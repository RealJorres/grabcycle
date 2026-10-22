import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button, Loading } from '../components/ui';
import type { Permission } from '../lib/permissions';
import { useAuth } from './authContext';

/** Blocks the dashboard for signed-out users and identities without a staff role. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, notStaff, loading, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (notStaff) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow-sm ring-1 ring-line">
          <h1 className="text-xl font-semibold">No staff access</h1>
          <p className="mt-2 text-sm text-muted">
            {user.email} is signed in but has no GrabCycle staff role. A superadmin must grant one. If a role was just granted, sign in again.
          </p>
          <Button className="mt-6" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Page-level permission gate (the backend and rules enforce the same rule). */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="rounded-xl bg-surface p-8 ring-1 ring-line">
        <h1 className="text-lg font-semibold">Not available for your role</h1>
        <p className="mt-1 text-sm text-muted">Ask a superadmin if you need this access.</p>
      </div>
    );
  }
  return <>{children}</>;
}
