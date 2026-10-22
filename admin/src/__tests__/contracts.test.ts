import { describe, expect, it } from 'vitest';
// Contract tests against the backend's own source of truth: if a role or
// payment rule changes server-side, the dashboard mirror must change too.
import { canTransitionPayment } from '../../../backend/functions/src/domain/payment';
import { ROLE_PERMISSIONS as BACKEND_ROLE_PERMISSIONS } from '../../../backend/functions/src/lib/permissions';
import { paymentTargets } from '../lib/payments';
import { auditCategoriesFor, can, ROLE_PERMISSIONS, STAFF_ROLES } from '../lib/permissions';

describe('permission matrix mirror', () => {
  it('matches the backend exactly for every role', () => {
    for (const role of STAFF_ROLES) {
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...BACKEND_ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('gates by role and denies unknown roles', () => {
    expect(can('reviewer', 'documents.view')).toBe(true);
    expect(can('support', 'documents.view')).toBe(false);
    expect(can('admin', 'staff.manage')).toBe(false);
    expect(can('superadmin', 'staff.manage')).toBe(true);
    expect(can(null, 'users.read')).toBe(false);
  });

  it('limits audit categories like the Firestore rule', () => {
    expect(auditCategoriesFor('admin')).toBe('ALL');
    expect(auditCategoriesFor('reviewer')).toEqual(['REVIEW']);
    expect(auditCategoriesFor('support')).toEqual(['SUPPORT']);
    expect(auditCategoriesFor(null)).toEqual([]);
  });
});

describe('payment resolution mirror', () => {
  it('only offers transitions the backend allows an admin to make', () => {
    for (const from of ['UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'DISPUTED'] as const) {
      for (const to of ['PAID', 'REFUNDED', 'FAILED'] as const) {
        expect(paymentTargets(from).includes(to), `${from} -> ${to}`).toBe(canTransitionPayment(from, to, 'ADMIN'));
      }
    }
  });
});
