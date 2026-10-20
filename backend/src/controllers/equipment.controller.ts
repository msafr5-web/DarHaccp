import type { Request, Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/database';
import { findDepartmentByCode } from '../models/department.model';
import { EquipmentStatus, findEquipment, listEquipment } from '../models/equipment.model';
import { canAccessDepartment } from '../middlewares/auth';
import { generateQrToken } from '../services/qr.service';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, optText, uuid } from '../utils/schemas';

const status = z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE']);

export const listEquipmentQuery = z.object({
  department: departmentCode.optional(),
  status: status.optional(),
  type: z.string().trim().max(40).optional(),
});

export const equipmentSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  name: z.string().trim().min(2).max(150),
  type: z.string().trim().toUpperCase().min(2).max(40),
  department: departmentCode,
  location: optText(150),
  formTemplateId: uuid.optional(),
  maintenanceIntervalDays: z.number().int().min(1).max(730).default(90),
  lastMaintenanceDate: isoDate.optional(),
});

export const equipmentUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    location: z.string().trim().max(150).nullable(),
    status,
    formTemplateId: uuid.nullable(),
    maintenanceIntervalDays: z.number().int().min(1).max(730),
    isActive: z.boolean(),
  })
  .partial();

export const maintenanceSchema = z.object({
  type: z.enum(['PREVENTIVE', 'CORRECTIVE', 'CALIBRATION']),
  description: z.string().trim().min(3).max(2000),
  vendor: optText(150),
  performedAt: isoDate,
  /** Defaults to performedAt + the equipment's maintenance interval. */
  nextDueDate: isoDate.optional(),
  /** Status after the intervention (e.g. back to OPERATIONAL). */
  resultingStatus: status.default('OPERATIONAL'),
});

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listEquipmentQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  return ok(res, await listEquipment({ departmentId, status: q.status as EquipmentStatus | undefined, type: q.type }));
}

export async function get(req: Request, res: Response) {
  const e = await findEquipment({ id: (req.valid.params as { id: string }).id });
  if (!e || !canAccessDepartment(req.user, e.department_id)) throw AppError.notFound('Equipment');
  return ok(res, e);
}

export async function create(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof equipmentSchema>;
  const dept = await findDepartmentByCode(b.department);
  if (!dept) throw AppError.notFound('Department');
  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO equipment (code, name, type, department_id, location, form_template_id, qr_token,
                              maintenance_interval_days, last_maintenance_date, next_maintenance_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date, COALESCE($9::date, CURRENT_DATE) + $8::int) RETURNING id`,
      [b.code, b.name, b.type, dept.id, b.location ?? null, b.formTemplateId ?? null, generateQrToken(),
        b.maintenanceIntervalDays, b.lastMaintenanceDate ?? null],
    );
    return rows[0]!.id;
  });
  return created(res, await findEquipment({ id }));
}

export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof equipmentUpdateSchema>;
  const result = await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE equipment SET name = COALESCE($2, name),
              location = CASE WHEN $3::boolean THEN $4 ELSE location END,
              status = COALESCE($5, status),
              form_template_id = CASE WHEN $6::boolean THEN $7::uuid ELSE form_template_id END,
              maintenance_interval_days = COALESCE($8, maintenance_interval_days),
              is_active = COALESCE($9, is_active)
        WHERE id = $1`,
      [id, b.name ?? null, b.location !== undefined, b.location ?? null, b.status ?? null,
        b.formTemplateId !== undefined, b.formTemplateId ?? null, b.maintenanceIntervalDays ?? null, b.isActive ?? null],
    ),
  );
  if (!result.rowCount) throw AppError.notFound('Equipment');
  return ok(res, await findEquipment({ id }));
}

export async function addMaintenance(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof maintenanceSchema>;
  const equipment = await findEquipment({ id });
  if (!equipment) throw AppError.notFound('Equipment');

  const log = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `INSERT INTO maintenance_logs (equipment_id, type, description, performed_by, vendor, performed_at, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6::date, COALESCE($7::date, $6::date + $8::int)) RETURNING *`,
      [id, b.type, b.description, req.user!.id, b.vendor ?? null, b.performedAt, b.nextDueDate ?? null, equipment.maintenance_interval_days],
    );
    const entry = rows[0] as { next_due_date: string };
    await db.query(
      `UPDATE equipment SET status = $2,
              last_maintenance_date = GREATEST(COALESCE(last_maintenance_date, $3::date), $3::date),
              next_maintenance_date = CASE WHEN $5 = 'PREVENTIVE' OR next_maintenance_date IS NULL THEN $4::date ELSE next_maintenance_date END
        WHERE id = $1`,
      [id, b.resultingStatus, b.performedAt, entry.next_due_date, b.type],
    );
    return rows[0];
  });
  return created(res, log);
}
