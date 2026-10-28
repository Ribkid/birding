import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from '../core/db.js';
import { cachedIndex, loadIndex, onMediaReady } from '../core/media.js';
import { loadExtras } from '../core/gallery.js';

export interface Sighting {
  id: number;
  speciesId: number;
  date: string;
  time: string;
  outingId?: number | null;
  count?: number;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
}

export interface Outing {
  id: number;
  date: string;
  time: string;
  place?: string;
  endedAt?: string | null;
  durationMin?: number | null;
}

/** v1 stores the note as `notes`; older React records also wrote a duplicate `note`. */
export function normaliseSighting<T extends { notes?: string; note?: string }>(row: T): T {
  if (row.note != null) {
    if (row.notes == null) row.notes = row.note;
    delete row.note;
  }
  return row;
}

/** All sightings, kept fresh as the database changes. */
export function useSightings(): Sighting[] {
  const [rows, setRows] = useState<Sighting[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = ((await db.all('sightings')) as Sighting[]).map(normaliseSighting);
      if (alive) setRows(all);
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'sightings') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

/** The set of species ids Sarah has logged at least once. */
export function useSeen(): Set<number> {
  const sightings = useSightings();
  return useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
}

export function useOutings(): Outing[] {
  const [rows, setRows] = useState<Outing[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = (await db.all('outings')) as Outing[];
      if (alive) setRows(all);
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'outings') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

// Photo readiness, shared by every component that draws a species photo. v1 waited for the saved photo index
// before its first paint and drew again when gallery.json arrived; here each of those, and every later index
// (looked up or refreshed online), bumps one version number that the photos re-render on.
let mediaVersion = 0;
let indexRead = false;
let extrasRead = false;
let mediaBooted = false;
const mediaSubs = new Set<() => void>();
const bumpMedia = () => {
  mediaVersion += 1;
  mediaSubs.forEach((fn) => fn());
};
function bootMedia() {
  if (mediaBooted) return;
  mediaBooted = true;
  onMediaReady(bumpMedia);
  // The saved index straight from IndexedDB, then anything to look up online (loadIndex notifies when it changes).
  void cachedIndex()
    .catch(() => null)
    .then(() => {
      indexRead = true;
      bumpMedia();
    });
  void loadIndex();
  void Promise.resolve(loadExtras())
    .catch(() => {})
    .then(() => {
      extrasRead = true;
      bumpMedia();
    });
}
const subscribeMedia = (fn: () => void) => {
  bootMedia();
  mediaSubs.add(fn);
  return () => {
    mediaSubs.delete(fn);
  };
};
const mediaSnapshot = () => mediaVersion;

/**
 * Photo/gallery readiness. The saved photo index, the gallery JSON and any later index are read asynchronously,
 * so components that render photos re-render when each lands. Returns a version number that changes each time.
 */
export function useMedia(): number {
  return useSyncExternalStore(subscribeMedia, mediaSnapshot, mediaSnapshot);
}

/**
 * True once the saved photo index and gallery.json have both been read. Until then a species with no photo yet
 * is still loading, not missing (v1 drew nothing before the saved index was in).
 */
export const mediaSettled = () => indexRead && extrasRead;

/** Last time a species was seen, as a `YYYY-MM-DD HH:MM` string, for sorting. */
export function lastSeenKey(sightings: Sighting[], speciesId: number): string {
  let best = '';
  for (const s of sightings) {
    if (s.speciesId !== speciesId) continue;
    const key = `${s.date} ${s.time}`;
    if (key > best) best = key;
  }
  return best;
}
