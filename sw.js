// Birddex service worker: app shell offline, plus cached bird photos and map tiles.
const VERSION = 'v2';
const SHELL = `birddex-shell-${VERSION}`;
const IMAGES = 'birddex-images';
const TILES = 'birddex-tiles';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/media.js', 'js/species.js', 'js/stats.js', 'js/ebird.js', 'js/seqdata.js',
  'data/seq.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'fonts/schibsted-grotesk-latin-400-normal.woff2', 'fonts/schibsted-grotesk-latin-400-italic.woff2',
  'fonts/schibsted-grotesk-latin-500-normal.woff2', 'fonts/schibsted-grotesk-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-600-normal.woff2', 'fonts/big-shoulders-display-latin-800-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('birddex-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheFirst(req, cacheName, { cors = false, limit = 0 } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(cors ? new Request(req.url, { mode: 'cors', credentials: 'omit' }) : req);
    if (res.ok) {
      cache.put(req.url, res.clone());
      if (limit && Math.random() < 0.02) trim(cacheName, limit);
    }
    return res;
  } catch (err) {
    if (cors) return fetch(req); // fall back to a plain request
    throw err;
  }
}
async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'upload.wikimedia.org' && req.destination !== 'audio') {
    e.respondWith(cacheFirst(req, IMAGES, { cors: true }));
    return;
  }
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(cacheFirst(req, TILES, { limit: 3000 }));
    return;
  }
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).catch(() => caches.match('index.html')));
      return;
    }
    // stale-while-revalidate for app files
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
