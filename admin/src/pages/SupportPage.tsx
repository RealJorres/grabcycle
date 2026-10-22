import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CachedHint, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, humanize, relativeAge, shortId } from '../lib/format';
import type { SupportCase } from '../lib/models';
import { sortCases } from '../lib/support';
import { useQuery } from '../lib/useFirestore';

export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const rideId = params.get('ride');
  const view = params.get('view') === 'closed' ? 'closed' : 'open';
  const db = requireFirebase().db;
  const q = useMemo(() => {
    const cases = collection(db, 'supportCases');
    if (rideId) return query(cases, where('rideId', '==', rideId), limit(50));
    const statuses = view === 'open' ? ['OPEN', 'IN_PROGRESS'] : ['RESOLVED', 'CLOSED'];
    return query(cases, where('status', 'in', statuses), orderBy('createdAt', 'desc'), limit(100));
  }, [db, rideId, view]);
  const cases = useQuery<SupportCase>(q, `support-${view}-${rideId ?? ''}`);
  const rows = useMemo(() => (cases.data ? (view === 'open' && !rideId ? sortCases(cases.data) : cases.data) : null), [cases.data, view, rideId]);

  return (
    <>
      <PageHeader title="Support" subtitle={rideId ? `Cases for ride ${shortId(rideId)}` : 'Safety reports are marked urgent and listed first.'} />
      {!rideId && (
        <div role="tablist" aria-label="Case filters" className="mb-4 flex gap-2">
          {(['open', 'closed'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${view === v ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
              onClick={() => setParams(v === 'open' ? {} : { view: v })}
            >
              {v === 'open' ? 'Open' : 'Resolved / closed'}
            </button>
          ))}
        </div>
      )}
      <CachedHint show={cases.fromCache} />
      <ErrorBanner message={cases.error?.message} />
      {cases.loading && <Loading />}
      {rows && rows.length === 0 && <EmptyState title="No cases" />}
      {rows && rows.length > 0 && (
        <DataTable
          caption="Support cases"
          rows={rows}
          href={(c) => `/support/${c.id}`}
          columns={[
            { header: 'Case', cell: (c) => shortId(c.id) },
            { header: 'Priority', cell: (c) => <StatusBadge status={c.priority} /> },
            { header: 'Category', cell: (c) => humanize(c.category) },
            { header: 'From', cell: (c) => humanize(c.reporterRole) },
            { header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            { header: 'Opened', cell: (c) => <span title={formatDateTime(c.createdAt)}>{relativeAge(c.createdAt)}</span> },
          ]}
        />
      )}
    </>
  );
}
