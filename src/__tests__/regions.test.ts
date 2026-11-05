// Region packs (src/regions): the SEQ pack must describe exactly the dex the app had before packs existed, and the
// helpers must turn councils into eBird codes and areas. See docs/plans/2026-11-05-melbourne-region-design.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import seq from '../regions/seq.js';
import melb from '../regions/melb.js';
import { PACKS, REGION, canUse, councilOf, ebirdRegion, regionFile, storedRegion, zoneOf, REGION_KEY } from '../regions/index.js';
import { ALL_BIRDS, ALL_SPECIES, BIRDS, RARITY, SPECIES, byId } from '../core/species.js';
import { SCI_ALIASES, compactSnapshot, mapTaxonomy } from '../../scripts/build-ebird.mjs';
import { clean, isBirdTaxon, nearSpots, rarityBand } from '../../scripts/build-rates.mjs';
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

describe('the Melbourne region pack', () => {
  it('holds the 103 app birds that are regular around Melbourne, each with a rarity of 1–5', () => {
    const ids = Object.keys(melb.species).map(Number);
    expect(ids).toHaveLength(103);
    for (const id of ids) expect(byId.get(id)?.kind).toBe('bird');
    expect(Object.values(melb.species).every((r) => Number.isInteger(r) && r >= 1 && r <= 5)).toBe(true);
    // Common in both cities, and none of the northern birds that barely reach Melbourne.
    expect(melb.species).toHaveProperty(String(BIRDS.find((b) => b.name === 'Superb Fairywren')!.id));
    expect(melb.species).not.toHaveProperty('1'); // Australian Brush-turkey
  });

  it('covers the 37 councils in 8 areas, with its own notes only for its own birds', () => {
    expect(Object.keys(melb.ebird.councils)).toHaveLength(37);
    expect(Object.keys(melb.ebird.zones)).toHaveLength(8);
    expect(melb.ebird.state).toBe('AU-VIC');
    for (const id of Object.keys(melb.notes)) expect(melb.species).toHaveProperty(id);
    for (const note of Object.values(melb.notes)) expect(note).not.toMatch(/SEQ|Moreton|Scenic Rim|Lockyer/);
  });

  it('turns Victorian council codes into areas, even where a code is a Queensland one too (BRI)', () => {
    expect(ebirdRegion('BRI', melb)).toBe('AU-VIC-BRI');
    expect(councilOf('AU-VIC-BRI', melb)).toBe('BRI');
    expect(zoneOf('BRI', melb)).toBe('west');
    expect(zoneOf('BRI', seq)).toBe('BRI');
    expect(zoneOf('MPE', melb)).toBe('peninsula');
  });

  it('can only be picked in a dev build until it launches', () => {
    expect(canUse('melb', false)).toBe(false);
    expect(canUse('melb', true)).toBe(true);
    expect(canUse('seq', false)).toBe(true);
    expect(canUse('atlantis', true)).toBe(false);
  });

  it('bands record counts as SEQ does', () => {
    expect([40000, 39999, 15000, 4000, 800, 799].map(rarityBand)).toEqual([1, 2, 2, 3, 4, 5]);
  });

  it('keeps record squares near the region’s own hotspots, so its box does not reach Ballarat', () => {
    const inRegion = nearSpots([[-37.78, 144.95], [-38.0, 144.6]]); // Royal Park, Western Treatment Plant
    expect(inRegion(-37.79, 144.96)).toBe(true);
    expect(inRegion(-38.01, 144.62)).toBe(true);
    expect(inRegion(-37.55, 143.84)).toBe(false); // Lake Wendouree, Ballarat
    expect(nearSpots([])(-37.55, 143.84)).toBe(true);
  });

  it('only takes a species or subspecies as a bird’s ALA name, never an order', () => {
    expect(isBirdTaxon({ rank: 'order', scientificName: 'ANSERIFORMES' })).toBe(false);
    expect(isBirdTaxon({ rank: 'species', scientificName: 'Anseranas semipalmata' })).toBe(true);
    expect(isBirdTaxon({ rank: 'subspecies' })).toBe(true);
  });

  it('tidies ALA place names from any state', () => {
    expect(clean('Royal Park, Parkville, AU-VIC')).toBe('Royal Park, Parkville');
    expect(clean('Lake Samsonvale -- Golds Scrub Lane (general area)')).toBe('Lake Samsonvale: Golds Scrub Lane');
  });
});

describe('eBird names for app birds', () => {
  it('match the six birds whose eBird name differs, Eastern Osprey to eBird’s Osprey', () => {
    const taxonomy = Object.entries(SCI_ALIASES).map(([, ebird], i) => ({ speciesCode: `code${i}`, sciName: ebird }));
    const { byCode } = mapTaxonomy(taxonomy, ALL_BIRDS);
    expect(byCode.size).toBe(6);
    const osprey = ALL_BIRDS.find((b) => b.name === 'Eastern Osprey')!;
    expect(SCI_ALIASES[osprey.sci]).toBe('Pandion haliaetus');
    expect([...byCode.values()]).toContain(osprey.id);
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
    // 22:30 in Brisbane and 23:30 in Melbourne (daylight saving) on the 5th.
    expect(latestToday(new Date('2026-11-05T12:30:00Z'))).toBe('2026-11-05');
    // 00:30 on the 6th in Melbourne, though still 23:30 on the 5th in Brisbane.
    expect(latestToday(new Date('2026-11-05T13:30:00Z'))).toBe('2026-11-06');
    // In winter Melbourne is UTC+10 too.
    expect(latestToday(new Date('2026-07-05T13:30:00Z'))).toBe('2026-07-05');
  });

  it('asks Victoria for Melbourne stats, and takes Victorian councils', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(
      String(url).includes('stats') ? JSON.stringify({ numChecklists: 3, numContributors: 2, numSpecies: 40 }) : '[]', { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    process.env[['EBIRD', 'API', 'KEY'].join('_')] = 'unit-test';

    await handler({ method: 'GET', query: { stats: '', date: '2026-11-01', in: 'melb' } }, response());
    const wyndham = response();
    await handler({ method: 'GET', query: { historic: '', region: 'AU-VIC-WYN', date: '2026-11-01' } }, wyndham);
    expect(wyndham.statusCode).toBe(200);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.ebird.org/v2/product/stats/AU-VIC/2026/11/1',
      'https://api.ebird.org/v2/data/obs/AU-VIC-WYN/historic/2026/11/1?rank=mrec&detail=simple',
    ]);
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

    const melbourne = response();
    await handler({ method: 'GET', query: { near: '', lat: '-37.81', lng: '144.96', dist: '10', back: '7' } }, melbourne);
    expect(melbourne.statusCode).toBe(200);

    const sydney = response();
    await handler({ method: 'GET', query: { near: '', lat: '-33.87', lng: '151.21', dist: '10', back: '7' } }, sydney);
    expect(sydney.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
