import { collection, query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DecisionForm } from '../components/DecisionForm';
import { REVIEW_REASONS } from '../components/decision';
import { DocumentViewer } from '../components/DocumentViewer';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, KeyValue, Loading, Notice, PageHeader, SelectField, TextArea, TextField } from '../components/ui';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatCalendarDate, formatDateTime, humanize } from '../lib/format';
import type { DocumentVersion, DriverDocumentRecord, DriverRecord } from '../lib/models';
import { useDocument, useQuery, type WithId } from '../lib/useFirestore';

type DriverDecision = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';

export function DriverDetailPage() {
  const { uid = '' } = useParams();
  const { user, can } = useAuth();
  const driver = useDocument<DriverRecord>(`drivers/${uid}`);
  const docsQ = useMemo(() => query(collection(requireFirebase().db, 'drivers', uid, 'documents')), [uid]);
  const docs = useQuery<DriverDocumentRecord>(docsQ, `driver-docs-${uid}`);

  if (driver.loading) return <Loading />;
  if (driver.error) return <ErrorBanner message={driver.error.message} />;
  if (!driver.data) return <Notice tone="warning">Driver not found.</Notice>;
  const d = driver.data;
  const self = uid === user?.uid;
  const reviewable = can('review.decide') && !self;

  return (
    <>
      <PageHeader
        title={d.displayName}
        subtitle={<>Driver {uid} · last update {formatDateTime(d.updatedAt)}</>}
        actions={
          <>
            <Link to="/drivers" className="text-sm text-brand-700 underline">Back to queue</Link>
            <Link to={`/users/${uid}`} className="text-sm text-brand-700 underline">User record</Link>
          </>
        }
      />
      <CachedHint show={driver.fromCache} />
      {self && <Notice tone="warning">You cannot review your own account.</Notice>}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Card title="Accreditation" actions={<StatusBadge status={d.status} />}>
            <KeyValue
              items={[
                ['Account', <StatusBadge key="a" status={d.accountStatus} />],
                ['Availability', humanize(d.availability)],
                ['Municipality', d.profile?.municipality ?? '—'],
                ['Application submitted', formatDateTime(d.applicationSubmittedAt)],
                ['Eligible to go online', d.eligibility?.eligible ? 'Yes' : 'No'],
                ['Eligibility valid until', d.eligibility?.validUntil ? formatDateTime(d.eligibility.validUntil) : '—'],
                ['Completed trips', d.stats?.completedTrips ?? 0],
                ['Driver cancellations', d.stats?.cancelledByDriver ?? 0],
              ]}
            />
            {d.eligibility && !d.eligibility.eligible && d.eligibility.reasons.length > 0 && (
              <ul className="mt-4 list-disc pl-5 text-sm text-amber-900">
                {d.eligibility.reasons.map((r) => (
                  <li key={r}>{humanize(r.replace(':', ' — '))}</li>
                ))}
              </ul>
            )}
            {d.decision && (
              <p className="mt-4 text-sm text-muted">
                Last decision: {humanize(d.decision.decision)} on {formatDateTime(d.decision.decidedAt)}
                {d.decision.publicMessage ? ` — “${d.decision.publicMessage}”` : ''}
              </p>
            )}
          </Card>

          <VehicleCard driver={d} reviewable={reviewable} />

          <Card title="Documents">
            <ErrorBanner message={docs.error?.message} />
            {docs.loading && <Loading />}
            {docs.data && docs.data.length === 0 && <p className="text-sm text-muted">No documents submitted yet.</p>}
            <div className="flex flex-col divide-y divide-line">
              {docs.data?.map((doc) => (
                <DocumentRow key={doc.id} driverUid={uid} doc={doc} reviewable={reviewable} canView={can('documents.view')} />
              ))}
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <DriverDecisionCard driver={d} uid={uid} self={self} />
        </div>
      </div>
    </>
  );
}

function VehicleCard({ driver, reviewable }: { driver: DriverRecord; reviewable: boolean }) {
  const v = driver.vehicle;
  return (
    <Card title="Vehicle" actions={v && <StatusBadge status={v.status} />}>
      {!v ? (
        <p className="text-sm text-muted">The driver has not entered vehicle details yet.</p>
      ) : (
        <>
          <KeyValue
            items={[
              ['Plate number', v.plateNumber],
              ['Body number', v.bodyNumber],
              ['Make / model', `${v.make} ${v.model}`],
              ['Color', v.color],
              ['Capacity', v.capacity],
              ['Franchise municipality', v.franchiseMunicipality],
            ]}
          />
          {reviewable && v.status !== 'APPROVED' && (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="mb-3 text-sm font-semibold">Review vehicle</h3>
              <p className="mb-3 text-xs text-muted">Compare these details with the vehicle documents (e.g. franchise and registration) before approving.</p>
              <DecisionForm checklistComplete={null} onSubmit={(f) => api.reviewVehicle({ ...f, driverUid: driver.uid }).then(() => undefined)} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function VersionBlock({ title, driverUid, code, version, which, canView }: {
  title: string;
  driverUid: string;
  code: string;
  version: DocumentVersion;
  which: 'pending' | 'approved';
  canView: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      <KeyValue
        items={[
          ['Expiry (entered)', version.expiryDate ? formatCalendarDate(version.expiryDate) : '—'],
          ['Document number', version.documentNumber ?? '—'],
          [which === 'pending' ? 'Submitted' : 'Approved', formatDateTime(which === 'pending' ? version.submittedAt : version.approvedAt)],
        ]}
      />
      {canView && (
        <div className="grid gap-4 md:grid-cols-2">
          {version.files.map((f) => (
            <DocumentViewer
              key={f.side}
              label={humanize(f.side)}
              request={{ kind: 'DRIVER_DOCUMENT', driverUid, requirementCode: code, version: which, side: f.side }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentRow({ driverUid, doc, reviewable, canView }: { driverUid: string; doc: WithId<DriverDocumentRecord>; reviewable: boolean; canView: boolean }) {
  const [expanded, setExpanded] = useState(doc.status === 'PENDING_REVIEW' || window.location.hash === `#${doc.id}`);
  const [verifiedExpiry, setVerifiedExpiry] = useState(doc.pending?.expiryDate ?? '');
  return (
    <div id={doc.id} className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{doc.label}</p>
          <p className="text-xs text-muted">
            {doc.scope === 'VEHICLE' ? 'Vehicle document' : 'Driver document'}
            {doc.approvedExpiryDate ? ` · approved until ${formatCalendarDate(doc.approvedExpiryDate)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={doc.status} />
          <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide' : 'Details'}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-4 flex flex-col gap-6">
          {doc.pending && (
            <VersionBlock title="Pending submission" driverUid={driverUid} code={doc.requirementCode} version={doc.pending} which="pending" canView={canView} />
          )}
          {doc.pending && reviewable && (
            <div className="rounded-lg bg-canvas p-4">
              <DecisionForm
                checklistComplete={null}
                extra={(decision) =>
                  decision === 'APPROVE' && (
                    <TextField
                      label="Verified expiry date"
                      type="date"
                      hint="Confirm against the printed date. Leave empty only for documents without expiry."
                      value={verifiedExpiry}
                      onChange={(e) => setVerifiedExpiry(e.target.value)}
                    />
                  )
                }
                onSubmit={(f) =>
                  api
                    .reviewDriverDocument({
                      ...f,
                      driverUid,
                      requirementCode: doc.requirementCode,
                      submissionId: doc.pending!.submissionId,
                      verifiedExpiryDate: f.decision === 'APPROVE' && verifiedExpiry ? verifiedExpiry : null,
                    })
                    .then(() => undefined)
                }
              />
            </div>
          )}
          {doc.approved && (
            <VersionBlock title="Currently approved version" driverUid={driverUid} code={doc.requirementCode} version={doc.approved} which="approved" canView={canView} />
          )}
          {doc.lastDecision && (
            <p className="text-xs text-muted">
              Last decision: {humanize(doc.lastDecision.decision)} on {formatDateTime(doc.lastDecision.decidedAt)}
              {doc.lastDecision.publicMessage ? ` — “${doc.lastDecision.publicMessage}”` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DriverDecisionCard({ driver, uid, self }: { driver: DriverRecord; uid: string; self: boolean }) {
  const { can } = useAuth();
  const [action, setAction] = useState<DriverDecision | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available: DriverDecision[] = [];
  if (can('review.decide') && driver.status === 'UNDER_REVIEW') available.push('APPROVE', 'REJECT');
  if (can('users.suspend') && driver.status !== 'SUSPENDED' && driver.everApproved) available.push('SUSPEND');
  if (can('users.suspend') && driver.status === 'SUSPENDED') available.push('REINSTATE');
  if (self || available.length === 0) return null;

  const needsReason = action === 'REJECT' || action === 'SUSPEND';
  const valid = !needsReason || (reasonCode !== '' && message.trim().length >= 5);

  const confirm = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await api.decideDriver({
        driverUid: uid,
        decision: action,
        reasonCode: needsReason ? reasonCode : null,
        publicMessage: message.trim() || null,
        internalNote: note.trim() || null,
      });
      setAction(null);
      setReasonCode('');
      setMessage('');
      setNote('');
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Driver decision">
      <p className="mb-4 text-sm text-muted">
        Approval requires every mandatory document and the vehicle to be approved; the backend checks this again.
      </p>
      <div className="flex flex-wrap gap-2">
        {available.map((a) => (
          <Button key={a} variant={a === 'REJECT' || a === 'SUSPEND' ? 'danger' : 'primary'} onClick={() => setAction(a)}>
            {humanize(a)}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={action != null}
        title={`${humanize(action)} ${driver.displayName}?`}
        confirmLabel={humanize(action)}
        danger={needsReason}
        busy={busy}
        confirmDisabled={!valid}
        onCancel={() => setAction(null)}
        onConfirm={() => void confirm()}
      >
        {action === 'SUSPEND' && <Notice tone="warning">The driver is taken offline immediately and cannot receive rides.</Notice>}
        {needsReason && (
          <>
            <SelectField label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...REVIEW_REASONS, { value: 'SAFETY_COMPLAINT', label: 'Safety complaint' }, { value: 'POLICY_VIOLATION', label: 'Policy violation' }]} />
            <TextArea label="Message to the driver" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} hint="At least 5 characters. Shown in the app." />
          </>
        )}
        <TextArea label="Internal note (staff only)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        <ErrorBanner message={error} />
      </ConfirmDialog>
    </Card>
  );
}
