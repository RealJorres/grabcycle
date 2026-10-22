import { collection, collectionGroup, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CachedHint, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, relativeAge } from '../lib/format';
import type { DriverDocumentRecord, DriverRecord } from '../lib/models';
import { useQuery } from '../lib/useFirestore';

const TABS = [
  { key: 'applications', label: 'Applications' },
  { key: 'documents', label: 'Pending documents' },
] as const;

export function DriverQueuePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'documents' ? 'documents' : 'applications';
  const db = requireFirebase().db;

  const appsQ = useMemo(
    () => (tab === 'applications' ? query(collection(db, 'drivers'), where('status', '==', 'UNDER_REVIEW'), orderBy('updatedAt', 'asc'), limit(100)) : null),
    [db, tab],
  );
  // Renewals and resubmissions from already-approved drivers land here too.
  const docsQ = useMemo(
    () =>
      tab === 'documents'
        ? query(collectionGroup(db, 'documents'), where('status', '==', 'PENDING_REVIEW'), orderBy('pendingSubmittedAt', 'asc'), limit(200))
        : null,
    [db, tab],
  );
  const apps = useQuery<DriverRecord>(appsQ, `drivers-${tab}`);
  const docs = useQuery<DriverDocumentRecord>(docsQ, `docs-${tab}`);
  const active = tab === 'applications' ? apps : docs;

  return (
    <>
      <PageHeader title="Driver accreditation" subtitle="Drivers can go online only after every mandatory document and the vehicle are approved." />
      <div role="tablist" aria-label="Queues" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
            onClick={() => setParams(t.key === 'applications' ? {} : { tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <CachedHint show={active.fromCache} />
      <ErrorBanner message={active.error?.message} />
      {active.loading && <Loading />}
      {tab === 'applications' && apps.data && (apps.data.length === 0 ? (
        <EmptyState title="No applications waiting" />
      ) : (
        <DataTable
          caption="Driver applications under review"
          rows={apps.data}
          href={(d) => `/drivers/${d.id}`}
          columns={[
            { header: 'Driver', cell: (d) => d.displayName },
            { header: 'Municipality', cell: (d) => d.profile?.municipality ?? '—' },
            { header: 'Plate / body no.', cell: (d) => (d.vehicle ? `${d.vehicle.plateNumber} · ${d.vehicle.bodyNumber}` : '—') },
            { header: 'Vehicle', cell: (d) => <StatusBadge status={d.vehicle?.status} /> },
            { header: 'Submitted', cell: (d) => <span title={formatDateTime(d.applicationSubmittedAt)}>{relativeAge(d.applicationSubmittedAt)}</span> },
          ]}
        />
      ))}
      {tab === 'documents' && docs.data && (docs.data.length === 0 ? (
        <EmptyState title="No documents waiting" />
      ) : (
        <DataTable
          caption="Driver documents pending review"
          // Document ids are requirement codes, so they repeat across drivers.
          rows={docs.data.map((d) => ({ ...d, id: `${d.driverUid}:${d.id}` }))}
          href={(d) => `/drivers/${d.driverUid}#${d.requirementCode}`}
          columns={[
            { header: 'Document', cell: (d) => d.label },
            { header: 'Type', cell: (d) => (d.approved ? 'Renewal / update' : 'First submission') },
            { header: 'Scope', cell: (d) => (d.scope === 'VEHICLE' ? 'Vehicle' : 'Driver') },
            { header: 'Submitted', cell: (d) => <span title={formatDateTime(d.pendingSubmittedAt)}>{relativeAge(d.pendingSubmittedAt)}</span> },
          ]}
        />
      ))}
    </>
  );
}
