import { pool, query, Queryable } from '../config/database';
import type { DepartmentCode, Role } from '../config/permissions';

export interface UserRow {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  department_id: number | null;
  department_code: DepartmentCode | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const PUBLIC_COLUMNS = `u.id, u.employee_no, u.full_name, u.email, u.phone, u.role, u.department_id,
  d.code AS department_code, u.is_active, u.last_login_at, u.created_at`;

export async function findActiveUserForAuth(id: string) {
  const { rows } = await query<UserRow & { password_changed_at: string }>(
    `SELECT ${PUBLIC_COLUMNS}, u.password_changed_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1 AND u.is_active`,
    [id],
  );
  return rows[0];
}

export async function findUserForLogin(email: string) {
  const { rows } = await query<UserRow & { password_hash: string; failed_login_attempts: number; locked_until: string | null }>(
    `SELECT ${PUBLIC_COLUMNS}, u.password_hash, u.failed_login_attempts, u.locked_until
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE LOWER(u.email) = LOWER($1)`,
    [email],
  );
  return rows[0];
}

export async function findUserById(id: string, db: Queryable = pool) {
  const { rows } = await db.query<UserRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
    [id],
  );
  return rows[0];
}

export async function listUsers(filters: { role?: Role; departmentId?: number; search?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.role) where.push(`u.role = $${params.push(filters.role)}`);
  if (filters.departmentId) where.push(`u.department_id = $${params.push(filters.departmentId)}`);
  if (filters.search) {
    const p = params.push(`%${filters.search}%`);
    where.push(`(u.full_name ILIKE $${p} OR u.email ILIKE $${p} OR u.employee_no ILIKE $${p})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query<UserRow & { total: number }>(
    `SELECT ${PUBLIC_COLUMNS}, COUNT(*) OVER()::int AS total
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ${whereSql}
      ORDER BY u.full_name
      LIMIT $${params.push(filters.limit)} OFFSET $${params.push(filters.offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}
