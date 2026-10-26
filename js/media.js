// Photos, descriptions and calls from Wikipedia / Wikimedia Commons (openly licensed).
// Everything fetched is cached in IndexedDB so the dex works offline afterwards.
import { db } from './db.js';
import { SPECIES } from './species.js';

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

async function buildIndex() {
  const result = {};
  let todo = SPECIES.slice();
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
  if (!p) return null;
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

// Audio is fetched whole and kept in the cache so it plays offline later.
export async function audioUrl(src) {
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
// Failed requests are reported instead of being mistaken for a successful download.
export async function downloadAll(onProgress, { signal } = {}) {
  if (!navigator.onLine) throw new Error('Connect to the internet to download field media.');
  await loadIndex();
  signal?.throwIfAborted();
  let done = 0, failed = 0;
  const list = SPECIES.filter(s => photoFor(s.id));
  for (const part of chunk(list, 4)) {
    if (signal?.aborted) break;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 150);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }).catch(err => { if (err.name !== 'AbortError') throw err; });
    if (signal?.aborted) break;
    await Promise.all(part.map(async s => {
      let ok = true;
      const get = async url => {
        const res = await fetch(url, { mode: 'cors', signal });
        if (!res.ok) throw new Error(`Media returned ${res.status}`);
        // Reading the body ensures the service worker receives a complete response.
        await res.blob();
      };
      try {
        await Promise.all([get(sized(s.id, 'small')), get(sized(s.id, 'large')), details(s)]);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ok = false;
      }
      if (signal?.aborted) return;
      done++;
      if (!ok) failed++;
      onProgress?.(done, list.length, failed);
    }));
  }
  return { total: list.length, completed: done, failed, cancelled: !!signal?.aborted };
}
