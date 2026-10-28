import { useSyncExternalStore } from 'react';
import { cachedIndex, loadIndex, onMediaReady } from '../core/media.js';
import { loadExtras } from '../core/gallery.js';
import { useStore, type StoreState } from './store';

export { normaliseSighting, useDexReady } from './store';

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

// Her records come from the one shared store (lib/store.ts), read once at boot and kept fresh as the database
// changes, so a screen draws her real numbers on its first frame. Each hook returns the same object until that part
// of the store changes. Treat what they return as read-only: every screen shares it.
const pickSightings = (s: StoreState) => s.sightings as unknown as Sighting[];
const pickOutings = (s: StoreState) => s.outings as unknown as Outing[];
const pickSeen = (s: StoreState) => s.seen;
const pickKindCounts = (s: StoreState) => s.kindCounts;
const pickLastSeen = (s: StoreState) => s.lastSeen;

/** All sightings, kept fresh as the database changes. */
export function useSightings(): Sighting[] {
  return useStore(pickSightings);
}

/** The set of species ids Sarah has logged at least once. */
export function useSeen(): Set<number> {
  return useStore(pickSeen);
}

/** All outings, kept fresh as the database changes. */
export function useOutings(): Outing[] {
  return useStore(pickOutings);
}

/** How many species of each kind she has seen. */
export function useKindCounts(): Map<string, number> {
  return useStore(pickKindCounts);
}

/** Her latest sighting of each species, as 'YYYY-MM-DD HH:MM', for sorting by recently seen. */
export function useLastSeen(): Map<number, string> {
  return useStore(pickLastSeen);
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
