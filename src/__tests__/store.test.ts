// @vitest-environment jsdom
// lib/store.ts: one read-only copy of her records, read once at boot and kept fresh as the database changes. Every
// write path must reach it: db.js's change events (add, edit, delete, a Settings restore, 'Delete everything'), a
// sync pull (sync.js writes raw and calls onRemoteChange) and a sign-out that clears the phone (sync status 'off').
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

const fake = vi.hoisted(() => {
  type Row = { id: number } & Record<string, unknown>;
  const f = {
    stores: { sightings: [] as Row[], outings: [] as Row[], patches: [] as Row[] } as Record<string, Row[]>,
    kv: {} as Record<string, unknown>,
    reads: { sightings: 0, outings: 0, patches: 0, kv: 0 } as Record<string, number>,
    hang: false,
    changes: new Set<(name: string) => void>(),
    remote: new Set<() => void>(),
    status: new Set<(st: { state: string }) => void>(),
    emit(name: string) { for (const fn of f.changes) fn(name); },
    reset() {
      f.stores = { sightings: [], outings: [], patches: [] };
      f.kv = {};
      f.reads = { sightings: 0, outings: 0, patches: 0, kv: 0 };
      f.hang = false;
      f.changes.clear(); f.remote.clear(); f.status.clear();
    },
  };
  return f;
});

vi.mock('../core/db.js', () => ({
  db: {
    // Each read hands back fresh copies, as IndexedDB does.
    all: async (name: string) => {
      fake.reads[name] += 1;
      if (fake.hang) return new Promise(() => {});
      return fake.stores[name].map((r) => ({ ...r }));
    },
    kvGet: async (key: string) => { fake.reads.kv += 1; return fake.kv[key]; },
    onChange: (fn: (name: string) => void) => { fake.changes.add(fn); return () => fake.changes.delete(fn); },
  },
}));
vi.mock('../core/sync.js', () => ({
  onRemoteChange: (fn: () => void) => { fake.remote.add(fn); return () => fake.remote.delete(fn); },
  onStatus: (fn: (st: { state: string }) => void) => { fake.status.add(fn); return () => fake.status.delete(fn); },
}));

type Store = typeof import('../lib/store');
let store: Store;
const sighting = (id: number, speciesId: number, extra: Record<string, unknown> = {}) =>
  ({ id, speciesId, date: '2026-10-01', time: '07:00', count: 1, heard: false, notes: '', ...extra });

beforeEach(async () => {
  fake.reset();
  vi.useFakeTimers();
  vi.resetModules();
  store = await import('../lib/store');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let the store's timers and reads run. */
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('boot', () => {
  it('reads every store once and works out seen, per-kind counts and last seen', async () => {
    fake.stores.sightings = [
      sighting(1, 1, { date: '2026-01-02', time: '06:00' }),
      sighting(2, 1, { date: '2026-03-04', time: '08:30' }),
      { ...sighting(3, 2), notes: undefined, note: 'old field' },
    ];
    fake.stores.outings = [{ id: 7, date: '2026-10-01', time: '06:00' }];
    fake.stores.patches = [{ id: 3, name: 'Home patch', lat: -27.4, lng: 153, radiusKm: 2 }];
    fake.kv.activeOuting = 7;
    const booted = store.bootStore();
    expect(store.storeState().ready).toBe(false);
    await settle();
    await booted;
    const s = store.storeState();
    expect(s.loaded && s.ready).toBe(true);
    expect(fake.reads).toEqual({ sightings: 1, outings: 1, patches: 1, kv: 1 });
    expect([...s.seen].sort()).toEqual([1, 2]);
    expect(s.kindCounts.get('bird')).toBe(2);
    expect(s.lastSeen.get(1)).toBe('2026-03-04 08:30');
    expect(s.outings).toHaveLength(1);
    expect(s.patches).toHaveLength(1);
    expect(s.activeOuting).toBe(7);
    // v1's notes field: an older record's duplicate 'note' is folded in.
    expect(s.sightings.find((r) => r.id === 3)).toMatchObject({ notes: 'old field' });
    expect(s.sightings.find((r) => r.id === 3)).not.toHaveProperty('note');
    // Booting again is the same boot.
    expect(store.bootStore()).toBe(booted);
  });

  it('stops waiting after BOOT_WAIT if IndexedDB never answers', async () => {
    fake.hang = true;
    const booted = store.bootStore();
    await settle(store.BOOT_WAIT - 1);
    expect(store.storeState().ready).toBe(false);
    await settle(1);
    await booted;
    expect(store.storeState()).toMatchObject({ ready: true, loaded: false, sightings: [] });
  });
});

describe('keeping fresh', () => {
  beforeEach(async () => {
    fake.stores.sightings = [sighting(1, 1), sighting(2, 2)];
    void store.bootStore();
    await settle();
  });

  it('keeps every identity when a change reads back the same records', async () => {
    const before = store.storeState();
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect(fake.reads.sightings).toBe(2);
    expect(store.storeState()).toBe(before);
  });

  it('shows an added sighting at once, keeping the unchanged rows and the seen set when nothing new was seen', async () => {
    await settle(store.SETTLE_MS);
    const before = store.storeState();
    fake.stores.sightings.push(sighting(3, 1, { notes: 'again' }));
    fake.emit('sightings');
    // A change after a quiet spell is read straight away, not after the settle time.
    await settle(0);
    const after = store.storeState();
    expect(after.sightings).not.toBe(before.sightings);
    expect(after.sightings).toHaveLength(3);
    expect(after.sightings[0]).toBe(before.sightings[0]);
    expect(after.sightings[1]).toBe(before.sightings[1]);
    expect(after.seen).toBe(before.seen);
    expect(after.outings).toBe(before.outings);
  });

  it('reads each of two quick changes straight away, as taps on the outing tally need', async () => {
    fake.stores.sightings[0] = sighting(1, 1, { count: 2 });
    fake.emit('sightings');
    fake.emit('kv:activeOuting'); // the outing page's two writes for one tap make one read
    await settle(0);
    expect(store.storeState().sightings[0]).toMatchObject({ count: 2 });
    expect(fake.reads.sightings).toBe(2);
    fake.stores.sightings[0] = sighting(1, 1, { count: 3 });
    fake.emit('sightings');
    await settle(0);
    expect(store.storeState().sightings[0]).toMatchObject({ count: 3 });
    expect(fake.reads.sightings).toBe(3);
  });

  it('follows an edit and a delete', async () => {
    fake.stores.sightings[1] = sighting(2, 5);
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect([...store.storeState().seen].sort()).toEqual([1, 5]);
    fake.stores.sightings = fake.stores.sightings.filter((r) => r.id !== 2);
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect([...store.storeState().seen]).toEqual([1]);
    expect(store.storeState().kindCounts.get('bird')).toBe(1);
  });

  it('reads a burst of writes (a Settings restore) together, and ends on the last of them', async () => {
    const reads = fake.reads.sightings;
    // db.clear on every store, then one put per record, as Settings' restore does.
    fake.stores.sightings = [];
    fake.emit('sightings'); fake.emit('outings'); fake.emit('patches');
    for (let i = 1; i <= 200; i++) {
      fake.stores.sightings.push(sighting(100 + i, (i % 50) + 1));
      fake.emit('sightings');
      if (i % 40 === 0) await settle(30);
    }
    await settle(store.SETTLE_MS * 2);
    expect(fake.reads.sightings - reads).toBeLessThanOrEqual(4);
    expect(store.storeState().sightings).toHaveLength(200);
    expect(store.storeState().seen.size).toBe(50);
  });

  it("follows 'Delete everything' and the running outing", async () => {
    fake.stores.outings = [{ id: 2, date: '2026-10-29', time: '07:00' }];
    fake.kv.activeOuting = 2;
    fake.emit('outings');
    fake.emit('kv:activeOuting');
    await settle(store.SETTLE_MS);
    expect(store.storeState().activeOuting).toBe(2);
    fake.stores.sightings = []; fake.stores.outings = []; fake.stores.patches = [];
    fake.kv.activeOuting = null;
    for (const s of ['sightings', 'outings', 'patches', 'kv:activeOuting']) fake.emit(s);
    await settle(store.SETTLE_MS);
    expect(store.storeState()).toMatchObject({ sightings: [], outings: [], patches: [], activeOuting: null });
    expect(store.storeState().seen.size).toBe(0);
  });

  it('reads again after a sync pull, which writes without change events', async () => {
    fake.stores.sightings.push(sighting(9, 42));
    expect(fake.remote.size).toBe(1);
    for (const fn of fake.remote) fn();
    await settle(store.SETTLE_MS);
    expect(store.storeState().seen.has(42)).toBe(true);
  });

  it('reads again when sync stops (a sign-out that cleared the phone)', async () => {
    fake.stores.sightings = [];
    for (const fn of fake.status) fn({ state: 'saved' });
    await settle(store.SETTLE_MS);
    expect(store.storeState().sightings).toHaveLength(2);
    for (const fn of fake.status) fn({ state: 'off' });
    await settle(store.SETTLE_MS);
    expect(store.storeState().sightings).toHaveLength(0);
  });

  it('ignores changes to stores it does not hold', async () => {
    const reads = { ...fake.reads };
    fake.emit('photos');
    fake.emit('kv:settings');
    await settle(store.SETTLE_MS);
    expect(fake.reads).toEqual(reads);
  });
});

describe('hooks', () => {
  it('draw her records, and draw again only when the part they use changes', async () => {
    fake.stores.sightings = [sighting(1, 1)];
    const hooks = await import('../lib/hooks');
    let seenRenders = 0;
    let outingRenders = 0;
    const Seen = () => { seenRenders += 1; const seen = hooks.useSeen(); const ready = hooks.useDexReady(); return createElement('i', { 'data-n': seen.size, 'data-ready': String(ready) }); };
    const Outings = () => { outingRenders += 1; return createElement('b', { 'data-n': hooks.useOutings().length }); };
    const { container } = render(createElement('div', null, createElement(Seen), createElement(Outings)));
    await settle();
    const i = container.querySelector('i')!;
    expect(i.dataset).toMatchObject({ n: '1', ready: 'true' });
    const [s0, o0] = [seenRenders, outingRenders];
    // A sighting of a species already seen: the seen set keeps its identity, so neither redraws.
    fake.stores.sightings.push(sighting(2, 1));
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect([seenRenders, outingRenders]).toEqual([s0, o0]);
    // A new species: only the component that uses the seen set redraws.
    fake.stores.sightings.push(sighting(3, 7));
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect(i.dataset.n).toBe('2');
    expect(seenRenders).toBe(s0 + 1);
    expect(outingRenders).toBe(o0);
  });
});

describe('reconcile and derive', () => {
  it('reuses old rows that did not change, and the old list when none did', async () => {
    const a = [{ id: 1, x: 1 }, { id: 2, x: 2 }];
    expect(store.reconcile(a, [{ id: 1, x: 1 }, { id: 2, x: 2 }])).toBe(a);
    const b = store.reconcile(a, [{ id: 2, x: 2 }, { id: 1, x: 3 }]);
    expect(b[0]).toBe(a[1]);
    expect(b[1]).not.toBe(a[0]);
  });

  it('counts each species once per kind and keeps equal results', async () => {
    const rows = [sighting(1, 1), sighting(2, 1), sighting(3, 2)];
    const d = store.derive(rows);
    expect(d.kindCounts.get('bird')).toBe(2);
    const again = store.derive(rows.slice().reverse(), d);
    expect(again.seen).toBe(d.seen);
    expect(again.kindCounts).toBe(d.kindCounts);
    expect(again.lastSeen).toBe(d.lastSeen);
  });
});
