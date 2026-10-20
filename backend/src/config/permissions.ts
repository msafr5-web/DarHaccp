export const ROLES = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'] as const;
export type Role = (typeof ROLES)[number];

export const DEPARTMENTS = ['HOT', 'COLD', 'SWEETS', 'SUPPORT'] as const;
export type DepartmentCode = (typeof DEPARTMENTS)[number];

/** Fine-grained permissions. Routes ask for a permission, never for a hard-coded role list. */
export const PERMISSIONS = {
  'record:create': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'record:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'capa:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'capa:update': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR'],
  'capa:verify': ['ADMIN', 'HACCP_OFFICER'],
  'alert:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'alert:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'haccp:manage': ['ADMIN', 'HACCP_OFFICER'],
  'qr:manage': ['ADMIN', 'HACCP_OFFICER'],
  'healthcert:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'healthcert:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'],
  'equipment:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'equipment:manage': ['ADMIN', 'HSE_OFFICER'],
  'dashboard:view': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'audit:read': ['ADMIN', 'HACCP_OFFICER'],
  'user:manage': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Roles that may access every kitchen/department. */
export const CROSS_DEPARTMENT_ROLES: readonly Role[] = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
