import type { User } from 'firebase/auth';
import { createContext, useContext } from 'react';
import type { Permission, StaffRole } from '../lib/permissions';

export interface AuthState {
  user: User | null;
  role: StaffRole | null;
  /** Signed in but the token carries no staff role (rider accounts, revoked staff). */
  notStaff: boolean;
  loading: boolean;
  can: (p: Permission) => boolean;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
