// Builds a region's Atlas of Living Australia data: public/data/regions/<code>/rates.json.
// This is legacy/scripts/build_ala.py (which built SEQ's file) ported to Node and parametrised by region pack, so a
// new region needs no Python. Birds only: SEQ's other kinds came from a later one-off script.
//
// Run by hand, not by `npm run build` (it makes ~1,000 ALA requests; answers are cached, so a rerun is quick):
//   node scripts/build-rates.mjs --region=melb
//   node scripts/build-rates.mjs --region=melb --dry-run   (no network; checks the pack and the name list)
// Build the region's eBird snapshot first (node scripts/build-ebird.mjs): its hotspots mark which record squares are
// inside the region's councils.
//
// What it writes, per bird in the pack: the ALA name and LSID it used, records since 2016 in the pack's box (n), records
// per month (m), the 40 busiest 0.01° squares (pts) and up to 3 openly licensed call clips (calls). Plus all-bird
// records per month (effort, for reporting rates) and up to 220 named hotspots: the squares richest in the pack's
// birds. It also prints the rarity band each bird's record count falls in, for the pack's `species` map.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALL_BIRDS } from '../src/core/species.js';
import { PACKS } from '../src/regions/index.js';

const ROOT = new URL('../', import.meta.url);
const CACHE = join(fileURLToPath(ROOT), 'node_modules', '.cache', 'birdydex-ala');
const BIO = 'https://biocache-ws.ala.org.au/ws/occurrences/search';
const NM = 'https://api.ala.org.au/namematching/api';
const IMG = 'https://images.ala.org.au';
const YEARS = 'year:[2016 TO *]';
const USER_AGENT = 'BirdyDex rates build (one-off)';
const GAP_MS = 150;

// Older or alternative scientific names ALA may file a bird under (from build_ala.py, plus the Melbourne ones).
export const SYNONYMS = {
  'Synoicus ypsilophorus': ['Coturnix ypsilophora'],
  'Chalcophaps longirostris': ['Chalcophaps indica'],
  'Hypotaenidia philippensis': ['Gallirallus philippensis'],
  'Himantopus leucocephalus': ['Himantopus himantopus'],
  'Anarhynchus ruficapillus': ['Charadrius ruficapillus'],
  'Ardea coromanda': ['Bubulcus coromandus', 'Ardea ibis', 'Bubulcus ibis'],
  'Ardea intermedia': ['Ardea plumifera', 'Egretta intermedia'],
  'Pandion cristatus': ['Pandion haliaetus'],
  'Tachyspiza fasciata': ['Accipiter fasciatus'],
  'Tachyspiza novaehollandiae': ['Accipiter novaehollandiae'],
  'Tachyspiza cirrocephala': ['Accipiter cirrocephalus'],
  'Icthyophaga leucogaster': ['Haliaeetus leucogaster'],
  'Tyto javanica': ['Tyto alba', 'Tyto delicatula'],
  'Todiramphus sordidus': ['Todiramphus chloris'],
  'Zanda funerea': ['Calyptorhynchus funereus'],
  'Parvipsitta pusilla': ['Glossopsitta pusilla'],
  'Caligavis chrysops': ['Lichenostomus chrysops'],
  'Gavicalis fasciogularis': ['Lichenostomus fasciogularis'],
  'Symposiachrus trivirgatus': ['Monarcha trivirgatus'],
  'Cincloramphus timoriensis': ['Megalurus timoriensis'],
  'Stizoptera bichenovii': ['Taeniopygia bichenovii'],
  'Spilopelia chinensis': ['Streptopelia chinensis'],
  'Cyclopsitta diophthalma': ['Opopsitta diophthalma'],
  'Chrysococcyx lucidus': ['Chalcites lucidus'],
  'Microcarbo melanoleucos': ['Phalacrocorax melanoleucos'],
  'Thalasseus bergii': ['Sterna bergii'],
  'Hydroprogne caspia': ['Sterna caspia'],
  'Chroicocephalus novaehollandiae': ['Larus novaehollandiae'],
  'Eudynamys orientalis': ['Eudynamys scolopaceus'],
  'Ninox boobook': ['Ninox novaeseelandiae'],
  'Petrochelidon ariel': ['Hirundo ariel'],
  'Petrochelidon nigricans': ['Hirundo nigricans'],
  'Acrocephalus australis': ['Acrocephalus stentoreus'],
  'Rhipidura albiscapa': ['Rhipidura fuliginosa'],
  'Porphyrio melanotus': ['Porphyrio porphyrio'],
  'Elseyornis melanops': ['Charadrius melanops', 'Thinornis melanops'],
};

/** SEQ's banding of records since 2016, used for every region: 1 common … 5 rare. */
export function rarityBand(n) {
  if (n >= 40000) return 1;
  if (n >= 15000) return 2;
  if (n >= 4000) return 3;
  if (n >= 800) return 4;
  return 5;
}

const PRIVATE = /^\d|^AU-|house|home|yard|residence|property|my |our |street|st\.? ?$|\d+ [a-z]+ (st|rd|ct|ave)/i;
/** Whether an ALA locality string can name a public place. */
export const usable = (l) => Boolean(l) && !['not supplied', 'unknown'].includes(l.toLowerCase()) && !PRIVATE.test(l) && l.length > 3;

/** Tidies an ALA locality string into a place name. */
export function clean(s) {
  return s
    .replace(/\s+/g, ' ').trim()
    .replace(/,?\s*AU-[A-Z]{2,3}\b.*$/, '')
    .replace(/\s*-?\d{2}\.\d+,\s*\d{3}\.\d+.*$/, '')
    .replace(/\s*--\s*/g, ': ')
    .replace(/\s+(at|near|off)$/i, '')
    .replace(/\s*\((?:general area|general)\)\s*$/i, '')
    .slice(0, 80);
}

const EARTH_KM = 6371.0088;
const kmBetween = (aLat, aLng, bLat, bLng) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Whether a point is in the region's councils, judged by its eBird hotspots: within `km` of one. The records box is a
 * rectangle, so on its own it takes in places outside the region (Melbourne's box reaches Ballarat). `spots` are
 * [lat, lng] pairs; with none, every point counts.
 */
export function nearSpots(spots, km = 3) {
  if (!spots.length) return () => true;
  const cell = 0.05;
  const grid = new Map();
  const key = (lat, lng) => `${Math.floor(lat / cell)},${Math.floor(lng / cell)}`;
  for (const [lat, lng] of spots) {
    const k = key(lat, lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([lat, lng]);
  }
  return (lat, lng) => {
    const [a, b] = key(lat, lng).split(',').map(Number);
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        for (const [sLat, sLng] of grid.get(`${i},${j}`) || []) if (kmBetween(lat, lng, sLat, sLng) <= km) return true;
      }
    }
    return false;
  };
}

/** Squares richest in the region's birds, named, with same-named neighbours merged. `named` is [label, name|null]. */
export function mergeHotspots(cells, named, keep = 220) {
  const merged = [];
  for (const [label, name] of named) {
    const [lat, lng] = label.split(',').map(Number);
    const sp = cells.get(label);
    const twin = name && merged.find((m) => m.name === name && Math.abs(m.lat - lat) <= 0.025 && Math.abs(m.lng - lng) <= 0.025);
    if (twin) {
      for (const [id, c] of sp) twin.sp.set(id, (twin.sp.get(id) || 0) + c);
    } else {
      merged.push({ name, lat, lng, sp: new Map(sp) });
    }
  }
  return merged
    .filter((h) => h.name)
    .slice(0, keep)
    .map((h) => ({
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      rich: h.sp.size,
      sp: [...h.sp].sort((a, b) => b[1] - a[1]).map(([id, c]) => [Number(id), c]),
    }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthVec = (pairs = []) => { const m = new Map(pairs); return MONTHS.map((x) => m.get(x) || 0); };
const AUDIO_PREF = { 'audio/mpeg': 0, 'audio/mp3': 0, 'audio/mp4': 1, 'audio/x-m4a': 1, 'audio/aac': 1, 'audio/ogg': 2, 'audio/vnd.wave': 3, 'audio/wav': 3, 'audio/x-wav': 3 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let last = 0;

async function get(url, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of [].concat(v)) q.append(k, one);
  const full = `${url}?${q}`;
  const file = join(CACHE, `${createHash('sha1').update(full).digest('hex')}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // not cached yet
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(full, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, JSON.stringify(data));
      return data;
    } catch (error) {
      if (attempt === 3) throw new Error(`${full}: ${error instanceof Error ? error.message : error}`);
      await sleep(2000 + attempt * 3000);
    }
  }
  return null;
}

function regionQuery(pack) {
  const [south, west, north, east] = pack.map.bbox;
  const box = [`decimalLatitude:[${south} TO ${north}]`, `decimalLongitude:[${west} TO ${east}]`, YEARS];
  async function facets(q, { extra = [], fields = ['point-0.01', 'month'], flimit = 1000 } = {}) {
    const d = await get(BIO, { q, fq: [...box, ...extra], pageSize: 0, facets: fields, flimit });
    const out = {};
    for (const f of d?.facetResults || []) out[f.fieldName] = f.fieldResult.map((x) => [x.label, x.count]);
    return { total: d?.totalRecords || 0, out };
  }
  return facets;
}

/** Whether an ALA name match is one bird (a species or subspecies), not a genus, family or order. */
export const isBirdTaxon = (match) => ['species', 'subspecies'].includes(match?.rank);

/** Every ALA taxon the bird might be filed under; keeps the one with the most records in the region. */
async function resolve(bird, facets) {
  const found = new Map();
  const names = [bird.sci, ...(SYNONYMS[bird.sci] || []), bird.sci.split(' ').slice(0, 2).join(' ')];
  const add = (d) => {
    // Only a species or subspecies: a common-name search can answer with a whole order ("Magpie Goose" gives
    // ANSERIFORMES), whose records would swamp the bird's own. build_ala.py let that through for SEQ.
    if (!d?.success || d.classs !== 'Aves' || !isBirdTaxon(d)) return;
    found.set(d.taxonConceptID, d);
    if (d.rank === 'subspecies' && d.speciesID) found.set(d.speciesID, { scientificName: d.species || d.scientificName });
  };
  for (const cand of new Set(names)) add(await get(`${NM}/search`, { q: cand }));
  add(await get(`${NM}/searchByVernacularName`, { vernacularName: bird.name }));
  let best = null;
  for (const [lsid, d] of found) {
    const { total } = await facets(`lsid:"${lsid}"`, { fields: ['month'], flimit: 1 });
    if (!best || total > best.total) best = { total, lsid, name: d.scientificName };
  }
  if (best && !best.name) {
    const d = await get(`${NM}/search`, { q: best.lsid });
    best.name = d?.scientificName || bird.sci;
  }
  // ALA writes subgenera in: "Ninox (Ninox) boobook" -> "Ninox boobook".
  if (best) best.name = best.name.replace(/ \([^)]*\)/g, '');
  return best;
}

/** Openly licensed recordings attached to ALA records, Australia-wide (as build_ala.py's sounds()). */
async function sounds(lsid, want = 3) {
  const d = await get(BIO, { q: `lsid:"${lsid}"`, fq: 'multimedia:Sound', pageSize: 25, sort: 'eventDate', dir: 'desc' });
  const cands = [];
  for (const o of d?.occurrences || []) {
    for (const sid of (o.sounds || []).slice(0, 1)) {
      const m = await get(`${IMG}/ws/image/${sid}`);
      const lic = m?.recognisedLicence?.acronym;
      const mime = m?.mimeType || '';
      if (!lic || !(mime in AUDIO_PREF)) continue;
      cands.push({ src: `${IMG}/image/proxyImage?imageId=${sid}`, mime, artist: m.creator || 'Unknown', license: lic,
        page: `https://biocache.ala.org.au/occurrences/${o.uuid}`, from: o.dataResourceName || 'Atlas of Living Australia' });
    }
    if (cands.filter((c) => AUDIO_PREF[c.mime] < 3).length >= want) break;
  }
  return cands.sort((a, b) => AUDIO_PREF[a.mime] - AUDIO_PREF[b.mime]).slice(0, want);
}

async function readJson(url) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; }
}

export async function build({ region, dryRun = false }) {
  const pack = PACKS[region];
  if (!pack) throw new Error(`No region pack "${region}" (have: ${Object.keys(PACKS).join(', ')})`);
  const byId = new Map(ALL_BIRDS.map((b) => [b.id, b]));
  const birds = Object.keys(pack.species).map(Number).map((id) => byId.get(id)).filter(Boolean);
  console.log(`[${region}] ${birds.length} birds, box ${pack.map.bbox.join(', ')}`);
  if (dryRun) return null;

  // Call clips are Australia-wide, so a bird matched to the same taxon in another region's file keeps its clips.
  const known = new Map();
  for (const other of Object.values(PACKS)) {
    if (other.code === region) continue;
    const rates = await readJson(new URL(`public/data/regions/${other.code}/rates.json`, ROOT));
    for (const [id, sp] of Object.entries(rates?.species || {})) if (!known.has(Number(id))) known.set(Number(id), sp);
  }

  // The region's own eBird hotspots (scripts/build-ebird.mjs), to keep places and points inside its councils.
  const snapshot = await readJson(new URL(`public/data/regions/${region}/ebird.json`, ROOT));
  if (!snapshot?.spots?.length) console.warn(`[${region}] no eBird snapshot: places outside the councils are kept. Run scripts/build-ebird.mjs first.`);
  const inRegion = nearSpots((snapshot?.spots || []).map(([, , lat, lng]) => [lat, lng]));

  const facets = regionQuery(pack);
  const { total: avesTotal, out: af } = await facets('class:Aves', { fields: ['month'], flimit: 20 });
  console.log(`[${region}] all bird records since 2016: ${avesTotal.toLocaleString()}`);

  const cells = new Map(); // "lat,lng" -> Map(id -> count)
  const species = {};
  const unresolved = [];
  for (const bird of birds) {
    const prior = known.get(bird.id);
    const best = await resolve(bird, facets);
    if (!best) { unresolved.push(bird.name); continue; }
    const { total, out } = await facets(`lsid:"${best.lsid}"`);
    const pts = (out['point-0.01'] || []).filter(([label]) => inRegion(...label.split(',').map(Number)));
    for (const [label, c] of pts) {
      if (!cells.has(label)) cells.set(label, new Map());
      cells.get(label).set(bird.id, c);
    }
    species[bird.id] = {
      ala: best.name,
      lsid: best.lsid,
      n: total,
      m: monthVec(out.month),
      pts: pts.slice(0, 40).map(([l, c]) => { const [a, b] = l.split(',').map(Number); return [a, b, c]; }),
      calls: prior?.lsid === best.lsid && prior.calls?.length ? prior.calls : await sounds(best.lsid),
    };
    console.log(`${String(bird.id).padStart(3)} ${bird.name.padEnd(32)} ${best.name.padEnd(36)} ${String(total).padStart(7)}`);
  }

  const ranked = [...cells].sort((a, b) => b[1].size - a[1].size || [...b[1].values()].reduce((s, c) => s + c, 0) - [...a[1].values()].reduce((s, c) => s + c, 0));
  const named = [];
  for (const [label] of ranked.slice(0, 320)) {
    const { out } = await facets('class:Aves', { extra: [`point-0.01:"${label}"`], fields: ['locality'], flimit: 6 });
    const locs = (out.locality || []).map(([l]) => l).filter(usable).map(clean);
    named.push([label, locs[0] || null]);
  }
  const hotspots = mergeHotspots(cells, named);

  const out = {
    built: new Date().toISOString().slice(0, 10),
    years: '2016–present',
    source: 'Atlas of Living Australia occurrence records (includes eBird and BirdLife Australia Birdata)',
    effort: monthVec(af.month),
    species,
    hotspots,
  };
  const file = new URL(`public/data/regions/${region}/rates.json`, ROOT);
  await mkdir(new URL('./', file), { recursive: true });
  await writeFile(file, JSON.stringify(out));
  console.log(`[${region}] unresolved: ${unresolved.length ? unresolved.join(', ') : 'none'}`);
  console.log(`[${region}] hotspots: ${hotspots.length}`);
  console.log(`[${region}] wrote ${(JSON.stringify(out).length / 1024).toFixed(0)} KB to public/data/regions/${region}/rates.json`);
  console.log(`[${region}] rarity bands from these counts (id: band):`);
  console.log(Object.entries(species).map(([id, sp]) => `${id}: ${rarityBand(sp.n)}`).join(', '));
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const region = process.argv.find((a) => a.startsWith('--region='))?.slice('--region='.length);
  if (!region) {
    console.error('Usage: node scripts/build-rates.mjs --region=<code> [--dry-run]');
    process.exitCode = 1;
  } else {
    build({ region, dryRun: process.argv.includes('--dry-run') }).catch((error) => {
      console.error(`Stopped: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
  }
}
