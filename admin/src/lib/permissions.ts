/**
 * Mirror of the backend permission matrix (backend/functions/src/lib/permissions.ts).
 * Used ONLY to hide controls a role cannot use; every action is authorized
 * again by the Cloud Function and by Firestore rules. Keep in sync — a unit
 * test pins the expected matrix.
 */
export const STAFF_ROLES = ['superadmin', 'admin', 'reviewer', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | 'review.read'
  | 'review.decide'
  | 'documents.view'
  | 'users.read'
  | 'users.suspend'
  | 'rides.read'
  | 'rides.intervene'
  | 'payments.manage'
  | 'support.manage'
  | 'config.manage'
  | 'reports.read'
  | 'audit.read'
  | 'staff.manage';

const REVIEWER: Permission[] = ['review.read', 'review.decide', 'documents.view', 'users.read'];
const SUPPORT: Permission[] = ['users.read', 'rides.read', 'support.manage', 'reports.read'];
const ADMIN: Permission[] = [
  ...new Set<Permission>([...REVIEWER, ...SUPPORT, 'users.suspend', 'rides.intervene', 'payments.manage', 'config.manage', 'audit.read']),
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  reviewer: REVIEWER,
  support: SUPPORT,
  admin: ADMIN,
  superadmin: [...ADMIN, 'staff.manage'],
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  return role != null && ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Audit categories a role may read (mirrors the auditLogs rule): admins see
 * everything, reviewers only REVIEW, support only SUPPORT.
 */
export function auditCategoriesFor(role: StaffRole | null | undefined): string[] | 'ALL' {
  if (role === 'admin' || role === 'superadmin') return 'ALL';
  if (role === 'reviewer') return ['REVIEW'];
  if (role === 'support') return ['SUPPORT'];
  return [];
}
