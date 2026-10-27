// BirdyDex service worker. The shell is precached at install; data, photos and the
// on-device models are cached on first use. Model files are left alone because
// src/core/photoid.js and src/core/listen.js manage their own cache ('birddex-models').
const VERSION = __VERSION__;
const SHELL = 'birdydex-shell-' + VERSION;
const RUNTIME = 'birdydex-runtime-v1';
const PHOTOS = 'birdydex-photos-v1';
const PHOTO_LIMIT = 400;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      // add() one by one so a single missing file cannot fail the whole install
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      );
      // The app is only usable once the shell is there; activate after that.
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, RUNTIME, PHOTOS, 'birddex-models']);
      for (const name of await caches.keys()) {
        if (!keep.has(name) && name.startsWith('birdydex-')) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const isModel = (url) => url.pathname.startsWith('/models/');
const isData = (url) => url.pathname.startsWith('/data/');
const isPhoto = (url) => /(^\/icons\/)|(^\/photos\/)/.test(url.pathname) || /\.(png|jpe?g|webp)$/i.test(url.pathname);

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // photos from Wikipedia/ALA are handled by the app
  if (isModel(url)) return; // managed by the app's own cache

  // Navigations: network first so a new deploy is picked up, cache as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put('/index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match('/index.html')) || (await caches.match(request)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Regional data: serve cached immediately, refresh in the background.
  if (isData(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })(),
    );
    return;
  }

  // Built assets are content-hashed, so cache-first is safe.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) (await caches.open(SHELL)).put(request, res.clone()).catch(() => {});
        return res;
      })(),
    );
    return;
  }

  if (isPhoto(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(PHOTOS);
            await cache.put(request, res.clone());
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
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(RUNTIME)).put(request, res.clone()).catch(() => {});
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});

// The page asks for this after a new worker is waiting, so updates land on her terms.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
