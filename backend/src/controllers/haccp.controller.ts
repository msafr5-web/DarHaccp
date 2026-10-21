import type { Request, Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/database';
import { findDepartmentByCode } from '../models/department.model';
import { Ccp, findCcpById, findTemplate, listCcps, listTemplates } from '../models/haccp.model';
import { findRecordById, listRecords } from '../models/record.model';
import { canAccessDepartment } from '../middlewares/auth';
import { formFieldsSchema } from '../services/haccpRules';
import { generateQrToken } from '../services/qr.service';
import { submitRecord } from '../services/record.service';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { departmentCode, isoDateTime, optText, pagination, uuid } from '../utils/schemas';

// ---------------------------------------------------------------- CCPs

const severity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ccpSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/, 'Code like CCP-1'),
    nameAr: z.string().trim().min(2).max(150),
    nameEn: z.string().trim().min(2).max(150),
    department: departmentCode.nullable().default(null),
    hazard: z.string().trim().min(2).max(1000),
    parameter: z.string().trim().max(50).default('TEMPERATURE'),
    unit: z.string().trim().max(10).default('°C'),
    minValue: z.number().nullable().default(null),
    maxValue: z.number().nullable().default(null),
    monitoringFrequency: z.string().trim().min(2).max(100),
    correctiveAction: z.string().trim().min(5).max(2000),
    severity: severity.default('CRITICAL'),
  })
  .refine((c) => c.minValue !== null || c.maxValue !== null, { message: 'At least one critical limit (min or max) is required' })
  .refine((c) => c.minValue === null || c.maxValue === null || c.minValue <= c.maxValue, { message: 'minValue must be ≤ maxValue' });

export const ccpUpdateSchema = z
  .object({
    nameAr: z.string().trim().min(2).max(150),
    nameEn: z.string().trim().min(2).max(150),
    hazard: z.string().trim().min(2).max(1000),
    minValue: z.number().nullable(),
    maxValue: z.number().nullable(),
    monitoringFrequency: z.string().trim().min(2).max(100),
    correctiveAction: z.string().trim().min(5).max(2000),
    severity,
    isActive: z.boolean(),
  })
  .partial();

const deptId = async (code: string | null | undefined) => (code ? (await findDepartmentByCode(code as never))?.id ?? null : null);

export async function getCcps(req: Request, res: Response) {
  const user = requireUser(req);
  return ok(res, await listCcps(user.departmentId ?? undefined));
}

export async function createCcp(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof ccpSchema>;
  const ccp = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<Ccp>(
      `INSERT INTO ccps (code, name_ar, name_en, department_id, hazard, parameter, unit, min_value, max_value,
                         monitoring_frequency, corrective_action, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.code, b.nameAr, b.nameEn, await deptId(b.department), b.hazard, b.parameter, b.unit, b.minValue, b.maxValue,
        b.monitoringFrequency, b.correctiveAction, b.severity],
    );
    return rows[0];
  });
  return created(res, ccp);
}

/** Critical-limit changes are fully traced in the audit log (old vs new values). */
export async function updateCcp(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof ccpUpdateSchema>;
  const existing = await findCcpById(id);
  if (!existing) throw AppError.notFound('CCP');

  const min = b.minValue !== undefined ? b.minValue : existing.min_value;
  const max = b.maxValue !== undefined ? b.maxValue : existing.max_value;
  if (min === null && max === null) throw AppError.unprocessable('At least one critical limit is required');
  if (min !== null && max !== null && min > max) throw AppError.unprocessable('minValue must be ≤ maxValue');

  const ccp = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<Ccp>(
      `UPDATE ccps SET name_ar = COALESCE($2, name_ar), name_en = COALESCE($3, name_en), hazard = COALESCE($4, hazard),
              min_value = $5, max_value = $6, monitoring_frequency = COALESCE($7, monitoring_frequency),
              corrective_action = COALESCE($8, corrective_action), severity = COALESCE($9, severity),
              is_active = COALESCE($10, is_active)
        WHERE id = $1 RETURNING *`,
      [id, b.nameAr ?? null, b.nameEn ?? null, b.hazard ?? null, min, max, b.monitoringFrequency ?? null,
        b.correctiveAction ?? null, b.severity ?? null, b.isActive ?? null],
    );
    return rows[0];
  });
  return ok(res, ccp);
}

// ---------------------------------------------------------------- Form templates

export const templateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{3,50}$/, 'Code like MEAT_RECEIVING'),
  titleAr: z.string().trim().min(2).max(200),
  titleEn: z.string().trim().min(2).max(200),
  description: optText(2000),
  department: departmentCode.nullable().default(null),
  ccpId: uuid.nullable().default(null),
  fields: formFieldsSchema,
});

export const templateUpdateSchema = z
  .object({
    titleAr: z.string().trim().min(2).max(200),
    titleEn: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).nullable(),
    ccpId: uuid.nullable(),
    fields: formFieldsSchema,
    isActive: z.boolean(),
  })
  .partial();

function assertCcpField(fields: { ccpMeasurement?: boolean }[], ccpId: string | null) {
  if (ccpId && !fields.some((f) => f.ccpMeasurement)) {
    throw AppError.unprocessable('A form linked to a CCP needs one field with ccpMeasurement: true');
  }
}

export async function getTemplates(req: Request, res: Response) {
  const user = requireUser(req);
  return ok(res, await listTemplates(user.departmentId ?? undefined));
}

export async function getTemplate(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const t = await findTemplate({ id });
  if (!t || !canAccessDepartment(req.user, t.department_id)) throw AppError.notFound('Form template');
  return ok(res, t);
}

export async function createTemplate(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof templateSchema>;
  assertCcpField(b.fields, b.ccpId);
  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO form_templates (code, title_ar, title_en, description, department_id, ccp_id, fields, qr_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.code, b.titleAr, b.titleEn, b.description ?? null, await deptId(b.department), b.ccpId, JSON.stringify(b.fields), generateQrToken()],
    );
    return rows[0]!.id;
  });
  return created(res, await findTemplate({ id }));
}

/** Changing fields bumps the version; past records keep the version they were captured with. */
export async function updateTemplate(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof templateUpdateSchema>;
  const existing = await findTemplate({ id });
  if (!existing) throw AppError.notFound('Form template');
  assertCcpField(b.fields ?? existing.fields, b.ccpId !== undefined ? b.ccpId : existing.ccp_id);

  await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE form_templates SET title_ar = COALESCE($2, title_ar), title_en = COALESCE($3, title_en),
              description = CASE WHEN $4::boolean THEN $5 ELSE description END,
              ccp_id = CASE WHEN $6::boolean THEN $7::uuid ELSE ccp_id END,
              fields = COALESCE($8::jsonb, fields),
              version = version + CASE WHEN $8::jsonb IS NOT NULL THEN 1 ELSE 0 END,
              is_active = COALESCE($9, is_active)
        WHERE id = $1`,
      [id, b.titleAr ?? null, b.titleEn ?? null, b.description !== undefined, b.description ?? null,
        b.ccpId !== undefined, b.ccpId ?? null, b.fields ? JSON.stringify(b.fields) : null, b.isActive ?? null],
    ),
  );
  return ok(res, await findTemplate({ id }));
}

// ---------------------------------------------------------------- Monitoring records (per kitchen)

export const listRecordsQuery = pagination.extend({
  status: z.enum(['PASS', 'FAIL']).optional(),
  ccpId: uuid.optional(),
  templateId: uuid.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export const submitRecordSchema = z.object({
  templateId: uuid,
  equipmentId: uuid.optional(),
  data: z.record(z.string(), z.unknown()),
  productName: optText(150),
  batchNo: optText(60),
  notes: optText(2000),
  correctiveActionTaken: optText(2000),
  source: z.enum(['QR', 'MANUAL']).default('MANUAL'),
  recordedAt: isoDateTime.optional(),
  clientRef: uuid.optional(),
});

export async function getRecords(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listRecordsQuery>;
  const { rows, total } = await listRecords({ departmentId: req.department!.id, ...q, ...paginate(q.page, q.pageSize) });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

export async function getRecord(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const record = await findRecordById(id);
  if (!record || record.department_id !== req.department!.id) throw AppError.notFound('Record');
  return ok(res, record);
}

export async function createRecord(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof submitRecordSchema>;
  const record = await submitRecord(dbContext(req), requireUser(req), req.department!, b);
  // 201 in both cases; the client inspects `status` / `deviations` to show the CAPA prompt.
  return created(res, record);
}
