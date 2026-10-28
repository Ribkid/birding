// @vitest-environment jsdom
// The Learn hub's photos are picked as v1 picked them (js/learn.js modeFaces, packCovers and heroFace): the duel's
// look-alike pair is kept for the duel before the other cards are given faces, a pack with three or more framed
// (Wikipedia) photos takes its cover from those before preferring commoner species, and picks are kept for the day.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({
  day: '2026-10-28',
  species: [] as { id: number; kind: string; rarity: number }[],
  wiki: new Set<number>(),
  none: new Set<number>(),
  pack: [] as number[],
  rates: new Map<number, number>(),
}));
const sp = (id: number) => st.species.find((s) => s.id === id);

vi.mock('../core/quiz.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/quiz.js')>();
  return {
    seeded: real.seeded,
    hashStr: real.hashStr,
    shuffle: real.shuffle,
    MODES: ['quick', 'photo', 'call', 'whoami', 'duel'],
    CALL_KINDS: ['bird', 'frog'],
    hasCall: () => true,
    hasPhoto: (s: { id: number }) => !st.none.has(s.id),
    photosFor: (id: number) => (st.none.has(id) ? [] : [{ src: st.wiki.has(id) ? `https://upload.wikimedia.org/x/${id}.jpg` : `https://images.ala.org.au/image?imageId=${id}` }]),
    speciesFor: (kind: string) => st.species.filter((s) => (kind === 'animals' ? s.kind !== 'plant' : s.kind === kind)),
    lookalikePairs: () => [{ a: 2, b: 3 }],
    packSpecies: (key: string) => (key === 'p1' ? st.pack.map(sp) : []),
    relRate: (id: number) => st.rates.get(id) ?? null,
  };
});
vi.mock('../core/learn.js', () => ({ dayStr: () => st.day, packs: [{ key: 'p1' }] }));
vi.mock('../lib/data', () => ({
  get SPECIES() { return st.species; },
  byId: { get: (id: number) => sp(id) },
}));

import { heroFace, modeFaces, packCovers } from '../screens/learn/hubPhotos';

const bird = (id: number, rarity = 1) => ({ id, kind: 'bird', rarity });
beforeEach(() => {
  st.wiki.clear();
  st.none.clear();
  st.rates.clear();
});

describe('Learn hub photos', () => {
  it('keeps the look-alike pair for the duel before the other cards take a face', () => {
    st.day = '2026-10-01';
    st.species = [1, 2, 3, 4, 5].map((id) => bird(id));
    const f = modeFaces('animals');
    expect(f.duel).toEqual([2, 3]);
    const others = Object.entries(f).filter(([m]) => m !== 'duel').flatMap(([, ids]) => ids);
    expect(others).not.toContain(2);
    expect(others).not.toContain(3);
    expect(new Set(others).size).toBe(others.length);
  });

  it('tries again while there are no photos, then keeps the faces for the day', () => {
    st.day = '2026-10-02';
    st.species = [1, 2, 3, 4, 5, 6].map((id) => bird(id));
    st.species.forEach((s) => st.none.add(s.id));
    expect(modeFaces('animals')).toEqual({});
    st.none.clear();
    const f = modeFaces('animals');
    expect(Object.keys(f).length).toBeGreaterThan(0);
    st.species.push(bird(7));
    expect(modeFaces('animals')).toBe(f);
  });

  it('takes a pack cover from its framed photos when it has three, before preferring commoner species', () => {
    st.day = '2026-10-03';
    st.species = [bird(6), bird(7), bird(8), bird(15, 4), bird(16, 4), bird(17, 4)];
    st.pack = [6, 7, 8, 15, 16, 17];
    [15, 16, 17].forEach((id) => st.wiki.add(id));
    expect([15, 16, 17]).toContain(packCovers().p1);
  });

  it('keeps the covers for the day once the packs have them, and picks again the next day', () => {
    st.day = '2026-10-04';
    st.species = [bird(6), bird(7), bird(8)];
    st.pack = [6, 7, 8];
    const first = packCovers();
    [6, 7, 8].forEach((id) => st.wiki.add(id));
    expect(packCovers()).toBe(first);
    st.day = '2026-10-05';
    expect(packCovers()).not.toBe(first);
  });

  it('gives the challenge card a species about this month whose photo can lend its colour', () => {
    st.day = '2026-10-06';
    st.species = [bird(1), bird(2), bird(3), bird(4)];
    [[1, 0.6], [2, 0.7], [3, 0.9], [4, 0.55]].forEach(([id, r]) => st.rates.set(id, r));
    st.wiki.add(2);
    expect(heroFace(10)?.id).toBe(2);
    st.wiki.clear();
    expect([1, 2, 4]).toContain(heroFace(10)?.id);
  });
});
