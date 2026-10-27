// BirdyDex service worker. The shell, the refreshed data files and the int4 photo-ID model are
// precached at install. Photos, map tiles and call clips are cached on first use.
const VERSION = __VERSION__;
const SHELL = 'birdydex-shell-' + VERSION;
const RUNTIME = 'birdydex-runtime-v2';
const PHOTOS = 'birdydex-photos-v2';
const CALLS = 'birdydex-calls';
const PHOTO_LIMIT = 400;
const PRECACHE = __PRECACHE__;

// Fetch decodes gzip, but keeps the gzip headers. Serving that body from Cache Storage makes the
// browser try to decode it twice, so strip the transfer headers before storing anything.
const stash = (cache, request, res) => {
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  headers.delete('content-length');
  return cache.put(request, new Response(res.body, { status: res.status, statusText: res.statusText, headers }));
};

// A response read back from Cache Storage has an empty URL. Module scripts and some media checks need the
// requested URL, and the stored body is already decoded, so rebuild a clean response with both.
const serve = (res, request) => {
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  headers.delete('content-length');
  headers.set('access-control-allow-origin', '*');
  const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  try {
    const url = typeof request === 'string' ? new URL(request, self.location.href).href : request.url;
    Object.defineProperty(out, 'url', { value: url, configurable: true });
    Object.defineProperty(out, 'type', { value: 'basic', configurable: true });
  } catch (_) {}
  return out;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      // one by one so a single missing file cannot fail the whole install
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (!res.ok) return;
            await stash(cache, url, res);
          } catch (_) { /* keep the previous release's copy, if any */ }
        }),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, RUNTIME, PHOTOS, CALLS, 'birddex-models']);
      for (const name of await caches.keys()) {
        if (!keep.has(name) && name.startsWith('birdydex-')) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const isModel = (url) => url.pathname.startsWith('/models/');
const isCallClip = (url) => url.pathname.startsWith('/data/calls/');
const isData = (url) => url.pathname.startsWith('/data/');
const isPhoto = (url) => /(^\/icons\/)|(^\/photos\/)/.test(url.pathname) || /\.(png|jpe?g|webp)$/i.test(url.pathname);

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

// Model chunks and the manifest are precached; if this release's copy is missing, fall back to the
// app-managed 'birddex-models' cache, then the network.
async function modelFile(request) {
  const shell = await caches.open(SHELL);
  const own = await shell.match(request);
  if (own) return serve(own, request);
  const saved = await caches.match(request);
  if (saved) return serve(saved, request);
  const res = await fetch(request);
  if (res.ok) stash(await caches.open('birddex-models'), request, res.clone()).catch(() => {});
  return res;
}

// Call clips (data/calls/): cache first. Audio elements ask for byte ranges, so the whole file is fetched
// and kept, and ranges are cut from it; Safari won't play media from a plain 200 answer to a range request.
async function callClip(request) {
  const cache = await caches.open(CALLS);
  let res = await cache.match(request);
  if (!res) {
    res = await fetch(request);
    if (!res.ok) return res;
    await stash(cache, request, res.clone());
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) return serve(res, request);
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
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

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return serve(hit, request);
  const res = await fetch(request);
  if (res.ok) stash(await caches.open(cacheName), request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // photos from Wikipedia/ALA are handled by the app

  // Navigations: network first so a new deploy is picked up, cache as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          stash(cache, '/index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const saved = (await caches.match('/index.html')) || (await caches.match(request));
          return saved ? serve(saved, request) : Response.error();
        }
      })(),
    );
    return;
  }

  if (isModel(url)) {
    event.respondWith(modelFile(request));
    return;
  }

  if (isCallClip(url)) {
    event.respondWith(callClip(request));
    return;
  }

  // Data (seq, calls manifest, photo-ID header): saved copy first, fresh copy in the background.
  if (isData(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then(async (res) => {
            if (res.ok) stash(await caches.open(RUNTIME), request, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return cached ? serve(cached, request) : ((await network) || Response.error());
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (isPhoto(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return serve(cached, request);
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(PHOTOS);
            await stash(cache, request, res.clone());
            void trim(PHOTOS, PHOTO_LIMIT);
          }
          return res;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else same-origin: cache first, network fallback.
  event.respondWith(cacheFirst(request, RUNTIME).catch(() => Response.error()));
});

// The page asks for this after a new worker is waiting, so updates land on her terms.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
