import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTransaction } from '../config/database';
import { CROSS_DEPARTMENT_ROLES, ROLES } from '../config/permissions';
import { findDepartmentByCode, listDepartments } from '../models/department.model';
import { findUserById, listUsers } from '../models/user.model';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, paginate } from '../utils/http';
import { departmentCode, pagination } from '../utils/schemas';
import { passwordPolicy } from './auth.controller';

export const listUsersQuery = pagination.extend({
  role: z.enum(ROLES).optional(),
  department: departmentCode.optional(),
  search: z.string().trim().max(100).optional(),
});

export const createUserSchema = z.object({
  employeeNo: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(2).max(150),
  email: z.email().max(255),
  phone: z.string().trim().max(20).optional(),
  password: passwordPolicy,
  role: z.enum(ROLES),
  department: departmentCode.optional(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    phone: z.string().trim().max(20).nullable(),
    role: z.enum(ROLES),
    department: departmentCode.nullable(),
    isActive: z.boolean(),
  })
  .partial();

async function departmentId(code: string | null | undefined) {
  if (!code) return null;
  const d = await findDepartmentByCode(code as never);
  if (!d) throw AppError.notFound('Department');
  return d.id;
}

export async function getDepartments(_req: Request, res: Response) {
  return ok(res, await listDepartments());
}

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listUsersQuery>;
  const { rows, total } = await listUsers({
    role: q.role,
    departmentId: (await departmentId(q.department)) ?? undefined,
    search: q.search,
    ...paginate(q.page, q.pageSize),
  });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

export async function create(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof createUserSchema>;
  const deptId = await departmentId(b.department);
  if (!CROSS_DEPARTMENT_ROLES.includes(b.role) && !deptId) {
    throw AppError.unprocessable('Kitchen staff (supervisor/chef) must be assigned to a department');
  }
  const hash = await bcrypt.hash(b.password, 12);
  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (employee_no, full_name, email, phone, password_hash, role, department_id)
       VALUES ($1, $2, LOWER($3), $4, $5, $6, $7) RETURNING id`,
      [b.employeeNo, b.fullName, b.email, b.phone ?? null, hash, b.role, deptId],
    );
    return rows[0]!.id;
  });
  return created(res, await findUserById(id));
}

export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof updateUserSchema>;
  if (id === req.user!.id && (b.isActive === false || (b.role && b.role !== 'ADMIN'))) {
    throw AppError.conflict('You cannot deactivate or demote your own account');
  }
  const existing = await findUserById(id);
  if (!existing) throw AppError.notFound('User');

  const deptId = b.department === undefined ? existing.department_id : await departmentId(b.department);
  await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE users SET full_name = COALESCE($2, full_name),
              phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
              role = COALESCE($5, role), department_id = $6, is_active = COALESCE($7, is_active),
              -- Deactivation also clears the push token so the device stops receiving alerts.
              push_token = CASE WHEN $7 = false THEN NULL ELSE push_token END
        WHERE id = $1`,
      [id, b.fullName ?? null, b.phone !== undefined, b.phone ?? null, b.role ?? null, deptId, b.isActive ?? null],
    ),
  );
  return ok(res, await findUserById(id));
}
