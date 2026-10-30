// Bakes each SEQ hotspot's access facts from OpenStreetMap into public/data/spot-access.json.
//
// Run by hand, not by `npm run build`:
//   node scripts/build-spot-access.mjs
//
// The 220 hotspots in public/data/seq.json are sent to Overpass a batch at a time (each with a
// 400 m radius), with a pause between requests and a descriptive User-Agent. The raw answers are
// cached in the system temp folder, so a resumed run never asks twice for the same batch.
//
// The access score itself is a pure function, `scoreAccess`, so a vitest test can work it:
//   node scripts/build-spot-access.mjs --dry-run   (no network; prints a few sample scores)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SEQ = new URL('public/data/seq.json', ROOT);
const OUT = new URL('public/data/spot-access.json', ROOT);
const CACHE = join(tmpdir(), 'birdydex-spot-access');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'BirdyDex spot access build (one-off)';
const RADIUS_M = 400;
const BATCH = 12;           // 12 hotspots x 6 clauses per request: small enough for a busy Overpass
const PAUSE_MS = 5000;      // polite: one request every 5 s
const ATTEMPTS = 3;         // per endpoint, with exponential backoff (the server asks for it when at capacity)
const EARTH_M = 6371008.8;

// ---------------------------------------------------------------------------
// The scoring (pure; tested in src/__tests__/spotAccessBuild.test.ts)
// ---------------------------------------------------------------------------

/** A hotspot's summary before scoring. Counts are of OSM elements within 400 m. */
export function emptySummary() {
  return {
    elements: 0,
    parking: 0,
    nearestParkingM: null,
    toilets: 0,
    birdHides: 0,
    shelters: 0,
    picnicTables: 0,
    pavedPaths: 0,
    boardwalks: 0,
    wheelchair: { yes: 0, limited: 0 },
    access: { yes: 0, private: 0, no: 0 },
    fee: { yes: 0, no: 0 },
  };
}

/**
 * Access score 1–5 and a short reason list.
 *
 * One point for being on a known access record at all, then:
 *   parking            +1 if the nearest bay is within 250 m, +0.5 out to 400 m
 *   toilets            +1
 *   bird hide          +1
 *   paved path / boardwalk +1
 *   wheelchair=yes     +0.5 (limited earns the reason but no point)
 *   shelter / picnic   +0.25
 * The total is rounded and held to 1–5. A name saying "restricted access", or a private/no
 * access tag, caps it at 2 and adds a note.
 *
 * A hotspot with nothing tagged at all gets `null`: the app says "Access not known yet" and never
 * ranks it as if access were poor. That includes a place where every nearby tag was irrelevant,
 * because a score with no reason cannot be explained.
 */
export function scoreAccess(summary, name = '') {
  if (!summary || !summary.elements) return { score: null, reasons: [], note: null };

  const reasons = [];
  let points = 1;

  if (summary.parking > 0 && summary.nearestParkingM != null) {
    const metres = Math.max(1, Math.round(summary.nearestParkingM));
    reasons.push(`Parking ${metres} m`);
    points += summary.nearestParkingM <= 250 ? 1 : 0.5;
  }
  if (summary.toilets > 0) {
    reasons.push('Toilets');
    points += 1;
  }
  if (summary.birdHides > 0) {
    reasons.push('Bird hide');
    points += 1;
  }
  if (summary.pavedPaths > 0 || summary.boardwalks > 0) {
    if (summary.pavedPaths > 0 && summary.boardwalks > 0) reasons.push('Paved paths and boardwalk');
    else if (summary.boardwalks > 0) reasons.push('Boardwalk');
    else reasons.push('Paved paths');
    points += 1;
  }
  if (summary.wheelchair.yes > 0) {
    reasons.push('Wheelchair access');
    points += 0.5;
  } else if (summary.wheelchair.limited > 0) {
    reasons.push('Limited wheelchair access');
  }
  if (summary.shelters > 0 || summary.picnicTables > 0) {
    if (summary.shelters > 0 && summary.picnicTables > 0) reasons.push('Picnic tables and shelter');
    else if (summary.picnicTables > 0) reasons.push('Picnic tables');
    else reasons.push('Shelter');
    points += 0.25;
  }
  if (summary.fee.yes > 0) reasons.push('Entry fee');

  // A score with no reason would be a mystery; treat it as unknown.
  if (!reasons.length) return { score: null, reasons: [], note: null };

  let note = null;
  if (/restricted access/i.test(name)) {
    note = 'Restricted access';
    points = Math.min(points, 2);
  } else if (summary.access.private > 0 || summary.access.no > 0) {
    note = 'Some access is private or closed';
    points = Math.min(points, 2);
  }

  const score = Math.max(1, Math.min(5, Math.round(points)));
  return { score, reasons, note };
}

/** What the app stores for one hotspot: the summary's useful parts and the score. */
export function spotRecord(name, summary) {
  const { score, reasons, note } = scoreAccess(summary, name);
  return {
    name,
    score,
    reasons,
    note,
    parkingM: summary.elements && summary.parking ? Math.round(summary.nearestParkingM) : null,
    toilets: summary.toilets,
    birdHides: summary.birdHides,
    shelters: summary.shelters,
    picnicTables: summary.picnicTables,
    pavedPaths: summary.pavedPaths,
    boardwalks: summary.boardwalks,
    wheelchair: summary.wheelchair.yes ? 'yes' : summary.wheelchair.limited ? 'limited' : null,
    restricted: summary.access.private > 0 || summary.access.no > 0,
    fee: summary.fee.yes ? 'yes' : summary.fee.no ? 'no' : null,
  };
}

// ---------------------------------------------------------------------------
// Reading OSM answers
// ---------------------------------------------------------------------------

export function metresBetween(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PAVED = new Set(['paved', 'asphalt', 'concrete', 'compacted']);

/** Adds one Overpass element to a hotspot's summary if it is within the radius. */
export function addElement(summary, el, hLat, hLng) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return;
  const metres = metresBetween(hLat, hLng, lat, lng);
  if (metres > RADIUS_M + 5) return;
  const tags = el.tags || {};
  summary.elements += 1;

  if (tags.amenity === 'parking') {
    summary.parking += 1;
    if (summary.nearestParkingM == null || metres < summary.nearestParkingM) summary.nearestParkingM = metres;
  }
  if (tags.amenity === 'toilets') summary.toilets += 1;
  if (tags.leisure === 'bird_hide') summary.birdHides += 1;
  if (tags.amenity === 'shelter') summary.shelters += 1;
  if (tags.leisure === 'picnic_table') summary.picnicTables += 1;

  const isPath = tags.highway === 'footway' || tags.highway === 'path';
  if (isPath && PAVED.has(tags.surface)) summary.pavedPaths += 1;
  if (tags.bridge === 'boardwalk' || tags.boardwalk === 'yes' || tags.highway === 'boardwalk') summary.boardwalks += 1;

  if (tags.wheelchair === 'yes') summary.wheelchair.yes += 1;
  else if (tags.wheelchair === 'limited') summary.wheelchair.limited += 1;

  if (tags.access === 'yes') summary.access.yes += 1;
  else if (tags.access === 'private') summary.access.private += 1;
  else if (tags.access === 'no') summary.access.no += 1;

  if (tags.fee === 'yes') summary.fee.yes += 1;
  else if (tags.fee === 'no') summary.fee.no += 1;
}

/** The whole summary for one hotspot from a batch's elements. */
export function summarise(elements, hLat, hLng) {
  const summary = emptySummary();
  for (const el of elements) addElement(summary, el, hLat, hLng);
  return summary;
}

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queryFor(spots) {
  const clauses = [];
  for (const { lat, lng } of spots) {
    const at = `(around:${RADIUS_M},${lat},${lng})`;
    clauses.push(`nwr${at}["amenity"~"^(parking|toilets|shelter)$"];`);
    clauses.push(`nwr${at}["leisure"~"^(bird_hide|picnic_table)$"];`);
    clauses.push(`nwr${at}["highway"~"^(footway|path|boardwalk)$"];`);
    clauses.push(`nwr${at}["bridge"="boardwalk"];`);
    clauses.push(`nwr${at}["boardwalk"];`);
    clauses.push(`nwr${at}["wheelchair"];`);
  }
  return `[out:json][timeout:180];\n(\n  ${clauses.join('\n  ')}\n);\nout center tags;`;
}

async function fetchBatch(spots, index) {
  await mkdir(CACHE, { recursive: true });
  const cached = join(CACHE, `batch-${index}.json`);
  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    // no cached answer yet
  }

  const body = new URLSearchParams({ data: queryFor(spots) }).toString();
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      process.stdout.write(`  ${index + 1}: asking ${new URL(endpoint).host} (try ${attempt}) … `);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(240000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`not JSON: ${text.slice(0, 80)}`);
        }
        if (!Array.isArray(json.elements)) throw new Error('no elements');
        await writeFile(cached, JSON.stringify(json));
        console.log(`${json.elements.length} elements`);
        return json;
      } catch (error) {
        lastError = error;
        console.log(`failed (${error instanceof Error ? error.message : error})`);
        // The public servers ask for exponential backoff when they are at capacity.
        if (attempt < ATTEMPTS) await sleep(10000 * 3 ** (attempt - 1));
      }
    }
  }
  throw new Error(`Overpass is unreachable (both endpoints failed): ${lastError}`);
}

export async function build({ dryRun = false } = {}) {
  const seq = JSON.parse(await readFile(SEQ, 'utf8'));
  const spots = seq.hotspots || [];
  if (dryRun) {
    for (const [index, h] of spots.slice(0, 5).entries()) {
      const summary = summarise([], h.lat, h.lng);
      console.log(index, h.name, scoreAccess(summary, h.name));
    }
    return null;
  }

  const out = {};
  for (let start = 0; start < spots.length; start += BATCH) {
    const batch = spots.slice(start, start + BATCH);
    const index = Math.floor(start / BATCH);
    console.log(`Batch ${index + 1}/${Math.ceil(spots.length / BATCH)}: hotspots ${start}–${start + batch.length - 1}`);
    const json = await fetchBatch(batch, index);

    // Each element may fall within 400 m of several hotspots in the same batch.
    for (let i = 0; i < batch.length; i++) {
      const h = batch[i];
      out[start + i] = spotRecord(h.name, summarise(json.elements, h.lat, h.lng));
    }
    if (start + BATCH < spots.length) await sleep(PAUSE_MS);
  }

  const built = {
    built: new Date().toISOString(),
    source: 'OpenStreetMap via the Overpass API',
    license: '© OpenStreetMap contributors (ODbL)',
    radiusM: RADIUS_M,
    spots: out,
  };
  await writeFile(OUT, `${JSON.stringify(built, null, 1)}\n`);
  const known = Object.values(out).filter((s) => s.score != null).length;
  console.log(`Wrote ${Object.keys(out).length} spots (${known} with access known) to public/data/spot-access.json`);
  return built;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  build({ dryRun: process.argv.includes('--dry-run') }).catch((error) => {
    console.error(`\nStopped: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
