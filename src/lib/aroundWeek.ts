import { byId } from './data';
import { EBIRD_SNAPSHOT_URL, type EbirdSnapshot } from './ebird';
import { setAroundSpecies } from '../core/quiz.js';

const DAY = 24 * 60 * 60 * 1000;
let cached: number[] | null = null;
let pending: Promise<number[]> | null = null;

/** Species reported in the baked seven-day window, once each, newest report first. */
export function recentWeekSpecies(snapshot: EbirdSnapshot, now = new Date()): number[] {
  const cutoff = now.getTime() - 7 * DAY;
  const latest = new Map<number, string>();
  for (const rows of Object.values(snapshot.recent ?? {})) {
    for (const row of rows ?? []) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = Number(row[0]);
      const date = String(row[1]).slice(0, 10);
      const time = Date.parse(`${date}T00:00:00`);
      if (!Number.isFinite(time) || time < cutoff || time > now.getTime() + DAY) continue;
      if (byId.get(id)?.kind !== 'bird') continue;
      const previous = latest.get(id);
      if (!previous || date > previous) latest.set(id, date);
    }
  }
  return [...latest.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0] - b[0])
    .map(([id]) => id);
}

/** Register the week's species with the Learn pack engine and remember them for this session. */
export function applyAroundWeek(snapshot: EbirdSnapshot, now = new Date()): number[] {
  const ids = recentWeekSpecies(snapshot, now);
  cached = ids;
  setAroundSpecies(ids);
  return ids;
}

/**
 * For a direct link to /learn/play/around, load the same baked eBird snapshot the rest of the app uses.
 * Any failure is quiet: the pack simply has no birds, so the Learn hub hides it and the round says to try again.
 */
export function ensureAroundWeek(fetcher: typeof fetch = fetch, now = new Date()): Promise<number[]> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetcher(EBIRD_SNAPSHOT_URL, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('eBird snapshot unavailable');
      const snapshot = await response.json() as EbirdSnapshot;
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.recent) throw new Error('Unexpected eBird snapshot');
      return applyAroundWeek(snapshot, now);
    } catch {
      cached = [];
      setAroundSpecies([]);
      return [];
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Test seam: forget the session's recent list. */
export function resetAroundWeekCache(): void {
  cached = null;
  pending = null;
  setAroundSpecies([]);
}
