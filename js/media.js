// Photos, descriptions and calls from Wikipedia / Wikimedia Commons (openly licensed).
// Everything fetched is cached in IndexedDB so the dex works offline afterwards.
import { db } from './db.js';
import { SPECIES } from './species.js';
import { galleryCover, galleryFor, loadExtras } from './gallery.js';

const WP = 'https://en.wikipedia.org/w/api.php';
const CM = 'https://commons.wikimedia.org/w/api.php';
const INDEX_KEY = 'media-index-v1';
const MAX_AGE = 1000 * 60 * 60 * 24 * 60; // refresh after 60 days

let index = null;          // speciesId -> { title, url, thumb, file }
let indexPromise = null;
const listeners = new Set();

function qs(params) {
  return Object.entries({ format: 'json', formatversion: 2, origin: '*', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

async function api(base, params) {
  const r = await fetch(`${base}?${qs(params)}`);
  if (!r.ok) throw new Error(`Wikipedia returned ${r.status}`);
  return r.json();
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const sentenceCase = s => s.charAt(0) + s.slice(1).toLowerCase();

// Resolve a batch of titles -> page info, following normalisation and redirects.
async function lookup(titles) {
  const out = new Map();
  for (const part of chunk(titles, 50)) {
    const data = await api(WP, {
      action: 'query', redirects: 1, prop: 'pageimages|info', inprop: 'url',
      piprop: 'thumbnail|name|original', pithumbsize: 500, pilimit: 50, titles: part.join('|'),
    });
    const q = data.query || {};
    const step = new Map();
    (q.normalized || []).forEach(n => step.set(n.from, n.to));
    const redir = new Map((q.redirects || []).map(r => [r.from, r.to]));
    const pages = new Map((q.pages || []).map(p => [p.title, p]));
    for (const t of part) {
      let cur = step.get(t) || t;
      cur = redir.get(cur) || cur;
      const p = pages.get(cur);
      if (p && !p.missing && !p.invalid) out.set(t, p);
    }
  }
  return out;
}

async function buildIndex(list = SPECIES) {
  const result = {};
  let todo = list.slice();
  const attempts = [
    s => s.wiki,
    s => s.sci,
    s => s.name,
    s => sentenceCase(s.name),
  ];
  for (const pick of attempts) {
    const titles = [...new Set(todo.map(pick).filter(Boolean))];
    if (!titles.length) continue;
    const found = await lookup(titles);
    const next = [];
    for (const s of todo) {
      const t = pick(s);
      const p = t && found.get(t);
      if (p && p.thumbnail) {
        result[s.id] = { title: p.title, url: p.fullurl, thumb: p.thumbnail.source, w: p.original?.width || p.thumbnail.width, file: p.pageimage || null };
      } else next.push(s);
    }
    todo = next;
    if (!todo.length) break;
  }
  return result;
}

export function onMediaReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function loadIndex({ force = false } = {}) {
  if (index && !force) return index;
  if (indexPromise && !force) return indexPromise;
  indexPromise = (async () => {
    const cached = await db.kvGet(INDEX_KEY);
    if (cached && !force) {
      index = cached.data;
      if (Date.now() - cached.at > MAX_AGE && navigator.onLine) refresh();
      else if (navigator.onLine) {
        // Species added since the index was built (new animals and plants): look up just those.
        const tried = new Set(cached.tried || []);
        const missing = SPECIES.filter(s => !index[s.id] && !tried.has(s.id));
        if (missing.length) {
          try {
            const more = await buildIndex(missing);
            index = { ...index, ...more };
            await db.kvSet(INDEX_KEY, { at: cached.at, data: index, tried: [...tried, ...missing.map(s => s.id)] });
          } catch (_) {}
        }
      }
      return index;
    }
    if (!navigator.onLine) return (index = cached?.data || {});
    try {
      index = await buildIndex();
      await db.kvSet(INDEX_KEY, { at: Date.now(), data: index });
    } catch (e) {
      console.warn('Photo index failed', e);
      index = cached?.data || {};
    }
    return index;
  })();
  const res = await indexPromise;
  listeners.forEach(fn => fn(res));
  return res;
}

async function refresh() {
  try {
    const fresh = await buildIndex();
    index = fresh;
    await db.kvSet(INDEX_KEY, { at: Date.now(), data: fresh });
    listeners.forEach(fn => fn(fresh));
  } catch (_) { /* keep old */ }
}

export function photoFor(id) { return index?.[id] || null; }

// Wikimedia only serves a set of standard thumbnail widths to other sites.
export function sized(id, size = 'small') {
  const p = photoFor(id);
  if (!p) return galleryCover(id, size);
  const px = size === 'large' ? 960 : 330;
  if (!/\/\d+px-/.test(p.thumb) || (p.w && p.w < px)) return p.thumb;
  return p.thumb.replace(/\/(\d+)px-/, `/${px}px-`);
}

const strip = html => {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};

// Detail: Wikipedia intro + image licence. Cached per species (only once both lookups succeed).
export async function details(species) {
  const key = `detail-v2-${species.id}`;
  const cached = await db.kvGet(key);
  if (cached) return cached;
  await loadIndex();
  const p = photoFor(species.id);
  if (!p) return null;
  const out = { title: p.title, url: p.url, extract: '', credit: null };
  let ok = true;
  try {
    const ex = await api(WP, { action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, exsentences: 5, titles: p.title });
    out.extract = ex.query?.pages?.[0]?.extract || '';
  } catch (_) { ok = false; }
  if (p.file) {
    try {
      const ii = await api(WP, {
        action: 'query', prop: 'imageinfo', iiprop: 'extmetadata|url',
        iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl', titles: `File:${p.file}`,
      });
      const info = ii.query?.pages?.[0]?.imageinfo?.[0];
      const m = info?.extmetadata || {};
      out.credit = {
        artist: strip(m.Artist?.value) || 'Unknown',
        license: strip(m.LicenseShortName?.value) || '',
        licenseUrl: m.LicenseUrl?.value || '',
        page: info?.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.file)}`,
      };
    } catch (_) { ok = false; }
  }
  if (ok) await db.kvSet(key, out);
  return out;
}

// Calls: search Wikimedia Commons for audio recordings of the species.
const MULTI = /soundscape|mystery|identity unknown|dawn chorus|chorus|bird ?song,|ambien|various|birds of|mixed/i;
export async function calls(species) {
  const key = `calls-v2-${species.id}`;
  const cached = await db.kvGet(key);
  if (cached && (cached.list.length || Date.now() - cached.at < 7 * 864e5)) return cached.list;
  const sci = species.sci.toLowerCase(), name = species.name.toLowerCase();
  const alt = (species.wiki || '').toLowerCase();
  const found = new Map();
  let failed = false;
  for (const q of [`"${species.sci}" filetype:audio`, `"${species.name}" filetype:audio`]) {
    let data;
    try {
      data = await api(CM, {
        action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: 6, gsrlimit: 15,
        prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription',
      });
      if (data.error) throw new Error(data.error.info);
    } catch (_) { failed = true; continue; }
    for (const pg of data.query?.pages || []) {
      const ii = pg.imageinfo?.[0];
      if (!ii || found.has(pg.title)) continue;
      if (!/^audio\/|application\/ogg/.test(ii.mime || '') || ii.size > 12e6) continue;
      const m = ii.extmetadata || {};
      const title = pg.title.toLowerCase().replace(/_/g, ' ');
      if (MULTI.test(title)) continue;
      const desc = strip(m.ImageDescription?.value).toLowerCase();
      const inTitle = title.includes(sci) || title.includes(name) || (alt && title.includes(alt));
      const inDesc = desc.includes(sci) || desc.includes(name);
      found.set(pg.title, {
        score: (inTitle ? 4 : 0) + (inDesc ? 2 : 0) - (pg.index || 0) / 100,
        title: pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
        src: ii.url, mime: ii.mime,
        artist: strip(m.Artist?.value) || 'Unknown',
        license: strip(m.LicenseShortName?.value) || '',
        page: ii.descriptionurl,
      });
    }
  }
  // Prefer files that name the bird, then formats every Android browser plays well.
  const fmt = r => /mpeg|mp3/.test(r.mime) ? 0.5 : /ogg|opus|vorbis/.test(r.mime) ? 0.3 : 0;
  const list = [...found.values()].filter(r => r.score >= 2)
    .sort((a, b) => (b.score + fmt(b)) - (a.score + fmt(a))).slice(0, 3)
    .map(({ score, ...r }) => r);
  if (!failed || list.length) await db.kvSet(key, { at: Date.now(), list });
  return list;
}

// Our own call pack (scripts/build_calls.py): short, level-matched clips served from this site, so they can be
// cached and played offline. The ALA originals can't be: that server sends no CORS header.
export const CALLS_CACHE = 'birddex-calls';
let pack = null, packPromise = null;
// A failed load isn't remembered, so the next call (opening Settings or Listen again) tries again.
export function loadCallPack() {
  return packPromise ||= fetch('data/calls.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(p => { if (!p) { packPromise = null; return {}; } return (pack = p); });
}
const clipUrl = c => new URL(`data/${c.file}${c.v ? `?v=${c.v}` : ''}`, location.href).href;
// Sync check, true once the pack has loaded.
export const hasLocalCall = id => !!pack?.[id]?.length;
export async function localCalls(id) {
  const list = (await loadCallPack())[id] || [];
  return list.map(c => ({
    src: clipUrl(c), orig: c.src, local: true, seconds: c.seconds,
    artist: c.artist, license: c.license, page: c.page, from: c.from,
    title: `${Math.max(1, Math.round(c.seconds || 0))}-second clip`,
  }));
}
const isSameOrigin = src => { try { return new URL(src, location.href).origin === location.origin; } catch (_) { return false; } };

async function packFiles() {
  const p = await loadCallPack();
  return Object.values(p).flat().map(c => ({ url: clipUrl(c), bytes: c.bytes || 0 }));
}
// How much of the pack is in Cache Storage on this phone.
export async function callPackStatus() {
  const files = await packFiles();
  const total = files.length, bytes = files.reduce((a, f) => a + f.bytes, 0);
  let saved = 0, savedBytes = 0;
  try {
    const cache = await caches.open(CALLS_CACHE);
    const have = new Set((await cache.keys()).map(r => r.url));
    for (const f of files) if (have.has(f.url)) { saved++; savedBytes += f.bytes; }
  } catch (_) {}
  return { total, saved, bytes, savedBytes };
}
// Fetch every clip into the calls cache. Clips from older builds of the pack are removed.
export async function saveCallPack(onProgress) {
  const files = await packFiles();
  const cache = await caches.open(CALLS_CACHE);
  const want = new Set(files.map(f => f.url));
  for (const r of await cache.keys()) if (!want.has(r.url)) await cache.delete(r);
  let done = 0, failed = 0;
  for (const part of chunk(files, 6)) {
    await Promise.all(part.map(async f => {
      try {
        if (!(await cache.match(f.url))) {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(res.status);
          await cache.put(f.url, res);
        }
      } catch (_) { failed++; }
      done++;
    }));
    onProgress?.(done, files.length);
  }
  return { done, failed, total: files.length };
}

// Audio is fetched whole and kept in the cache so it plays offline later.
// Our own clips are just returned: the service worker keeps them in the calls cache.
export async function audioUrl(src) {
  if (isSameOrigin(src)) return src;
  try {
    const cache = await caches.open('birddex-audio');
    let res = await cache.match(src);
    if (!res) {
      res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error('audio fetch failed');
      await cache.put(src, res.clone());
    }
    return URL.createObjectURL(await res.blob());
  } catch (_) {
    return src; // stream directly
  }
}

// Pre-download every photo (and descriptions) for offline use in the field.
export async function downloadAll(onProgress) {
  await Promise.all([loadIndex(), loadExtras()]);
  let done = 0;
  const list = SPECIES.filter(s => photoFor(s.id) || galleryFor(s.id).length);
  for (const part of chunk(list, 4)) {
    await new Promise(r => setTimeout(r, 250));
    await Promise.all(part.map(async s => {
      try {
        await Promise.all([
          photoFor(s.id) && fetch(sized(s.id, 'small'), { mode: 'cors' }).catch(() => {}),
          photoFor(s.id) && fetch(sized(s.id, 'large'), { mode: 'cors' }).catch(() => {}),
          photoFor(s.id) && details(s),
          // Gallery photos can't go in Cache Storage (no CORS), but they're served with a one-year
          // cache lifetime, so fetching them once keeps them in the browser's own cache for offline use.
          ...galleryFor(s.id).slice(0, 4).map(g => fetch(g.src, { mode: 'no-cors' }).catch(() => {})),
        ]);
      } catch (_) {}
      done++;
      onProgress?.(done, list.length);
    }));
  }
}
