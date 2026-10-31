import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { TIMEOUT_MS } from '../../api/ebird.js';

const KEY_NAME = ['EBIRD', 'API', 'KEY'].join('_');
const SECRET = 'unit-test-token-value';
const CACHE = 's-maxage=3600, stale-while-revalidate=86400';

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

beforeEach(() => {
  process.env[KEY_NAME] = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the eBird server function', () => {
  it('rejects non-GET methods and invalid hotspot ids without calling eBird', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const wrongMethod = response();
    await handler({ method: 'POST', query: { recent: 'L123' } }, wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);

    for (const query of [{ recent: '123' }, { recent: 'L123x' }, { list: 'L12345678901' }, { recent: 'L1', list: 'L2' }, {}]) {
      const res = response();
      await handler({ method: 'GET', query }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns compact recent observations with shared cache headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { speciesCode: 'birpri', sciName: 'Birdus primus', comName: 'First Bird', obsDt: '2026-10-30 08:00', howMany: 2 },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = response();

    await handler({ method: 'GET', query: { recent: 'L123' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(CACHE);
    expect(res.body).toEqual([{ code: 'birpri', sci: 'Birdus primus', name: 'First Bird', date: '2026-10-30 08:00', n: 2 }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.ebird.org/v2/data/obs/L123/recent?back=30');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('returns a species-code list with the same cache headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(['birpri', 'birren']), { status: 200 })));
    const res = response();

    await handler({ method: 'GET', query: { list: 'L123' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(CACHE);
    expect(res.body).toEqual(['birpri', 'birren']);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET);
  });

  it('returns a generic 502 without echoing an upstream error or token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`upstream failed with ${SECRET}`, { status: 500 })));
    const res = response();

    await handler({ method: 'GET', query: { recent: 'L123' } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'eBird unavailable' });
    expect(res.headers['Cache-Control']).toBe(CACHE);
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
  });

  it('calls eBird with an eight-second abort signal and fails quietly when it aborts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await handler({ method: 'GET', query: { list: 'L123' } }, response());

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_MS).toBe(8000);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')));
    const aborted = response();
    await handler({ method: 'GET', query: { list: 'L123' } }, aborted);
    expect(aborted.statusCode).toBe(502);
    expect(aborted.body).toEqual({ error: 'eBird unavailable' });
  });

  it('treats a non-array answer as an upstream failure on both routes', async () => {
    for (const query of [{ recent: 'L123' }, { list: 'L123' }]) {
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: 'rate limited', token: SECRET }),
        { status: 200 },
      ));
      vi.stubGlobal('fetch', fetchMock);
      const res = response();

      await handler({ method: 'GET', query }, res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'eBird unavailable' });
      expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(SECRET);
    }
  });
});
