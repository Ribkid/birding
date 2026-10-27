// Sarah's BirdyDex service worker.
// App files: network first (so updates arrive straight away), cache when offline.
// Bird photos, map tiles and the ID models: cache first, so they work in the bush.
const VERSION = 'v7-p';
const SHELL = `birddex-shell-${VERSION}`;
const IMAGES = 'birddex-images';
const TILES = 'birddex-tiles';
const MODELS = 'birddex-models';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'css/scan.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/media.js', 'js/species.js', 'js/stats.js', 'js/ebird.js', 'js/seqdata.js',
  'js/card3d.js', 'js/quiz.js', 'js/mapinfo.js', 'js/statsview.js', 'js/palettes.js', 'js/model3d.js', 'js/listen.js', 'js/photoid.js', 'js/scan.js', 'js/gallery.js',
  'js/config.js', 'js/cloud.js', 'js/sync.js', 'js/account.js', 'vendor/supabase/supabase.js',
  'data/photoid.json', 'data/photoid.bin', 'models/bioclip/manifest.json',
  'data/species-new.json', 'data/tiers.json', 'data/info.json', 'data/gallery.json',
  'data/seq.json', 'data/birdnet-map.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/three/three.module.min.js',
  'fonts/schibsted-grotesk-latin-400-normal.woff2', 'fonts/schibsted-grotesk-latin-400-italic.woff2',
  'fonts/schibsted-grotesk-latin-500-normal.woff2', 'fonts/schibsted-grotesk-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-600-normal.woff2', 'fonts/big-shoulders-display-latin-800-normal.woff2', 'fonts/caprasimo-latin-400-normal.woff2',
  'icons/icon.svg', 'icons/logo.svg', 'icons/icon-32.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // Add files one by one so a missing optional data file can't stop the update.
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
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
    if (cors) return fetch(req);
    throw err;
  }
}
async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000)),
    ]);
    if (res.ok && req.method === 'GET') cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    return fetch(req);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if ((url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') && req.destination !== 'audio') {
    e.respondWith(cacheFirst(req, IMAGES, { cors: true }));
    return;
  }
  if (url.hostname.endsWith('tile.openstreetmap.org') || url.hostname === 'server.arcgisonline.com') {
    e.respondWith(cacheFirst(req, TILES, { limit: 3000 }));
    return;
  }
  if (url.origin === location.origin) {
    // The photo model's chunks are joined and cached by js/photoid.js; don't keep a second 87 MB copy here.
    // Its small manifest goes network first, so photo ID still starts offline.
    if (url.pathname.includes('/models/bioclip/')) {
      if (url.pathname.endsWith('.bin')) return;
      e.respondWith(networkFirst(req));
      return;
    }
    if (url.pathname.includes('/models/') || url.pathname.includes('/vendor/')) {
      e.respondWith(cacheFirst(req, MODELS));
      return;
    }
    if (url.search.includes('nocache')) return;
    e.respondWith(networkFirst(req));
  }
});
