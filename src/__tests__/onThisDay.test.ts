import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';
import { sameDayLastYear, type EbirdSnapshot } from '../lib/ebird';
import { nearestRegionCode } from '../lib/areas';

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
  obsDt: '2025-11-01 08:15',
  howMany: 2,
  ...over,
});

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [
    ['L1', 'Brisbane Park', -27.5, 153.02, 100, 500, '2026-10-30', 'BRI'],
    ['L2', 'Gold Coast Park', -28.0, 153.4, 80, 400, '2026-10-30', 'GOL'],
  ],
  lists: {}, recent: {}, notable: [], codes: {},
} as unknown as EbirdSnapshot;

beforeEach(() => { process.env[KEY_NAME] = SECRET; });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the last-year date and nearest region', () => {
  it('uses the same day last year and clamps 29 February to 28 February', () => {
    expect(sameDayLastYear(new Date(2026, 10, 1))).toBe('2025-11-01');
    expect(sameDayLastYear(new Date(2028, 1, 29))).toBe('2027-02-28');
  });

  it('chooses the council area of the nearest eBird hotspot', () => {
    expect(nearestRegionCode(SNAPSHOT, { lat: -28.01, lng: 153.39 })).toBe('GOL');
    expect(nearestRegionCode(SNAPSHOT, { lat: -27.51, lng: 153.02 })).toBe('BRI');
    expect(nearestRegionCode(SNAPSHOT, null)).toBeNull();
  });
});

describe('the historic day route', () => {
  it('rejects regions outside SEQ and bad dates without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      { historic: '', region: 'AU-NSW', date: '2025-11-01' },
      { historic: '', region: 'AU-QLD-BRI', date: '2025-02-30' },
      { historic: '', region: 'AU-QLD-BRI', date: '1999-11-01' },
      { historic: '', region: 'AU-QLD-BRI', date: '2999-11-01' },
      { historic: '', region: 'AU-QLD-BRI' },
    ]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns compact mapped sightings with an hourly cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([row()]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { historic: '', region: 'AU-QLD-BRI', date: '2025-11-01' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=3600, stale-while-revalidate=86400');
    expect(res.body).toEqual({
      region: 'BRI',
      date: '2025-11-01',
      sightings: [{
        code: 'chbcuc2', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo',
        loc: 'L123', where: 'Oxley Creek Common', lat: -27.5, lng: 153.02,
        date: '2025-11-01 08:15', n: 2, sub: null,
      }],
    });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.ebird.org/v2/data/obs/AU-QLD-BRI/historic/2025/11/1?rank=mrec&detail=simple',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('returns a generic 502 for a non-array answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: SECRET }), { status: 200 })));
    const res = response();
    await handler({ method: 'GET', query: { historic: '', region: 'AU-QLD-BRI', date: '2025-11-01' } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'eBird unavailable' });
  });
});
