/**
 * Authoritative role/permission matrix. The server never trusts a role or permission supplied by a
 * client. The frontend mirrors the permission names for display, but every route resolves access
 * from this table and the current membership/company membership in PostgreSQL.
 *
 * The matrix follows master plan §9.3. Owner and Admin are identical except that ownership transfer
 * and OWNER invitations are restricted to an existing OWNER (last-owner protection is separate).
 */

export const ROLES = ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR', 'AUDITOR'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'MANAGE_COMPANY_SETTINGS',
  'MANAGE_MASTERS_AND_COA',
  'CREATE_COMMERCIAL_DRAFT',
  'DISPATCH_OR_RECEIVE_STOCK',
  'POST_TO_GL',
  'APPROVE_HIGH_VALUE',
  'OVERRIDE_3WAY_VARIANCE',
  'REVERSE_POSTED_JOURNAL',
  'SUBMIT_CLOSE_MAKER',
  'APPROVE_CLOSE_CHECKER',
  'REOPEN_PERIOD',
  'MANAGE_USERS_AND_ORG',
  'VIEW_REPORTS',
  'VIEW_LIMITED_REPORTS',
  'EXPORT_DATA',
  'OVERRIDE_NEGATIVE_STOCK',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: OWNER_PERMISSIONS,
  CONTROLLER: [
    'MANAGE_COMPANY_SETTINGS',
    'MANAGE_MASTERS_AND_COA',
    'CREATE_COMMERCIAL_DRAFT',
    'DISPATCH_OR_RECEIVE_STOCK',
    'POST_TO_GL',
    'APPROVE_HIGH_VALUE',
    'OVERRIDE_3WAY_VARIANCE',
    'REVERSE_POSTED_JOURNAL',
    'SUBMIT_CLOSE_MAKER',
    'APPROVE_CLOSE_CHECKER',
    'REOPEN_PERIOD',
    'VIEW_REPORTS',
    'EXPORT_DATA',
    'OVERRIDE_NEGATIVE_STOCK',
  ],
  ACCOUNTANT: [
    'MANAGE_MASTERS_AND_COA',
    'CREATE_COMMERCIAL_DRAFT',
    'DISPATCH_OR_RECEIVE_STOCK',
    'POST_TO_GL',
    'SUBMIT_CLOSE_MAKER',
    'VIEW_REPORTS',
    'EXPORT_DATA',
  ],
  OPERATOR: ['CREATE_COMMERCIAL_DRAFT', 'DISPATCH_OR_RECEIVE_STOCK', 'VIEW_LIMITED_REPORTS'],
  AUDITOR: ['VIEW_REPORTS', 'EXPORT_DATA'],
};

const PERMISSION_SET_BY_ROLE = Object.fromEntries(
  ROLES.map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
) as unknown as Record<Role, ReadonlySet<Permission>>;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Effective company role: an explicit company override wins over the organisation membership role. */
export function effectiveRole(membershipRole: Role, roleOverride: Role | null | undefined): Role {
  return roleOverride ?? membershipRole;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_SET_BY_ROLE[role].has(permission);
}

export function isReadOnlyRole(role: Role): boolean {
  return role === 'AUDITOR';
}

export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === 'OWNER') return actorRole === 'OWNER';
  return actorRole === 'OWNER' || actorRole === 'ADMIN';
}
