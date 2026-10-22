import type { StaffRole } from '../domain/types';
import { STAFF_ROLES } from '../domain/types';

/**
 * Authenticated caller identity, derived exclusively from the verified
 * Firebase ID token (never from request payloads).
 */
export interface CallerContext {
  uid: string;
  staffRole: StaffRole | null;
  phoneNumber: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Sign-in provider, e.g. "phone" or "password". */
  signInProvider: string | null;
}

export function contextFromToken(uid: string, token: Record<string, unknown>): CallerContext {
  const claimRole = token.staffRole;
  const staffRole = typeof claimRole === 'string' && (STAFF_ROLES as readonly string[]).includes(claimRole)
    ? (claimRole as StaffRole)
    : null;
  const firebase = (token.firebase ?? {}) as { sign_in_provider?: unknown };
  return {
    uid,
    staffRole,
    phoneNumber: typeof token.phone_number === 'string' ? token.phone_number : null,
    email: typeof token.email === 'string' ? token.email : null,
    emailVerified: token.email_verified === true,
    signInProvider: typeof firebase.sign_in_provider === 'string' ? firebase.sign_in_provider : null,
  };
}
