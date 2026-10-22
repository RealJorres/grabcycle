import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, EmptyState, ErrorBanner, Loading, Notice, PageHeader, SelectField, TextArea, TextField } from '../components/ui';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, humanize, relativeAge } from '../lib/format';
import type { DataRequest } from '../lib/models';
import { useQuery, type WithId } from '../lib/useFirestore';

/** Saves the export as a JSON file on the staff member's device for secure hand-over. */
function download(uid: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grabcycle-data-${uid}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PrivacyRequestsPage() {
  const q = useMemo(
    () => query(collection(requireFirebase().db, 'dataRequests'), where('status', 'in', ['RECEIVED', 'IN_PROGRESS']), orderBy('createdAt', 'asc'), limit(100)),
    [],
  );
  const requests = useQuery<DataRequest>(q, 'privacy-requests');
  return (
    <>
      <PageHeader title="Privacy requests" subtitle="Data-subject requests under the Data Privacy Act. Oldest first; every action is audited." />
      <Notice>
        Verify the requester through their registered mobile number before sending an export. Exports contain personal data: share them only through the agreed secure channel and delete local copies afterwards.
      </Notice>
      <div className="mt-4">
        <CachedHint show={requests.fromCache} />
        <ErrorBanner message={requests.error?.message} />
        {requests.loading && <Loading />}
        {requests.data && requests.data.length === 0 && <EmptyState title="No open requests" />}
        <div className="flex flex-col gap-4">
          {requests.data?.map((r) => <RequestCard key={r.id} request={r} />)}
        </div>
      </div>
    </>
  );
}

export function RequestCard({ request: r }: { request: WithId<DataRequest> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmUid, setConfirmUid] = useState('');
  const [resolution, setResolution] = useState('COMPLETED');
  const [note, setNote] = useState('');

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`${humanize(r.type)} request`}
      actions={<StatusBadge status={r.status === 'RECEIVED' ? 'OPEN' : r.status} label={humanize(r.status)} />}
    >
      <p className="text-sm">
        Account <Link className="font-mono text-brand-700 underline" to={`/users/${r.uid}`}>{r.uid}</Link> · received {formatDateTime(r.createdAt)} ({relativeAge(r.createdAt)})
      </p>
      {r.note && <p className="mt-2 rounded-lg bg-canvas p-3 text-sm whitespace-pre-wrap">{r.note}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {r.type === 'ACCESS' && (
          <Button
            variant="secondary"
            busy={busy}
            onClick={() =>
              void act(async () => {
                download(r.uid, await api.exportUserData(r.id));
                setNotice('Export downloaded. Mark the request completed once it has been delivered.');
              })
            }
          >
            Export data (JSON)
          </Button>
        )}
        {r.type === 'DELETION' && (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete account…
          </Button>
        )}
      </div>
      {notice && <div className="mt-3"><Notice tone="success">{notice}</Notice></div>}
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="w-44">
          <SelectField label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} options={[{ value: 'COMPLETED', label: 'Completed' }, { value: 'REJECTED', label: 'Rejected' }]} />
        </div>
        <div className="min-w-64 flex-1">
          <TextArea label="Resolution note (audited)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} hint="How it was fulfilled, or the legal basis for refusing." />
        </div>
        <Button
          busy={busy}
          disabled={note.trim().length < 3}
          onClick={() => void act(() => api.resolveDataRequest({ requestId: r.id, status: resolution as 'COMPLETED' | 'REJECTED', resolutionNote: note.trim() }).then(() => undefined))}
        >
          Close request
        </Button>
      </div>
      <div className="mt-3"><ErrorBanner message={error} /></div>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete this account permanently?"
        confirmLabel="Delete account"
        danger
        busy={busy}
        confirmDisabled={confirmUid.trim() !== r.uid}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          void act(async () => {
            const res = await api.deleteUserData({ requestId: r.id, confirmUid: confirmUid.trim() });
            setDeleteOpen(false);
            setNotice(`Deleted. Anonymised ${res.rides} rides, ${res.ratings} ratings, ${res.supportCases} support cases, ${res.verificationCases} verification cases; removed ${res.files} files.`);
          })
        }
      >
        <Notice tone="warning">
          This deletes the sign-in, profile, driver record, devices, live location and all uploaded documents. Trips, payments, ratings and reports within their retention period are kept without identifying details. It cannot be undone. The backend refuses while there is an active trip or an open payment dispute.
        </Notice>
        <TextField label="Type the account id to confirm" value={confirmUid} onChange={(e) => setConfirmUid(e.target.value)} autoComplete="off" />
        <ErrorBanner message={error} />
      </ConfirmDialog>
    </Card>
  );
}
