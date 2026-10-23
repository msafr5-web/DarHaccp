import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { runInTenant } from '../config/database';
import { env } from '../config/env';
import { DEPARTMENTS, DepartmentCode, hasPermission, Permission, PLATFORM_ROLE, ROLES, Role, CROSS_DEPARTMENT_ROLES } from '../config/permissions';
import { findActiveUserForAuth } from '../models/user.model';
import { findDepartmentByCode } from '../models/department.model';
import { AppError } from '../utils/AppError';

interface TokenPayload {
  sub: string;
  role: Role;
  /** Tenant (company) id. */
  tid: number;
  iat: number;
}

export function signAccessToken(userId: string, role: Role, tenantId: number): string {
  return jwt.sign({ role, tid: tenantId }, env.JWT_SECRET, {
    subject: userId,
    issuer: env.JWT_ISSUER,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/**
 * JWT authentication. The user is re-loaded on each request so that deactivation,
 * role changes and password changes take effect immediately (token revocation).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();

  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      algorithms: ['HS256'],
    }) as unknown as TokenPayload;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new AppError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', expired ? 'Session expired, please sign in again' : 'Invalid token');
  }

  if (!Number.isInteger(payload.tid)) throw new AppError(401, 'INVALID_TOKEN', 'Session expired, please sign in again');

  // Everything below — including all downstream handlers — runs confined to this company.
  return runInTenant(payload.tid, async () => {
    const user = await findActiveUserForAuth(payload.sub);
    if (!user || !(ROLES.includes(user.role as never) || user.role === PLATFORM_ROLE)) {
      throw AppError.unauthorized('Account is disabled or no longer exists');
    }
    if (user.tenant_status !== 'ACTIVE') {
      throw new AppError(403, 'TENANT_SUSPENDED', 'حساب الشركة غير نشط — تواصل مع إدارة المنصة');
    }

    // Tokens issued before the last password change are revoked.
    if (Math.floor(new Date(user.password_changed_at).getTime() / 1000) > payload.iat) {
      throw new AppError(401, 'INVALID_TOKEN', 'Session revoked, please sign in again');
    }

    req.user = {
      id: user.id,
      role: user.role,
      departmentId: user.department_id,
      departmentCode: user.department_code,
      branchId: user.branch_id,
      fullName: user.full_name,
      employeeNo: user.employee_no,
      recordAccess: user.record_access,
      tenantId: payload.tid,
      tenantCode: user.tenant_code,
      tenantName: user.tenant_name,
    };
    next();
  });
}

/** SaaS operator endpoints. */
export function authorizePlatform(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== PLATFORM_ROLE) throw AppError.forbidden();
  next();
}

/** Scheduled-job endpoints: constant-time check of `Authorization: Bearer <CRON_SECRET>`. */
export function authorizeCron(req: Request, _res: Response, next: NextFunction) {
  const expected = env.CRON_SECRET ? Buffer.from(`Bearer ${env.CRON_SECRET}`) : null;
  const received = Buffer.from(req.headers.authorization ?? '');
  if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw AppError.notFound('Route');
  }
  next();
}

/** Role-based authorization by permission (see config/permissions.ts). */
export function authorize(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw AppError.unauthorized();
    const allowed = permissions.every((p) => hasPermission(req.user!.role, p));
    if (!allowed) throw AppError.forbidden();
    next();
  };
}

/** True when the user may act on the given department (kitchen). */
export function canAccessDepartment(user: Express.Request['user'], departmentId: number | null): boolean {
  if (!user) return false;
  if (CROSS_DEPARTMENT_ROLES.includes(user.role)) return true;
  return departmentId === null || user.departmentId === departmentId;
}

/**
 * Resolves `:department` (HOT | COLD | SWEETS | SUPPORT) and enforces department isolation:
 * chefs and supervisors only reach their own kitchen; officers and admins reach all.
 */
export async function authorizeDepartment(req: Request, _res: Response, next: NextFunction) {
  const code = String(req.params.department ?? '').toUpperCase();
  if (!DEPARTMENTS.includes(code as DepartmentCode)) throw AppError.notFound('Department');

  const department = await findDepartmentByCode(code as DepartmentCode);
  if (!department) throw AppError.notFound('Department');
  if (!canAccessDepartment(req.user, department.id)) {
    throw AppError.forbidden(`You are not assigned to the ${department.code} department`);
  }
  req.department = { id: department.id, code: department.code };
  next();
}
