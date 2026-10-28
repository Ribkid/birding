// One read-only copy of her records, shared by every screen: sightings, outings, patches and the running outing,
// with what the screens work out from them (the species she has seen, how many of each kind, when she last saw
// each one). v1 held these in memory from boot, so every screen drew her real numbers on its first frame; the port
// read them again from IndexedDB each time a screen opened, and drew an empty dex first.
//
// db.js stays the only writer: this reads through db.all and db.kvGet, and reads again when db.onChange names a
// store it holds, when a sync pull has written rows (sync.js onRemoteChange), when sync stops (a sign-out that
// cleared the phone writes without db.onChange) and when the first sign-in's merge ends (it can rewrite uids without
// either). A change is read at once, and changes that come while a read is
// running are read together straight after it, so a tap on the outing tally shows as fast as before. A burst (more
// than a few changes during one read: a restore, a sync) is read once it has paused for 150 ms, so a restore of
// hundreds of records costs a handful of reads, not hundreds.
// Lists keep their identity while nothing in them changed, so screens and memoised tiles skip redrawing.
import { useSyncExternalStore } from 'react';
import { db } from '../core/db.js';
import { byId } from '../core/species.js';
import { onRemoteChange, onStatus } from '../core/sync.js';

export type Rec = { id: number } & Record<string, unknown>;
type Key = 'sightings' | 'outings' | 'patches' | 'active';
const KEYS: Key[] = ['sightings', 'outings', 'patches', 'active'];

export interface StoreState {
  sightings: Rec[];
  outings: Rec[];
  patches: Rec[];
  /** The id in the `activeOuting` kv entry, or null. */
  activeOuting: number | null;
  /** Species ids she has logged at least once. */
  seen: Set<number>;
  /** How many species of each kind she has seen. */
  kindCounts: Map<string, number>;
  /** Her latest sighting of each species, as 'YYYY-MM-DD HH:MM', for sorting by recently seen. */
  lastSeen: Map<number, string>;
  /** The first read has landed (or failed: then the lists stay empty). */
  loaded: boolean;
  /** Loaded, or BOOT_WAIT has passed since boot: screens stop waiting and draw with what there is. */
  ready: boolean;
}

/** How long screens wait for the first read before drawing without it (the Dex's old give-up time). */
export const BOOT_WAIT = 1500;
/** A burst of changes is read once it has paused this long. */
export const SETTLE_MS = 150;
/** More changes than this while one read runs make a burst. */
const BURST = 4;

const NONE: Rec[] = [];
let state: StoreState = {
  sightings: NONE, outings: NONE, patches: NONE, activeOuting: null,
  seen: new Set(), kindCounts: new Map(), lastSeen: new Map(), loaded: false, ready: false,
};
const subs = new Set<() => void>();
const set = (next: StoreState) => {
  if (next === state) return;
  state = next;
  for (const fn of subs) {
    try { fn(); } catch { /* one broken subscriber must not stop the others */ }
  }
};

/** v1 stores the note as `notes`; older React records also wrote a duplicate `note`. */
export function normaliseSighting<T extends { notes?: string; note?: string }>(row: T): T {
  if (row.note != null) {
    if (row.notes == null) row.notes = row.note;
    delete row.note;
  }
  return row;
}

// ---------- keeping identity ----------
function sameRec(a: Rec, b: Rec) {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
/** The new rows, reusing the old row objects that did not change, or the old list itself if nothing did. */
export function reconcile(prev: Rec[], next: Rec[]): Rec[] {
  if (prev.length === next.length && next.every((r, i) => sameRec(prev[i], r))) return prev;
  if (!prev.length) return next;
  const old = new Map(prev.map((r) => [r.id, r]));
  return next.map((r) => {
    const o = old.get(r.id);
    return o && sameRec(o, r) ? o : r;
  });
}
const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...b].every((x) => a.has(x));
function sameMap<K, V>(a: Map<K, V>, b: Map<K, V>) {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) if (a.get(k) !== v) return false;
  return true;
}

/** Seen set, per-kind counts and last-seen map for these sightings, keeping the old ones when they come out the same. */
export function derive(sightings: Rec[], prev?: Pick<StoreState, 'seen' | 'kindCounts' | 'lastSeen'>) {
  const seen = new Set<number>();
  const lastSeen = new Map<number, string>();
  for (const s of sightings) {
    const id = Number(s.speciesId);
    seen.add(id);
    const key = `${s.date ?? ''} ${s.time ?? ''}`;
    if (key > (lastSeen.get(id) ?? '')) lastSeen.set(id, key);
  }
  const kindCounts = new Map<string, number>();
  for (const id of seen) {
    const kind = (byId as Map<number, { kind: string }>).get(id)?.kind;
    if (kind) kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }
  return {
    seen: prev && sameSet(prev.seen, seen) ? prev.seen : seen,
    kindCounts: prev && sameMap(prev.kindCounts, kindCounts) ? prev.kindCounts : kindCounts,
    lastSeen: prev && sameMap(prev.lastSeen, lastSeen) ? prev.lastSeen : lastSeen,
  };
}

// ---------- reading ----------
async function readKey(key: Key): Promise<Rec[] | number | null> {
  if (key === 'active') {
    const v = await db.kvGet('activeOuting');
    return v == null ? null : Number(v);
  }
  const rows = (await db.all(key)) as Rec[];
  return key === 'sightings' ? rows.map((r) => normaliseSighting(r as Rec & { notes?: string; note?: string })) : rows;
}

async function read(keys: Key[]) {
  const got = await Promise.all(keys.map((k) => readKey(k).then((v) => ({ ok: true as const, v }), () => ({ ok: false as const, v: null }))));
  const next = { ...state };
  keys.forEach((k, i) => {
    const { ok, v } = got[i];
    if (!ok) return; // keep what there was; a first read that fails leaves the lists empty
    if (k === 'active') next.activeOuting = v as number | null;
    else next[k] = reconcile(state[k], v as Rec[]);
  });
  if (next.sightings !== state.sightings) Object.assign(next, derive(next.sightings, state));
  next.loaded = true;
  next.ready = true;
  const changed = (Object.keys(next) as (keyof StoreState)[]).some((k) => next[k] !== state[k]);
  if (changed) set(next);
}

const dirty = new Set<Key>();
let reading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | 0 = 0;
// Changes since the last read started; more than BURST makes the next read wait for the burst to pause, though
// never more than a second after the burst began.
let changes = 0;
let burstAt = 0;

function flush() {
  timer = 0;
  if (!dirty.size || reading) return;
  const keys = KEYS.filter((k) => dirty.has(k));
  dirty.clear();
  changes = 0;
  burstAt = 0;
  reading = read(keys).catch(() => {}).finally(() => {
    reading = null;
    if (dirty.size) schedule();
  });
}
function schedule() {
  if (reading) return; // the running read reads again for anything still marked
  const burst = changes > BURST;
  if (burst && !burstAt) burstAt = Date.now();
  if (timer) {
    if (!burst || Date.now() - burstAt > 1000) return;
    clearTimeout(timer); // a burst: wait for it to pause
  }
  timer = setTimeout(flush, burst ? SETTLE_MS : 0);
}
function mark(keys: Key[]) {
  keys.forEach((k) => dirty.add(k));
  changes += 1;
  schedule();
}

const STORE_FOR: Record<string, Key> = { sightings: 'sightings', outings: 'outings', patches: 'patches', 'kv:activeOuting': 'active' };
let booted: Promise<void> | null = null;

/**
 * Starts the store (once): the first read of everything, and the listeners that keep it fresh. main.tsx calls it
 * before React draws; the hooks call it too, so a screen drawn on its own (a test) still gets its data. Resolves
 * once the first read is in, or BOOT_WAIT has passed.
 */
export function bootStore(): Promise<void> {
  if (booted) return booted;
  try {
    db.onChange((name: string) => {
      const k = STORE_FOR[name];
      if (k) mark([k]);
    });
  } catch { /* no change events: the first read still lands */ }
  try { onRemoteChange(() => mark(KEYS)); } catch { /* sync not loaded */ }
  // Sync stopping (a sign-out that cleared the phone), and the end of the first sign-in's merge, which can give her
  // records new uids with no change event and no pull to report it (sync.js migrate). A row kept with its old uid
  // would be written back with it by an edit, and reach her account as a second copy.
  let syncWas = '';
  try {
    onStatus((st: { state: string }) => {
      const was = syncWas;
      syncWas = st.state;
      if (st.state === 'off' || (was === 'migrating' && st.state !== 'migrating')) mark(KEYS);
    });
  } catch { /* sync not loaded */ }
  KEYS.forEach((k) => dirty.add(k));
  const first = new Promise<void>((resolve) => {
    flush();
    void (reading ?? Promise.resolve()).then(() => resolve());
  });
  const wait = new Promise<void>((resolve) => setTimeout(() => {
    if (!state.ready) set({ ...state, ready: true });
    resolve();
  }, BOOT_WAIT));
  booted = Promise.race([first, wait]);
  return booted;
}

const subscribe = (fn: () => void) => {
  void bootStore();
  subs.add(fn);
  return () => { subs.delete(fn); };
};

/** The whole state, for code outside React. */
export const storeState = () => state;

/** Calls `fn` after every change to the state, for code outside React (the outing tally's queue). */
export const onStoreChange = (fn: () => void): (() => void) => subscribe(fn);

/** One part of the store, kept fresh; a part that did not change keeps its identity, so nothing redraws for it. */
export function useStore<T>(pick: (s: StoreState) => T): T {
  const get = () => pick(state);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * True once her records are in (or BOOT_WAIT has passed since boot), so a screen can wait for them without a timer of
 * its own. On every later visit it is true at once.
 */
export function useDexReady(): boolean {
  return useStore(pickReady);
}
const pickReady = (s: StoreState) => s.ready;

/** Read again now (tests, and anything that wrote without db.onChange). */
export function refreshStore(): Promise<void> {
  mark(KEYS);
  return new Promise((resolve) => {
    const check = () => (timer || reading ? setTimeout(check, 5) : resolve());
    check();
  });
}
