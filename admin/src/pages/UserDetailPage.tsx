import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { DataTable } from '../components/DataTable';
import { ReasonDialog } from '../components/ReasonDialog';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, KeyValue, Loading, Notice, PageHeader, SelectField, TextField } from '../components/ui';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatCentavos, formatDate, formatDateTime, humanize, maskPhone } from '../lib/format';
import type { RideRecord, UserRecord } from '../lib/models';
import { useDocument, useQuery } from '../lib/useFirestore';

const ACCOUNT_REASONS = [
  { value: 'SAFETY_COMPLAINT', label: 'Safety complaint' },
  { value: 'FRAUD_SUSPECTED', label: 'Suspected fraud' },
  { value: 'POLICY_VIOLATION', label: 'Policy violation' },
  { value: 'USER_REQUEST', label: 'Requested by the user' },
  { value: 'RESOLVED', label: 'Issue resolved' },
  { value: 'OTHER', label: 'Other' },
];

type VerificationAction = 'SUSPEND' | 'REINSTATE' | 'REVOKE' | 'REOPEN';

export function UserDetailPage() {
  const { uid = '' } = useParams();
  const { user: me, can } = useAuth();
  const u = useDocument<UserRecord>(`users/${uid}`);
  const [statusDialog, setStatusDialog] = useState(false);
  const [verificationAction, setVerificationAction] = useState<VerificationAction | null>(null);

  const ridesQ = useMemo(
    () =>
      can('rides.read') && u.data
        ? query(
            collection(requireFirebase().db, 'rides'),
            where(u.data.accountType === 'DRIVER' ? 'driverUid' : 'passengerUid', '==', uid),
            orderBy('requestedAt', 'desc'),
            limit(20),
          )
        : null,
    [can, u.data, uid],
  );
  const rides = useQuery<RideRecord>(ridesQ, `user-rides-${uid}-${u.data?.accountType ?? ''}-${ridesQ ? 1 : 0}`);

  if (u.loading) return <Loading />;
  if (u.error) return <ErrorBanner message={u.error.message} />;
  if (!u.data) return <Notice tone="warning">No passenger or driver account with this id. Staff accounts are managed on the Staff page.</Notice>;
  const d = u.data;
  const self = uid === me?.uid;
  const pv = d.passengerVerification;
  const pvStatus = pv?.status ?? 'NOT_SUBMITTED';
  const suspended = d.status === 'SUSPENDED';

  const verificationActions: VerificationAction[] = [];
  if (d.accountType === 'PASSENGER' && can('users.suspend')) {
    if (pvStatus === 'APPROVED') verificationActions.push('SUSPEND', 'REVOKE');
    if (pvStatus === 'SUSPENDED') verificationActions.push('REINSTATE', 'REOPEN');
    if (pvStatus === 'REJECTED') verificationActions.push('REOPEN');
  }

  return (
    <>
      <PageHeader
        title={d.displayName}
        subtitle={<>{humanize(d.accountType)} · {uid}</>}
        actions={d.accountType === 'DRIVER' ? <Link className="text-sm text-brand-700 underline" to={`/drivers/${uid}`}>Accreditation record</Link> : undefined}
      />
      <CachedHint show={u.fromCache} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Account" actions={<StatusBadge status={d.status} />}>
          <KeyValue
            items={[
              ['Mobile', maskPhone(d.phoneNumber)],
              ['Joined', formatDateTime(d.createdAt)],
              ['Active ride', d.activeRideId ? <Link key="r" className="text-brand-700 underline" to={`/rides/${d.activeRideId}`}>{d.activeRideId.slice(0, 8)}</Link> : 'None'],
              ['Ratings received', d.ratingSummary?.count ?? 0],
              ['Suspension reason', d.suspension ? humanize(d.suspension.reasonCode) : '—'],
              ['Suspended on', d.suspension ? formatDateTime(d.suspension.at) : '—'],
            ]}
          />
          {can('users.suspend') && !self && (
            <div className="mt-4">
              <Button variant={suspended ? 'primary' : 'danger'} onClick={() => setStatusDialog(true)}>
                {suspended ? 'Reactivate account' : 'Suspend account'}
              </Button>
            </div>
          )}
        </Card>

        {d.accountType === 'PASSENGER' && (
          <Card title="ID verification" actions={<StatusBadge status={pvStatus} />}>
            <KeyValue
              items={[
                ['Valid until', pv?.validUntil ? formatDateTime(pv.validUntil) : pvStatus === 'APPROVED' ? 'No expiry' : '—'],
                ['Latest case', pv?.caseId ? <Link key="c" className="text-brand-700 underline" to={`/verifications/${pv.caseId}`}>{pv.caseId.slice(0, 8)}</Link> : '—'],
                ['Message shown to passenger', pv?.publicMessage ?? '—'],
              ]}
            />
            {verificationActions.length > 0 && !self && (
              <div className="mt-4 flex flex-wrap gap-2">
                {verificationActions.map((a) => (
                  <Button key={a} variant={a === 'SUSPEND' || a === 'REVOKE' ? 'danger' : 'secondary'} onClick={() => setVerificationAction(a)}>
                    {a === 'REVOKE' ? 'Revoke (require new ID)' : a === 'REOPEN' ? 'Allow resubmission' : humanize(a)}
                  </Button>
                ))}
              </div>
            )}
            {can('review.decide') && !self && <FareDiscountForm user={d} />}
          </Card>
        )}
      </div>

      {can('rides.read') && (
        <Card title="Recent rides" className="mt-6">
          <ErrorBanner message={rides.error?.message} />
          {rides.loading && <Loading />}
          {rides.data && rides.data.length === 0 && <p className="text-sm text-muted">No rides yet.</p>}
          {rides.data && rides.data.length > 0 && (
            <DataTable
              caption="Recent rides"
              rows={rides.data}
              href={(r) => `/rides/${r.id}`}
              columns={[
                { header: 'Requested', cell: (r) => formatDateTime(r.requestedAt) },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Route', cell: (r) => `${r.pickup.address} → ${r.destination.address}` },
                { header: 'Fare', cell: (r) => formatCentavos(r.finalFare?.total ?? r.quote.total), className: 'tabular-nums' },
              ]}
            />
          )}
        </Card>
      )}

      <ReasonDialog
        open={statusDialog}
        title={suspended ? `Reactivate ${d.displayName}?` : `Suspend ${d.displayName}?`}
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        danger={!suspended}
        reasons={ACCOUNT_REASONS}
        onClose={() => setStatusDialog(false)}
        onSubmit={async (r) => {
          await api.setAccountStatus({ uid, status: suspended ? 'ACTIVE' : 'SUSPENDED', ...r });
        }}
      >
        {!suspended && <Notice tone="warning">The user is signed out of booking and driving immediately. Active trips must be resolved separately.</Notice>}
      </ReasonDialog>
      <ReasonDialog
        open={verificationAction != null}
        title={`${humanize(verificationAction)} passenger verification?`}
        confirmLabel={humanize(verificationAction)}
        danger={verificationAction === 'SUSPEND' || verificationAction === 'REVOKE'}
        reasons={ACCOUNT_REASONS}
        onClose={() => setVerificationAction(null)}
        onSubmit={async (r) => {
          if (verificationAction) await api.updatePassengerVerification({ uid, action: verificationAction, ...r });
        }}
      />
    </>
  );
}

/** Discount entitlements (e.g. senior citizen, PWD, student) offered by the active fare rules. */
function FareDiscountForm({ user }: { user: UserRecord }) {
  const fare = useDocument<{ activeVersion?: string }>('config/fare');
  const version = fare.data?.activeVersion;
  const cfg = useDocument<{ discounts?: Array<{ code: string; label: string; percent: number; enabled: boolean }> }>(version ? `fareConfigs/${version}` : null);
  const options = (cfg.data?.discounts ?? []).filter((x) => x.enabled);
  const [code, setCode] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setFareDiscount({ uid: user.uid, code: next, expiresOn: next && expiresOn ? expiresOn : null, reasonCode: next ? 'DOCUMENT_VERIFIED' : 'ENTITLEMENT_REMOVED' });
      setCode('');
      setExpiresOn('');
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Fare discount</h3>
      <p className="mt-1 text-sm">
        {user.fareDiscount ? (
          <>Current: <strong>{humanize(user.fareDiscount.code)}</strong>{user.fareDiscount.expiresAt ? ` until ${formatDate(user.fareDiscount.expiresAt)}` : ''}</>
        ) : (
          'None'
        )}
      </p>
      <p className="mt-1 text-xs text-muted">Grant only after checking the supporting ID in person or through a reviewed document.</p>
      {options.length === 0 ? (
        <p className="mt-2 text-xs text-muted">The active fare rules define no enabled discounts.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-56">
            <SelectField label="Discount" value={code} onChange={(e) => setCode(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...options.map((o) => ({ value: o.code, label: `${o.label} (${o.percent}%)` }))]} />
          </div>
          <div className="w-44">
            <TextField label="Valid until (optional)" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </div>
          <Button onClick={() => void save(code)} disabled={!code} busy={busy}>
            Grant
          </Button>
          {user.fareDiscount && (
            <Button variant="secondary" onClick={() => void save(null)} busy={busy}>
              Remove
            </Button>
          )}
        </div>
      )}
      <ErrorBanner message={error} />
    </div>
  );
}
