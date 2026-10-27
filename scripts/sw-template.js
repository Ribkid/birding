// BirdyDex service worker. scripts/build-sw.mjs fills in VERSION (the build time) and PRECACHE (the
// shell file list) and writes the result to dist/sw.js.
//
// Where things are kept:
//   birdydex-shell-<VERSION>  this release's files, saved at install: PRECACHE, with Listen's worker under
//                             the address src/core/listen.js asks for. A listed /assets/ chunk or the
//                             Supabase client, if missing here when asked for, is fetched and stored
//                             here again. Pages (the app, privacy, terms), /js/ scripts and other worker
//                             scripts are stored here again whenever they load online.
//   birdydex-older-<VERSION>  /assets/ chunks this release does not list, for a page still running an
//                             earlier release: the earlier shells' chunks, copied at activate, and any
//                             unlisted chunk fetched later. The next activate deletes it.
//   birdydex-runtime-v3       other same-origin files fetched at runtime. It outlives releases, so what an
//                             earlier release kept here (main kept the BirdNET model there) still works.
//   birdydex-photos-v3        same-origin images (icons, /photos/, other .png/.jpg/.webp), about 400.
//   birddex-images            Wikimedia photos, under their plain address. src/core/quiz.js and the
//                             Ready for the field card read it.
//   birddex-tiles             map tiles, about 3000.
//   birddex-calls             call clips, stored whole. src/core/media.js saves clips into it too.
//   birddex-models            BirdNET files and the /vendor libraries (not the Supabase client), on first
//                             use. The photo model's .bin parts never pass through here:
//                             src/core/photoid.js fetches them and keeps the joined model and the ONNX
//                             runtime's .wasm in this cache itself.
//   birddex-audio             recordings from Wikimedia Commons, which src/core/media.js (audioUrl) stores
//                             itself when one is first played. The worker never answers or stores them.
// activate deletes every other birdydex-* cache (earlier shells and older caches, main's calls cache).
// The birddex-* caches are never deleted.
//
// Rule learned the hard way: never rebuild a cached Response (no new Response(res.body, …), no
// forged url/type). Cached responses are served as they are. Rebuilding them makes CORS-mode
// requests (module scripts and modulepreload) fail with net::ERR_FAILED while plain requests
// such as CSS still work, which is a very confusing way to go offline. The only responses made
// here are new ones: a call clip's 206 slice, a 416, the offline page, and Response.error() for a
// request that fails.
//
// A response is copied with clone() before it is handed to respondWith, never after: by then the
// page is reading its body, and clone() throws. event.waitUntil keeps the worker alive while the copy
// is stored.
const VERSION = __VERSION__;
const SHELL = 'birdydex-shell-' + VERSION;
const OLDER = 'birdydex-older-' + VERSION;
const RUNTIME = 'birdydex-runtime-v3';
const PHOTOS = 'birdydex-photos-v3';
const CALLS = 'birddex-calls';
const IMAGES = 'birddex-images';
const TILES = 'birddex-tiles';
const MODELS = 'birddex-models';
const PHOTO_LIMIT = 400;
const TILE_LIMIT = 3000;
const NAV_WAIT = 4000; // a page load waits this long for the network before using the saved copy
const SCRIPT_WAIT = 2500; // a /js/ script waits this long
const PRECACHE = __PRECACHE__;

// Listen's worker reads its settings from its own query string, and a worker's address is the address of
// the response it is given. A copy saved without the query would start the worker without its settings
// (it then looks for /js/js/tfjs-4.14.0.min.js), so the shell keeps the worker under the exact address
// src/core/listen.js builds, fetched with that query, in place of the plain /js/birdnet-worker.js.
// src/__tests__/sw.test.ts checks the two addresses agree.
const ROOT = new URL('/', self.location.href).href;
const LISTEN_WORKER = `/js/birdnet-worker.js?tf=${encodeURIComponent(ROOT + 'vendor/tfjs/tf.min.js')}&root=${encodeURIComponent(ROOT + 'models')}&lang=en_uk`;
const SHELL_FILES = PRECACHE.map((path) => (path === '/js/birdnet-worker.js' ? LISTEN_WORKER : path));
const href = (path) => new URL(path, ROOT).href;
const OWN = new Set(SHELL_FILES.map(href));

// Cached responses carry the server's Vary header, but requests for module scripts, styles and
// fonts send different Accept* headers than the install-time fetch did. Without ignoreVary the
// lookup misses and the (offline) network fallback fails.
const MATCH = { ignoreVary: true };

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');
const keysOf = async (cache) => new Set((await cache.keys()).map((req) => req.url));

// Keep the worker alive until `promise` settles. waitUntil throws once the event is over and nothing
// else is pending; the work itself still runs.
function waitFor(event, promise) {
  try {
    event.waitUntil(promise);
  } catch {}
}

// Returns a step for fetch(...).then() that stores a good answer in `cacheName` under `key` and hands
// the answer on. The copy is cloned at once, before the answer goes back to respondWith. An HTML
// answer to a file request is the host's fallback page for a missing file, so it is not kept. A cache
// with a limit is trimmed after about one store in fifty, as v1 does.
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

// Save one shell file. A file that cannot be fetched now keeps the copy any cache already holds under the
// same address, as v1 does, so an update on a patchy connection never loses a working file.
async function saveShellFile(cache, path) {
  try {
    await cache.add(new Request(path, { cache: 'reload' }));
  } catch {
    const old = await caches.match(path, MATCH);
    if (old) await cache.put(path, old).catch(() => {});
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        await Promise.all(SHELL_FILES.map((path) => saveShellFile(cache, path)));
        // The page and its content-hashed assets have no older copy to fall back on. Without them this
        // release cannot start, so the install fails and the working release stays in charge.
        const have = await keysOf(cache);
        if (SHELL_FILES.some((path) => (path === '/index.html' || path.startsWith('/assets/')) && !have.has(href(path)))) {
          throw new Error('shell incomplete');
        }
      } catch (err) {
        // A failed install leaves no half-filled shell behind.
        await caches.delete(SHELL);
        throw err;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // A page still running the previous release may lazy-load one of its content-hashed chunks, so the
      // /assets/ files of every earlier shell (normally just the previous release's) that this release
      // does not list are copied into this release's OLDER cache. Shells hold only their own release's
      // files, and earlier OLDER caches are deleted below, so an old chunk is kept for one release and
      // old chunks never pile up.
      const older = await caches.open(OLDER);
      for (const name of await caches.keys()) {
        if (name === SHELL || !name.startsWith('birdydex-shell-')) continue;
        const old = await caches.open(name);
        for (const req of await old.keys()) {
          if (!new URL(req.url).pathname.startsWith('/assets/') || OWN.has(req.url)) continue;
          const res = await old.match(req, MATCH);
          if (res) await older.put(req, res).catch(() => {});
        }
      }
      const keep = new Set([SHELL, OLDER, RUNTIME, PHOTOS]);
      for (const name of await caches.keys()) {
        if (name.startsWith('birdydex-') && !keep.has(name)) await caches.delete(name);
      }
      // Earlier releases kept the photo model's .bin parts and the ONNX runtime in the runtime cache.
      // photoid.js keeps the joined model and the .wasm in birddex-models, so the parts are deleted. The
      // runtime's /vendor/ort/ files move to birddex-models unless it already has them, so Scan still
      // starts offline after the update.
      const runtime = await caches.open(RUNTIME);
      const models = await caches.open(MODELS);
      for (const req of await runtime.keys()) {
        const path = new URL(req.url).pathname;
        const part = path.startsWith('/models/bioclip/') && path.endsWith('.bin');
        if (!part && !path.startsWith('/vendor/ort/')) continue;
        if (!part && !(await models.match(req, MATCH))) {
          const res = await runtime.match(req, MATCH);
          if (!res) continue;
          try {
            await models.put(req, res);
          } catch {
            continue;
          }
        }
        await runtime.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

const isCallClip = (url) => url.pathname.startsWith('/data/calls/');
const isData = (url) => url.pathname.startsWith('/data/');
const isPhoto = (url) => /(^\/icons\/)|(^\/photos\/)/.test(url.pathname) || /\.(png|jpe?g|webp)$/i.test(url.pathname);
// A sound file (Commons recordings, including their .mp3 transcodes).
const isRecording = (url) => /\.(ogg|oga|opus|mp3|wav|flac|m4a|aac|webm|midi?)$/i.test(url.pathname);

// Delete the oldest entries (Cache Storage lists them in the order they were stored) beyond `limit`.
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

// Cache first, as v1 does: this release's shell copy, else any saved copy, else the network, keeping a
// good answer in `cacheName`. The shell comes first so a file this release ships (the Supabase client)
// wins over an older copy an earlier release kept in the runtime cache.
async function cacheFirst(event, cacheName, limit = 0) {
  const { request } = event;
  const hit = (await (await caches.open(SHELL)).match(request, MATCH)) || (await caches.match(request, MATCH));
  if (hit) return hit;
  return fetch(request).then(keep(event, cacheName, request.url, limit));
}

// Cross-origin photos and map tiles, as v1 does: any saved copy, else a CORS request (an opaque
// no-cors answer has no status, so it could never pass the res.ok check), kept under the plain address
// so src/core/quiz.js and Settings find it. When the CORS request fails (no signal, or the host
// refuses CORS), the page's own request goes to the network and nothing is kept.
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

// /js/ scripts and workers: the network for up to SCRIPT_WAIT, so a new release's worker reaches the
// phone, stored in this release's shell under the full address. Then a saved copy under that same
// address: this release's shell first, then any cache (such as an earlier release's runtime copy). A copy
// saved without the query comes last, for a script that does not read one. With no saved copy it keeps
// waiting for the network.
async function networkFirstScript(event) {
  const { request } = event;
  const net = fetch(request).then(keep(event, SHELL, request.url));
  waitFor(event, net.catch(() => {}));
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), SCRIPT_WAIT));
  const first = await Promise.race([net.catch(() => null), timer]);
  if (first) return first;
  const shell = await caches.open(SHELL);
  const saved = (await shell.match(request, MATCH))
    || (await caches.match(request, MATCH))
    || (await shell.match(request, { ignoreVary: true, ignoreSearch: true }));
  return saved || net;
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

// Navigations: the network for up to NAV_WAIT so a deploy lands, then the saved page, then the app shell,
// then the network however long it takes, then a short offline page. Every good answer is stored again,
// however long it took: the app under /index.html, and the privacy and terms pages under their own
// address. A captive portal or a host error page can answer any address with its own HTML, so only a page
// with BirdyDex's root element is kept as the app, only a page that names BirdyDex is kept as privacy or
// terms, and no other address is stored.
async function navigation(event, url) {
  const { request } = event;
  const isApp = url.pathname === '/' || url.pathname === '/index.html';
  const net = fetch(request).then((fresh) => {
    if (fresh.ok && isHtml(fresh) && (isApp || OWN.has(request.url))) {
      const copy = fresh.clone();
      waitFor(event, (async () => {
        const text = await copy.clone().text();
        if (!text.includes(isApp ? '<div id="root">' : 'BirdyDex')) return;
        await (await caches.open(SHELL)).put(isApp ? '/index.html' : request.url, copy);
      })().catch(() => {}));
    }
    return fresh;
  });
  waitFor(event, net.catch(() => {}));

  const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_WAIT));
  const first = await Promise.race([net.catch(() => null), timer]);
  if (first) return first;

  const saved = (await caches.match(request, MATCH)) || (await caches.match('/index.html', MATCH));
  if (saved) return saved;

  const late = await net.catch(() => null);
  if (late) return late;
  return new Response('<h1>Offline</h1><p>BirdyDex has not been opened online yet.</p>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Wikimedia photos and map tiles, as v1 keeps them, so the field guide, quizzes and map work offline.
  // Commons recordings are not photos: an <audio> element streams them, and src/core/media.js keeps the
  // ones it plays in birddex-audio, so they go straight to the network and are never stored twice.
  if ((url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') && request.destination !== 'audio' && !isRecording(url)) {
    event.respondWith(cacheFirstCross(event, IMAGES).catch(() => Response.error()));
    return;
  }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) || url.hostname === 'server.arcgisonline.com') {
    event.respondWith(cacheFirstCross(event, TILES, TILE_LIMIT).catch(() => Response.error()));
    return;
  }
  if (url.origin !== self.location.origin) return; // other third-party requests go straight to the network

  if (request.mode === 'navigate') {
    event.respondWith(navigation(event, url));
    return;
  }

  if (isCallClip(url)) {
    event.respondWith(callClip(request).catch(() => Response.error()));
    return;
  }

  // /data/ files: this release's shell copy (build-sw.mjs precaches the .json files the app needs), else
  // a saved copy refreshed in the background, else the network. Both network answers are kept in the
  // runtime cache.
  if (isData(url)) {
    event.respondWith(
      (async () => {
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

  // Built assets are content-hashed, so any saved copy is right. One fetched now is kept in the shell
  // when this release lists it, else in OLDER (an older release's chunk, asked for by a page still
  // running that release), so the shell never holds another release's files.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, OWN.has(request.url) ? SHELL : OLDER).catch(() => Response.error()));
    return;
  }

  // Same-origin images (the icons are in the shell too): cache first, kept in the photos cache, which
  // drops its oldest entries beyond PHOTO_LIMIT.
  if (isPhoto(url)) {
    event.respondWith(cacheFirst(event, PHOTOS, PHOTO_LIMIT).catch(() => Response.error()));
    return;
  }

  // Listen's BirdNET worker and audio worklet (/js/), and any other worker script: network first, so a
  // newer copy reaches people who already have one.
  if (request.destination === 'worker' || url.pathname.startsWith('/js/')) {
    event.respondWith(networkFirstScript(event).catch(() => Response.error()));
    return;
  }
  // The Supabase client is precached with each release, as in v1; cacheFirst answers from this shell.
  if (url.pathname.startsWith('/vendor/supabase/')) {
    event.respondWith(cacheFirst(event, SHELL).catch(() => Response.error()));
    return;
  }

  // The photo model's parts are joined and cached by src/core/photoid.js; never store them twice.
  if (url.pathname.startsWith('/models/bioclip/') && url.pathname.endsWith('.bin')) return;
  // BirdNET files and the other /vendor libraries (tf.js, the ONNX runtime's modules and .wasm): cache
  // first into birddex-models. photoid.js keeps the .wasm there too, under the same address.
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(cacheFirst(event, MODELS).catch(() => Response.error()));
    return;
  }

  // Everything else same-origin (the fonts and web manifest are in the shell): cache first, then the
  // network, kept in the runtime cache.
  event.respondWith(cacheFirst(event, RUNTIME).catch(() => Response.error()));
});

// "Ready for the field" in Settings asks how many shell files are saved ('shell-status') and can ask for
// the missing ones ('shell-fill'). Both answer { version, total, saved } on the message's port.
async function shellStatus() {
  const have = await keysOf(await caches.open(SHELL));
  return {
    version: VERSION,
    total: SHELL_FILES.length,
    saved: SHELL_FILES.filter((path) => have.has(href(path))).length,
  };
}

async function shellFill() {
  const cache = await caches.open(SHELL);
  const have = await keysOf(cache);
  for (const path of SHELL_FILES) {
    if (!have.has(href(path))) await saveShellFile(cache, path);
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
