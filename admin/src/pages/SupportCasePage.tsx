import { collection, orderBy, query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, KeyValue, Loading, Notice, PageHeader, SelectField, TextArea } from '../components/ui';
import { api } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, humanize, shortId } from '../lib/format';
import type { SupportCase } from '../lib/models';
import { useDocument, useQuery } from '../lib/useFirestore';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export function SupportCasePage() {
  const { caseId = '' } = useParams();
  const { user } = useAuth();
  const c = useDocument<SupportCase>(`supportCases/${caseId}`);
  const notesQ = useMemo(() => query(collection(requireFirebase().db, 'supportCases', caseId, 'notes'), orderBy('createdAt', 'asc')), [caseId]);
  const notes = useQuery<{ note: string; authorUid: string; createdAt: SupportCase['createdAt'] }>(notesQ, `notes-${caseId}`);
  const [status, setStatus] = useState<string>('');
  const [response, setResponse] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (c.loading) return <Loading />;
  if (c.error) return <ErrorBanner message={c.error.message} />;
  if (!c.data) return <Notice tone="warning">Case not found.</Notice>;
  const sc = c.data;
  const nextStatus = status || sc.status;
  const changed = nextStatus !== sc.status || response.trim() !== '' || note.trim() !== '';

  const save = async (assignToMe: boolean) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSupportCase({
        caseId,
        status: nextStatus as SupportCase['status'],
        publicResponse: response.trim() || null,
        internalNote: note.trim() || null,
        assignToMe,
      });
      setResponse('');
      setNote('');
      setStatus('');
      setSaved(true);
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={`Case ${shortId(caseId)}`} subtitle={`${humanize(sc.category)} · opened ${formatDateTime(sc.createdAt)}`} actions={<StatusBadge status={sc.priority} />} />
      <CachedHint show={c.fromCache} />
      {sc.category === 'SAFETY' && (
        <Notice tone="warning">Safety report. If anyone may be in immediate danger, advise calling the emergency hotline; GrabCycle does not dispatch emergency services.</Notice>
      )}
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="flex flex-col gap-6">
          <Card title="Report" actions={<StatusBadge status={sc.status} />}>
            <KeyValue
              items={[
                ['Reporter', <Link key="u" className="text-brand-700 underline" to={`/users/${sc.reporterUid}`}>{humanize(sc.reporterRole)} account</Link>],
                ['Ride', sc.rideId ? <Link key="r" className="text-brand-700 underline" to={`/rides/${sc.rideId}`}>{shortId(sc.rideId)}</Link> : '—'],
                ['Assigned to', sc.assignedTo ? (sc.assignedTo === user?.uid ? 'You' : 'Another staff member') : 'Unassigned'],
                ['Last update', formatDateTime(sc.updatedAt)],
              ]}
            />
            <p className="mt-4 rounded-lg bg-canvas p-4 text-sm whitespace-pre-wrap">{sc.description}</p>
            {sc.publicResponse && (
              <div className="mt-4 text-sm">
                <p className="font-medium">Latest reply shown to the user</p>
                <p className="mt-1 whitespace-pre-wrap">{sc.publicResponse}</p>
              </div>
            )}
          </Card>
          <Card title="Internal notes">
            <ErrorBanner message={notes.error?.message} />
            {notes.data && notes.data.length === 0 && <p className="text-sm text-muted">No notes yet.</p>}
            <ol className="flex flex-col gap-3 text-sm">
              {notes.data?.map((n) => (
                <li key={n.id} className="rounded-lg bg-canvas p-3">
                  <p className="whitespace-pre-wrap">{n.note}</p>
                  <p className="mt-1 text-xs text-muted">
                    {n.authorUid === user?.uid ? 'You' : 'Staff'} · {formatDateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <Card title="Update case">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <SelectField label="Status" value={nextStatus} onChange={(e) => setStatus(e.target.value)} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
            <TextArea label="Reply to the user (optional)" hint="Sent to the user's app and notifies them." value={response} maxLength={2000} onChange={(e) => setResponse(e.target.value)} />
            <TextArea label="Internal note (optional)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            <ErrorBanner message={error} />
            {saved && <Notice tone="success">Saved.</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy} disabled={!changed}>
                Save
              </Button>
              {sc.assignedTo !== user?.uid && (
                <Button variant="secondary" onClick={() => void save(true)} busy={busy}>
                  Assign to me{changed ? ' and save' : ''}
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
