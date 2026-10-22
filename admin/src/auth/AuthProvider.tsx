import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { requireFirebase } from '../lib/firebase';
import { can, isStaffRole, type StaffRole } from '../lib/permissions';
import { AuthContext, type AuthState } from './authContext';



/**
 * Tracks the Firebase session and the `staffRole` custom claim. The claim is
 * read from the verified ID token; role changes made by a superadmin revoke
 * refresh tokens server-side, which signs the affected session out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = requireFirebase();
    return onIdTokenChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }
      try {
        const token = await u.getIdTokenResult();
        const claim = token.claims.staffRole;
        setRole(isStaffRole(claim) ? claim : null);
        setUser(u);
      } catch {
        // Token refresh failed (revoked or disabled account): end the session.
        await fbSignOut(auth);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      notStaff: user != null && role == null,
      loading,
      can: (p) => can(role, p),
      signOut: () => fbSignOut(requireFirebase().auth),
    }),
    [user, role, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Test/preview helper: provide a fixed auth state. */
export function AuthStateProvider({ value, children }: { value: AuthState; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
