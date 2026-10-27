// BirdyDex service worker.
//
// Shell and data are precached at install; photos, map tiles and call clips are cached on first
// use. The 88 MB photo model is deliberately left out: src/core/photoid.js downloads it on demand
// with progress and keeps it in its own 'birddex-models' cache.
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
const PHOTO_LIMIT = 400;
const PRECACHE = __PRECACHE__;

// Cached responses carry the server's Vary header, but requests for module scripts, styles and
// fonts send different Accept* headers than the install-time fetch did. Without ignoreVary the
// lookup misses and the (offline) network fallback fails.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One by one: a single missing file must not fail the whole install.
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, RUNTIME, PHOTOS, CALLS, 'birddex-models']);
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

async function cacheFirst(request, cacheName, event) {
  const hit = await caches.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const put = caches.open(cacheName).then((cache) => cache.put(request, res.clone())).catch(() => {});
    if (event) event.waitUntil(put);
    else await put;
  }
  return res;
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
  if (url.origin !== self.location.origin) return; // Wikipedia / ALA photos are the app's business

  // Navigations: network first so a deploy lands, cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put('/index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (
            (await caches.match('/index.html', MATCH)) ||
            (await caches.match(request, MATCH)) ||
            new Response('<h1>Offline</h1><p>BirdyDex has not been opened online yet.</p>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
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
        const cached = await caches.match(request, MATCH);
        const network = fetch(request)
          .then(async (res) => {
            if (res.ok) {
              const cache = await caches.open(RUNTIME);
              await cache.put(request, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })(),
    );
    return;
  }

  // Built assets are content-hashed, so the cached copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL).catch(() => Response.error()));
    return;
  }

  if (isPhoto(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, MATCH);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(PHOTOS);
          await cache.put(request, res.clone()).catch(() => {});
          void trim(PHOTOS, PHOTO_LIMIT);
        }
        return res;
      })().catch(() => Response.error()),
    );
    return;
  }

  // The photo-ID parts are joined and cached by src/core/photoid.js; never store them twice.
  if (url.pathname.startsWith('/models/bioclip/') && url.pathname.endsWith('.bin')) return;
  // Models and vendor bundles (the ORT wasm, BirdNET files): one entry in birddex-models.
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(cacheFirst(request, 'birddex-models', event).catch(() => Response.error()));
    return;
  }

  // Everything else same-origin (fonts): cache first, then network.
  event.respondWith(cacheFirst(request, RUNTIME, event).catch(() => Response.error()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
