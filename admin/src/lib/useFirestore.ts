import {
  doc,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { requireFirebase } from './firebase';

export interface LiveState<T> {
  data: T | null;
  loading: boolean;
  error: FirestoreError | null;
  /** True while showing locally cached data that the server has not confirmed. */
  fromCache: boolean;
}

export type WithId<T> = T & { id: string };

const initial = { data: null, loading: true, error: null, fromCache: false };

/**
 * Live document subscription. Pass `null` to subscribe to nothing. The key is
 * the document path, so re-renders with the same path do not resubscribe.
 */
export function useDocument<T = DocumentData>(path: string | null): LiveState<WithId<T>> & { exists: boolean } {
  const [state, setState] = useState<LiveState<WithId<T>> & { exists: boolean; key: string | null }>({
    ...initial,
    exists: false,
    key: path,
  });
  if (state.key !== path) setState({ ...initial, loading: path != null, exists: false, key: path });

  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(requireFirebase().db, path),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as WithId<T>) : null,
          exists: snap.exists(),
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
          key: path,
        }),
      (error) => setState((s) => ({ ...s, loading: false, error, key: path })),
    );
  }, [path]);
  return state;
}

/**
 * Live query subscription. `key` must change whenever the query changes
 * (queries are not comparable), and `null` disables the subscription.
 */
export function useQuery<T = DocumentData>(query: Query | null, key: string): LiveState<Array<WithId<T>>> {
  const [state, setState] = useState<LiveState<Array<WithId<T>>> & { key: string }>({ ...initial, key });
  if (state.key !== key) setState({ ...initial, loading: query != null, key });

  useEffect(() => {
    if (!query) return;
    return onSnapshot(
      query,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }) as WithId<T>),
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
          key,
        }),
      (error) => setState((s) => ({ ...s, loading: false, error, key })),
    );
    // The caller-provided key identifies the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
