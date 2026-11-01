import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';

const KEY_NAME = ['EBIRD', 'API', 'KEY'].join('_');
const SECRET = 'unit-test-token-value';
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

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

describe('top eBirders today', () => {
  it('rejects bad regions and dates without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      { top: '', region: 'AU-NSW', date: today },
      { top: '', region: 'AU-QLD-BRI', date: '2026-02-30' },
      { top: '', region: 'AU-QLD-BRI', date: '2999-01-01' },
      { top: '', region: 'AU-QLD-BRI' },
    ]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the top ten by species with names exactly as published and no profile links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { userDisplayName: 'Ada Bird', numSpecies: 87, numChecklists: 3, profileHandle: 'ada' },
      { userDisplayName: 'Sam Wren', numSpecies: 70, numChecklists: 1, profileHandle: 'sam' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { top: '', region: 'AU-QLD-BRI', date: today } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=900, stale-while-revalidate=86400');
    expect(res.body).toEqual([
      { name: 'Ada Bird', species: 87, checklists: 3 },
      { name: 'Sam Wren', species: 70, checklists: 1 },
    ]);
    const month = now.getMonth() + 1;
    const day = now.getDate();
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      `https://api.ebird.org/v2/product/top100/AU-QLD-BRI/${now.getFullYear()}/${month}/${day}?rankedBy=spp&maxResults=10`,
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('profileHandle');
    expect(JSON.stringify(res.body)).not.toContain('ada');
  });

  it('returns a generic 502 for a non-array answer or a row without a usable species count', async () => {
    for (const payload of [{ error: SECRET }, [{ userDisplayName: 'No Count', numChecklists: 2 }]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
      const res = response();
      await handler({ method: 'GET', query: { top: '', region: 'AU-QLD-BRI', date: today } }, res);
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'eBird unavailable' });
    }
  });
});
