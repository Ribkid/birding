// Sarah's BirdyDex service worker.
// App files: network first (so updates arrive straight away), cache when offline or when the signal is too weak.
// Bird photos, map tiles, the ID models and our call clips: cache first, so they work in the bush.
const VERSION = 'v9-o';
const SHELL = `birddex-shell-${VERSION}`;
const IMAGES = 'birddex-images';
const TILES = 'birddex-tiles';
const MODELS = 'birddex-models';
const CALLS = 'birddex-calls';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'css/motion.css', 'css/learn.css', 'css/calls.css', 'css/scan.css', 'css/field.css', 'manifest.webmanifest',
  'js/app.js', 'js/motion.js', 'js/layers.js', 'js/db.js', 'js/media.js', 'js/species.js', 'js/stats.js', 'js/ebird.js', 'js/seqdata.js',
  'js/card3d.js', 'js/quiz.js', 'js/learn.js', 'js/mapinfo.js', 'js/statsview.js', 'js/palettes.js', 'js/model3d.js', 'js/listen.js', 'js/photoid.js', 'js/scan.js', 'js/gallery.js',
  'js/config.js', 'js/cloud.js', 'js/sync.js', 'js/account.js', 'vendor/supabase/supabase.js',
  // Listen's worker and audio worklet: kept with each release, so Listen still starts offline after an update.
  'js/birdnet-worker.js', 'js/audio-processor.js',
  'data/species-new.json', 'data/tiers.json', 'data/info.json', 'data/gallery.json',
  'data/seq.json', 'data/birdnet-map.json', 'data/lookalikes.json', 'data/calls.json',
  'data/photoid.json', 'data/photoid.bin', 'models/bioclip/manifest.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/three/three.module.min.js',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'fonts/schibsted-grotesk-latin-400-normal.woff2', 'fonts/schibsted-grotesk-latin-400-italic.woff2',
  'fonts/schibsted-grotesk-latin-500-normal.woff2', 'fonts/schibsted-grotesk-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-600-normal.woff2', 'fonts/big-shoulders-display-latin-800-normal.woff2', 'fonts/caprasimo-latin-400-normal.woff2',
  'icons/icon.svg', 'icons/logo.svg', 'icons/icon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'privacy.html', 'terms.html',
];
const NAV_WAIT = 4000;  // a page load waits this long for the network before using the saved copy
const FILE_WAIT = 1500; // each file it loads waits this long

// Add files one by one so a missing optional file can't stop the update. A file that can't be fetched right now
// keeps the copy from the previous release, so an update on a patchy connection never loses a working file.
async function precache(cache, list) {
  await Promise.all(list.map(async a => {
    try { await cache.add(new Request(a, { cache: 'reload' })); }
    catch (_) { const old = await caches.match(a); if (old) await cache.put(a, old).catch(() => {}); }
  }));
}
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => precache(c, ASSETS)).then(() => self.skipWaiting()));
});
// Only old app-file caches go. Photos, map tiles, models and call clips stay across every release.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('birddex-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

// How many app files are saved, for Settings' "Ready for the field". 'shell-fill' also fetches any that are missing.
const assetUrl = a => new URL(a, self.location.href).href;
async function shellStatus() {
  const c = await caches.open(SHELL);
  const have = new Set((await c.keys()).map(r => r.url.split('#')[0])); // a page saved from #/dex is still the page
  const missing = ASSETS.filter(a => !have.has(assetUrl(a)));
  return { version: VERSION, total: ASSETS.length, saved: ASSETS.length - missing.length, missing };
}
self.addEventListener('message', e => {
  const type = e.data?.type, port = e.ports?.[0];
  if (type !== 'shell-status' && type !== 'shell-fill') return;
  e.waitUntil((async () => {
    let st = await shellStatus();
    if (type === 'shell-fill' && st.missing.length) { await precache(await caches.open(SHELL), st.missing); st = await shellStatus(); }
    port?.postMessage({ version: st.version, total: st.total, saved: st.saved });
  })());
});

// Cache first. Any saved copy will do (the vendor libraries are saved with the app files), but this release's own
// app files come first, so an updated library reaches the phone.
async function cacheFirst(req, cacheName, { cors = false, limit = 0 } = {}) {
  const own = req.url.startsWith(self.location.origin) ? await (await caches.open(SHELL)).match(req.url) : null;
  const hit = own || await caches.match(req.url);
  if (hit) return hit;
  const cache = await caches.open(cacheName);
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
// Call clips (data/calls/): cache first. Audio elements ask for byte ranges, so the whole file is fetched and kept,
// and ranges are cut from it; Safari won't play media from a plain 200 answer to a range request.
async function callClip(req) {
  const cache = await caches.open(CALLS);
  let res = await cache.match(req.url);
  if (!res) {
    res = await fetch(req.url);
    if (!res.ok) return res;
    await cache.put(req.url, res.clone());
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!range) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}

// Pages that had to fall back to saved files (no signal, or too weak). The rest of that page's files come straight
// from the cache too: one wait instead of one per file, and every file from the same release.
const slowPages = new Set();
const markSlow = id => { if (!id) return; if (slowPages.size > 30) slowPages.clear(); slowPages.add(id); };
const savedCopy = async (cache, req) => await cache.match(req, { ignoreSearch: true })
  || (req.mode === 'navigate' ? await cache.match('index.html') : null)
  || await caches.match(req, { ignoreSearch: true });

async function networkFirst(req, clientId) {
  const cache = await caches.open(SHELL);
  const nav = req.mode === 'navigate';
  // A response that turns up after the wait is still saved, so the next start has it.
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (!nav && slowPages.has(clientId)) {
    const hit = await savedCopy(cache, req);
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }
  let timer;
  try {
    return await Promise.race([net, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('slow')), nav ? NAV_WAIT : FILE_WAIT); })]);
  } catch (_) {
    const hit = await savedCopy(cache, req);
    if (!hit) return net; // nothing saved: keep waiting for the network, or pass on its error
    net.catch(() => {});
    markSlow(clientId);
    return hit;
  } finally { clearTimeout(timer); }
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
    const clientId = req.mode === 'navigate' ? e.resultingClientId : e.clientId;
    // The photo model's chunks are joined and cached by js/photoid.js; don't keep a second 87 MB copy here.
    // Its small manifest goes network first, so photo ID still starts offline.
    if (url.pathname.includes('/models/bioclip/')) {
      if (url.pathname.endsWith('.bin')) return;
      e.respondWith(networkFirst(req, clientId));
      return;
    }
    if (url.pathname.includes('/models/') || url.pathname.includes('/vendor/')) {
      e.respondWith(cacheFirst(req, MODELS));
      return;
    }
    if (url.pathname.includes('/data/calls/')) {
      e.respondWith(callClip(req));
      return;
    }
    if (url.search.includes('nocache')) return;
    e.respondWith(networkFirst(req, clientId));
  }
});
