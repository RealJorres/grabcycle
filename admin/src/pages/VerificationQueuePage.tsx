import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';
import { useAuth } from '../auth/authContext';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CachedHint, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, relativeAge } from '../lib/format';
import type { VerificationCase } from '../lib/models';
import { useQuery } from '../lib/useFirestore';

/** Oldest first, so nobody waits behind newer submissions. */
export function VerificationQueuePage() {
  const { user } = useAuth();
  const q = useMemo(
    () =>
      query(
        collection(requireFirebase().db, 'verificationCases'),
        where('status', 'in', ['SUBMITTED', 'UNDER_REVIEW']),
        orderBy('submittedAt', 'asc'),
        limit(100),
      ),
    [],
  );
  const cases = useQuery<VerificationCase>(q, 'verification-queue');

  return (
    <>
      <PageHeader title="Passenger ID verification" subtitle="Approve only when every checklist item is satisfied. Each document view is logged." />
      <CachedHint show={cases.fromCache} />
      <ErrorBanner message={cases.error?.message} />
      {cases.loading && <Loading />}
      {cases.data && cases.data.length === 0 && <EmptyState title="Queue is empty" message="No passenger IDs are waiting for review." />}
      {cases.data && cases.data.length > 0 && (
        <DataTable
          caption="Passenger verification cases awaiting review"
          rows={cases.data}
          href={(c) => `/verifications/${c.id}`}
          columns={[
            { header: 'Applicant', cell: (c) => c.applicantName },
            { header: 'ID type', cell: (c) => c.idTypeLabel },
            { header: 'Attempt', cell: (c) => `#${c.attempt}`, className: 'tabular-nums' },
            { header: 'Submitted', cell: (c) => <span title={formatDateTime(c.submittedAt)}>{relativeAge(c.submittedAt)}</span> },
            { header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            {
              header: 'Reviewer',
              cell: (c) => (c.claimedBy ? (c.claimedBy === user?.uid ? 'You' : 'Another reviewer') : <span className="text-muted">Unclaimed</span>),
            },
          ]}
        />
      )}
    </>
  );
}
