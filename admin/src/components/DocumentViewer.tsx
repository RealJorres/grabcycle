import { useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { api, type DocumentFileRequest } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { Button, ErrorBanner } from './ui';

/**
 * Shows one private identity/accreditation image. Files are never public:
 * each view is an explicit, audited call to the backend, the bytes live only
 * in memory for this component, and a visible watermark identifies the
 * viewer to discourage screenshots leaving the review process.
 */
export function DocumentViewer({ request, label }: { request: DocumentFileRequest; label: string }) {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [viewedAt, setViewedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await api.getDocumentFile(request);
      const bytes = Uint8Array.from(atob(file.dataBase64), (c) => c.charCodeAt(0));
      setUrl(URL.createObjectURL(new Blob([bytes], { type: file.contentType })));
      setViewedAt(Date.now());
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      {url ? (
        <div className="relative overflow-hidden rounded-lg bg-black/5 ring-1 ring-line" onContextMenu={(e) => e.preventDefault()}>
          <img src={url} alt={label} className="max-h-[480px] w-full object-contain select-none" draggable={false} />
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 rounded bg-white/50 px-3 py-1 text-xs font-semibold tracking-wide text-black/60">
              CONFIDENTIAL · {user?.email ?? 'staff'} · {formatDateTime(viewedAt)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg bg-canvas ring-1 ring-line">
          <Button variant="secondary" onClick={() => void load()} busy={busy}>
            View document (logged)
          </Button>
        </div>
      )}
      <ErrorBanner message={error} />
    </figure>
  );
}
