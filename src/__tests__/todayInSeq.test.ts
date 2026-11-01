import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';

const KEY_NAME = ['EBIRD', 'API', 'KEY'].join('_');
const SECRET = 'unit-test-token-value';
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

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

beforeEach(() => { process.env[KEY_NAME] = SECRET; });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('today in Queensland', () => {
  it('rejects missing, impossible, too-old and future dates without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      { stats: '' },
      { stats: '', date: '1999-12-31' },
      { stats: '', date: '2026-02-30' },
      { stats: '', date: '01-11-2026' },
      { stats: '', date: '2999-01-01' },
    ]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps checklists, birders and species with a ten-minute cache', async () => {
    const today = new Date();
    const date = dateOf(today);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      numChecklists: 212,
      numContributors: 34,
      numSpecies: 287,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { stats: '', date } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=600, stale-while-revalidate=86400');
    expect(res.body).toEqual({ date, checklists: 212, birders: 34, species: 287 });
    const month = today.getMonth() + 1;
    const day = today.getDate();
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      `https://api.ebird.org/v2/product/stats/AU-QLD/${today.getFullYear()}/${month}/${day}`,
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('returns a generic 502 when the answer is not a usable statistics object', async () => {
    const date = dateOf(new Date());
    for (const payload of [[], { date }, { numChecklists: 'many' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
      const res = response();
      await handler({ method: 'GET', query: { stats: '', date } }, res);
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'eBird unavailable' });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
  });
});
