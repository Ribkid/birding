// node scripts/build-gallery.mjs [--dry-run] [--ids=1,2] [--all-missing] [--force]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const CACHE = join(fileURLToPath(ROOT), 'node_modules', '.cache', 'birdydex-ala');
const BIO = 'https://biocache-ws.ala.org.au/ws/occurrences/search';
const NM = 'https://api.ala.org.au/namematching/api';
const IMG = 'https://images.ala.org.au';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Same URL hashing, cache directory, retries and 150 ms spacing as build-rates.mjs.
function alaClient(dryRun) {
  let last = 0;
  async function request(url, accept) {
    const wait = last + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return fetch(url, { headers: { 'User-Agent': 'BirdyDex gallery build (one-off)', Accept: accept }, signal: AbortSignal.timeout(90000) });
  }
  async function get(url, params = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const one of [].concat(v)) q.append(k, one);
    const full = `${url}?${q}`;
    const file = join(CACHE, `${createHash('sha1').update(full).digest('hex')}.json`);
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await request(full, 'application/json');
        if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
        const data = await res.json();
        if (!dryRun) {
          await mkdir(CACHE, { recursive: true });
          await writeFile(file, JSON.stringify(data));
        }
        return data;
      } catch (error) {
        if (attempt === 3) throw new Error(`${full}: ${error.message}`, { cause: error });
        await sleep(2000 + attempt * 3000);
      }
    }
  }
  async function imageOK(src) {
    try {
      const res = await request(src, 'image/*');
      const ok = res.status === 200 && /^image\//i.test(res.headers.get('content-type') || '');
      await res.body?.cancel();
      return ok;
    } catch (error) { console.warn(`Image rejected: ${src}: ${error.message}`); return false; }
  }
  return { get, imageOK };
}

export function allowedLicense(value) {
  const s = String(value || '').trim();
  if (/^CC0(?:\s+1\.0)?$/i.test(s) || /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/i.test(s)) return 'CC0';
  const url = s.match(/^https?:\/\/creativecommons\.org\/licenses\/(by(?:-nc)?(?:-sa)?)\/(\d+\.\d+)\/?$/i);
  const text = s.match(/^CC[ -]+(BY(?:-NC)?(?:-SA)?)(?:\s+(\d+\.\d+))?$/i);
  const m = url || text;
  return m ? `CC ${m[1].toUpperCase()}${m[2] ? ` ${m[2]}` : ''}` : null;
}

export async function selectPhotos(occurrences, metadata, imageOK, photos = [], observers = new Set()) {
  for (const o of occurrences) {
    if (photos.length >= 5) break;
    const observer = (Array.isArray(o.recordedBy) ? o.recordedBy.join('; ') : o.recordedBy || '').trim();
    if (!o.uuid || !observer || observers.has(observer.toLowerCase())) continue;
    for (const id of o.images || (o.image ? [o.image] : [])) {
      const m = await metadata(id);
      const license = allowedLicense(m?.recognisedLicence?.acronym) || allowedLicense(m?.license);
      if (!license || !/^image\//i.test(m?.mimeType || '')) continue;
      const src = `${IMG}/image/proxyImageThumbnailLarge?imageId=${encodeURIComponent(id)}`;
      if (photos.some(p => p.src === src) || !await imageOK(src)) continue;
      photos.push({ src, thumb: `${IMG}/image/proxyImageThumbnail?imageId=${encodeURIComponent(id)}`, credit: m.creator?.trim() || observer,
        license, page: `https://biocache.ala.org.au/occurrences/${o.uuid}`, from: 'iNaturalist via ALA' });
      observers.add(observer.toLowerCase());
      break;
    }
  }
  return photos;
}

// Names iNaturalist records use that neither ALA nor eBird give us.
const RAW_NAMES = {
  'Ardea coromanda': ['Bubulcus coromandus', 'Ardea ibis'],
  'Tachyspiza fasciata': ['Accipiter fasciatus'],
  'Tachyspiza cirrocephala': ['Accipiter cirrocephalus'],
  'Parvipsitta pusilla': ['Glossopsitta pusilla'],
  'Parvipsitta porphyrocephala': ['Glossopsitta porphyrocephala'],
};

async function* resolve(bird, get, synonyms, known = []) {
  const valid = d => d?.success && d.classs === 'Aves' && ['species', 'subspecies'].includes(d.rank) && d.taxonConceptID;
  const seen = new Set();
  // The taxa the rates build already matched (regions/<code>/rates.json), which know ALA's current name.
  for (const lsid of known) if (lsid && !seen.has(lsid)) { seen.add(lsid); yield lsid; }
  for (const name of new Set([bird.sci, ...(synonyms[bird.sci] || []), bird.sci.split(' ').slice(0, 2).join(' ')])) {
    const scientific = await get(`${NM}/search`, { q: name });
    if (valid(scientific) && !seen.has(scientific.taxonConceptID)) {
      seen.add(scientific.taxonConceptID);
      yield scientific.taxonConceptID;
    }
  }
  const common = await get(`${NM}/searchByVernacularName`, { vernacularName: bird.name });
  if (valid(common) && !seen.has(common.taxonConceptID)) yield common.taxonConceptID;
}

async function photosFor(lsid, client, q = `lsid:"${lsid}"`) {
  const photos = [], observers = new Set();
  // Search Australia first, then the remainder. Each pass is newest first.
  for (const country of ['country:Australia', '-country:Australia']) {
    for (let start = 0; photos.length < 5;) {
      const data = await client.get(BIO, { q, fq: ['multimedia:Image', 'data_resource_uid:dr1411', country],
        pageSize: 100, start, sort: 'eventDate', dir: 'desc', facet: false });
      const occurrences = data.occurrences;
      if (!Array.isArray(occurrences) || !Number.isFinite(data.totalRecords)) throw new Error('Invalid ALA occurrence response');
      await selectPhotos(occurrences, id => client.get(`${IMG}/ws/image/${id}`), client.imageOK, photos, observers);
      start += occurrences.length;
      if (!occurrences.length || start >= data.totalRecords) break;
    }
  }
  return photos;
}

export function formatJSON(value, original) {
  const indent = original.match(/\r?\n([\t ]+)"/)?.[1];
  let out = JSON.stringify(value, null, indent);
  if (original.includes('\r\n')) out = out.replace(/\n/g, '\r\n');
  return out + (original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : '');
}

export async function build(args = process.argv.slice(2)) {
  for (const arg of args) if (!['--dry-run', '--all-missing', '--force'].includes(arg) && !arg.startsWith('--ids=')) throw new Error(`Unknown flag: ${arg}`);
  const dryRun = args.includes('--dry-run'), force = args.includes('--force');
  const idArg = args.find(a => a.startsWith('--ids='));
  if (force && !idArg) throw new Error('--force requires --ids= to bound replacements');
  if (idArg && !/^--ids=\d+(,\d+)*$/.test(idArg)) throw new Error('Expected --ids=1,2');
  const file = new URL('public/data/gallery.json', ROOT);
  const original = await readFile(file, 'utf8');
  const gallery = JSON.parse(original);
  const { ALL_BIRDS } = await import('../src/core/species.js');
  const { SYNONYMS } = await import('./build-rates.mjs');
  const { SCI_ALIASES } = await import('./build-ebird.mjs');
  const ids = idArg ? new Set(idArg.slice(6).split(',').map(Number)) : null;
  if (ids) for (const id of ids) if (!ALL_BIRDS.some(b => b.id === id)) throw new Error(`Unknown catalogue id: ${id}`);
  const birds = ALL_BIRDS.filter(b => (!ids || ids.has(b.id)) && (force || !Object.hasOwn(gallery, b.id)));
  console.log(`${dryRun ? 'DRY RUN' : 'BUILD'}: ${birds.length} ids selected: ${birds.map(b => `${b.id} ${b.name}`).join(', ') || 'none'}`);
  const known = new Map();
  for (const code of ['seq', 'melb']) {
    try {
      const rates = JSON.parse(await readFile(new URL(`public/data/regions/${code}/rates.json`, ROOT), 'utf8'));
      for (const [id, sp] of Object.entries(rates.species || {})) if (sp.lsid) known.set(Number(id), [...(known.get(Number(id)) || []), sp.lsid]);
    } catch { /* no rates for that region */ }
  }
  const client = alaClient(dryRun), done = [], none = [], errors = [];
  for (const bird of birds) {
    try {
      let photos = [], matched = false;
      for await (const lsid of resolve(bird, client.get, SYNONYMS, known.get(bird.id))) {
        matched = true;
        photos = await photosFor(lsid, client);
        if (photos.length) break;
      }
      // iNaturalist's newer names (Trichoglossus concinnus, Tachyspiza fasciata…) are matched by ALA only to the
      // genus, so look the records up by the name the observer used: ours, its synonyms, and eBird's.
      for (const name of photos.length ? [] : new Set([bird.sci, ...(SYNONYMS[bird.sci] || []), SCI_ALIASES[bird.sci], ...(RAW_NAMES[bird.sci] || [])].filter(Boolean))) {
        photos = await photosFor(null, client, `raw_scientificName:"${name}"`);
        if (photos.length) { matched = true; break; }
      }
      console.log(`${bird.id} ${bird.name}: ${photos.length} photos${matched ? '' : ' (no species/subspecies match)'}`);
      if (!photos.length) { none.push(bird.id); continue; }
      gallery[bird.id] = photos;
      done.push(bird.id);
    } catch (error) { errors.push(bird.id); console.error(`${bird.id} ${bird.name}: ${error.message}`); }
  }
  if (!dryRun && done.length) await writeFile(file, formatJSON(gallery, original));
  console.log(`Ids done (${done.length}): ${done.map(id => `${id}=${gallery[id].length}`).join(', ') || 'none'}`);
  console.log(`Ids with none (${none.length}): ${none.join(', ') || 'none'}`);
  console.log(`Ids failed (${errors.length}): ${errors.join(', ') || 'none'}; ${dryRun ? 'no files written' : 'gallery updated'}`);
  if (errors.length) process.exitCode = 1;
  return { done, none, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().catch(error => { console.error(`Stopped: ${error.message}`); process.exitCode = 1; });
