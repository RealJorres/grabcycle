import type { Permission } from '../lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  permission: Permission | null;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', permission: null },
  { to: '/verifications', label: 'Passenger IDs', permission: 'review.read' },
  { to: '/drivers', label: 'Driver accreditation', permission: 'review.read' },
  { to: '/users', label: 'Users', permission: 'users.read' },
  { to: '/rides', label: 'Rides', permission: 'rides.read' },
  { to: '/support', label: 'Support', permission: 'support.manage' },
  { to: '/config', label: 'Configuration', permission: 'config.manage' },
  { to: '/audit', label: 'Audit log', permission: null },
  { to: '/staff', label: 'Staff', permission: 'staff.manage' },
];
