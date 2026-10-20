import type { Request, Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/database';
import { env } from '../config/env';
import { findDepartmentByCode } from '../models/department.model';
import { listHealthCertificates } from '../models/healthCertificate.model';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, optText, pagination, uuid } from '../utils/schemas';

export const listCertsQuery = pagination.extend({
  department: departmentCode.optional(),
  state: z.enum(['VALID', 'EXPIRING_SOON', 'EXPIRED']).optional(),
  search: z.string().trim().max(100).optional(),
});

export const certSchema = z
  .object({
    userId: uuid.optional(),
    employeeNo: z.string().trim().min(1).max(30),
    employeeName: z.string().trim().min(2).max(150),
    department: departmentCode,
    certificateNo: z.string().trim().min(3).max(60),
    issuingAuthority: z.string().trim().max(150).default('Baladi'),
    issueDate: isoDate,
    expiryDate: isoDate,
    notes: optText(1000),
  })
  .refine((c) => c.expiryDate > c.issueDate, { message: 'expiryDate must be after issueDate', path: ['expiryDate'] });

export const certUpdateSchema = z
  .object({ expiryDate: isoDate, issueDate: isoDate, issuingAuthority: z.string().trim().max(150), notes: z.string().trim().max(1000).nullable() })
  .partial();

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listCertsQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const { rows, total } = await listHealthCertificates({
    warningDays: env.HEALTH_CERT_WARNING_DAYS,
    timezone: env.APP_TIMEZONE,
    departmentId,
    state: q.state,
    search: q.search,
    ...paginate(q.page, q.pageSize),
  });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

export async function create(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof certSchema>;
  const dept = await findDepartmentByCode(b.department);
  if (!dept) throw AppError.notFound('Department');
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `INSERT INTO health_certificates (user_id, employee_no, employee_name, department_id, certificate_no,
                                        issuing_authority, issue_date, expiry_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.userId ?? null, b.employeeNo, b.employeeName, dept.id, b.certificateNo, b.issuingAuthority, b.issueDate,
        b.expiryDate, b.notes ?? null, req.user!.id],
    );
    return rows[0];
  });
  return created(res, row);
}

export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof certUpdateSchema>;
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `UPDATE health_certificates SET expiry_date = COALESCE($2, expiry_date), issue_date = COALESCE($3, issue_date),
              issuing_authority = COALESCE($4, issuing_authority),
              notes = CASE WHEN $5::boolean THEN $6 ELSE notes END
        WHERE id = $1 RETURNING *`,
      [id, b.expiryDate ?? null, b.issueDate ?? null, b.issuingAuthority ?? null, b.notes !== undefined, b.notes ?? null],
    );
    return rows[0];
  });
  if (!row) throw AppError.notFound('Health certificate');
  return ok(res, row);
}
