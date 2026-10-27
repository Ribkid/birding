// BirdyDex service worker.
//
// Shell and data are precached at install. Wikimedia photos ('birddex-images') and map tiles
// ('birddex-tiles') are cached on first use; call clips ('birddex-calls') are stored whole. The
// BioCLIP .bin parts bypass the worker and are joined by src/core/photoid.js into
// 'birddex-models'; BirdNET files and /vendor bundles use the same model cache.
//
// Rule learned the hard way: never rebuild a cached Response (no new Response(res.body, …), no
// forged url/type). Cached responses are served as they are. Rebuilding them makes CORS-mode
// requests — module scripts and modulepreload — fail with net::ERR_FAILED while plain requests
// such as CSS still work, which is a very confusing way to go offline.
const VERSION = __VERSION__;
const SHELL = 'birdydex-shell-' + VERSION;
const RUNTIME = 'birdydex-runtime-v3';
const PHOTOS = 'birdydex-photos-v3';
const CALLS = 'birddex-calls';
const IMAGES = 'birddex-images';
const TILES = 'birddex-tiles';
const PHOTO_LIMIT = 400;
const NAV_WAIT = 4000;
const TILE_LIMIT = 3000;
const PRECACHE = __PRECACHE__;

// Cached responses carry the server's Vary header, but requests for module scripts, styles and
// fonts send different Accept* headers than the install-time fetch did. Without ignoreVary the
// lookup misses and the (offline) network fallback fails.
const MATCH = { ignoreVary: true };

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

// Keep the worker alive until `promise` settles. waitUntil throws once the event is over and nothing
// else is pending; the work itself still runs.
function waitFor(event, promise) {
  try {
    event.waitUntil(promise);
  } catch {}
}

// Returns a step for fetch(...).then() that stores a good answer under `key` and hands the answer on.
// The copy is cloned at once: once the answer has gone back to respondWith its body is being read,
// and clone() throws. An HTML answer is the host's fallback page for a missing file, so it is not
// kept. Caches with a limit are trimmed now and then, as v1 does.
function keep(event, cacheName, key, limit = 0) {
  return (res) => {
    if (res.ok && !isHtml(res)) {
      const copy = res.clone();
      waitFor(event, caches.open(cacheName)
        .then((cache) => cache.put(key, copy))
        .then(() => (limit && Math.random() < 0.02 ? trim(cacheName, limit) : undefined))
        .catch(() => {}));
    }
    return res;
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Keep the previous release's copy of a file that fails now; content-hashed
      // assets have no older copy, so a missing index or asset fails the install and
      // leaves the working worker in charge until the next update.
      await Promise.all(PRECACHE.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch {
          const old = await caches.match(url, MATCH);
          if (old) await cache.put(url, old).catch(() => {});
        }
      }));
      const have = new Set((await cache.keys()).map((req) => new URL(req.url).pathname));
      if (PRECACHE.some((url) => (url === '/index.html' || url.startsWith('/assets/')) && !have.has(url))) {
        throw new Error('shell incomplete');
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, RUNTIME, PHOTOS, CALLS, 'birddex-models']);
      const shell = await caches.open(SHELL);
      // A page still running the previous release may lazy-load an old content-hashed
      // chunk. Keep the old shell's assets in the new shell before deleting it.
      for (const name of await caches.keys()) {
        if (name === SHELL || !name.startsWith('birdydex-shell-')) continue;
        const old = await caches.open(name);
        for (const req of await old.keys()) {
          if (!new URL(req.url).pathname.startsWith('/assets/')) continue;
          if (await shell.match(req, MATCH)) continue;
          const res = await old.match(req);
          if (res) await shell.put(req, res).catch(() => {});
        }
      }
      for (const name of await caches.keys()) {
        if (!keep.has(name) && name.startsWith('birdydex-')) await caches.delete(name);
      }
      // These used to be caught by the runtime cache; photoid.js owns the model cache now.
      const runtime = await caches.open(RUNTIME);
      for (const req of await runtime.keys()) {
        const path = new URL(req.url).pathname;
        if ((path.startsWith('/models/bioclip/') && path.endsWith('.bin')) || path.startsWith('/vendor/ort/')) {
          await runtime.delete(req);
        }
      }
      await self.clients.claim();
    })(),
  );
});

const isCallClip = (url) => url.pathname.startsWith('/data/calls/');
const isData = (url) => url.pathname.startsWith('/data/');
const isPhoto = (url) => /(^\/icons\/)|(^\/photos\/)/.test(url.pathname) || /\.(png|jpe?g|webp)$/i.test(url.pathname);

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

// Cache first: any saved copy, else the network, keeping a good answer in `cacheName`.
async function cacheFirst(event, cacheName, limit = 0) {
  const { request } = event;
  const hit = await caches.match(request, MATCH);
  if (hit) return hit;
  return fetch(request).then(keep(event, cacheName, request.url, limit));
}

// Cross-origin photos and map tiles, as v1 does. Ask for a CORS response so Cache Storage can keep
// it, saved under the plain URL so src/core/quiz.js and Settings find it. When the host refuses
// CORS, answer with the original request and keep nothing.
async function cacheFirstCross(event, cacheName, limit = 0) {
  const { request } = event;
  const hit = await caches.match(request.url, MATCH);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
  } catch {
    return fetch(request);
  }
  return keep(event, cacheName, request.url, limit)(res);
}

// Worker scripts and /js/ files: try the network briefly, then this release's shell.
async function networkFirstScript(event, ms = 2500) {
  const { request } = event;
  const net = fetch(request).then(keep(event, SHELL, request.url));
  waitFor(event, net.catch(() => {}));
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), ms));
  const first = await Promise.race([net.catch(() => null), timer]);
  if (first) return first;
  const own = await (await caches.open(SHELL)).match(request, { ignoreVary: true, ignoreSearch: true });
  if (own) return own;
  const any = await caches.match(request, MATCH);
  if (any) return any;
  return (await net.catch(() => null)) || Response.error();
}

// Call clips: audio elements ask for byte ranges, and Safari will not play a plain 200 answer to a
// range request, so the whole file is kept and the range is cut from it.
async function callClip(request) {
  const cache = await caches.open(CALLS);
  let res = await cache.match(request.url, MATCH);
  if (!res) {
    // Fetch the whole file: forwarding the audio element's Range header returns a 206,
    // and Cache Storage refuses to store partial responses.
    res = await fetch(request.url);
    if (!res.ok || res.status === 206) return res;
    await cache.put(request.url, res.clone()).catch(() => {});
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) return res;

  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  if (!size) return res;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // v1 caches Wikipedia photos and map tiles so the field guide, quizzes and map work offline.
  if ((url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') && request.destination !== 'audio') {
    event.respondWith(cacheFirstCross(event, IMAGES).catch(() => Response.error()));
    return;
  }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) || url.hostname === 'server.arcgisonline.com') {
    event.respondWith(cacheFirstCross(event, TILES, TILE_LIMIT).catch(() => Response.error()));
    return;
  }
  if (url.origin !== self.location.origin) return; // other third-party requests are the app's business

  // Navigations: network first so a deploy lands, cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        // The copy is cloned the moment the answer arrives, before the page reads it.
        const navFetch = fetch(request).then((fresh) => {
          if (fresh.ok && isHtml(fresh)) {
            const isApp = url.pathname === '/' || url.pathname === '/index.html';
            const copy = fresh.clone();
            waitFor(event, (async () => {
              const cache = await caches.open(SHELL);
              if (!isApp) {
                // Privacy, terms and error pages belong under their own URL, never as the app shell.
                await cache.put(request, copy);
              } else if ((await copy.clone().text()).includes('<div id="root">')) {
                // A captive portal can answer with HTML; only store a real BirdyDex shell.
                await cache.put('/index.html', copy);
              }
            })().catch(() => {}));
          }
          return fresh;
        });
        // A slow answer still refreshes the shell, but never holds the launch open.
        waitFor(event, navFetch.catch(() => {}));

        const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_WAIT));
        const first = await Promise.race([navFetch.catch(() => null), timer]);
        if (first) return first;

        const cached = (await caches.match(request, MATCH)) || (await caches.match('/index.html', MATCH));
        if (cached) return cached;

        const late = await navFetch.catch(() => null);
        if (late) return late;
        return new Response('<h1>Offline</h1><p>BirdyDex has not been opened online yet.</p>', {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      })(),
    );
    return;
  }

  if (isCallClip(url)) {
    event.respondWith(callClip(request).catch(() => Response.error()));
    return;
  }

  // Regional data: cached copy straight away, refreshed in the background.
  if (isData(url)) {
    event.respondWith(
      (async () => {
        // Prefer this release's shell: the persistent runtime cache is older after a deploy.
        const own = await (await caches.open(SHELL)).match(request, MATCH);
        if (own) return own;
        const cached = await caches.match(request, MATCH);
        const net = fetch(request).then(keep(event, RUNTIME, request.url));
        if (!cached) return net;
        waitFor(event, net.catch(() => {}));
        return cached;
      })().catch(() => Response.error()),
    );
    return;
  }

  // Built assets are content-hashed, so the cached copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, SHELL).catch(() => Response.error()));
    return;
  }

  if (isPhoto(url)) {
    event.respondWith(cacheFirst(event, PHOTOS, PHOTO_LIMIT).catch(() => Response.error()));
    return;
  }

  // The BirdNET worker carries a ?tf=&root=&lang= query; a newer worker must reach existing users.
  if (request.destination === 'worker' || url.pathname.startsWith('/js/')) {
    event.respondWith(networkFirstScript(event).catch(() => Response.error()));
    return;
  }
  // The Supabase client is a per-release vendor file, like v1's shell.
  if (url.pathname.startsWith('/vendor/supabase/')) {
    event.respondWith(cacheFirst(event, SHELL).catch(() => Response.error()));
    return;
  }

  // The photo-ID parts are joined and cached by src/core/photoid.js; never store them twice.
  if (url.pathname.startsWith('/models/bioclip/') && url.pathname.endsWith('.bin')) return;
  // Models and vendor bundles (the ORT wasm, BirdNET files): one entry in birddex-models.
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(cacheFirst(event, 'birddex-models').catch(() => Response.error()));
    return;
  }

  // Everything else same-origin (fonts): cache first, then network.
  event.respondWith(cacheFirst(event, RUNTIME).catch(() => Response.error()));
});

async function shellStatus() {
  const have = new Set((await (await caches.open(SHELL)).keys()).map((req) => new URL(req.url).pathname));
  return {
    version: VERSION,
    total: PRECACHE.length,
    saved: PRECACHE.filter((url) => have.has(url)).length,
  };
}

async function shellFill() {
  const cache = await caches.open(SHELL);
  const have = new Set((await cache.keys()).map((req) => new URL(req.url).pathname));
  for (const url of PRECACHE) {
    if (have.has(url)) continue;
    try {
      await cache.add(new Request(url, { cache: 'reload' }));
    } catch {
      const old = await caches.match(url, MATCH);
      if (old) await cache.put(url, old).catch(() => {});
    }
  }
  return shellStatus();
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skip-waiting') void self.skipWaiting();
  if (data?.type === 'shell-status') {
    event.waitUntil(shellStatus().then((status) => event.ports[0]?.postMessage(status)).catch(() => {}));
  }
  if (data?.type === 'shell-fill') {
    event.waitUntil(shellFill().then((status) => event.ports[0]?.postMessage(status)).catch(() => {}));
  }
});
