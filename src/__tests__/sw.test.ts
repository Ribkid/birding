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
  // What an earlier release left behind: a stored answer under `url` in cache `name`.
  seed(name: string, url: string, body: string, type = 'text/javascript') {
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this.net));
    const bytes = new TextEncoder().encode(body).buffer as ArrayBuffer;
    this.map.get(name)!.entries.set(abs(url), { url: abs(url), body: bytes, status: 200, headers: [['content-type', type]] });
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

type Files = Record<string, string | { body: string; type: string; status?: number }>;

function setup(precache: string[] = ['/index.html', '/assets/index-a.js'], opts: { files?: Files; before?: (caches: FakeCaches) => void } = {}) {
  const app = { body: '<!doctype html><title>BirdyDex</title><div id="root"></div>', type: 'text/html' };
  const files: Files = {
    [abs('/')]: app,
    [abs('/index.html')]: app,
    [abs('/assets/index-a.js')]: 'console.log("a")',
    [abs('/vendor/tfjs/tf.min.js')]: 'tf',
    [abs('/vendor/ort/ort.wasm.min.mjs')]: 'ort',
    [abs('/fonts/nope.woff2')]: { body: '<!doctype html><div id="root"></div>', type: 'text/html' },
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bird.jpg/320px-Bird.jpg': { body: 'jpeg', type: 'image/jpeg' },
    'https://tile.openstreetmap.org/9/473/296.png': { body: 'png', type: 'image/png' },
  };
  for (const [url, file] of Object.entries(opts.files ?? {})) files[abs(url)] = file;
  const { net, state } = makeNet(files);
  const caches = new FakeCaches(net);
  opts.before?.(caches);
  const sw = loadWorker({ precache, caches, net });
  const get = (url: string, extra: Partial<Req> = {}) => dispatch(sw.fetch, { request: toReq(url, extra) });
  const update = async () => {
    await dispatch(sw.install, {});
    await dispatch(sw.activate, {});
  };
  return { sw, caches, state, get, update, files };
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

describe('service worker updates from an earlier release', () => {
  it('keeps the ONNX runtime modules for offline Scan, dropping only copies birddex-models already has', async () => {
    const { caches, state, get, update } = setup(undefined, {
      before: (c) => {
        // What main left after one online scan: the parts, the wasm and the modules in the runtime cache,
        // and photoid.js's own joined model and wasm in birddex-models.
        c.seed('birdydex-runtime-v3', '/models/bioclip/vision-int4.part1.bin', 'part1', 'application/octet-stream');
        c.seed('birdydex-runtime-v3', '/vendor/ort/ort-wasm-simd-threaded.wasm', 'wasm', 'application/wasm');
        c.seed('birdydex-runtime-v3', '/vendor/ort/ort.wasm.min.mjs', 'ort-main', 'text/javascript');
        c.seed('birdydex-runtime-v3', '/vendor/ort/ort-wasm-simd-threaded.mjs', 'ort-threaded', 'text/javascript');
        c.seed('birdydex-runtime-v3', '/models/birdnet/model.json', '{}', 'application/json');
        c.seed('birddex-models', '/vendor/ort/ort-wasm-simd-threaded.wasm', 'wasm', 'application/wasm');
        c.seed('birddex-models', '/models/bioclip/vision-int4.onnx', 'onnx', 'application/octet-stream');
      },
    });
    await update();
    expect(caches.urls('birdydex-runtime-v3')).toEqual([abs('/models/birdnet/model.json')]);
    expect(caches.urls('birddex-models').sort()).toEqual([
      abs('/models/bioclip/vision-int4.onnx'),
      abs('/vendor/ort/ort-wasm-simd-threaded.mjs'),
      abs('/vendor/ort/ort-wasm-simd-threaded.wasm'),
      abs('/vendor/ort/ort.wasm.min.mjs'),
    ]);
    state.online = false;
    expect(await get('/vendor/ort/ort.wasm.min.mjs')).toMatchObject({ status: 200, text: 'ort-main' });
    expect(await get('/vendor/ort/ort-wasm-simd-threaded.mjs')).toMatchObject({ status: 200, text: 'ort-threaded' });
    expect(await get('/models/birdnet/model.json')).toMatchObject({ status: 200, text: '{}' });
  });

  it('keeps the ONNX runtime modules a fresh install fetches', async () => {
    const { caches, state, get } = setup();
    expect(await get('/vendor/ort/ort.wasm.min.mjs')).toMatchObject({ status: 200, text: 'ort' });
    expect(caches.urls('birddex-models')).toEqual([abs('/vendor/ort/ort.wasm.min.mjs')]);
    state.online = false;
    expect(await get('/vendor/ort/ort.wasm.min.mjs')).toMatchObject({ status: 200, text: 'ort' });
  });
});

// The worker address exactly as src/core/listen.js builds it for this origin.
function listenWorkerUrl() {
  const src = readFileSync(join(root, 'src', 'core', 'listen.js'), 'utf8');
  const tpl = /const url = `([^`]*birdnet-worker\.js[^`]*)`/.exec(src)?.[1];
  if (!tpl) throw new Error('listen.js no longer builds the worker address as the service worker expects');
  return new Function('BASE', `return \`${tpl}\`;`)(ORIGIN + '/') as string;
}

describe('Listen offline', () => {
  const precache = ['/index.html', '/assets/index-a.js', '/js/birdnet-worker.js'];
  const files = { '/js/birdnet-worker.js': 'worker-new' };

  it('saves the worker under the address listen.js asks for, query and all', async () => {
    const url = listenWorkerUrl();
    expect(url).toContain('?tf=');
    const { caches, state, get, update } = setup(precache, { files });
    await update();
    const shell = [...caches.map.keys()].find((n) => n.startsWith('birdydex-shell-'))!;
    expect(caches.urls(shell)).toContain(url);
    state.online = false;
    // The worker reads its settings from its own address, which is the address of the answer it gets.
    expect(await get(url, { destination: 'worker', mode: 'same-origin' })).toMatchObject({ status: 200, text: 'worker-new', url });
  });

  it('starts offline after an update from main, with main\'s BirdNET files', async () => {
    const url = listenWorkerUrl();
    const { state, get, update } = setup(precache, {
      files,
      before: (c) => {
        c.seed('birdydex-runtime-v3', url, 'worker-main');
        c.seed('birdydex-runtime-v3', '/vendor/tfjs/tf.min.js', 'tf-main');
        c.seed('birdydex-runtime-v3', '/models/birdnet/model.json', '{"m":1}', 'application/json');
      },
    });
    await update();
    state.online = false;
    expect(await get(url, { destination: 'worker', mode: 'same-origin' })).toMatchObject({ status: 200, text: 'worker-new', url });
    expect(await get('/vendor/tfjs/tf.min.js', { destination: 'script' })).toMatchObject({ status: 200, text: 'tf-main' });
    expect(await get('/models/birdnet/model.json')).toMatchObject({ status: 200, text: '{"m":1}' });
  });

  it('answers the Supabase client from this release, not an older runtime copy', async () => {
    const { state, get, update } = setup(['/index.html', '/assets/index-a.js', '/vendor/supabase/supabase.js'], {
      files: { '/vendor/supabase/supabase.js': 'supabase-new' },
      before: (c) => c.seed('birdydex-runtime-v3', '/vendor/supabase/supabase.js', 'supabase-main'),
    });
    await update();
    expect(await get('/vendor/supabase/supabase.js')).toMatchObject({ status: 200, text: 'supabase-new' });
    state.online = false;
    expect(await get('/vendor/supabase/supabase.js')).toMatchObject({ status: 200, text: 'supabase-new' });
  });

  it('counts the worker in the shell status', async () => {
    const { sw, update } = setup(precache, { files });
    await update();
    let status: unknown = null;
    await dispatch(sw.message, { data: { type: 'shell-status' }, ports: [{ postMessage: (s: unknown) => { status = s; } }] });
    expect(status).toMatchObject({ total: 3, saved: 3 });
  });
});

describe('navigations', () => {
  const precache = ['/index.html', '/assets/index-a.js', '/privacy.html'];
  const privacy = { body: '<!doctype html><title>Privacy: Sarah\'s BirdyDex</title><p>Privacy</p>', type: 'text/html' };
  const nav = { mode: 'navigate', destination: 'document' };
  const shellOf = (caches: FakeCaches) => [...caches.map.keys()].find((n) => n.startsWith('birdydex-shell-'))!;
  const text = async (caches: FakeCaches, url: string) => {
    const hit = await (await caches.open(shellOf(caches))).match(url);
    return hit ? hit.text() : null;
  };

  it('stores good pages again on every online visit, each under its own address', async () => {
    const { caches, get, update, files } = setup(precache, { files: { '/privacy.html': privacy } });
    await update();
    const shell = await caches.open(shellOf(caches));
    await shell.delete('/index.html');
    await shell.delete('/privacy.html');
    await get('/', nav);
    await get('/privacy.html', nav);
    expect(await text(caches, '/index.html')).toContain('<div id="root">');
    expect(await text(caches, '/privacy.html')).toContain('Privacy');
    // A newer page replaces the saved one straight away.
    files[abs('/privacy.html')] = { body: '<title>Privacy: Sarah\'s BirdyDex</title><p>Privacy v2</p>', type: 'text/html' };
    await get('/privacy.html', nav);
    expect(await text(caches, '/privacy.html')).toContain('Privacy v2');
  });

  it('never stores a captive portal, an error page or an unknown address', async () => {
    const { caches, get, update, files, state } = setup(precache, { files: { '/privacy.html': privacy } });
    await update();
    const portal = { body: '<!doctype html><title>Free Wi-Fi</title><p>Log in to continue</p>', type: 'text/html' };
    files[abs('/')] = portal;
    files[abs('/index.html')] = portal;
    files[abs('/privacy.html')] = portal;
    files[abs('/does-not-exist')] = { body: '<!doctype html><div id="root"></div>', type: 'text/html' };
    await get('/', nav);
    await get('/index.html', nav);
    await get('/privacy.html', nav);
    await get('/does-not-exist', nav);
    files[abs('/terms.html')] = { body: 'Not found', type: 'text/html', status: 404 };
    await get('/terms.html', nav);
    expect(await text(caches, '/index.html')).toContain('<div id="root">');
    expect(await text(caches, '/privacy.html')).toContain('Privacy');
    expect(caches.urls(shellOf(caches)).sort()).toEqual([abs('/assets/index-a.js'), abs('/index.html'), abs('/privacy.html')]);
    // Offline the app and the privacy page still open.
    state.online = false;
    expect((await get('/', nav)).text).toContain('<div id="root">');
    expect((await get('/privacy.html', nav)).text).toContain('Privacy');
    expect((await get('/does-not-exist', nav)).text).toContain('<div id="root">');
  });
});

describe('releases', () => {
  // One phone, one network, several releases of the service worker in a row.
  function phone(files: Files) {
    const all: Files = { '/index.html': { body: '<div id="root"></div>', type: 'text/html' }, ...files };
    const { net, state } = makeNet(Object.fromEntries(Object.entries(all).map(([u, f]) => [abs(u), f])));
    const caches = new FakeCaches(net);
    // Install and activate a release; resolves to 'installed' or the install's error.
    const release = async (version: string, precache: string[]) => {
      const sw = loadWorker({ precache: ['/index.html', ...precache], version, caches, net });
      let wait: Promise<unknown> = Promise.resolve();
      sw.install({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
      try {
        await wait;
      } catch (err) {
        return String(err);
      }
      await dispatch(sw.activate, {});
      return { result: 'installed', get: (url: string) => dispatch(sw.fetch, { request: toReq(url) }) };
    };
    const assets = (name: string) => caches.urls(name).filter((u) => u.includes('/assets/')).map((u) => u.split('/').pop()).sort();
    return { caches, state, release, assets };
  }
  const files: Files = {
    '/assets/index-a.js': 'a', '/assets/index-b.js': 'b', '/assets/index-c.js': 'c', '/assets/index-d.js': 'd',
    '/assets/photoid-1.js': 'p1', '/assets/photoid-2.js': 'p2', '/assets/photoid-3.js': 'p3',
  };

  it('keeps an older release\'s own chunks for one release only', async () => {
    const { caches, state, release, assets } = phone(files);
    await release('A', ['/assets/index-a.js', '/assets/photoid-1.js']);
    const b = await release('B', ['/assets/index-b.js', '/assets/photoid-2.js']);
    expect(assets('birdydex-shell-B')).toEqual(['index-b.js', 'photoid-2.js']);
    expect(assets('birdydex-older-B')).toEqual(['index-a.js', 'photoid-1.js']);
    // A page still running release A loads its chunk offline.
    state.online = false;
    expect(await (b as { get: (u: string) => Promise<unknown> }).get('/assets/photoid-1.js')).toMatchObject({ status: 200, text: 'p1' });
    state.online = true;
    await release('C', ['/assets/index-c.js', '/assets/photoid-3.js']);
    await release('D', ['/assets/index-d.js', '/assets/photoid-3.js']);
    expect([...caches.map.keys()].filter((n) => /^birdydex-(shell|older)-/.test(n)).sort()).toEqual(['birdydex-older-D', 'birdydex-shell-D']);
    expect(assets('birdydex-shell-D')).toEqual(['index-d.js', 'photoid-3.js']);
    expect(assets('birdydex-older-D')).toEqual(['index-c.js']);
  });

  it('drops what an earlier build carried into its shell after one release', async () => {
    const { caches, release, assets } = phone(files);
    // A shell from before this fix, holding its own files and chunks carried from two releases back.
    caches.seed('birdydex-shell-old', '/index.html', '<div id="root"></div>', 'text/html');
    for (const f of ['index-a.js', 'photoid-1.js', 'photoid-2.js']) caches.seed('birdydex-shell-old', '/assets/' + f, f);
    await release('C', ['/assets/index-c.js', '/assets/photoid-3.js']);
    expect(assets('birdydex-older-C')).toEqual(['index-a.js', 'photoid-1.js', 'photoid-2.js']);
    await release('D', ['/assets/index-d.js', '/assets/photoid-3.js']);
    expect(assets('birdydex-older-D')).toEqual(['index-c.js']);
  });

  it('leaves no half-filled shell when an install fails, and the working release carries on', async () => {
    const { caches, state, release, assets } = phone({ ...files, '/assets/photoid-9.js': { body: 'flaky', type: 'text/plain', status: 503 } });
    await release('A', ['/assets/index-a.js', '/assets/photoid-1.js']);
    expect(await release('B', ['/assets/index-b.js', '/assets/photoid-9.js'])).toContain('shell incomplete');
    expect([...caches.map.keys()].filter((n) => /^birdydex-(shell|older)-/.test(n)).sort()).toEqual(['birdydex-older-A', 'birdydex-shell-A']);
    expect(assets('birdydex-shell-A')).toEqual(['index-a.js', 'photoid-1.js']);
    state.online = false;
    const a = loadWorker({ precache: ['/index.html', '/assets/index-a.js'], version: 'A', caches, net: async () => { throw new TypeError('offline'); } });
    expect((await dispatch(a.fetch, { request: toReq('/', { mode: 'navigate' }) })).text).toContain('<div id="root">');
  });
});
