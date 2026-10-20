import { CROSS_DEPARTMENT_ROLES, DepartmentCode } from '../config/permissions';
import { findDepartmentByCode } from '../models/department.model';
import type { AuthUser } from '../types/express';
import { AppError } from './AppError';

/**
 * Department filter for list/dashboard queries:
 * - kitchen roles are always pinned to their own department;
 * - cross-department roles see everything, or a single department when requested.
 */
export async function resolveDepartmentScope(user: AuthUser, requested?: DepartmentCode): Promise<number | null> {
  if (!CROSS_DEPARTMENT_ROLES.includes(user.role)) {
    if (requested && requested !== user.departmentCode) throw AppError.forbidden('You can only view your own department');
    return user.departmentId;
  }
  if (!requested) return null;
  const dept = await findDepartmentByCode(requested);
  if (!dept) throw AppError.notFound('Department');
  return dept.id;
}
