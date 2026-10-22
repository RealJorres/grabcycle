import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/authContext';
import { Button, Card, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { api, type Overview } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { formatDateTime } from '../lib/format';

interface Tile {
  label: string;
  value: (o: Overview) => number;
  to?: string;
  attention?: (o: Overview) => boolean;
}

const TILES: Tile[] = [
  { label: 'Passenger IDs awaiting review', value: (o) => o.passengersPendingVerification, to: '/verifications', attention: (o) => o.passengersPendingVerification > 0 },
  { label: 'Drivers awaiting approval', value: (o) => o.driversAwaitingApproval, to: '/drivers', attention: (o) => o.driversAwaitingApproval > 0 },
  { label: 'Driver documents pending', value: (o) => o.driverDocumentsPendingReview, to: '/drivers?tab=documents', attention: (o) => o.driverDocumentsPendingReview > 0 },
  { label: 'Open support cases', value: (o) => o.openSupportCases, to: '/support', attention: (o) => o.openSupportCases > 0 },
  { label: 'Payments needing attention', value: (o) => o.paymentsNeedingAttention, to: '/rides?filter=payments', attention: (o) => o.paymentsNeedingAttention > 0 },
  { label: 'Active rides', value: (o) => o.activeRides, to: '/rides' },
  { label: 'Drivers online', value: (o) => o.driversOnline },
  { label: 'Completed today', value: (o) => o.completedToday },
  { label: 'Cancelled today', value: (o) => o.cancelledToday },
  { label: 'Passengers', value: (o) => o.passengers, to: '/users' },
  { label: 'Drivers', value: (o) => o.drivers, to: '/users?type=DRIVER' },
];

export function OverviewPage() {
  const { can, role } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.overview());
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const allowed = can('reports.read');
  useEffect(() => {
    // Fetching on mount is the point of this effect; state updates happen after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Welcome" subtitle={`Signed in as ${role}.`} />
        <Card>
          <p className="text-sm">Use the menu to open your review queues.</p>
          <div className="mt-4 flex gap-2">
            <Link className="text-brand-700 underline" to="/verifications">Passenger IDs</Link>
            <Link className="text-brand-700 underline" to="/drivers">Driver accreditation</Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={data?.generatedAt ? `As of ${formatDateTime(data.generatedAt)} (Philippine time)` : 'Live operational counts'}
        actions={
          <Button variant="secondary" onClick={() => void load()} busy={loading}>
            Refresh
          </Button>
        }
      />
      <ErrorBanner message={error} onRetry={() => void load()} />
      {!data && loading && <Loading />}
      {data && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TILES.map((t) => {
            const value = t.value(data);
            const hot = t.attention?.(data) ?? false;
            const body = (
              <div className={`h-full rounded-xl bg-surface p-5 ring-1 ${hot ? 'ring-amber-300' : 'ring-line'} ${t.to ? 'hover:ring-brand-600' : ''}`}>
                <p className="text-sm text-muted">{t.label}</p>
                <p className={`mt-2 text-3xl font-semibold tabular-nums ${hot ? 'text-amber-800' : ''}`}>{value.toLocaleString('en-PH')}</p>
              </div>
            );
            return <li key={t.label}>{t.to ? <Link to={t.to}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </>
  );
}
