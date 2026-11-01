import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';
import { cutHunt, huntFromSnapshot } from '../lib/hunt';
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
  subId: 'S12345678',
  ...over,
});

const obs = (over: Partial<EbirdObservation> = {}): EbirdObservation => ({
  code: 'chbcuc2', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo',
  loc: 'L123', where: 'Oxley Creek Common', lat: -27.5, lng: 153.02,
  date: '2026-10-30 08:15', n: 2, sub: 'S12345678', ...over,
});

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [],
  lists: {},
  recent: {},
  notable: [],
  codes: { chbcuc2: 94, lewinh1: 38, comkoe1: 112 },
} as unknown as EbirdSnapshot;

beforeEach(() => {
  process.env[KEY_NAME] = SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('nearby hunt logic', () => {
  it('keeps only unseen dex birds, chooses their nearest report, and sorts by distance then freshness', () => {
    const result = cutHunt([
      obs({ code: 'lewinh1', loc: 'LOLD', distanceKm: 2, date: '2026-10-31 07:00' }),
      obs({ code: 'chbcuc2', loc: 'LFAR', distanceKm: 8, date: '2026-10-31 08:00' }),
      obs({ code: 'chbcuc2', loc: 'LNEAR', distanceKm: 1.2, date: '2026-10-29 08:00' }),
      obs({ code: 'comkoe1', loc: 'LSAME2', distanceKm: 2, date: '2026-10-28 07:00' }),
      obs({ code: 'comkoe1', loc: 'LSAME1', distanceKm: 2, date: '2026-10-30 07:00' }),
      obs({ code: 'nothin1', loc: 'LUNKNOWN', distanceKm: 0.1 }),
    ], SNAPSHOT, new Set([94]));

    expect(result.rows.map((row) => [row.sp.id, row.obs.loc, row.obs.distanceKm])).toEqual([
      [38, 'LOLD', 2],
      [112, 'LSAME1', 2],
    ]);
    // The Spots Hunt filter gets every location for an unseen bird, not just each bird's nearest one.
    expect([...result.locations].sort()).toEqual(['LOLD', 'LSAME1', 'LSAME2']);
  });

  it('falls back to the saved snapshot for dates in the last week within 25 km', () => {
    const baked = {
      ...SNAPSHOT,
      spots: [
        ['LOLD', 'Old Place', -27.55, 153.02, 50, 10, '2026-10-31', 'BRI'],
        ['LFAR', 'Far Away', -28.2, 153.02, 50, 10, '2026-10-31', 'BRI'],
      ],
      recent: {
        LOLD: [[38, '2026-10-31'], [112, '2026-10-20']],
        LFAR: [[112, '2026-10-31']],
      },
    } as unknown as EbirdSnapshot;
    const now = new Date('2026-11-01T10:00:00');

    const result = huntFromSnapshot(baked, { lat: -27.5, lng: 153.02 }, new Set(), now);

    expect(result.rows.map((row) => [row.sp.id, row.obs.loc])).toEqual([[38, 'LOLD']]);
    expect([...result.locations]).toEqual(['LOLD']);
  });
});

describe('the near eBird route', () => {
  it('validates coordinates, dist and back without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bad = [
      { near: '', lat: '-27.5', lng: '153.02' },
      { near: '', lat: '-30', lng: '153.02', dist: '25', back: '7' },
      { near: '', lat: '-27.5', lng: '150', dist: '25', back: '7' },
      { near: '', lat: '-27.5', lng: '153.02', dist: '0', back: '7' },
      { near: '', lat: '-27.5', lng: '153.02', dist: '51', back: '7' },
      { near: '', lat: '-27.5', lng: '153.02', dist: '25', back: '31' },
    ];
    for (const query of bad) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns mapped observations with distance and a ten-minute edge cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      row({ locId: 'L456', locName: 'Far Place', lat: -27.6, lng: 153.02, obsDt: '2026-10-31 07:00' }),
      row(),
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { near: '', lat: '-27.5', lng: '153.02', dist: '25', back: '7' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=600, stale-while-revalidate=86400');
    expect(Array.isArray(res.body)).toBe(true);
    const body = res.body as EbirdObservation[];
    expect(body).toHaveLength(2);
    expect(body[0].loc).toBe('L123');
    expect(body[0].distanceKm).toBe(0);
    expect(body[1].distanceKm).toBeGreaterThan(10);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.ebird.org/v2/data/obs/geo/recent?lat=-27.5&lng=153.02&dist=25&back=7&hotspot=false&maxResults=200',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('returns a generic 502 for a non-array answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: SECRET }), { status: 200 })));
    const res = response();
    await handler({ method: 'GET', query: { near: '', lat: '-27.5', lng: '153.02', dist: '25', back: '7' } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'eBird unavailable' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
