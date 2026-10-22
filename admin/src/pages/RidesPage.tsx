import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CachedHint, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatCentavos, formatDateTime, relativeAge, shortId } from '../lib/format';
import type { PaymentRecord, RideRecord } from '../lib/models';
import { ACTIVE_STATUSES } from '../lib/rides';
import { useQuery } from '../lib/useFirestore';

const FILTERS = {
  active: { label: 'Active', statuses: ACTIVE_STATUSES },
  completed: { label: 'Completed', statuses: ['COMPLETED'] },
  cancelled: { label: 'Cancelled', statuses: ['CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'] },
  unmatched: { label: 'No driver / expired', statuses: ['NO_DRIVER_FOUND', 'EXPIRED'] },
  payments: { label: 'Payments needing attention', statuses: [] as string[] },
} as const;
type FilterKey = keyof typeof FILTERS;

export function RidesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter') ?? 'active';
  const filter: FilterKey = raw in FILTERS ? (raw as FilterKey) : 'active';
  const db = requireFirebase().db;

  const ridesQ = useMemo(
    () =>
      filter === 'payments'
        ? null
        : query(collection(db, 'rides'), where('status', 'in', [...FILTERS[filter].statuses]), orderBy('requestedAt', 'desc'), limit(100)),
    [db, filter],
  );
  const paymentsQ = useMemo(
    () => (filter === 'payments' ? query(collection(db, 'payments'), where('status', 'in', ['PENDING', 'DISPUTED']), orderBy('updatedAt', 'desc'), limit(100)) : null),
    [db, filter],
  );
  const rides = useQuery<RideRecord>(ridesQ, `rides-${filter}`);
  const payments = useQuery<PaymentRecord>(paymentsQ, `payments-${filter}`);
  const state = filter === 'payments' ? payments : rides;

  return (
    <>
      <PageHeader title="Rides" subtitle="Live view. Amounts are in Philippine pesos; times in Philippine time." />
      <div role="tablist" aria-label="Ride filters" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${filter === k ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
            onClick={() => setParams({ filter: k })}
          >
            {FILTERS[k].label}
          </button>
        ))}
      </div>
      <CachedHint show={state.fromCache} />
      <ErrorBanner message={state.error?.message} />
      {state.loading && <Loading />}
      {filter !== 'payments' && rides.data && (rides.data.length === 0 ? (
        <EmptyState title="No rides" />
      ) : (
        <DataTable
          caption="Rides"
          rows={rides.data}
          href={(r) => `/rides/${r.id}`}
          columns={[
            { header: 'Ride', cell: (r) => shortId(r.id) },
            { header: 'Requested', cell: (r) => <span title={formatDateTime(r.requestedAt)}>{relativeAge(r.requestedAt)}</span> },
            { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { header: 'Passenger', cell: (r) => r.passenger?.firstName ?? '—' },
            { header: 'Driver', cell: (r) => (r.driver ? `${r.driver.displayName} · ${r.driver.plateNumber}` : '—') },
            { header: 'Route', cell: (r) => `${r.pickup.address} → ${r.destination.address}`, className: 'max-w-80' },
            { header: 'Fare', cell: (r) => formatCentavos(r.finalFare?.total ?? r.quote.total), className: 'tabular-nums' },
            { header: 'Payment', cell: (r) => <StatusBadge status={r.payment?.status} /> },
          ]}
        />
      ))}
      {filter === 'payments' && payments.data && (payments.data.length === 0 ? (
        <EmptyState title="No payments need attention" />
      ) : (
        <DataTable
          caption="Payments needing attention"
          rows={payments.data}
          href={(p) => `/rides/${p.id}`}
          columns={[
            { header: 'Ride', cell: (p) => shortId(p.id) },
            { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
            { header: 'Due', cell: (p) => formatCentavos(p.amountDue), className: 'tabular-nums' },
            { header: 'Collected', cell: (p) => formatCentavos(p.amountCollected), className: 'tabular-nums' },
            { header: 'Shortfall', cell: (p) => (p.discrepancy ? formatCentavos(p.discrepancy) : '—'), className: 'tabular-nums' },
          ]}
        />
      ))}
    </>
  );
}
