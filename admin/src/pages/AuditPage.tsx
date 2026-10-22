import { collection, query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { DataTable } from '../components/DataTable';
import { Button, CachedHint, EmptyState, ErrorBanner, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, humanize } from '../lib/format';
import { auditConstraints, type AuditFilter } from '../lib/auditQuery';
import type { AuditLog } from '../lib/models';
import { auditCategoriesFor } from '../lib/permissions';
import { useQuery } from '../lib/useFirestore';

const ALL_CATEGORIES = ['REVIEW', 'SUPPORT', 'SECURITY', 'OPERATIONS', 'CONFIG', 'PAYMENT'];

export function AuditPage() {
  const { role } = useAuth();
  const allowed = auditCategoriesFor(role);
  const categories = allowed === 'ALL' ? ALL_CATEGORIES : allowed;
  const [draft, setDraft] = useState<AuditFilter>({ category: allowed === 'ALL' ? '' : categories[0] ?? '', targetUid: '', actorUid: '' });
  const [filter, setFilter] = useState<AuditFilter>(draft);
  const db = requireFirebase().db;
  const q = useMemo(() => {
    const constraints = auditConstraints(filter, auditCategoriesFor(role));
    return constraints ? query(collection(db, 'auditLogs'), ...constraints) : null;
  }, [db, filter, role]);
  const logs = useQuery<AuditLog>(q, `audit-${filter.category}-${filter.targetUid}-${filter.actorUid}`);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of reviews, document views, suspensions, configuration changes and interventions." />
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...draft, targetUid: draft.targetUid.trim(), actorUid: draft.actorUid.trim() });
        }}
      >
        <div className="w-48">
          <SelectField
            label="Category"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            options={[...(allowed === 'ALL' ? [{ value: '', label: 'All categories' }] : []), ...categories.map((c) => ({ value: c, label: humanize(c) }))]}
          />
        </div>
        <div className="w-72">
          <TextField label="Affected user id" value={draft.targetUid} onChange={(e) => setDraft({ ...draft, targetUid: e.target.value })} />
        </div>
        {allowed === 'ALL' && (
          <div className="w-72">
            <TextField label="Staff (actor) id" hint="Used when no category or user is set." value={draft.actorUid} onChange={(e) => setDraft({ ...draft, actorUid: e.target.value })} />
          </div>
        )}
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <CachedHint show={logs.fromCache} />
      <ErrorBanner message={logs.error?.message} />
      {logs.loading && <Loading />}
      {logs.data && logs.data.length === 0 && <EmptyState title="No entries" />}
      {logs.data && logs.data.length > 0 && (
        <DataTable
          caption="Audit entries"
          rows={logs.data}
          columns={[
            { header: 'Time', cell: (l) => formatDateTime(l.at), className: 'whitespace-nowrap' },
            { header: 'Category', cell: (l) => humanize(l.category) },
            { header: 'Action', cell: (l) => humanize(l.action) },
            { header: 'Actor', cell: (l) => <span className="text-xs"><code>{l.actorUid}</code> ({l.actorRole})</span> },
            { header: 'Target', cell: (l) => <span className="text-xs">{l.targetType} <code>{l.targetId}</code></span> },
            { header: 'Reason', cell: (l) => humanize(l.reasonCode) },
            {
              header: 'Details',
              cell: (l) => <span className="text-xs text-muted">{Object.entries(l.details ?? {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || '—'}</span>,
            },
          ]}
        />
      )}
    </>
  );
}
