import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';
import { rareNearbyRows } from '../lib/rare';
import type { EbirdObservation, EbirdSnapshot } from '../lib/ebird';

const KEY_NAME = ['EBIRD', 'API', 'KEY'].join('_');
const SECRET = 'unit-test-token-value';

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

const row = (over: Record<string, unknown> = {}) => ({
  speciesCode: 'chbcuc2',
  sciName: 'Scythrops novaehollandiae',
  comName: 'Channel-billed Cuckoo',
  locId: 'L123',
  locName: 'Oxley Creek Common',
  lat: -27.5,
  lng: 153.02,
  obsDt: '2026-10-30 08:15',
  howMany: 2,
  ...over,
});

const obs = (over: Partial<EbirdObservation> = {}): EbirdObservation => ({
  code: 'chbcuc2', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo',
  loc: 'L123', where: 'Oxley Creek Common', lat: -27.5, lng: 153.02,
  date: '2026-10-30 08:15', n: 2, distanceKm: 1.2, ...over,
});

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [],
  lists: {},
  recent: {},
  notable: [],
  codes: { chbcuc2: 94, lewinh1: 38 },
} as unknown as EbirdSnapshot;

beforeEach(() => { process.env[KEY_NAME] = SECRET; });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rare birds near you', () => {
  it('marks only unseen app birds as new, keeping eBird-only names unlinked', () => {
    const result = rareNearbyRows([
      obs({ code: 'chbcuc2', loc: 'L1', distanceKm: 1.1 }),
      obs({ code: 'chbcuc2', loc: 'L2', distanceKm: 4 }),
      obs({ code: 'lewinh1', loc: 'L3', distanceKm: 2 }),
      obs({ code: 'notinapp', name: 'Mystery Bird', loc: 'L4', distanceKm: 3 }),
    ], SNAPSHOT, new Set([94]));

    expect(result.map((row) => [row.obs.code, row.obs.loc, row.sp?.id ?? null, row.isNew])).toEqual([
      ['chbcuc2', 'L1', 94, false],
      ['lewinh1', 'L3', 38, true],
      ['notinapp', 'L4', null, false],
    ]);
  });
});

describe('the notable route', () => {
  it('validates coordinates, dist and back without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      { notable: '', lat: '-27.5', lng: '153.02', dist: '50' },
      { notable: '', lat: '-27.5', lng: '153.02', back: '7' },
      { notable: '', lat: '-27.5', lng: '153.02', dist: '0', back: '7' },
      { notable: '', lat: '-30', lng: '153.02', dist: '50', back: '7' },
    ]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the nearest notable sightings with distance and edge caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      row({ lat: -27.56, lng: 153.02, speciesCode: 'lewinh1', comName: 'Lewin’s Honeyeater' }),
      row(),
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { notable: '', lat: '-27.5', lng: '153.02', dist: '50', back: '7' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=600, stale-while-revalidate=86400');
    const body = res.body as EbirdObservation[];
    expect(body).toHaveLength(2);
    expect(body[0].code).toBe('chbcuc2');
    expect(body[0].distanceKm).toBe(0);
    expect(body[1].distanceKm).toBeGreaterThan(0.5);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.ebird.org/v2/data/obs/geo/recent/notable?lat=-27.5&lng=153.02&dist=50&back=7&hotspot=false&maxResults=100',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('returns a generic 502 for a non-array answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: SECRET }), { status: 200 })));
    const res = response();
    await handler({ method: 'GET', query: { notable: '', lat: '-27.5', lng: '153.02', dist: '50', back: '7' } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'eBird unavailable' });
  });
});
