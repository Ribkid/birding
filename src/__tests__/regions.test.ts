// Region packs (src/regions): the SEQ pack must describe exactly the dex the app had before packs existed, and the
// helpers must turn councils into eBird codes and areas. See docs/plans/2026-11-05-melbourne-region-design.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import seq from '../regions/seq.js';
import { PACKS, REGION, councilOf, ebirdRegion, regionFile, storedRegion, zoneOf, REGION_KEY } from '../regions/index.js';
import { ALL_BIRDS, ALL_SPECIES, BIRDS, RARITY, SPECIES, byId } from '../core/species.js';
import { compactSnapshot } from '../../scripts/build-ebird.mjs';
import handler, { latestToday } from '../../api/ebird.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the SEQ region pack', () => {
  it('lists all 181 birds and every species in species-new.json, each with a rarity of 1–5', () => {
    const extra = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'species-new.json'), 'utf8')) as { id: number }[];
    const ids = Object.keys(seq.species).map(Number);
    expect(ids).toHaveLength(181 + extra.length);
    for (let id = 1; id <= 181; id++) expect(seq.species).toHaveProperty(String(id));
    for (const { id } of extra) expect(seq.species).toHaveProperty(String(id));
    expect(Object.values(seq.species).every((r) => Number.isInteger(r) && r >= 1 && r <= 5)).toBe(true);
  });

  it('puts every council in exactly one area, and every area is made of known councils', () => {
    for (const pack of Object.values(PACKS)) {
      const councils = Object.keys(pack.ebird.councils);
      const inAreas = Object.values(pack.ebird.zones).flatMap((zone) => zone.councils);
      expect([...inAreas].sort()).toEqual([...councils].sort());
      expect(pack.ebird.councils).toHaveProperty(pack.ebird.fallbackCouncil);
    }
  });

  it('is the region when none is saved, and the dex is the whole catalogue', () => {
    expect(REGION.code).toBe('seq');
    expect(BIRDS).toHaveLength(181);
    expect(ALL_BIRDS).toHaveLength(181);
    expect(SPECIES.map((s) => s.id)).toEqual(ALL_SPECIES.map((s) => s.id));
    expect(RARITY[1].hint).toBe('Reported all the time across SEQ');
    expect(RARITY[5].hint).toBe('A genuine find in SEQ');
  });

  it('gives every bird the rarity it had before packs (Australian Brush-turkey common, Scaly-breasted Munia rare)', () => {
    expect(byId.get(1)).toMatchObject({ name: 'Australian Brush-turkey', rarity: 1 });
    const munia = BIRDS.find((b) => b.name === 'Scaly-breasted Munia');
    expect(munia?.rarity).toBe(5);
    for (const b of BIRDS) expect(b.rarity).toBe(seq.species[b.id]);
  });
});

describe('region helpers', () => {
  it('build file paths and eBird codes from the pack', () => {
    expect(regionFile('rates.json')).toBe('/data/regions/seq/rates.json');
    expect(regionFile('ebird.json', 'melb')).toBe('/data/regions/melb/ebird.json');
    expect(ebirdRegion('BRI')).toBe('AU-QLD-BRI');
    expect(councilOf('AU-QLD-GOL')).toBe('GOL');
    expect(zoneOf('SUN')).toBe('SUN');
    expect(zoneOf('NOPE')).toBeNull();
  });

  it('ignores a saved region that does not exist', () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null });
    saved.set(REGION_KEY, 'atlantis');
    expect(storedRegion()).toBeNull();
    saved.set(REGION_KEY, 'seq');
    expect(storedRegion()).toBe('seq');
  });
});

describe('area lists in the eBird snapshot', () => {
  // A made-up two-area region, to show councils being grouped the way Melbourne's 37 become 8 areas.
  const pack = {
    ...seq,
    code: 'test',
    ebird: {
      ...seq.ebird,
      state: 'AU-VIC',
      councils: { MEL: 'Melbourne', YAR: 'Yarra', WYN: 'Wyndham' },
      zones: { inner: { name: 'Inner Melbourne', councils: ['MEL', 'YAR'] }, west: { name: 'West', councils: ['WYN'] } },
      fallbackCouncil: 'MEL',
    },
  };

  it('strips the region’s own state prefix from each hotspot and merges council lists into areas', () => {
    const result = compactSnapshot({
      byCode: new Map([['a', 1], ['b', 2], ['c', 3]]),
      hotspots: [{ locId: 'L1', locName: 'Royal Park', lat: -37.78, lng: 144.95, numSpeciesAllTime: 185, numChecklistsAllTime: 9000, latestObsDt: '2026-11-05', subnational2Code: 'AU-VIC-MEL' }],
      lists: {},
      regionLists: { MEL: ['a', 'b'], YAR: ['b', 'c'], WYN: ['c', 'zzz'] },
      recent: [],
      notable: [],
      built: '2026-11-05T00:00:00.000Z',
      pack,
    });
    expect(result.spots[0][7]).toBe('MEL');
    expect(result.regions).toEqual({
      inner: { name: 'Inner Melbourne', ids: [1, 2, 3] },
      west: { name: 'West', ids: [3] },
    });
  });

  it('leaves an area out when none of its council lists came back', () => {
    const result = compactSnapshot({
      byCode: new Map([['a', 1]]), hotspots: [], lists: {}, regionLists: { WYN: ['a'] }, recent: [], notable: [], built: 'x', pack,
    });
    expect(Object.keys(result.regions)).toEqual(['west']);
  });
});

describe('the eBird proxy across regions', () => {
  function response() {
    return {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      setHeader(name: string, value: string) { this.headers[name] = value; return this; },
      json(value: unknown) { this.body = value; return this; },
    };
  }

  it('takes the latest local date of any region, not a fixed UTC+10', () => {
    // 23:30 in Brisbane on the 5th is still the 5th in UTC.
    expect(latestToday(new Date('2026-11-05T13:30:00Z'))).toBe('2026-11-05');
    // 00:30 on the 6th in Brisbane.
    expect(latestToday(new Date('2026-11-05T14:30:00Z'))).toBe('2026-11-06');
  });

  it('asks for the state of the region named by ?in=, defaulting to SEQ for older clients', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ numChecklists: 3, numContributors: 2, numSpecies: 40 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env[['EBIRD', 'API', 'KEY'].join('_')] = 'unit-test';

    await handler({ method: 'GET', query: { stats: '', date: '2026-11-01' } }, response());
    await handler({ method: 'GET', query: { stats: '', date: '2026-11-01', in: 'seq' } }, response());
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.ebird.org/v2/product/stats/AU-QLD/2026/11/1',
      'https://api.ebird.org/v2/product/stats/AU-QLD/2026/11/1',
    ]);

    const bad = response();
    await handler({ method: 'GET', query: { stats: '', date: '2026-11-01', in: 'atlantis' } }, bad);
    expect(bad.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts nearby searches inside a region and refuses them outside every region', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env[['EBIRD', 'API', 'KEY'].join('_')] = 'unit-test';

    const inside = response();
    await handler({ method: 'GET', query: { near: '', lat: '-27.47', lng: '153.02', dist: '10', back: '7' } }, inside);
    expect(inside.statusCode).toBe(200);

    const sydney = response();
    await handler({ method: 'GET', query: { near: '', lat: '-33.87', lng: '151.21', dist: '10', back: '7' } }, sydney);
    expect(sydney.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
