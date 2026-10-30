// What the Spots tab decides: the sorts, the suggestions (most new birds, weighted nearby), the filter chips and
// the name search. Pure data, no DOM, so these hold the behaviour the browser checks rely on.
import { describe, expect, it } from 'vitest';
import {
  buildRows,
  distanceLabel,
  filterSpots,
  matchesFilters,
  matchesSearch,
  NO_FILTERS,
  sortSpots,
  suggestSpots,
  type HotspotLike,
  type SpotAccess,
  type SpotRow,
} from '../lib/spots';

const access = (patch: Partial<SpotAccess> = {}): SpotAccess => ({
  name: 'spot',
  score: 3,
  reasons: [],
  note: null,
  parkingM: null,
  toilets: 0,
  birdHides: 0,
  shelters: 0,
  picnicTables: 0,
  pavedPaths: 0,
  boardwalks: 0,
  wheelchair: null,
  restricted: false,
  fee: null,
  ...patch,
});

const hotspot = (name: string, lat: number, lng: number, sp: [number, number][]): HotspotLike => ({
  name,
  lat,
  lng,
  rich: sp.length,
  sp,
});

const SEEN = new Set<number>([1, 2]);

const HOTSPOTS: HotspotLike[] = [
  hotspot('Rich Place', -27.5, 153.0, [[1, 100], [2, 50], [3, 40], [4, 10]]),
  hotspot('Near Place', -27.51, 153.01, [[1, 10], [5, 5]]),
  hotspot('Far Place', -28.2, 152.4, [[6, 900], [7, 800], [8, 700]]),
  hotspot('All Seen Place', -27.49, 153.02, [[1, 1000], [2, 900]]),
];

const rows = (pos: { lat: number; lng: number } | null = null) =>
  buildRows(HOTSPOTS, { '0': access({ score: 4, toilets: 1, parkingM: 80 }) }, SEEN, pos);

describe('building rows', () => {
  it('adds up records and counts the birds she has never logged', () => {
    const r = rows();
    expect(r[0]).toMatchObject({ idx: 0, records: 200, newForYou: 2, distanceKm: null });
    expect(r[3]).toMatchObject({ records: 1900, newForYou: 0 });
    expect(r[0].access).toMatchObject({ score: 4 });
    expect(r[1].access).toBeNull();
  });

  it('measures the distance only when her location is known', () => {
    const r = rows({ lat: -27.5, lng: 153.0 });
    expect(r[0].distanceKm).toBe(0);
    expect(r[2].distanceKm).toBeGreaterThan(50);
    expect(rows()[0].distanceKm).toBeNull();
  });
});

describe('the sorts', () => {
  it('sorts by species, then by records', () => {
    expect(sortSpots(rows(), 'rich').map((r) => r.name)).toEqual([
      'Rich Place', 'Far Place', 'All Seen Place', 'Near Place',
    ]);
    expect(sortSpots(rows(), 'records').map((r) => r.name)).toEqual([
      'Far Place', 'All Seen Place', 'Rich Place', 'Near Place',
    ]);
  });

  it('puts the easiest access first, and unknown access after every known score', () => {
    const list = sortSpots(rows(), 'access');
    expect(list[0].name).toBe('Rich Place');
    expect(list.slice(1).every((r) => r.access == null)).toBe(true);
  });

  it('sorts by distance and leaves spots without one at the end', () => {
    const list = sortSpots(rows({ lat: -27.5, lng: 153.0 }), 'nearest');
    expect(list[0].name).toBe('Rich Place');
    expect(list[1].name).toBe('Near Place');
    // With no fix at all every distance is unknown, so the list falls back to the richest.
    expect(sortSpots(rows(), 'nearest').map((r) => r.name)[0]).toBe('Rich Place');
  });

  it('sorts by birds new to her', () => {
    expect(sortSpots(rows(), 'new').map((r) => r.name)).toEqual([
      'Far Place', 'Rich Place', 'Near Place', 'All Seen Place',
    ]);
  });
});

describe('suggestions', () => {
  it('offers up to three spots with birds she has not seen, and none she has seen everything at', () => {
    const list = suggestSpots(rows(), null, 3);
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.name)).toEqual(['Far Place', 'Rich Place', 'Near Place']);
    expect(list.every((r) => r.newForYou > 0)).toBe(true);
  });

  it('weights nearby spots when her location is known', () => {
    // Far Place has three new birds but is ~97 km away; Rich Place has two, about a kilometre away.
    expect(suggestSpots(rows(), null, 1)[0].name).toBe('Far Place');
    const here = { lat: -27.51, lng: 153.01 };
    expect(suggestSpots(rows(here), here, 1)[0].name).toBe('Rich Place');
  });

  it('can ask for fewer', () => {
    expect(suggestSpots(rows(), null, 1)).toHaveLength(1);
    expect(suggestSpots(rows(), null, 0)).toHaveLength(0);
  });

  it('suggests a spot she may not be able to get into only when nothing else fills the list', () => {
    const shut = buildRows(
      [hotspot('Locked Lake (some areas restricted access)', -27.5, 153.0, [[3, 9], [4, 9], [5, 9], [6, 9]]), ...HOTSPOTS],
      null, SEEN, null,
    );
    expect(suggestSpots(shut, null, 1)[0].name).toBe('Far Place');
    expect(suggestSpots(shut, null, 4).map((r) => r.name).at(-1)).toBe('Locked Lake (some areas restricted access)');
  });
});

describe('filters and search', () => {
  const withAccess = (patch: Partial<SpotAccess>): SpotRow => ({
    ...rows()[0],
    access: access(patch),
  });

  it('matches each chip on its own OSM fact', () => {
    expect(matchesFilters(withAccess({ toilets: 1 }), { ...NO_FILTERS, toilets: true })).toBe(true);
    expect(matchesFilters(withAccess({ toilets: 0 }), { ...NO_FILTERS, toilets: true })).toBe(false);
    expect(matchesFilters(withAccess({ parkingM: 120 }), { ...NO_FILTERS, parking: true })).toBe(true);
    expect(matchesFilters(withAccess({ parkingM: null }), { ...NO_FILTERS, parking: true })).toBe(false);
    expect(matchesFilters(withAccess({ birdHides: 1 }), { ...NO_FILTERS, birdHide: true })).toBe(true);
    expect(matchesFilters(withAccess({ wheelchair: 'limited' }), { ...NO_FILTERS, wheelchair: true })).toBe(true);
    expect(matchesFilters(withAccess({ wheelchair: null }), { ...NO_FILTERS, wheelchair: true })).toBe(false);
  });

  it('requires every chosen chip', () => {
    const row = withAccess({ toilets: 1, parkingM: 50 });
    expect(matchesFilters(row, { toilets: true, parking: true, birdHide: false, wheelchair: false })).toBe(true);
    expect(matchesFilters(row, { toilets: true, parking: true, birdHide: true, wheelchair: false })).toBe(false);
    // No OSM record at all fails every filter.
    expect(matchesFilters({ ...rows()[1], access: null }, { ...NO_FILTERS, toilets: true })).toBe(false);
  });

  it('searches every word of the name, whatever the case', () => {
    const row = rows()[0];
    expect(matchesSearch(row, '')).toBe(true);
    expect(matchesSearch(row, 'rich')).toBe(true);
    expect(matchesSearch(row, 'RICH place')).toBe(true);
    expect(matchesSearch(row, 'place rich')).toBe(true);
    expect(matchesSearch(row, 'near')).toBe(false);
  });

  it('filters and searches together', () => {
    expect(filterSpots(rows(), { ...NO_FILTERS, toilets: true }, 'rich').map((r) => r.name)).toEqual(['Rich Place']);
    expect(filterSpots(rows(), { ...NO_FILTERS, toilets: true }, 'near')).toEqual([]);
  });
});

describe('distance labels', () => {
  it('says metres under a kilometre and one decimal above', () => {
    expect(distanceLabel(null)).toBe('');
    expect(distanceLabel(0.06)).toBe('60 m');
    expect(distanceLabel(0.999)).toBe('999 m');
    expect(distanceLabel(1.24)).toBe('1.2 km');
  });
});
