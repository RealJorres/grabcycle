import { collection, limit, orderBy, query, where, type Query } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, EmptyState, ErrorBanner, Loading, PageHeader, SelectField, TextField } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { formatDate, humanize, maskPhone } from '../lib/format';
import type { UserRecord } from '../lib/models';
import { normalizePhilippineMobile } from '../lib/phone';
import { useQuery } from '../lib/useFirestore';

const PAGE = 50;

/**
 * Account lookup. Firestore has no free-text search, so staff filter by type
 * or status, or look up an exact mobile number / user id.
 */
export function UsersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') === 'DRIVER' ? 'DRIVER' : params.get('type') === 'SUSPENDED' ? 'SUSPENDED' : 'PASSENGER';
  const phone = params.get('phone');
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const db = requireFirebase().db;

  const q: Query = useMemo(() => {
    const users = collection(db, 'users');
    if (phone) return query(users, where('phoneNumber', '==', phone), limit(5));
    if (type === 'SUSPENDED') return query(users, where('status', '==', 'SUSPENDED'), orderBy('createdAt', 'desc'), limit(PAGE));
    return query(users, where('accountType', '==', type), orderBy('createdAt', 'desc'), limit(PAGE));
  }, [db, type, phone]);
  const users = useQuery<UserRecord>(q, `users-${type}-${phone ?? ''}`);

  const submitLookup = () => {
    const v = lookup.trim();
    setLookupError(null);
    if (!v) return;
    const e164 = normalizePhilippineMobile(v);
    if (e164) setParams({ phone: e164 });
    else if (/^[A-Za-z0-9]{20,128}$/.test(v)) navigate(`/users/${v}`);
    else setLookupError('Enter a Philippine mobile number (e.g. 0917 123 4567) or a user id.');
  };

  return (
    <>
      <PageHeader title="Users" subtitle={phone ? `Lookup: ${phone}` : `Newest ${PAGE} ${type === 'SUSPENDED' ? 'suspended accounts' : humanize(type).toLowerCase() + 's'}`} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SelectField
            label="Show"
            value={phone ? '' : type}
            onChange={(e) => setParams({ type: e.target.value })}
            options={[
              ...(phone ? [{ value: '', label: 'Lookup result' }] : []),
              { value: 'PASSENGER', label: 'Passengers' },
              { value: 'DRIVER', label: 'Drivers' },
              { value: 'SUSPENDED', label: 'Suspended accounts' },
            ]}
          />
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitLookup();
          }}
        >
          <div className="w-72">
            <TextField label="Mobile number or user id" value={lookup} onChange={(e) => setLookup(e.target.value)} error={lookupError} />
          </div>
          <Button type="submit" variant="secondary">
            Look up
          </Button>
        </form>
      </div>
      <CachedHint show={users.fromCache} />
      <ErrorBanner message={users.error?.message} />
      {users.loading && <Loading />}
      {users.data && users.data.length === 0 && <EmptyState title="No accounts found" />}
      {users.data && users.data.length > 0 && (
        <DataTable
          caption="Accounts"
          rows={users.data}
          href={(u) => `/users/${u.id}`}
          columns={[
            { header: 'Name', cell: (u) => u.displayName },
            { header: 'Type', cell: (u) => humanize(u.accountType) },
            { header: 'Mobile', cell: (u) => maskPhone(u.phoneNumber) },
            { header: 'Account', cell: (u) => <StatusBadge status={u.status} /> },
            {
              header: 'ID verification',
              cell: (u) => (u.accountType === 'PASSENGER' ? <StatusBadge status={u.passengerVerification?.status ?? 'NOT_SUBMITTED'} /> : '—'),
            },
            { header: 'Joined', cell: (u) => formatDate(u.createdAt) },
          ]}
        />
      )}
    </>
  );
}
