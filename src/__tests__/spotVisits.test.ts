import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/ebird.js';

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

beforeEach(() => { process.env[KEY_NAME] = SECRET; });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a spot’s latest visits', () => {
  it('validates the hotspot and checklist ids without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      { visits: '', loc: '123' },
      { visits: '', loc: 'L12345678901' },
      { checklist: '', sub: 'A1234' },
      { checklist: '', sub: 'S123' },
      { checklist: '', sub: 'S1234567890123' },
    ]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the ten latest checklists without observer names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { subId: 'S12345678', locId: 'L123', obsDt: '2026-10-31', obsTime: '06:40', numSpecies: 42, userDisplayName: 'A Person' },
      { subId: 'S87654321', locId: 'L123', obsDt: '2026-10-30 17:20', numSpecies: 31, userDisplayName: 'Another Person' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { visits: '', loc: 'L123' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=900, stale-while-revalidate=86400');
    expect(res.body).toEqual([
      { sub: 'S12345678', date: '2026-10-31', time: '06:40', species: 42 },
      { sub: 'S87654321', date: '2026-10-30', time: '17:20', species: 31 },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Person');
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.ebird.org/v2/product/lists/L123?maxResults=10',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('maps a checklist to compact species rows and never leaks the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      subId: 'S12345678',
      locId: 'L123',
      obsDt: '2026-10-31 06:40',
      userDisplayName: 'A Person',
      obs: [
        { speciesCode: 'chbcuc2', comName: 'Channel-billed Cuckoo', howManyStr: '2' },
        { speciesCode: 'lewinh1', comName: 'Lewin’s Honeyeater', howManyAtleast: 1 },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { checklist: '', sub: 'S12345678' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=3600, stale-while-revalidate=86400');
    expect(res.body).toEqual({
      sub: 'S12345678',
      date: '2026-10-31',
      time: '06:40',
      loc: 'L123',
      species: [
        { code: 'chbcuc2', name: 'Channel-billed Cuckoo', n: 2 },
        { code: 'lewinh1', name: 'Lewin’s Honeyeater', n: 1 },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('Person');
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.ebird.org/v2/product/checklist/view/S12345678',
    );
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('treats a non-array visits answer and a checklist without observations as failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: SECRET }), { status: 200 })));
    const visits = response();
    await handler({ method: 'GET', query: { visits: '', loc: 'L123' } }, visits);
    expect(visits.statusCode).toBe(502);
    expect(visits.body).toEqual({ error: 'eBird unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ subId: 'S12345678' }), { status: 200 })));
    const checklist = response();
    await handler({ method: 'GET', query: { checklist: '', sub: 'S12345678' } }, checklist);
    expect(checklist.statusCode).toBe(502);
    expect(checklist.body).toEqual({ error: 'eBird unavailable' });
  });
});
