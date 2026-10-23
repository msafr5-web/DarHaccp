import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { hasPermission } from '../config/permissions';
import { insertAuditEvent } from '../models/audit.model';
import { findDepartmentByCode } from '../models/department.model';
import { findStaff, listStaff } from '../models/staff.model';
import { canAccessDepartment } from '../middlewares/auth';
import { AppError } from '../utils/AppError';
import { decrypt, encrypt } from '../utils/crypto';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, optText, pagination, uuid } from '../utils/schemas';

const idNumber = z.string().trim().regex(/^[12]\d{9}$/, 'National ID / Iqama must be 10 digits starting with 1 or 2');

export const listStaffQuery = pagination.extend({
  department: departmentCode.optional(),
  fitness: z.enum(['FIT', 'EXPIRING_SOON', 'UNFIT']).optional(),
  search: z.string().trim().max(100).optional(),
});

export const staffSchema = z.object({
  employeeNo: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(2).max(150),
  nationality: optText(60),
  idNumber: idNumber.optional(),
  jobTitle: optText(100),
  department: departmentCode,
  userId: uuid.optional(),
  isFoodHandler: z.boolean().default(true),
  hireDate: isoDate.optional(),
  phone: optText(20),
});

export const staffUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    nationality: z.string().trim().max(60).nullable(),
    idNumber: idNumber,
    jobTitle: z.string().trim().max(100).nullable(),
    department: departmentCode,
    isFoodHandler: z.boolean(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']),
    phone: z.string().trim().max(20).nullable(),
  })
  .partial();

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listStaffQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const { rows, total } = await listStaff({
    warningDays: env.HEALTH_CERT_WARNING_DAYS,
    timezone: env.APP_TIMEZONE,
    departmentId,
    fitness: q.fitness,
    search: q.search,
    ...paginate(q.page, q.pageSize),
  });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

/** Staff file: certificates history and the last daily health checks. The full ID is decrypted only for HSE/admin and audited. */
export async function get(req: Request, res: Response) {
  const user = requireUser(req);
  const { id } = req.valid.params as { id: string };
  const staff = await findStaff(id, env.HEALTH_CERT_WARNING_DAYS, env.APP_TIMEZONE);
  if (!staff || !canAccessDepartment(user, staff.department_id)) throw AppError.notFound('Staff member');

  const [certificates, dailyChecks] = await Promise.all([
    query(
      `SELECT id, certificate_no AS municipality_cert_no, issuing_authority, issue_date, expiry_date
         FROM health_certificates WHERE staff_id = $1 OR employee_no = $2 ORDER BY expiry_date DESC`,
      [staff.id, staff.employee_no],
    ),
    query(
      `SELECT r.id, r.recorded_at, r.status, r.measured_value, r.data, u.full_name AS recorded_by
         FROM monitoring_records r JOIN form_templates t ON t.id = r.template_id JOIN users u ON u.id = r.recorded_by
        WHERE t.code = 'STAFF_DAILY_HEALTH' AND r.data ->> 'employee_no' = $1
        ORDER BY r.recorded_at DESC LIMIT 14`,
      [staff.employee_no],
    ),
  ]);

  const { id_number_enc, ...publicStaff } = staff;
  let id_number: string | undefined;
  if (id_number_enc && hasPermission(user.role, 'staff:view-id')) {
    id_number = decrypt(id_number_enc);
    await insertAuditEvent({
      userId: user.id, action: 'VIEW_SENSITIVE', entity: 'staff', entityId: staff.id,
      data: { field: 'id_number' }, ip: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId,
    });
  }
  return ok(res, { ...publicStaff, id_number, certificates: certificates.rows, dailyChecks: dailyChecks.rows });
}

export async function create(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof staffSchema>;
  const dept = await findDepartmentByCode(b.department);
  if (!dept) throw AppError.notFound('Department');
  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO staff (employee_no, full_name, nationality, id_number_enc, id_number_last4, job_title, department_id,
                          branch_id, user_id, is_food_handler, hire_date, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)),$9,$10,$11,$12)
       RETURNING id`,
      [b.employeeNo, b.fullName, b.nationality ?? null, b.idNumber ? encrypt(b.idNumber) : null, b.idNumber?.slice(-4) ?? null,
        b.jobTitle ?? null, dept.id, req.user!.branchId, b.userId ?? null, b.isFoodHandler, b.hireDate ?? null, b.phone ?? null],
    );
    // Link certificates already registered under this employee number.
    await db.query('UPDATE health_certificates SET staff_id = $1 WHERE employee_no = $2 AND staff_id IS NULL', [rows[0]!.id, b.employeeNo]);
    return rows[0]!.id;
  });
  return created(res, await findStaff(id, env.HEALTH_CERT_WARNING_DAYS, env.APP_TIMEZONE).then((s) => s && { ...s, id_number_enc: undefined }));
}

export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof staffUpdateSchema>;
  const deptId = b.department ? (await findDepartmentByCode(b.department))?.id ?? null : null;
  const result = await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE staff SET full_name = COALESCE($2, full_name),
              nationality = CASE WHEN $3::boolean THEN $4 ELSE nationality END,
              id_number_enc = COALESCE($5, id_number_enc), id_number_last4 = COALESCE($6, id_number_last4),
              job_title = CASE WHEN $7::boolean THEN $8 ELSE job_title END,
              department_id = COALESCE($9, department_id), is_food_handler = COALESCE($10, is_food_handler),
              status = COALESCE($11, status), phone = CASE WHEN $12::boolean THEN $13 ELSE phone END
        WHERE id = $1`,
      [id, b.fullName ?? null, b.nationality !== undefined, b.nationality ?? null,
        b.idNumber ? encrypt(b.idNumber) : null, b.idNumber?.slice(-4) ?? null,
        b.jobTitle !== undefined, b.jobTitle ?? null, deptId, b.isFoodHandler ?? null, b.status ?? null,
        b.phone !== undefined, b.phone ?? null],
    ),
  );
  if (!result.rowCount) throw AppError.notFound('Staff member');
  const staff = await findStaff(id, env.HEALTH_CERT_WARNING_DAYS, env.APP_TIMEZONE);
  return ok(res, staff && { ...staff, id_number_enc: undefined });
}
