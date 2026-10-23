import express, { Request, Response, Router } from 'express';
import { z } from 'zod';
import { hasPermission } from '../config/permissions';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { insertAuditEvent } from '../models/audit.model';
import * as reg from '../services/healthRegister.service';
import { created, dbContext, ok, requireUser } from '../utils/http';
import { idParams } from '../utils/schemas';

/** Health certificates register (Balady sheet): list, form, reveal ID, Excel / CSV import & export. */

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['VALID', 'EXPIRING', 'EXPIRED', 'RENEWAL_REQUIRED', 'NOT_FIT']).optional(),
  branch: z.string().trim().max(150).optional(),
});

const entrySchema = z.object({
  serial: z.number().int().positive().max(999999).nullable().optional(),
  branchName: z.string().max(150),
  baladyLicenseNo: z.string().max(20),
  internalSection: z.string().max(120).nullable().optional(),
  workerName: z.string().max(150),
  idNumber: z.string().max(20).optional(),
  birthDate: z.string().max(10).nullable().optional(),
  profession: z.string().max(120).nullable().optional(),
  mobile: z.string().max(20).nullable().optional(),
  examDate: z.string().max(10).nullable().optional(),
  examStatus: z.enum(['FIT', 'PENDING', 'UNFIT']),
  certExpiry: z.string().max(10).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  city: z.string().max(60).nullable().optional(),
  activityCode: z.string().max(30).nullable().optional(),
  requestNo: z.string().max(30).nullable().optional(),
  eduStatus: z.enum(['PENDING', 'PASSED', 'FAILED']).optional(),
  feePaidOn: z.string().max(10).nullable().optional(),
});

const exportQuery = z.object({ template: z.enum(['true', 'false']).optional() });
const importQuery = z.object({ apply: z.enum(['true', 'false']).default('false') });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const router = Router();

router.get('/health-register', authorize('staff:read'), validate({ query: listQuery }), async (req: Request, res: Response) => {
  ok(res, await reg.listRegister(req.valid.query as z.infer<typeof listQuery>));
});

/** The full sheet (with full ID numbers for HSE / admin, masked otherwise) as the establishment keeps it. */
router.get('/health-register/export.xlsx', authorize('staff:read'), validate({ query: exportQuery }), async (req: Request, res: Response) => {
  const user = requireUser(req);
  const template = (req.valid.query as z.infer<typeof exportQuery>).template === 'true';
  const fullIds = !template && hasPermission(user.role, 'staff:view-id');
  if (fullIds) {
    await insertAuditEvent({ userId: user.id, action: 'EXPORT', entity: 'health_register', entityId: null, data: { fullIds: true },
      ip: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId });
  }
  const file = await reg.exportRegister(user.tenantName, { template, fullIds });
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${template ? 'health-register-template' : `health-register-${new Date().toISOString().slice(0, 10)}`}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file);
});

// Raw .xlsx or .csv body (max 4 MB). apply=false → preview; apply=true → all-or-nothing.
router.post('/health-register/import', authorize('staff:manage'),
  express.raw({ type: [XLSX, 'text/csv', 'application/vnd.ms-excel', 'application/octet-stream'], limit: '4mb' }),
  validate({ query: importQuery }), async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'أرسل ملف Excel أو CSV' } });
    const { apply } = req.valid.query as z.infer<typeof importQuery>;
    return ok(res, await reg.importRegister(dbContext(req), req.body, apply === 'true'));
  });

router.post('/health-register', authorize('staff:manage'), validate({ body: entrySchema }), async (req: Request, res: Response) => {
  created(res, await reg.createEntry(dbContext(req), req.valid.body as reg.RegisterInput));
});

router.put('/health-register/:id', authorize('staff:manage'), validate({ params: idParams, body: entrySchema }), async (req: Request, res: Response) => {
  ok(res, await reg.updateEntry(dbContext(req), (req.valid.params as { id: string }).id, req.valid.body as reg.RegisterInput));
});

router.delete('/health-register/:id', authorize('staff:manage'), validate({ params: idParams }), async (req: Request, res: Response) => {
  await reg.deleteEntry(dbContext(req), (req.valid.params as { id: string }).id);
  ok(res, { deleted: true });
});

/** Full ID / iqama number: HSE / admin only, every reveal audited. */
router.get('/health-register/:id/id-number', authorize('staff:view-id'), validate({ params: idParams }), async (req: Request, res: Response) => {
  const { id } = req.valid.params as { id: string };
  const idNumber = await reg.revealIdNumber(id);
  const user = requireUser(req);
  await insertAuditEvent({ userId: user.id, action: 'VIEW_SENSITIVE', entity: 'health_register', entityId: id, data: { field: 'id_number' },
    ip: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId });
  ok(res, { id_number: idNumber });
});

export default router;
