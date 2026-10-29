// @vitest-environment jsdom
// lib/tiers.ts: heard only and photographed, worked out from the sightings the shared store holds. Decoration only:
// photographed is core/stats badges()'s photo rule, heard only (every sighting heard) is tiers.ts's own, heard still
// counts as seen, and nothing reads the photos store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { badges } from '../core/stats.js';

const fake = vi.hoisted(() => {
  type Row = { id: number } & Record<string, unknown>;
  const f = {
    stores: { sightings: [] as Row[], outings: [] as Row[], patches: [] as Row[], photos: [] as Row[] } as Record<string, Row[]>,
    kv: {} as Record<string, unknown>,
    reads: [] as string[],
    changes: new Set<(name: string) => void>(),
    emit(name: string) { for (const fn of f.changes) fn(name); },
    reset() {
      f.stores = { sightings: [], outings: [], patches: [], photos: [] };
      f.kv = {};
      f.reads = [];
      f.changes.clear();
    },
  };
  return f;
});

vi.mock('../core/db.js', () => ({
  db: {
    all: async (name: string) => { fake.reads.push(name); return fake.stores[name].map((r) => ({ ...r })); },
    get: async (name: string, id: number) => { fake.reads.push(name); return fake.stores[name].find((r) => r.id === id); },
    kvGet: async (key: string) => fake.kv[key],
    onChange: (fn: (name: string) => void) => { fake.changes.add(fn); return () => fake.changes.delete(fn); },
  },
}));
vi.mock('../core/sync.js', () => ({ onRemoteChange: () => () => {}, onStatus: () => () => {} }));

type Tiers = typeof import('../lib/tiers');
type Store = typeof import('../lib/store');
let tiers: Tiers;
let store: Store;

const sighting = (id: number, speciesId: number, extra: Record<string, unknown> = {}) =>
  ({ id, speciesId, count: 1, heard: false, date: '2026-10-01', time: '07:00', lat: null, lng: null, acc: null, place: '', notes: '', photoId: null, outingId: null, ...extra });
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

beforeEach(async () => {
  fake.reset();
  vi.useFakeTimers();
  vi.resetModules();
  store = await import('../lib/store');
  tiers = await import('../lib/tiers');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('tiersOf', () => {
  it('is heard only when every sighting of the species was heard, in whatever order they were logged', () => {
    const t = tiers.tiersOf([
      sighting(1, 33, { heard: true }), sighting(2, 33, { heard: true }), // only ever heard
      sighting(3, 21, { heard: true }), sighting(4, 21), // heard, then seen
      sighting(5, 45), sighting(6, 45, { heard: true }), // seen, then heard
      sighting(7, 9), // seen
    ]);
    expect(sorted(t.heardOnly)).toEqual([33]);
  });

  it('is photographed when any sighting has a photoId, a photo synced from another device included', () => {
    const t = tiers.tiersOf([
      sighting(1, 9, { photoId: 4 }), sighting(2, 9),
      // sync.js gives a pulled photo a photos row with no blob; the sighting's photoId is all that counts.
      sighting(3, 12, { photoId: 17 }),
      sighting(4, 5, { photoId: null }), sighting(5, 6), sighting(6, 7, { photoId: undefined }),
      sighting(7, 33, { heard: true, photoId: 2 }), // heard only and photographed
    ]);
    expect(sorted(t.photographed)).toEqual([9, 12, 33]);
    expect(sorted(t.heardOnly)).toEqual([33]);
  });

  it("matches core/stats badges(): its photo badges count the same species, and heard still counts as seen", () => {
    const rows = [
      sighting(1, 1, { photoId: 1 }), sighting(2, 1, { photoId: 2 }), sighting(3, 2, { photoId: 3, heard: true }),
      sighting(4, 3, { heard: true }), sighting(5, 4), sighting(6, 5, { photoId: 9 }),
    ];
    const t = tiers.tiersOf(rows);
    const list = badges(rows, []) as { id: string; have: number }[];
    expect(list.find((b) => b.id === 'photo25')!.have).toBe(t.photographed.size);
    // Heard-only species are still in her dex: badges' life list counts them.
    expect(list.find((b) => b.id === 'n10')!.have).toBe(5);
    expect(t.heardOnly.has(3) && t.heardOnly.has(2)).toBe(true);
  });

  it('reads the sightings as the store keeps them, ids as numbers', () => {
    const t = tiers.tiersOf([{ speciesId: '33', heard: true }, { speciesId: '9', photoId: 1 }]);
    expect(sorted(t.heardOnly)).toEqual([33]);
    expect(sorted(t.photographed)).toEqual([9]);
  });
});

describe('selectTiers', () => {
  it('works the tiers out once per sightings list, keeping each set while what is in it stays the same', () => {
    const a = [sighting(1, 33, { heard: true }), sighting(2, 9, { photoId: 1 })];
    const first = tiers.selectTiers({ sightings: a });
    expect(tiers.selectTiers({ sightings: a })).toBe(first);
    // A new list with the same tiers (an edited note): the same object, so nothing redraws.
    const b = [...a, sighting(3, 9, { notes: 'again' })];
    expect(tiers.selectTiers({ sightings: b })).toBe(first);
    // Seeing the heard-only owl: a new heard-only set, the photographed set kept.
    const c = [...b, sighting(4, 33)];
    const next = tiers.selectTiers({ sightings: c });
    expect(next).not.toBe(first);
    expect(next.heardOnly.size).toBe(0);
    expect(next.photographed).toBe(first.photographed);
  });
});

describe('useTiers', () => {
  it("follows the shared store's sightings and never reads the photos store", async () => {
    fake.stores.sightings = [sighting(1, 33, { heard: true }), sighting(2, 9)];
    fake.stores.photos = [{ id: 1, uid: 'p1', blob: null, remote: true }];
    let seenTiers: ReturnType<Tiers['useTiers']> | null = null;
    let draws = 0;
    function Probe() {
      seenTiers = tiers.useTiers();
      draws += 1;
      return null;
    }
    render(createElement(Probe));
    await settle();
    expect(sorted(seenTiers!.heardOnly)).toEqual([33]);
    expect(seenTiers!.photographed.size).toBe(0);
    // A photo pulled from another device lands on 9's sighting.
    fake.stores.sightings[1] = sighting(2, 9, { photoId: 1 });
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect(sorted(seenTiers!.photographed)).toEqual([9]);
    const drawsThen = draws;
    // An edit that changes no tier draws nothing again.
    fake.stores.sightings[0] = sighting(1, 33, { heard: true, notes: 'calling at dusk' });
    fake.emit('sightings');
    await settle(store.SETTLE_MS);
    expect(draws).toBe(drawsThen);
    expect(fake.reads).not.toContain('photos');
    // Heard only stays seen: the store's seen set and per-kind counts include the owl.
    expect(store.storeState().seen.has(33)).toBe(true);
    expect(store.storeState().kindCounts.get('bird')).toBe(2);
  });
});

describe('countIn and tierNote', () => {
  it('counts the species that pass a kind tab test', () => {
    expect(tiers.countIn(new Set([1, 2, 3, 300]), (id) => id < 100)).toBe(3);
    expect(tiers.countIn(new Set(), () => true)).toBe(0);
  });

  it("gives the tile's screen-reader words for each tier", () => {
    expect(tiers.tierNote(false, false, false)).toBe(', not seen');
    expect(tiers.tierNote(true, false, false)).toBe(', seen');
    expect(tiers.tierNote(true, true, false)).toBe(', heard only');
    expect(tiers.tierNote(true, false, true)).toBe(', seen and photographed');
    expect(tiers.tierNote(true, true, true)).toBe(', heard only and photographed');
  });
});

describe('heardOnlySoFar', () => {
  it("says the species page's 'Heard only so far.' by the Dex's own rule", () => {
    const all = [
      sighting(1, 33, { heard: true }), sighting(2, 33, { heard: true }), // only ever heard
      sighting(3, 21, { heard: true }), sighting(4, 21), // heard, then seen
      sighting(5, 9), // seen
      sighting(6, 7, { heard: true, photoId: 3 }), // heard only, with a photo of where it called from
    ];
    const ring = tiers.tiersOf(all).heardOnly;
    for (const id of [33, 21, 9, 7, 50]) expect(tiers.heardOnlySoFar(all, id)).toBe(ring.has(id));
    expect([33, 21, 9, 7, 50].filter((id) => tiers.heardOnlySoFar(all, id))).toEqual([33, 7]);
    // One sighting she saw takes it off, wherever it sits in her history; none at all is not "heard only".
    expect(tiers.heardOnlySoFar([...all, sighting(9, 33)], 33)).toBe(false);
    expect(tiers.heardOnlySoFar([], 33)).toBe(false);
  });

  it('reads the species page\'s own history the same as the whole list', () => {
    const all = [sighting(1, 33, { heard: true }), sighting(2, 5), sighting(3, 33, { heard: true })];
    expect(tiers.heardOnlySoFar(all.filter((s) => s.speciesId === 33), 33)).toBe(true);
    expect(tiers.heardOnlySoFar([{ ...sighting(4, 33, { heard: true }), speciesId: '33' }], 33)).toBe(true);
  });
});
