// Small, calm readers for the eBird snapshot and the private function. A live call never holds a screen: it exposes a
// loading flag, hides when offline, and keeps a null in place of every failure.
import { useEffect, useMemo, useState } from 'react';
import { fetchEbirdQuery, type EbirdSnapshot } from './ebird';

let snapshot: EbirdSnapshot | null | undefined;
let snapshotPromise: Promise<EbirdSnapshot | null> | null = null;
const liveCache = new Map<string, unknown>();

/** Tests and a fresh app boot can clear the module cache without reaching into implementation details. */
export function resetEbirdSnapshotCache(): void {
  snapshot = undefined;
  snapshotPromise = null;
  liveCache.clear();
}

/** The baked eBird file; undefined while it is being read, null when it is unavailable. */
export function useEbirdSnapshot(): EbirdSnapshot | null | undefined {
  const [data, setData] = useState<EbirdSnapshot | null | undefined>(snapshot);
  useEffect(() => {
    if (snapshot !== undefined) {
      setData(snapshot);
      return;
    }
    let alive = true;
    snapshotPromise ??= fetch('/data/ebird/spots.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((json: EbirdSnapshot | null) => {
        if (!json || !Array.isArray(json.spots)) return null;
        snapshot = json;
        return json;
      })
      .catch(() => {
        snapshot = null;
        return null;
      });
    void snapshotPromise.then((next) => {
      if (alive) setData(next);
    });
    return () => { alive = false; };
  }, []);
  return data;
}

/** True while the browser says it has a connection; changes to offline/online redraw callers. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? false : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export interface LiveEbirdState<T> {
  data: T | null;
  loading: boolean;
  online: boolean;
}

/**
 * One named private-function route. Calls are cached for the visit so two copies of a card do not ask twice; the
 * eight-second wait lives in fetchEbirdQuery, and every failure is simply no data.
 */
export function useLiveEbird<T>(
  query: Record<string, string | number | boolean>,
  enabled = true,
): LiveEbirdState<T> {
  const online = useOnline();
  const key = useMemo(() => JSON.stringify(query), [query]);
  const allowed = enabled && online;
  const cached = allowed ? liveCache.get(key) as T | undefined : undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(() => allowed && cached === undefined);

  useEffect(() => {
    if (!allowed) {
      setData(null);
      setLoading(false);
      return;
    }
    const hit = liveCache.get(key) as T | undefined;
    if (hit !== undefined) {
      setData(hit);
      setLoading(false);
      return;
    }
    let alive = true;
    setData(null);
    setLoading(true);
    void fetchEbirdQuery<T>(JSON.parse(key) as Record<string, string | number | boolean>, fetch, true)
      .then((next) => {
        if (!alive) return;
        if (next != null) liveCache.set(key, next);
        setData(next);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [allowed, key]);

  return { data, loading, online };
}
