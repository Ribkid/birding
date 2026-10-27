// Runs scripts/sw-template.js against an in-memory Cache Storage and a fake network. respondWith
// reads the answer's body as soon as it has it, as the browser does, and waitUntil throws once the
// event is over and nothing is pending, as Chrome does. A cache write that clones too late, or keeps
// the worker alive too late, fails here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = readFileSync(join(root, 'scripts', 'sw-template.js'), 'utf8');
const ORIGIN = 'https://birdydex.test';
const abs = (u: string) => new URL(u, ORIGIN + '/').href;

type Req = { url: string; method: string; mode: string; destination: string; headers: Headers };
type Stored = { url: string; body: ArrayBuffer; status: number; headers: [string, string][] };

// Cache Storage answers on a later task (it is a round trip to the browser), never in the same tick.
const later = () => new Promise((resolve) => setImmediate(resolve));
const asUrl = (input: unknown) => abs(typeof input === 'string' ? input : (input as { url: string }).url);
const bare = (u: string) => u.split('?')[0];

class FakeCache {
  entries = new Map<string, Stored>();
  constructor(private net: (req: Req) => Promise<Response>) {}
  async match(input: unknown, opts: { ignoreSearch?: boolean } = {}) {
    await later();
    const url = asUrl(input);
    const hit = this.entries.get(url)
      ?? (opts.ignoreSearch ? [...this.entries.values()].find((e) => bare(e.url) === bare(url)) : undefined);
    if (!hit) return undefined;
    const res = new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
    Object.defineProperty(res, 'url', { value: hit.url });
    return res;
  }
  async put(input: unknown, res: Response) {
    if (res.bodyUsed) throw new TypeError('Response body is already used');
    const body = await res.arrayBuffer();
    this.entries.set(asUrl(input), { url: asUrl(input), body, status: res.status, headers: [...res.headers] });
  }
  async add(input: unknown) {
    const res = await this.net(toReq(asUrl(input)));
    if (!res.ok) throw new TypeError('Request failed');
    await this.put(input, res);
  }
  async keys() {
    return [...this.entries.values()].map((e) => ({ url: e.url }));
  }
  async delete(input: unknown) {
    return this.entries.delete(asUrl(input));
  }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  constructor(private net: (req: Req) => Promise<Response>) {}
  async open(name: string) {
    await later();
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this.net));
    return this.map.get(name)!;
  }
  async has(name: string) {
    return this.map.has(name);
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
  async keys() {
    return [...this.map.keys()];
  }
  async match(input: unknown, opts: { ignoreSearch?: boolean } = {}) {
    for (const cache of this.map.values()) {
      const hit = await cache.match(input, opts);
      if (hit) return hit;
    }
    return undefined;
  }
  urls(name: string) {
    return [...(this.map.get(name)?.entries.keys() ?? [])];
  }
}

function toReq(url: string, extra: Partial<Req> = {}): Req {
  return { url: abs(url), method: 'GET', mode: 'cors', destination: '', headers: new Headers(), ...extra };
}

// The network: a table of answers, or offline.
function makeNet(files: Record<string, string | { body: string; type: string; status?: number }>) {
  const state = { online: true, seen: [] as string[] };
  const net = async (req: Req) => {
    state.seen.push(req.url);
    if (!state.online) throw new TypeError('Failed to fetch');
    const file = files[req.url] ?? files[bare(req.url)];
    if (file === undefined) return new Response('missing', { status: 404 });
    const { body, type, status = 200 } = typeof file === 'string' ? { body: file, type: 'text/javascript' } : file;
    return new Response(body, { status, headers: { 'content-type': type } });
  };
  return { net, state };
}

type Listener = (event: unknown) => void;

function loadWorker(opts: { precache: string[]; version?: string; caches: FakeCaches; net: (req: Req) => Promise<Response> }) {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: new URL('/sw.js', ORIGIN),
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  class SWRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? abs(input) : input, init);
    }
  }
  const code = TEMPLATE
    .replace('__VERSION__', JSON.stringify(opts.version ?? 'v-test'))
    .replace('__PRECACHE__', JSON.stringify(opts.precache));
  // Timers never fire: the fake network answers (or fails) at once.
  const noTimer = () => 0;
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'setTimeout', code)(
    self, opts.caches, (r: Req | Request) => opts.net(r instanceof Request ? toReq(r.url, { mode: r.mode }) : r),
    SWRequest, Response, URL, noTimer,
  );
  return listeners;
}

// Dispatch an event the way Chrome does: waitUntil is allowed during dispatch or while another
// lifetime promise (including respondWith's) is pending.
async function dispatch(listener: Listener, extra: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = [];
  let pending = 0;
  let dispatching = true;
  let answer: Promise<{ status: number; text: string; url: string } | null> = Promise.resolve(null);
  const add = (p: Promise<unknown>) => {
    pending++;
    const done = Promise.resolve(p).finally(() => { pending--; });
    waits.push(done.catch(() => {}));
  };
  const event = {
    ...extra,
    waitUntil(p: Promise<unknown>) {
      if (!dispatching && pending === 0) throw new DOMException('The event handler is already finished', 'InvalidStateError');
      add(p);
    },
    respondWith(p: Promise<Response>) {
      add(p);
      // Read the body straight away, as the page does.
      answer = Promise.resolve(p).then(async (res) => ({ status: res.status, text: await res.text(), url: res.url }));
    },
  };
  listener(event);
  dispatching = false;
  const result = await answer.catch((err) => ({ status: -1, text: String(err), url: '' }));
  for (let seen = -1; seen !== waits.length;) {
    seen = waits.length;
    await Promise.all(waits);
  }
  return result;
}

function setup(precache: string[] = ['/index.html', '/assets/index-a.js']) {
  const app = { body: '<!doctype html><title>BirdyDex</title><div id="root"></div>', type: 'text/html' };
  const files = {
    [abs('/')]: app,
    [abs('/index.html')]: app,
    [abs('/assets/index-a.js')]: 'console.log("a")',
    [abs('/vendor/tfjs/tf.min.js')]: 'tf',
    [abs('/fonts/nope.woff2')]: { body: '<!doctype html><div id="root"></div>', type: 'text/html' },
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/320px-Bird.jpg': { body: 'jpeg', type: 'image/jpeg' },
    'https://tile.openstreetmap.org/9/473/296.png': { body: 'png', type: 'image/png' },
  };
  const { net, state } = makeNet(files);
  const caches = new FakeCaches(net);
  const sw = loadWorker({ precache, caches, net });
  const get = (url: string, extra: Partial<Req> = {}) => dispatch(sw.fetch, { request: toReq(url, extra) });
  return { sw, caches, state, get };
}

describe('service worker runtime caching', () => {
  it('keeps vendor files it answers with, even though the page reads the body at once', async () => {
    const { caches, state, get } = setup();
    const first = await get('/vendor/tfjs/tf.min.js');
    expect(first).toMatchObject({ status: 200, text: 'tf' });
    expect(caches.urls('birddex-models')).toEqual([abs('/vendor/tfjs/tf.min.js')]);
    state.online = false;
    expect(await get('/vendor/tfjs/tf.min.js')).toMatchObject({ status: 200, text: 'tf' });
  });

  it('keeps Wikimedia photos and map tiles under their plain URL', async () => {
    const { caches, state, get } = setup();
    const photo = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/320px-Bird.jpg';
    const tile = 'https://tile.openstreetmap.org/9/473/296.png';
    expect(await get(photo, { mode: 'no-cors', destination: 'image' })).toMatchObject({ status: 200, text: 'jpeg' });
    expect(await get(tile, { mode: 'no-cors', destination: 'image' })).toMatchObject({ status: 200, text: 'png' });
    expect(caches.urls('birddex-images')).toEqual([photo]);
    expect(caches.urls('birddex-tiles')).toEqual([tile]);
    state.online = false;
    expect(await get(photo, { mode: 'no-cors', destination: 'image' })).toMatchObject({ status: 200, text: 'jpeg' });
    expect(await get(tile, { mode: 'no-cors', destination: 'image' })).toMatchObject({ status: 200, text: 'png' });
  });

  it('does not keep an HTML fallback page as a file', async () => {
    const { caches, get } = setup();
    await get('/fonts/nope.woff2');
    expect(caches.urls('birdydex-runtime-v3')).toEqual([]);
  });

  it('re-saves the app shell on a fast online launch', async () => {
    const { sw, caches, get } = setup();
    await dispatch(sw.install, {});
    const shell = [...caches.map.keys()].find((n) => n.startsWith('birdydex-shell-'))!;
    await (await caches.open(shell)).delete('/index.html');
    const res = await get('/', { mode: 'navigate', destination: 'document' });
    expect(res.text).toContain('<div id="root">');
    expect(caches.urls(shell)).toContain(abs('/index.html'));
  });
});
