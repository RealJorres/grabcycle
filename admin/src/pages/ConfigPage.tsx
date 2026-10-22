import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, Loading, Notice, PageHeader, SelectField, TextArea, TextField } from '../components/ui';
import { api, CONFIG_KEYS, type ConfigKey } from '../lib/callables';
import { parseConfigJson } from '../lib/configJson';
import { toDisplayError, type DisplayError } from '../lib/errors';
import { requireFirebase } from '../lib/firebase';
import { formatDateTime, humanize } from '../lib/format';
import { useDocument, useQuery } from '../lib/useFirestore';

const TABS = ['settings', 'fares', 'landmarks', 'history'] as const;
type Tab = (typeof TABS)[number];

const KEY_HELP: Record<ConfigKey, string> = {
  serviceArea: 'Service polygons, municipalities and operating hours. Bounds for live locations are recomputed on save.',
  matching: 'Offer timeouts, search radii, location freshness and accuracy thresholds.',
  documentPolicy: 'Accepted passenger IDs and driver accreditation requirements. Confirm against current LGU/LTO rules.',
  policies: 'Cancellation, ratings, retention and the current terms/privacy versions.',
  payments: 'Payment methods and cash discrepancy tolerance.',
  app: 'Announcements, support contacts, minimum Android version and maintenance mode.',
};

export function ConfigPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'settings';
  return (
    <>
      <PageHeader title="Configuration" subtitle="Every change is validated by the backend, versioned and audited. Sample values are flagged and blocked in production." />
      <div role="tablist" aria-label="Configuration sections" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === t ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
            onClick={() => setParams({ tab: t })}
          >
            {humanize(t)}
          </button>
        ))}
      </div>
      {tab === 'settings' && <SettingsTab />}
      {tab === 'fares' && <FaresTab />}
      {tab === 'landmarks' && <LandmarksTab />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}

function FieldErrors({ error }: { error: DisplayError | null }) {
  if (!error) return null;
  return (
    <div className="flex flex-col gap-2">
      <ErrorBanner message={error.message} />
      {error.fields.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-red-800">
          {error.fields.map((f) => (
            <li key={f.path + f.message}>
              <code>{f.path || '(root)'}</code>: {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsTab() {
  const [key, setKey] = useState<ConfigKey>('serviceArea');
  const docState = useDocument<Record<string, unknown>>(`config/${key}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="w-64">
        <SelectField label="Configuration" value={key} onChange={(e) => setKey(e.target.value as ConfigKey)} options={CONFIG_KEYS.map((k) => ({ value: k, label: humanize(k.replace(/([A-Z])/g, '_$1')) }))} />
      </div>
      <p className="text-sm text-muted">{KEY_HELP[key]}</p>
      <CachedHint show={docState.fromCache} />
      {docState.loading ? <Loading /> : <ConfigEditor key={key} configKey={key} current={docState.data} />}
    </div>
  );
}

function ConfigEditor({ configKey, current }: { configKey: ConfigKey; current: Record<string, unknown> | null }) {
  const initial = useMemo(() => {
    if (!current) return '{\n}';
    const { id: _id, meta: _meta, ...rest } = current;
    return JSON.stringify(rest, null, 2);
  }, [current]);
  const [text, setText] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [saved, setSaved] = useState(false);
  const parsed = parseConfigJson(text);
  const meta = current?.meta as { revision?: number; updatedAt?: { toMillis(): number } } | undefined;

  const save = async () => {
    if (!parsed.value) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateConfig(configKey, parsed.value);
      setConfirm(false);
      setSaved(true);
    } catch (err) {
      setError(toDisplayError(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`config/${configKey}`}
      actions={meta?.revision ? <span className="text-xs text-muted">Revision {meta.revision} · {formatDateTime(meta.updatedAt?.toMillis())}</span> : null}
    >
      {!current && <Notice tone="warning">Not configured. The backend refuses operations that depend on this until it is set.</Notice>}
      {parsed.value?.isSample === true && <Notice tone="warning">Marked as SAMPLE data. Replace with verified values before production use.</Notice>}
      <TextArea
        label="JSON"
        spellCheck={false}
        className="min-h-96 rounded-lg border border-line p-3 font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        error={parsed.error}
      />
      <div className="mt-4 flex flex-col gap-3">
        <FieldErrors error={error} />
        {saved && <Notice tone="success">Saved. Clients pick up the new configuration within a few minutes.</Notice>}
        <div className="flex gap-2">
          <Button onClick={() => setConfirm(true)} disabled={!parsed.value || text === initial}>
            Review and save
          </Button>
          <Button variant="secondary" onClick={() => setText(initial)} disabled={text === initial}>
            Discard changes
          </Button>
        </div>
      </div>
      <ConfirmDialog open={confirm} title={`Save ${configKey}?`} confirmLabel="Save configuration" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void save()}>
        <p>This takes effect for all users. The previous version is kept in the history.</p>
      </ConfirmDialog>
    </Card>
  );
}

interface FareVersion {
  version: string;
  label?: string;
  mode?: string;
  isSample?: boolean;
  createdAt?: { toMillis(): number };
}

function FaresTab() {
  const db = requireFirebase().db;
  const active = useDocument<{ activeVersion?: string; activatedAt?: { toMillis(): number } }>('config/fare');
  const versionsQ = useMemo(() => query(collection(db, 'fareConfigs'), orderBy('createdAt', 'desc'), limit(25)), [db]);
  const versions = useQuery<FareVersion>(versionsQ, 'fare-versions');
  const activeVersion = active.data?.activeVersion;
  const activeDoc = useDocument<Record<string, unknown>>(activeVersion ? `fareConfigs/${activeVersion}` : null);
  const [text, setText] = useState<string | null>(null);
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  const startDraft = () => {
    const base: Record<string, unknown> = activeDoc.data ?? {};
    const { id: _id, version: _v, createdAt: _c, createdBy: _b, ...rest } = base;
    setText(JSON.stringify(rest, null, 2));
    setError(null);
    setMessage(null);
  };
  const parsed = text != null ? parseConfigJson(text) : null;

  const publish = async () => {
    if (!parsed?.value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.publishFareConfig(parsed.value, activate);
      setMessage(`Published ${res.version}${res.active ? ' and activated it' : ''}. New quotes use the active version; existing quotes keep theirs.`);
      setText(null);
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };

  const doActivate = async () => {
    if (!activating) return;
    setBusy(true);
    setError(null);
    try {
      await api.activateFareVersion(activating);
      setMessage(`Activated ${activating}.`);
      setActivating(null);
    } catch (err) {
      setError(toDisplayError(err));
      setActivating(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title="Active fare rules" actions={<Button variant="secondary" onClick={startDraft} disabled={text != null}>New version from active</Button>}>
        {active.loading ? (
          <Loading />
        ) : activeVersion ? (
          <p className="text-sm">
            <strong>{activeVersion}</strong> · activated {formatDateTime(active.data?.activatedAt?.toMillis())}
            {activeDoc.data?.isSample === true && <span className="ml-2"><StatusBadge status="PENDING" label="SAMPLE rates" /></span>}
          </p>
        ) : (
          <Notice tone="warning">No active fare version. Quotes are refused until one is activated.</Notice>
        )}
        <p className="mt-2 text-xs text-muted">Fares must follow the rates approved by the local government. Do not activate unverified rates in production.</p>
      </Card>
      {message && <Notice tone="success">{message}</Notice>}
      <FieldErrors error={error} />
      {text != null && (
        <Card title="Draft fare version">
          <TextArea label="Fare rules (JSON)" spellCheck={false} className="min-h-96 rounded-lg border border-line p-3 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} error={parsed?.error} />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            Activate immediately after publishing
          </label>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void publish()} busy={busy} disabled={!parsed?.value}>
              Publish version
            </Button>
            <Button variant="secondary" onClick={() => setText(null)}>
              Discard draft
            </Button>
          </div>
        </Card>
      )}
      <Card title="Versions">
        <ErrorBanner message={versions.error?.message} />
        {versions.data && (
          <DataTable
            caption="Fare versions"
            rows={versions.data}
            columns={[
              { header: 'Version', cell: (v) => <code className="text-xs">{v.id}</code> },
              { header: 'Label', cell: (v) => v.label ?? '—' },
              { header: 'Sample', cell: (v) => (v.isSample ? 'Yes' : 'No') },
              { header: 'Created', cell: (v) => formatDateTime(v.createdAt?.toMillis()) },
              {
                header: '',
                cell: (v) =>
                  v.id === activeVersion ? (
                    <StatusBadge status="ACTIVE" />
                  ) : (
                    <Button variant="ghost" onClick={() => setActivating(v.id)}>
                      Activate
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>
      <ConfirmDialog open={activating != null} title="Activate this fare version?" confirmLabel="Activate" busy={busy} onCancel={() => setActivating(null)} onConfirm={() => void doActivate()}>
        <p>
          New quotes will use <code>{activating}</code> immediately. Quotes already given keep their own version.
        </p>
      </ConfirmDialog>
    </div>
  );
}

interface Landmark {
  name: string;
  municipality: string;
  barangay: string | null;
  keywords: string[];
  lat: number;
  lng: number;
  active: boolean;
  isSample?: boolean;
}

const EMPTY_LANDMARK = { id: null as string | null, name: '', municipality: '', barangay: '', keywords: '', lat: '', lng: '', active: true };

function LandmarksTab() {
  const db = requireFirebase().db;
  const q = useMemo(() => query(collection(db, 'landmarks'), orderBy('name'), limit(300)), [db]);
  const landmarks = useQuery<Landmark>(q, 'landmarks');
  const [form, setForm] = useState(EMPTY_LANDMARK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const valid = form.name.trim().length >= 2 && form.municipality.trim().length >= 2 && form.lat !== '' && form.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.upsertLandmark({
        id: form.id,
        name: form.name.trim(),
        municipality: form.municipality.trim(),
        barangay: form.barangay.trim() || null,
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 10),
        lat,
        lng,
        active: form.active,
      });
      setForm(EMPTY_LANDMARK);
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <Card title="Landmarks">
        <p className="mb-3 text-sm text-muted">Shown in place search before (or when there is no) map provider result. Coordinates must be inside the service area.</p>
        <ErrorBanner message={landmarks.error?.message} />
        {landmarks.loading && <Loading />}
        {landmarks.data && (
          <DataTable
            caption="Landmarks"
            rows={landmarks.data}
            columns={[
              {
                header: 'Name',
                cell: (l) => (
                  <button
                    type="button"
                    className="text-left font-medium text-brand-700 hover:underline"
                    onClick={() =>
                      setForm({ id: l.id, name: l.name, municipality: l.municipality, barangay: l.barangay ?? '', keywords: (l.keywords ?? []).join(', '), lat: String(l.lat), lng: String(l.lng), active: l.active })
                    }
                  >
                    {l.name}
                  </button>
                ),
              },
              { header: 'Municipality', cell: (l) => l.municipality },
              { header: 'Barangay', cell: (l) => l.barangay ?? '—' },
              { header: 'Status', cell: (l) => (l.isSample ? <StatusBadge status="PENDING" label="Sample" /> : <StatusBadge status={l.active ? 'ACTIVE' : 'SUSPENDED'} label={l.active ? 'Active' : 'Hidden'} />) },
            ]}
          />
        )}
      </Card>
      <Card title={form.id ? 'Edit landmark' : 'Add landmark'}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField label="Name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Municipality" value={form.municipality} maxLength={60} onChange={(e) => setForm({ ...form, municipality: e.target.value })} />
          <TextField label="Barangay (optional)" value={form.barangay} maxLength={80} onChange={(e) => setForm({ ...form, barangay: e.target.value })} />
          <TextField label="Search keywords (comma-separated)" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Latitude" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            <TextField label="Longitude" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Show in search
          </label>
          <ErrorBanner message={error} />
          <div className="flex gap-2">
            <Button type="submit" busy={busy} disabled={!valid}>
              Save
            </Button>
            {form.id && (
              <Button variant="secondary" onClick={() => setForm(EMPTY_LANDMARK)}>
                New
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

function HistoryTab() {
  const [key, setKey] = useState<ConfigKey>('serviceArea');
  const db = requireFirebase().db;
  const q = useMemo(() => query(collection(db, 'configHistory'), where('key', '==', key), orderBy('at', 'desc'), limit(30)), [db, key]);
  const history = useQuery<{ key: string; revision: number; updatedBy: string; at: { toMillis(): number }; value: unknown }>(q, `history-${key}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="w-64">
        <SelectField label="Configuration" value={key} onChange={(e) => setKey(e.target.value as ConfigKey)} options={CONFIG_KEYS.map((k) => ({ value: k, label: k }))} />
      </div>
      <ErrorBanner message={history.error?.message} />
      {history.loading && <Loading />}
      {history.data?.length === 0 && <p className="text-sm text-muted">No changes recorded.</p>}
      <ol className="flex flex-col gap-2">
        {history.data?.map((h) => (
          <li key={h.id} className="rounded-xl bg-surface p-4 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Revision <strong>{h.revision}</strong> · {formatDateTime(h.at?.toMillis())} · by <code className="text-xs">{h.updatedBy}</code>
              </span>
              <Button variant="ghost" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                {open === h.id ? 'Hide' : 'View value'}
              </Button>
            </div>
            {open === h.id && <pre className="mt-3 max-h-96 overflow-auto rounded bg-canvas p-3 text-xs">{JSON.stringify(h.value, null, 2)}</pre>}
          </li>
        ))}
      </ol>
    </div>
  );
}
