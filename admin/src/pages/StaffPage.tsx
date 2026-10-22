import { collection, orderBy, query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Card, ErrorBanner, Loading, Notice, PageHeader, SelectField, TextField } from '../components/ui';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime } from '../lib/format';
import type { StaffRecord } from '../lib/models';
import { STAFF_ROLES, type StaffRole } from '../lib/permissions';
import { useQuery } from '../lib/useFirestore';

const ROLE_HELP: Record<StaffRole, string> = {
  superadmin: 'Everything, including staff management.',
  admin: 'Operations, configuration, suspensions, reviews, rides and payments.',
  reviewer: 'Passenger ID and driver accreditation reviews only.',
  support: 'Support cases and ride monitoring; no identity documents.',
};

/**
 * Superadmin-only staff management. Accounts are created in Firebase
 * Authentication by an operator (never through the apps); this page grants or
 * removes the role claim, which the backend applies and audits.
 */
export function StaffPage() {
  const { user } = useAuth();
  const q = useMemo(() => query(collection(requireFirebase().db, 'staff'), orderBy('email')), []);
  const staff = useQuery<StaffRecord>(q, 'staff');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('reviewer');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const self = email.trim().toLowerCase() === user?.email?.toLowerCase();

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextRole = role === 'NONE' ? null : (role as StaffRole);
      await api.setStaffRole(email.trim(), nextRole);
      setDone(nextRole ? `${email.trim()} is now ${nextRole}. They must sign in again.` : `Removed staff access for ${email.trim()}.`);
      setEmail('');
      setConfirm(false);
    } catch (err) {
      setError(toDisplayError(err).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Staff" subtitle="Grant the least privilege needed. Role changes sign the person out everywhere." />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card title="Staff accounts">
          <ErrorBanner message={staff.error?.message} />
          {staff.loading && <Loading />}
          {staff.data && (
            <DataTable
              caption="Staff accounts"
              rows={staff.data}
              columns={[
                { header: 'Email', cell: (s) => s.email },
                { header: 'Role', cell: (s) => (s.active && s.role ? <StatusBadge status="ACTIVE" label={s.role} /> : <StatusBadge status="SUSPENDED" label="No access" />) },
                { header: 'Updated', cell: (s) => formatDateTime(s.updatedAt) },
              ]}
            />
          )}
        </Card>
        <Card title="Grant or change a role">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <Notice>The person must already have a staff sign-in account (created by an operator in Firebase Authentication). Passenger and driver accounts cannot become staff.</Notice>
            <TextField label="Staff email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={self ? 'You cannot change your own role.' : null} />
            <SelectField
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={[...STAFF_ROLES.map((r) => ({ value: r, label: r })), { value: 'NONE', label: 'Remove access' }]}
              hint={role !== 'NONE' ? ROLE_HELP[role as StaffRole] : 'Removes the staff role claim.'}
            />
            <ErrorBanner message={error} />
            {done && <Notice tone="success">{done}</Notice>}
            <div>
              <Button type="submit" disabled={!emailValid || self} variant={role === 'NONE' ? 'danger' : 'primary'}>
                {role === 'NONE' ? 'Remove access' : 'Apply role'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        title={role === 'NONE' ? 'Remove staff access?' : `Make ${email.trim()} ${role}?`}
        confirmLabel="Confirm"
        danger={role === 'NONE' || role === 'superadmin'}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void apply()}
      >
        {role === 'superadmin' && <Notice tone="warning">Superadmins can grant any role, including superadmin.</Notice>}
        <p>This is recorded in the audit log.</p>
      </ConfirmDialog>
    </>
  );
}
