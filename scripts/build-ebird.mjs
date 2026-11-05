// Builds the offline eBird hotspot snapshot. The API token is loaded locally and is never logged or
// written out.
//
// Speed matters: Vercel caps a build at 45 minutes and eBird answers one hotspot species list in
// about 6-7 seconds, so only the top 150 hotspots by species get a baked list. Those lists are
// cached for seven days in node_modules/.cache/birdydex-ebird/lists/<locId>.json, which Vercel keeps
// between builds, so a warm build asks eBird only for the hotspot catalog, the regional recent and
// notable feeds and the taxonomy (~35 calls). Spots without a baked list use the live
// /api/ebird?list= route on their page.
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALL_BIRDS } from '../src/core/species.js';
import { PACKS } from '../src/regions/index.js';

const ROOT = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
/** Each region's snapshot is written to public/data/regions/<code>/ebird.json. */
export const outFor = (pack) => new URL(`public/data/regions/${pack.code}/ebird.json`, ROOT);
const BASE = 'https://api.ebird.org/v2/';
const USER_AGENT = 'BirdyDex build (seqbirding.com)';
/** A region pack's councils as full eBird region codes (AU-QLD-BRI…), in display order. */
export const councilCodes = (pack) => Object.keys(pack.ebird.councils).map((c) => `${pack.ebird.state}-${c}`);

/** How many hotspots per region get a baked species list. The rest fall back to the live list route. */
export const LIST_LIMIT = 150;
/** At most this many species-list requests may be in flight together. */
export const LIST_CONCURRENCY = 3;
/** Lists younger than this are reused, so most builds refetch none of them. */
export const LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const LIST_CACHE = join(ROOT_PATH, 'node_modules', '.cache', 'birdydex-ebird', 'lists');
const LEGACY_LIST_CACHE = join(ROOT_PATH, '.cache', 'ebird-lists');

// App scientific name -> eBird scientific name, only where the two taxonomies differ. Without these the birds drop out
// of every hotspot list, area list and sighting feed. The build logs any app bird still unmatched.
export const SCI_ALIASES = {
  'Ptilinopus magnificus': 'Megaloprepia magnifica', // Wompoo Fruit-Dove
  'Chrysococcyx lucidus': 'Chalcites lucidus', // Shining Bronze-Cuckoo
  'Hypotaenidia philippensis': 'Gallirallus philippensis', // Buff-banded Rail
  'Elseyornis melanops': 'Thinornis melanops', // Black-fronted Dotterel
  'Parvipsitta pusilla': 'Psitteuteles pusillus', // Little Lorikeet
  'Parvipsitta porphyrocephala': 'Psitteuteles porphyrocephalus', // Purple-crowned Lorikeet
  'Glossopsitta concinna': 'Trichoglossus concinnus', // Musk Lorikeet
  // eBird lumps Eastern Osprey into (Western) Osprey; every Australian osprey is the eastern one.
  'Pandion cristatus': 'Pandion haliaetus',
};

export function mapTaxonomy(taxonomy, birds = ALL_BIRDS, aliases = SCI_ALIASES) {
  const codeBySci = new Map(taxonomy.map((row) => [row.sciName, row.speciesCode]));
  const byCode = new Map();
  const unmatched = [];
  for (const bird of birds) {
    const code = codeBySci.get(aliases[bird.sci] ?? bird.sci);
    if (code) byCode.set(code, bird.id);
    else unmatched.push(bird);
  }
  return { byCode, unmatched };
}

const dateOnly = (value) => String(value ?? '').slice(0, 10);

export function snapshotIsCurrent(snapshot, now = new Date()) {
  return snapshot?.source === 'eBird' && String(snapshot.built).slice(0, 10) === now.toISOString().slice(0, 10);
}

// `regionLists` are council species lists keyed by council suffix (BRI); the snapshot's `regions` group them into the
// pack's areas (zones), keyed by zone. In SEQ each council is its own zone, so the two match.
export function compactSnapshot({ byCode, hotspots, lists, regionLists = {}, recent, notable, built, pack = PACKS.seq }) {
  const statePrefix = `${pack.ebird.state}-`;
  const deduped = new Map();
  for (const spot of hotspots) {
    if (spot.numSpeciesAllTime < 10) continue;
    deduped.set(spot.locId, [
      spot.locId,
      spot.locName,
      spot.lat,
      spot.lng,
      spot.numSpeciesAllTime,
      spot.numChecklistsAllTime,
      spot.latestObsDt,
      String(spot.subnational2Code ?? '').replace(statePrefix, ''),
    ]);
  }
  const spots = [...deduped.values()].sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1]));

  const compactLists = {};
  for (const [locId, codes] of Object.entries(lists)) {
    compactLists[locId] = [...new Set(codes.map((code) => byCode.get(code)).filter((id) => id != null))];
  }

  // An area's dex is the region's dex in that area, so only the pack's own species count (byCode covers the whole
  // catalogue; in SEQ the pack is the whole catalogue, so nothing is dropped).
  const inDex = (id) => id != null && pack.species[id] != null;
  const compactRegions = {};
  for (const [zone, { name, councils }] of Object.entries(pack.ebird.zones)) {
    const present = councils.filter((council) => regionLists[council]);
    if (!present.length) continue; // every council list for this area failed; leave the area out, as before
    const codes = present.flatMap((council) => regionLists[council]);
    compactRegions[zone] = {
      name,
      ids: [...new Set(codes.map((speciesCode) => byCode.get(speciesCode)).filter(inDex))],
    };
  }

  const latest = new Map();
  for (const obs of recent) {
    const id = byCode.get(obs.speciesCode);
    if (id == null) continue;
    const key = `${obs.locId}:${id}`;
    const previous = latest.get(key);
    if (!previous || String(obs.obsDt) > String(previous.obsDt)) latest.set(key, obs);
  }
  const compactRecent = {};
  for (const obs of latest.values()) {
    (compactRecent[obs.locId] ??= []).push([byCode.get(obs.speciesCode), dateOnly(obs.obsDt)]);
  }
  for (const rows of Object.values(compactRecent)) rows.sort((a, b) => b[1].localeCompare(a[1]) || a[0] - b[0]);

  // A hotspot near a region border comes back from both region feeds, so the same sighting can
  // arrive twice; keep the first.
  const notableBySighting = new Map();
  for (const obs of notable) {
    const id = byCode.get(obs.speciesCode);
    if (id == null) continue;
    notableBySighting.set(`${obs.locId}:${id}:${obs.obsDt}`, obs);
  }

  const compactNotable = [...notableBySighting.values()]
    .map((obs) => {
      const id = byCode.get(obs.speciesCode);
      return {
        id,
        name: obs.comName,
        loc: obs.locId,
        where: obs.locName,
        lat: obs.lat,
        lng: obs.lng,
        date: obs.obsDt,
        n: obs.howMany ?? 1,
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    built,
    source: 'eBird',
    spots,
    lists: compactLists,
    regions: compactRegions,
    recent: compactRecent,
    notable: compactNotable,
    codes: Object.fromEntries(byCode),
  };
}

async function loadLocalEnv() {
  try {
    const text = await readFile(new URL('.env.local', ROOT), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || process.env[match[1]] != null) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // A missing local env file simply means the ALA fallback is used.
  }
}

// ---------------------------------------------------------------------------
// Pacing, retries and the species-list cache
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const retryDelayMs = (attempt, retryAfter) => {
  const upstream = Number(retryAfter);
  return Math.max(5000 * 2 ** (attempt - 1), Number.isFinite(upstream) && upstream > 0 ? upstream * 1000 : 0);
};
export const REQUEST_GAP_MS = 400;

/**
 * A shared starter gate: every request asks for a turn, turns are handed out one at a time and the
 * next start is at least `gapMs` after the previous one, however many requests are in flight.
 */
export function createPacer(gapMs = REQUEST_GAP_MS, now = Date.now) {
  let lastStart = 0;
  let chain = Promise.resolve();
  return function pace() {
    const turn = chain.then(async () => {
      const wait = Math.max(0, gapMs - (now() - lastStart));
      if (wait) await sleep(wait);
      lastStart = now();
    });
    chain = turn.catch(() => {});
    return turn;
  };
}

const pace = createPacer();

async function ebird(path) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await pace();
    let retryAfter = null;
    try {
      const response = await fetch(new URL(path, BASE), {
        headers: {
          'X-eBirdApiToken': process.env.EBIRD_API_KEY,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) return await response.json();
      retryAfter = response.headers.get('retry-after');
      lastError = new Error(`eBird returned HTTP ${response.status} for ${path}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /eBird returned HTTP (?!429|5)\d+/.test(error.message)) throw error;
    }
    if (attempt < 3) await sleep(retryDelayMs(attempt, retryAfter));
  }
  throw lastError ?? new Error('eBird request failed');
}

/** True when a cache file written at `mtimeMs` is still inside the seven-day lifetime. */
export function cacheIsFresh(mtimeMs, now = Date.now(), ttlMs = LIST_TTL_MS) {
  return Number.isFinite(mtimeMs) && now - mtimeMs <= ttlMs;
}

/** The cached species codes for a hotspot, or null when missing, stale or unreadable. */
export async function readCachedList(dir, locId, now = Date.now(), ttlMs = LIST_TTL_MS) {
  const file = join(dir, `${locId}.json`);
  try {
    const info = await stat(file);
    if (!cacheIsFresh(info.mtimeMs, now, ttlMs)) return null;
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCachedList(dir, locId, list, mtimeMs) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${locId}.json`);
  await writeFile(file, JSON.stringify(list));
  // A caller may backdate the file (tests, migration); the build leaves the real mtime alone.
  if (mtimeMs != null) await utimes(file, new Date(mtimeMs), new Date(mtimeMs));
}

/**
 * Copies lists left by older builds (`.cache/ebird-lists/<date>/<locId>.json`) into the new cache,
 * keeping their age so the seven-day lifetime still applies. Returns how many were moved.
 */
export async function migrateLegacyLists(legacyRoot, dir, now = Date.now(), ttlMs = LIST_TTL_MS) {
  let folders;
  try {
    folders = await readdir(legacyRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  const newest = new Map();
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    let names;
    try {
      names = await readdir(join(legacyRoot, folder.name));
    } catch {
      continue;
    }
    for (const name of names) {
      const match = /^(L\d{1,10})\.json$/.exec(name);
      if (!match) continue;
      const from = join(legacyRoot, folder.name, name);
      const info = await stat(from).catch(() => null);
      if (!info) continue;
      const previous = newest.get(match[1]);
      if (!previous || info.mtimeMs > previous.mtimeMs) newest.set(match[1], { from, mtimeMs: info.mtimeMs });
    }
  }
  let moved = 0;
  for (const [locId, { from, mtimeMs }] of newest) {
    if (!cacheIsFresh(mtimeMs, now, ttlMs)) continue;
    const to = join(dir, `${locId}.json`);
    const existing = await stat(to).catch(() => null);
    // A second of slack covers mtime precision; lists are only refetched after days anyway.
    if (existing && existing.mtimeMs + 1000 >= mtimeMs) continue;
    try {
      const list = JSON.parse(await readFile(from, 'utf8'));
      if (!Array.isArray(list)) continue;
      await mkdir(dir, { recursive: true });
      await writeFile(to, JSON.stringify(list));
      await utimes(to, new Date(mtimeMs), new Date(mtimeMs));
      moved++;
    } catch {
      // A half-written list is simply fetched again.
    }
  }
  return moved;
}

/** Runs `worker` over `items`, at most `limit` at a time, keeping the result order. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function build() {
  await loadLocalEnv();
  if (!process.env.EBIRD_API_KEY) {
    console.log('eBird key not set; keeping the previous snapshots and using ALA spots.');
    return null;
  }
  const refresh = process.argv.includes('--refresh');
  const todo = [];
  for (const pack of Object.values(PACKS)) {
    if (!refresh) {
      try {
        const existing = JSON.parse(await readFile(outFor(pack), 'utf8'));
        if (snapshotIsCurrent(existing)) {
          console.log(`[${pack.code}] eBird snapshot was already built today; keeping it.`);
          continue;
        }
      } catch {
        // No usable local snapshot yet, so fetch one.
      }
    }
    todo.push(pack);
  }
  if (!todo.length) return null;

  const migrated = await migrateLegacyLists(LEGACY_LIST_CACHE, LIST_CACHE);
  if (migrated) console.log(`Moved ${migrated} cached species lists into node_modules/.cache/birdydex-ebird.`);

  // One taxonomy for every region, mapped against the whole catalogue so a shared bird keeps one id everywhere.
  const taxonomy = await ebird('ref/taxonomy/ebird?fmt=json&cat=species');
  const { byCode, unmatched } = mapTaxonomy(taxonomy);
  console.log(`Taxonomy: ${byCode.size} app birds matched`);
  console.log(`unmatched app birds: ${unmatched.length}${unmatched.length ? ` — ${unmatched.map((bird) => `${bird.name} (${bird.sci})`).join(', ')}` : ''}`);

  const built = {};
  for (const pack of todo) built[pack.code] = await buildRegion(pack, byCode);
  return built;
}

async function buildRegion(pack, byCode) {
  const startedAt = Date.now();
  const regions = councilCodes(pack);
  const statePrefix = `${pack.ebird.state}-`;
  const hotspots = [];
  for (const region of regions) {
    const rows = await ebird(`ref/hotspot/${region}?fmt=json`);
    hotspots.push(...rows);
  }

  const eligible = [...new Map(hotspots.map((spot) => [spot.locId, spot])).values()]
    .filter((spot) => spot.numSpeciesAllTime >= 10)
    .sort((a, b) => b.numSpeciesAllTime - a.numSpeciesAllTime);
  const picked = eligible.slice(0, LIST_LIMIT);
  const lists = {};
  let hits = 0;
  let misses = 0;
  let failed = 0;

  await pool(picked, LIST_CONCURRENCY, async (spot) => {
    const cached = await readCachedList(LIST_CACHE, spot.locId);
    if (cached) {
      hits++;
      lists[spot.locId] = cached;
      return;
    }
    try {
      const list = await ebird(`product/spplist/${spot.locId}`);
      if (!Array.isArray(list)) throw new Error('Species list was not an array');
      await writeCachedList(LIST_CACHE, spot.locId, list);
      misses++;
      lists[spot.locId] = list;
    } catch (error) {
      // One unhelpful hotspot must not lose the whole snapshot; its page falls back to the live list.
      failed++;
      console.warn(`Species list for ${spot.locId} skipped: ${error instanceof Error ? error.message : error}`);
    }
  });

  const regionLists = {};
  let regionListsFailed = 0;
  await pool(regions, LIST_CONCURRENCY, async (region) => {
    try {
      const codes = await ebird(`product/spplist/${region}`);
      if (!Array.isArray(codes)) throw new Error('Region species list was not an array');
      regionLists[region.replace(statePrefix, '')] = codes;
    } catch (error) {
      regionListsFailed++;
      console.warn(`Region list for ${region} skipped: ${error instanceof Error ? error.message : error}`);
    }
  });

  const recent = [];
  const notable = [];
  for (const region of regions) {
    recent.push(...await ebird(`data/obs/${region}/recent?back=30&hotspot=true`));
    notable.push(...await ebird(`data/obs/${region}/recent/notable?back=7&detail=simple`));
  }

  const snapshot = compactSnapshot({
    byCode,
    hotspots,
    lists,
    regionLists,
    recent,
    notable,
    built: new Date().toISOString(),
    pack,
  });
  const out = outFor(pack);
  await mkdir(new URL('./', out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot)}
`);

  const tag = `[${pack.code}]`;
  const recentCount = Object.values(snapshot.recent).reduce((sum, rows) => sum + rows.length, 0);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`${tag} Species lists: ${Object.keys(snapshot.lists).length} of ${picked.length} (${hits} cached, ${misses} fetched${failed ? `, ${failed} failed` : ''})`);
  console.log(`${tag} spots: ${snapshot.spots.length}`);
  console.log(`${tag} council lists: ${regions.length - regionListsFailed} of ${regions.length}${regionListsFailed ? `, ${regionListsFailed} failed` : ''}; areas: ${Object.keys(snapshot.regions).length}`);
  console.log(`${tag} recent: ${recentCount} species-days at ${Object.keys(snapshot.recent).length} spots`);
  console.log(`${tag} notable: ${snapshot.notable.length}`);
  console.log(`${tag} Wrote ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB to public/data/regions/${pack.code}/ebird.json`);
  console.log(`${tag} eBird step took ${seconds} s`);
  return snapshot;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  build().catch((error) => {
    console.error(`eBird snapshot stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
