import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { TIMEOUT_MS } from '../../api/ebird.js';
import { relativeDay, roughCoord, tidySpotName } from '../lib/ebird';

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

const obs = (over: Record<string, unknown> = {}) => ({
  speciesCode: 'vermfly',
  sciName: 'Scythrops novaehollandiae',
  comName: 'Channel-billed Cuckoo',
  locId: 'L123',
  locName: 'Oxley Creek Common',
  lat: -27.54,
  lng: 153.01,
  obsDt: '2026-10-30 08:15',
  howMany: 2,
  subId: 'S12345678',
  ...over,
});

beforeEach(() => {
  process.env[KEY_NAME] = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared eBird display helpers', () => {
  it('tidies eBird hotspot names and reports restricted access', () => {
    expect(tidySpotName('Oxley Creek Common -- South')).toEqual({
      name: 'Oxley Creek Common – South',
      restricted: false,
    });
    expect(tidySpotName('Coolum Beach (some areas restricted access)')).toEqual({
      name: 'Coolum Beach',
      restricted: true,
    });
    expect(tidySpotName('Bribie Island (restricted access)')).toEqual({
      name: 'Bribie Island',
      restricted: true,
    });
  });

  it('writes recent dates as relative days', () => {
    const now = new Date('2026-11-01T10:00:00+10:00');
    expect(relativeDay('2026-11-01 07:00', now)).toBe('today');
    expect(relativeDay('2026-10-31 18:00', now)).toBe('yesterday');
    expect(relativeDay('2026-10-30 08:00', now)).toBe('2 days ago');
    expect(relativeDay('2026-10-23 08:00', now)).toBe('last week');
    expect(relativeDay('not a date', now)).toBe('');
  });

  it('rounds a phone fix to two decimal places before it leaves the phone', () => {
    expect(roughCoord(-27.534567)).toBe(-27.53);
    expect(roughCoord(153.0149)).toBe(153.01);
    expect(roughCoord(Number.NaN)).toBeNull();
  });
});

describe('the species-page eBird routes', () => {
  it('validates the nearest route without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const cases = [
      { nearest: '', lat: '-27.5', lng: '153' },
      { nearest: '', sp: 'BAD!', lat: '-27.5', lng: '153' },
      { nearest: '', sp: 'vermfly', lat: '-30', lng: '153' },
      { nearest: '', sp: 'vermfly', lat: '-27.5', lng: '150' },
      { nearest: '', sp: 'vermfly', lat: 'nope', lng: '153' },
    ];
    for (const query of cases) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the five nearest mapped sightings behind a short edge cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      obs(),
      obs({ locId: 'L456', locName: 'Second Spot', obsDt: '2026-10-29 16:00', howMany: null }),
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { nearest: '', sp: 'vermfly', lat: '-27.51', lng: '153.02' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { code: 'vermfly', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo', loc: 'L123', where: 'Oxley Creek Common', lat: -27.54, lng: 153.01, date: '2026-10-30 08:15', n: 2, sub: 'S12345678' },
      { code: 'vermfly', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo', loc: 'L456', where: 'Second Spot', lat: -27.54, lng: 153.01, date: '2026-10-29 16:00', n: 1, sub: 'S12345678' },
    ]);
    expect(res.headers['Cache-Control']).toBe('s-maxage=600, stale-while-revalidate=86400');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.ebird.org/v2/data/nearest/geo/recent/vermfly?lat=-27.51&lng=153.02&back=30&maxResults=5',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_MS).toBe(8000);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('merges the eleven SEQ region feeds newest first and removes duplicate records', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('AU-QLD-BRI')) {
        return new Response(JSON.stringify([
          obs({ obsDt: '2026-10-30 08:15' }),
          obs({ locId: 'L999', locName: 'Other Place', obsDt: '2026-10-28 09:00' }),
        ]), { status: 200 });
      }
      if (url.includes('AU-QLD-GOL')) {
        return new Response(JSON.stringify([
          obs({ obsDt: '2026-10-30 08:15' }),
          obs({ locId: 'L456', locName: 'Newest Spot', obsDt: '2026-10-31 06:30' }),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { species: '', sp: 'vermfly' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=1800, stale-while-revalidate=86400');
    expect(res.body).toMatchObject({ total: 3 });
    expect((res.body as { sightings: { loc: string }[] }).sightings.map((row) => row.loc)).toEqual(['L456', 'L123', 'L999']);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(fetchMock.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('returns a generic 502 when either route gets a non-array answer', async () => {
    for (const query of [
      { nearest: '', sp: 'vermfly', lat: '-27.5', lng: '153' },
      { species: '', sp: 'vermfly' },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: 'rate limited', token: SECRET }),
        { status: 200 },
      )));
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'eBird unavailable' });
      expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
    }
  });
});
