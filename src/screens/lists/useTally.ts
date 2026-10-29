// useTally(outing): the outing page's counts, drawn the moment she taps and stored by one writer per outing
// (tallyQueue.ts). The writer keeps going when she leaves the page, and leaving the page, the tab going to the
// background and the page being closed all start the writes still waiting. Taps not stored yet are noted in this
// browser as they happen, and a page closed mid-write has them stored on the next start (recoverTallies).
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { db } from '../../core/db.js';
import { onStoreChange, storeState } from '../../lib/store';
import { toast } from '../../lib/toast';
import { deleteSighting, saveSighting, writeSighting, type OutingRow, type SightingRow } from './shared';
import { TallyQueue, recoverTallies, type JournalData, type TallyCount, type TallyIO, type TallyJournal } from './tallyQueue';

export type { TallyCount } from './tallyQueue';

export const TALLY_FAILED = "That count didn't save. Try again.";

/** A short buzz with a tap, once she has touched the page (Chrome blocks vibrate before that). */
export const buzz = (pattern: number | number[]) => {
  try {
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return;
    navigator.vibrate?.(pattern);
  } catch { /* no vibration here */ }
};

// The journal of taps not stored yet: one small JSON entry in localStorage. It is a note of what the rows showed,
// never a copy of her sightings; it is empty again once the writer catches up. It is read afresh for each note, so a
// second tab of the app noting its own taps meanwhile keeps them (a copy read once would write over them).
export const JOURNAL_KEY = 'birdydex:tally-unsaved';
let journalMemory: JournalData = {};
export const localJournal: TallyJournal = {
  read() {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as JournalData) : {};
    } catch {
      return journalMemory; // no storage here: the page still counts, it just can't note anything for next time
    }
  },
  write(outingId, speciesId, entry) {
    const all = localJournal.read();
    const o = String(outingId);
    const sp = String(speciesId);
    if (entry) (all[o] ??= {})[sp] = entry;
    else if (all[o]) {
      delete all[o][sp];
      if (!Object.keys(all[o]).length) delete all[o];
    }
    journalMemory = all;
    try {
      if (Object.keys(all).length) localStorage.setItem(JOURNAL_KEY, JSON.stringify(all));
      else localStorage.removeItem(JOURNAL_KEY);
    } catch { /* private mode or full: the writer still stores the taps while the page is open */ }
  },
};

// On start, the taps a page closed mid-write never stored. The app loads this module at boot (App.tsx draws the
// outing route), so this runs once, a moment after the first draw; the tally's writes wait for it.
const recovered: Promise<void> = new Promise<void>((resolve) => { setTimeout(resolve, 0); })
  .then(() => (Object.keys(localJournal.read()).length
    ? recoverTallies({
      journal: localJournal,
      getOuting: (id) => db.get('outings', id) as Promise<OutingRow | undefined>,
      onOuting: (id) => db.byIndex('sightings', 'outingId', id) as Promise<SightingRow[]>,
      add: writeSighting,
      update: (rec) => db.put('sightings', rec),
      remove: deleteSighting,
    })
    : undefined))
  .catch(() => {});

const appIO: TallyIO = {
  // Quiet: a first sighting from the tally gets its moment on the row (Outing.tsx), not the card, which would make
  // the page inert and lose the taps after it.
  create: (rec) => saveSighting(rec, { quiet: true }),
  update: (rec) => db.put('sightings', rec),
  remove: deleteSighting,
  markActive: (id) => db.kvSet('activeOuting', id),
  failed: () => toast(TALLY_FAILED),
  now: () => Date.now(),
  journal: localJournal,
  ready: recovered,
};

// One queue per outing for the whole visit, so a write still running when she leaves and comes back is drawn the
// same, and what it wrote is used until the store has read it back.
const queues = new Map<number, TallyQueue>();
export function tallyQueueFor(outing: OutingRow, io: TallyIO = appIO): TallyQueue {
  let q = queues.get(outing.id);
  if (!q) {
    q = new TallyQueue(outing, io);
    queues.set(outing.id, q);
    if (io === appIO) watchStore();
  }
  // Its place, date and time follow the record (the Finish sheet can change them).
  q.outing = outing;
  return q;
}

/** Forgets an outing's queue once the outing is deleted (Discard, Delete outing): nothing of it is drawn again. */
export function forgetTally(outingId: number) {
  queues.delete(outingId);
}

// Every read of the shared store reaches each queue still holding a write the store hadn't read back, whether or not
// its outing is on screen, so the queue goes back to the store as soon as the store has the write.
let watching = false;
function watchStore() {
  if (watching) return;
  watching = true;
  onStoreChange(() => {
    let byId: Map<number, SightingRow> | null = null;
    for (const q of queues.values()) {
      if (!q.waiting()) continue;
      byId ??= new Map((storeState().sightings as unknown as SightingRow[]).map((r) => [r.id, r]));
      const all = byId;
      q.catchUp((id) => all.get(id));
    }
  });
}

const noSub = () => () => {};
const zero = () => 0;
const NONE: TallyCount[] = [];

export interface Tally {
  /** The species on the tally, newest first, with the counts she sees. */
  rows: TallyCount[];
  /** A species' row, or undefined when it isn't on the tally. */
  get: (speciesId: number) => TallyCount | undefined;
  /** Counts a tap (or a flock) at once; the writer stores it. */
  tap: (speciesId: number, delta: number) => void;
  /** Resolves once every tap is stored. */
  flush: () => Promise<void>;
  /** Drops the taps not written yet and waits for the write in progress. */
  drop: () => Promise<void>;
}

/**
 * The tally of `outing`: `stored` is the store's sighting per species on it (what Outing.tsx drew before). Pass
 * undefined while the outing hasn't loaded.
 */
export function useTally(outing: OutingRow | undefined, stored: Map<number, SightingRow>): Tally {
  const q = outing ? tallyQueueFor(outing) : null;
  const version = useSyncExternalStore(q ? q.subscribe : noSub, q ? q.getVersion : zero, q ? q.getVersion : zero);

  // The writer works from the store's records; it reads them at the next write, after this commit.
  useLayoutEffect(() => {
    q?.setStored(stored);
  }, [q, stored]);

  useEffect(() => {
    if (!q) return;
    const hidden = () => { if (document.visibilityState === 'hidden') void q.flush(); };
    const pagehide = () => { void q.flush(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      // Leaving the outing: anything still waiting is written now (the queue outlives the page).
      void q.flush();
    };
  }, [q]);

  const rows = useMemo(
    () => (q ? q.view(stored) : NONE),
    // version: the queue changed (a tap, a write landing, a rollback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, stored, version],
  );
  return useMemo(() => {
    const by = new Map(rows.map((r) => [r.speciesId, r]));
    return {
      rows,
      get: (id: number) => by.get(id),
      tap: (id: number, delta: number) => q?.tap(id, delta),
      flush: () => q?.flush() ?? Promise.resolve(),
      drop: () => q?.drop() ?? Promise.resolve(),
    };
  }, [rows, q]);
}
