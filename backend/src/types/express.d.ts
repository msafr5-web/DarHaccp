import type { DepartmentCode, Role } from '../config/permissions';

export interface AuthUser {
  id: string;
  role: Role;
  departmentId: number | null;
  departmentCode: DepartmentCode | null;
  branchId: number | null;
  fullName: string;
  employeeNo: string;
  /** FILL = may only fill forms; FILL_EDIT = may also amend records (with a reason, fully traced). */
  recordAccess: 'FILL' | 'FILL_EDIT';
  /** Company (tenant) the user belongs to — every query of the request is confined to it. */
  tenantId: number;
  tenantCode: string;
  tenantName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Department resolved from the :department route param (after access check). */
      department?: { id: number; code: DepartmentCode };
      /** Parsed & validated input (Express 5 makes req.query read-only). */
      valid: { body?: any; query?: any; params?: any };
      requestId: string;
    }
  }
}
