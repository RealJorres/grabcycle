import { fail } from '../domain/errors';
import type { StaffRole } from '../domain/types';
import type { CallerContext } from './context';

/**
 * Server-enforced role-based access control for staff operations.
 * The admin dashboard hides controls a role cannot use, but authorization
 * is always decided here.
 */
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
  | 'privacy.manage'
  | 'staff.manage';

const REVIEWER: Permission[] = ['review.read', 'review.decide', 'documents.view', 'users.read'];
const SUPPORT: Permission[] = ['users.read', 'rides.read', 'support.manage', 'reports.read'];
const ADMIN: Permission[] = [
  ...new Set<Permission>([
    ...REVIEWER,
    ...SUPPORT,
    'users.suspend',
    'rides.intervene',
    'payments.manage',
    'config.manage',
    'audit.read',
    'privacy.manage',
  ]),
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  reviewer: REVIEWER,
  support: SUPPORT,
  admin: ADMIN,
  superadmin: [...ADMIN, 'staff.manage'],
};

export function hasPermission(role: StaffRole | null, permission: Permission): boolean {
  return role != null && ROLE_PERMISSIONS[role].includes(permission);
}

export function requirePermission(ctx: CallerContext, permission: Permission): StaffRole {
  if (!ctx.staffRole || !hasPermission(ctx.staffRole, permission)) {
    throw fail.forbidden();
  }
  return ctx.staffRole;
}
