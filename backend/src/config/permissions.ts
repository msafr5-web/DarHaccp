/** Roles inside a company (tenant). ADMIN = the company's own administrator. */
export const ROLES = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'] as const;
export type CompanyRole = (typeof ROLES)[number];
/** SaaS operator role: manages companies, never sees their operational data. */
export const PLATFORM_ROLE = 'PLATFORM_ADMIN' as const;
export type Role = CompanyRole | typeof PLATFORM_ROLE;

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
  // HSE & support services
  'staff:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'staff:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'],
  'staff:view-id': ['ADMIN', 'HSE_OFFICER'],
  'contractor:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'contractor:manage': ['ADMIN', 'HSE_OFFICER'],
  'document:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'document:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'],
  // Quality: anyone may report an incident; investigation follows the CAPA permissions
  'incident:create': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'incident:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'internal-audit:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'internal-audit:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'],
  // Confectionery: recipes & product data cards
  'recipe:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'recipe:manage': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR'],
  'label:create': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'label:read': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  // IoT probes
  'iot:manage': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Roles that may access every kitchen/department. */
export const CROSS_DEPARTMENT_ROLES: readonly Role[] = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
