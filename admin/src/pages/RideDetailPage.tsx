import { collection, orderBy, query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, KeyValue, Loading, Notice, PageHeader, SelectField, TextArea, TextField } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatCentavos, formatDateTime, humanize, maskPhone, shortId } from '../lib/format';
import type { PaymentRecord, RideEvent, RideRecord } from '../lib/models';
import { useDocument, useQuery } from '../lib/useFirestore';
import { paymentTargets } from '../lib/payments';
import { ACTIVE_STATUSES } from '../lib/rides';

const ADMIN_CANCEL_REASONS = [
  { value: 'SAFETY', label: 'Safety concern' },
  { value: 'STUCK_RIDE', label: 'Ride stuck / not progressing' },
  { value: 'DUPLICATE', label: 'Duplicate request' },
  { value: 'REQUESTED_BY_PARTICIPANT', label: 'Requested by passenger or driver' },
  { value: 'OTHER', label: 'Other' },
];

export function RideDetailPage() {
  const { rideId = '' } = useParams();
  const { can } = useAuth();
  const ride = useDocument<RideRecord>(`rides/${rideId}`);
  const eventsQ = useMemo(() => query(collection(requireFirebase().db, 'rides', rideId, 'events'), orderBy('at', 'asc')), [rideId]);
  const events = useQuery<RideEvent>(eventsQ, `events-${rideId}`);
  const completed = ride.data?.status === 'COMPLETED';
  const payment = useDocument<PaymentRecord>(completed ? `payments/${rideId}` : null);
  const active = ride.data ? ACTIVE_STATUSES.includes(ride.data.status) : false;
  const contact = useDocument<{ passengerPhone?: string; driverPhone?: string }>(active ? `rides/${rideId}/contact/info` : null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [showPhones, setShowPhones] = useState(false);

  if (ride.loading) return <Loading />;
  if (ride.error) return <ErrorBanner message={ride.error.message} />;
  if (!ride.data) return <Notice tone="warning">Ride not found (records past the retention period are deleted).</Notice>;
  const r = ride.data;

  return (
    <>
      <PageHeader title={`Ride ${shortId(rideId)}`} subtitle={<>{rideId} · requested {formatDateTime(r.requestedAt)}</>} actions={<StatusBadge status={r.status} />} />
      <CachedHint show={ride.fromCache} />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Card title="Trip">
            <KeyValue
              items={[
                ['Pickup', r.pickup.address + (r.pickup.note ? ` (note: ${r.pickup.note})` : '')],
                ['Destination', r.destination.address],
                ['Booking mode', r.mode === 'SELECTED' ? 'Passenger chose the driver' : 'Automatic matching'],
                ['Passengers', r.quote.passengers],
                ['Distance', `${(r.quote.distanceMeters / 1000).toFixed(2)} km (${humanize(r.quote.distanceSource)})`],
                ['Status reason', humanize(r.statusReason)],
                ['Passenger', <Link key="p" className="text-brand-700 underline" to={`/users/${r.passengerUid}`}>{r.passenger?.firstName ?? r.passengerUid}</Link>],
                ['Driver', r.driverUid ? <Link key="d" className="text-brand-700 underline" to={`/users/${r.driverUid}`}>{r.driver ? `${r.driver.displayName} · ${r.driver.plateNumber} · body ${r.driver.bodyNumber}` : r.driverUid}</Link> : '—'],
              ]}
            />
            {active && contact.data && (
              <div className="mt-4 border-t border-line pt-4 text-sm">
                <p className="font-medium">Contact numbers (active trip only)</p>
                <p className="mt-1">
                  Passenger: {showPhones ? contact.data.passengerPhone ?? '—' : maskPhone(contact.data.passengerPhone)} · Driver:{' '}
                  {showPhones ? contact.data.driverPhone ?? '—' : maskPhone(contact.data.driverPhone)}
                </p>
                <Button variant="ghost" className="-ml-3" onClick={() => setShowPhones(!showPhones)}>
                  {showPhones ? 'Hide numbers' : 'Show full numbers'}
                </Button>
              </div>
            )}
          </Card>

          <Card title="Fare and payment" actions={<StatusBadge status={r.payment?.status} />}>
            {r.quote.fareIsSample && <Notice tone="warning">Quoted with SAMPLE fare rules (not official rates).</Notice>}
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-line">
                {(r.finalFare?.lines ?? r.quote.lines).map((l) => (
                  <tr key={l.code + l.label}>
                    <td className="py-2">{l.label}</td>
                    <td className="py-2 text-right tabular-nums">{formatCentavos(l.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">{r.finalFare ? 'Final fare' : 'Quoted fare'}</td>
                  <td className="py-2 text-right tabular-nums">{formatCentavos(r.finalFare?.total ?? r.quote.total)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Fare version {r.quote.fareVersion}</p>
            {r.cancellation && (
              <p className="mt-2 text-sm">
                Cancelled by {humanize(r.cancellation.by)} — {humanize(r.cancellation.reasonCode)}
                {r.cancellation.feeApplied > 0 ? ` · fee ${formatCentavos(r.cancellation.feeApplied)}` : ''}
              </p>
            )}
            {payment.data && (
              <div className="mt-4 border-t border-line pt-4">
                <KeyValue
                  items={[
                    ['Amount due', formatCentavos(payment.data.amountDue)],
                    ['Cash collected (driver)', formatCentavos(payment.data.amountCollected)],
                    ['Shortfall', payment.data.discrepancy ? formatCentavos(payment.data.discrepancy) : '—'],
                  ]}
                />
                <ol className="mt-3 flex flex-col gap-1 text-xs text-muted">
                  {payment.data.history.map((h, i) => (
                    <li key={i}>
                      {formatDateTime(h.at)} — {humanize(h.status)}
                      {h.note ? ` (${h.note})` : ''}
                    </li>
                  ))}
                </ol>
                {can('payments.manage') && <ResolvePayment rideId={rideId} status={payment.data.status} />}
              </div>
            )}
          </Card>

          <Card title="Timeline">
            <ErrorBanner message={events.error?.message} />
            <ol className="flex flex-col gap-2 text-sm">
              {events.data?.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-40 shrink-0 text-muted tabular-nums">{formatDateTime(e.at)}</span>
                  <span>
                    {humanize(e.type)}
                    {e.actor ? <span className="text-muted"> · {humanize(e.actor)}</span> : null}
                    {e.details && Object.keys(e.details).length > 0 ? (
                      <span className="text-muted"> · {Object.entries(e.details).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {can('rides.intervene') && active && (
            <Card title="Intervene">
              <p className="mb-4 text-sm text-muted">Use only when the participants cannot resolve the trip themselves. Every intervention is audited.</p>
              <div className="flex flex-col gap-2">
                <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel ride</Button>
                {r.status === 'IN_PROGRESS' && (
                  <Button variant="secondary" onClick={() => setCompleteOpen(true)}>Complete ride</Button>
                )}
              </div>
            </Card>
          )}
          <Link className="text-sm text-brand-700 underline" to={`/support?ride=${rideId}`}>Support cases for this ride</Link>
        </div>
      </div>

      <ReasonDialog
        open={cancelOpen}
        title="Cancel this ride?"
        confirmLabel="Cancel ride"
        danger
        reasons={ADMIN_CANCEL_REASONS}
        messageLabel="Note (staff only)"
        requireMessage={false}
        onClose={() => setCancelOpen(false)}
        onSubmit={async (x) => {
          await api.cancelRide({ rideId, reasonCode: x.reasonCode, note: [x.publicMessage, x.internalNote].filter(Boolean).join(' — ') || null });
        }}
      >
        <Notice tone="warning">Both participants are notified and the driver is released.</Notice>
      </ReasonDialog>
      <CompleteDialog open={completeOpen} rideId={rideId} onClose={() => setCompleteOpen(false)} />
    </>
  );
}

function CompleteDialog({ open, rideId, onClose }: { open: boolean; rideId: string; onClose: () => void }) {
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = cash.trim() === '' ? null : Math.round(Number(cash) * 100);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000_000);
  return (
    <ConfirmDialog
      open={open}
      title="Complete this ride?"
      confirmLabel="Complete ride"
      busy={busy}
      confirmDisabled={!valid}
      onCancel={onClose}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.completeRide({ rideId, cashCollected: parsed });
          onClose();
        } catch (err) {
          setError(toDisplayError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>The backend computes the final fare. Enter the cash collected only if you confirmed it with the driver.</p>
      <TextField label="Cash collected (₱, optional)" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} error={valid ? null : 'Enter a valid amount.'} />
      <ErrorBanner message={error} />
    </ConfirmDialog>
  );
}

function ResolvePayment({ rideId, status }: { rideId: string; status: string }) {
  const targets = paymentTargets(status);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (targets.length === 0) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resolvePayment({ rideId, status: target as 'PAID' | 'REFUNDED' | 'FAILED', note: note.trim() });
      setTarget('');
      setNote('');
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg bg-canvas p-4">
      <h3 className="text-sm font-semibold">Resolve payment</h3>
      <SelectField label="New status" value={target} onChange={(e) => setTarget(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...targets.map((t) => ({ value: t, label: humanize(t) }))]} />
      <TextArea label="Resolution note (audited)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} hint="At least 3 characters, e.g. how the dispute was settled." />
      <ErrorBanner message={error} />
      <div>
        <Button onClick={() => void submit()} busy={busy} disabled={!target || note.trim().length < 3}>
          Save
        </Button>
      </div>
    </div>
  );
}
