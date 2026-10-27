import { useEffect, useMemo, useState } from 'react';
import { db } from '../core/db.js';
import { loadIndex, onMediaReady } from '../core/media.js';
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

let mediaBooted = false;
let extrasBooted = false;

/**
 * Photo/gallery readiness. The Wikipedia index and the gallery JSON are fetched
 * asynchronously, so components that render photos need to re-render when they land.
 */
export function useMedia(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!mediaBooted) {
      mediaBooted = true;
      void loadIndex();
    }
    if (!extrasBooted) {
      extrasBooted = true;
      void loadExtras();
    }
    const off = onMediaReady(() => setTick((t) => t + 1));
    return () => {
      off();
    };
  }, []);
}

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
