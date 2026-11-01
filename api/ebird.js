const BASE = 'https://api.ebird.org/v2/';
const LOC_ID = /^L\d{1,10}$/;
const SPECIES_CODE = /^[a-z0-9]{4,8}$/;
const SUB_ID = /^S\d{4,12}$/;
// Keep each upstream request short: a stalled eBird call is "not available right now", never a held-open screen.
export const TIMEOUT_MS = 8000;

const SEQ_REGIONS = [
  'AU-QLD-BRI', 'AU-QLD-GOL', 'AU-QLD-IPS', 'AU-QLD-LOV', 'AU-QLD-LOG', 'AU-QLD-MRB',
  'AU-QLD-RED', 'AU-QLD-SCE', 'AU-QLD-SOM', 'AU-QLD-SUN', 'AU-QLD-TOO',
];
const REGIONS = new Set(['AU-QLD', ...SEQ_REGIONS]);
const CACHE = {
  recent: 's-maxage=3600, stale-while-revalidate=86400',
  list: 's-maxage=3600, stale-while-revalidate=86400',
  nearest: 's-maxage=600, stale-while-revalidate=86400',
  species: 's-maxage=1800, stale-while-revalidate=86400',
  near: 's-maxage=600, stale-while-revalidate=86400',
  notable: 's-maxage=600, stale-while-revalidate=86400',
  visits: 's-maxage=900, stale-while-revalidate=86400',
  checklist: 's-maxage=3600, stale-while-revalidate=86400',
  stats: 's-maxage=600, stale-while-revalidate=86400',
  historic: 's-maxage=3600, stale-while-revalidate=86400',
  top: 's-maxage=900, stale-while-revalidate=86400',
};
const ROUTES = Object.keys(CACHE);

class BadRequest extends Error {}

const has = (query, key) => Object.prototype.hasOwnProperty.call(query, key);
const text = (value) => (typeof value === 'string' ? value : null);

function requireLocId(value) {
  const id = text(value);
  if (!id || !LOC_ID.test(id)) throw new BadRequest('Invalid hotspot id');
  return id;
}

function requireSpeciesCode(value) {
  const code = text(value);
  if (!code || !SPECIES_CODE.test(code)) throw new BadRequest('Invalid species code');
  return code;
}

function requireSubId(value) {
  const sub = text(value);
  if (!sub || !SUB_ID.test(sub)) throw new BadRequest('Invalid checklist id');
  return sub;
}

/** A real calendar date from 2000 through today in Brisbane (the app's birding day). */
function requireDate(value) {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequest('Invalid date');
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) throw new BadRequest('Invalid date');
  const utcToday = new Date().toISOString().slice(0, 10);
  const brisbaneToday = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const latest = brisbaneToday > utcToday ? brisbaneToday : utcToday;
  if (raw < '2000-01-01' || raw > latest) throw new BadRequest('Invalid date');
  return raw;
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function requireRegion(value) {
  const region = text(value);
  if (!region || !REGIONS.has(region)) throw new BadRequest('Invalid region');
  return region;
}

function numberInRange(value, min, max) {
  const raw = text(value);
  if (raw == null || raw.trim() === '') throw new BadRequest('Invalid number');
  const number = Number(raw);
  if (!Number.isFinite(number) || number < min || number > max) throw new BadRequest('Invalid number');
  return number;
}

/** Her rough coordinates must stay inside the SEQ box. */
function requireSeqPoint(query) {
  const lat = numberInRange(query.lat, -29.2, -25.8);
  const lng = numberInRange(query.lng, 151.0, 153.6);
  return { lat, lng };
}

function requiredInteger(value, min, max) {
  const raw = text(value);
  if (raw == null || !/^\d+$/.test(raw)) throw new BadRequest('Invalid number');
  const number = Number(raw);
  if (number < min || number > max) throw new BadRequest('Invalid number');
  return number;
}

const toRad = (degrees) => degrees * Math.PI / 180;
function distanceKm(a, b) {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

async function ebirdJson(path) {
  const response = await fetch(new URL(path, BASE), {
    headers: { 'X-eBirdApiToken': process.env.EBIRD_API_KEY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Upstream request failed');
  return response.json();
}

async function ebirdArray(path) {
  const data = await ebirdJson(path);
  if (!Array.isArray(data)) throw new Error('Unexpected eBird response');
  return data;
}

/** One observation in the compact shape every round-2 route shares. Missing core fields are an upstream failure. */
function observation(row) {
  if (!row || typeof row !== 'object' || !row.speciesCode || !row.comName || !row.obsDt) {
    throw new Error('Unexpected eBird observation');
  }
  return {
    code: String(row.speciesCode),
    sci: String(row.sciName ?? ''),
    name: String(row.comName),
    loc: String(row.locId ?? ''),
    where: String(row.locName ?? ''),
    lat: Number(row.lat),
    lng: Number(row.lng),
    date: String(row.obsDt),
    n: Number(row.howMany ?? 1),
    sub: row.subId == null ? null : String(row.subId),
  };
}

function uniqueNewest(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const item = observation(row);
    const key = `${item.code}:${item.loc}:${item.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.loc.localeCompare(b.loc));
}

async function recentOrList(query, route) {
  const locId = requireLocId(query[route]);
  if (route === 'recent') {
    const data = await ebirdArray(`data/obs/${locId}/recent?back=30`);
    return data.map((row) => {
      if (!row || typeof row !== 'object' || !row.speciesCode || !row.comName || !row.obsDt) {
        throw new Error('Unexpected eBird observation');
      }
      return {
        code: String(row.speciesCode),
        sci: String(row.sciName ?? ''),
        name: String(row.comName),
        date: String(row.obsDt),
        n: Number(row.howMany ?? 1),
      };
    });
  }
  return ebirdArray(`product/spplist/${locId}`);
}

async function nearbyObservations(query, notable = false) {
  const point = requireSeqPoint(query);
  const dist = requiredInteger(query.dist, 1, 50);
  const back = requiredInteger(query.back, 1, 30);
  const params = new URLSearchParams({
    lat: String(point.lat),
    lng: String(point.lng),
    dist: String(dist),
    back: String(back),
    hotspot: 'false',
    maxResults: notable ? '100' : '200',
  });
  const path = notable ? 'data/obs/geo/recent/notable' : 'data/obs/geo/recent';
  const data = await ebirdArray(`${path}?${params.toString()}`);
  return data.map((row) => {
    const item = observation(row);
    const away = distanceKm(point, item);
    return { ...item, distanceKm: Number.isFinite(away) ? Number(away.toFixed(2)) : null };
  }).filter((item) => item.distanceKm != null)
    .sort((a, b) => a.distanceKm - b.distanceKm || b.date.localeCompare(a.date));
}

async function near(query) {
  return nearbyObservations(query);
}

async function notable(query) {
  return nearbyObservations(query, true);
}

function dateAndTime(value, time) {
  const stamp = String(value ?? '');
  const [date, embedded] = stamp.split(/\s+/);
  if (!date) throw new Error('Unexpected eBird date');
  return { date, time: String(time ?? embedded ?? '') };
}

async function visits(query) {
  const locId = requireLocId(query.loc);
  const data = await ebirdArray(`product/lists/${locId}?maxResults=10`);
  return data.map((row) => {
    if (!row || typeof row !== 'object' || !row.subId) throw new Error('Unexpected eBird checklist');
    const { date, time } = dateAndTime(row.obsDt, row.obsTime);
    const species = Number(row.numSpecies);
    if (!Number.isFinite(species)) throw new Error('Unexpected eBird checklist count');
    return { sub: String(row.subId), date, time, species };
  });
}

async function checklist(query) {
  const sub = requireSubId(query.sub);
  const data = await ebirdJson(`product/checklist/view/${sub}`);
  if (!data || typeof data !== 'object' || !Array.isArray(data.obs)) {
    throw new Error('Unexpected eBird checklist');
  }
  const { date, time } = dateAndTime(data.obsDt ?? data.creationDt, data.obsTime);
  const species = data.obs.map((row) => {
    if (!row || typeof row !== 'object' || !row.speciesCode) throw new Error('Unexpected eBird observation');
    const raw = row.howManyStr ?? row.howMany ?? row.howManyAtleast ?? 1;
    const n = Number(raw);
    return {
      code: String(row.speciesCode),
      name: String(row.comName ?? row.speciesCode),
      n: Number.isFinite(n) ? n : 1,
    };
  });
  return { sub, date, time, loc: String(data.locId ?? ''), species };
}

async function stats(query) {
  const date = requireDate(query.date);
  const [year, month, day] = date.split('-').map(Number);
  const data = await ebirdJson(`product/stats/AU-QLD/${year}/${month}/${day}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected eBird stats');
  const checklists = finiteCount(data.numChecklists ?? data.checklists);
  const birders = finiteCount(data.numContributors ?? data.contributors ?? data.numBirders);
  const species = finiteCount(data.numSpecies ?? data.spp ?? data.species);
  if (checklists == null && birders == null && species == null) throw new Error('Unexpected eBird stats');
  return { date, checklists: checklists ?? 0, birders: birders ?? 0, species: species ?? 0 };
}

async function historic(query) {
  const region = requireRegion(query.region);
  const date = requireDate(query.date);
  const [year, month, day] = date.split('-').map(Number);
  const data = await ebirdArray(`data/obs/${region}/historic/${year}/${month}/${day}?rank=mrec&detail=simple`);
  return {
    region: region.replace(/^AU-QLD-/, ''),
    date,
    sightings: data.map(observation),
  };
}

async function top(query) {
  const region = requireRegion(query.region);
  const date = requireDate(query.date);
  const [year, month, day] = date.split('-').map(Number);
  const data = await ebirdArray(`product/top100/${region}/${year}/${month}/${day}?rankedBy=spp&maxResults=10`);
  return data.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.userDisplayName !== 'string' || !row.userDisplayName.trim()) {
      throw new Error('Unexpected eBird leader');
    }
    const species = finiteCount(row.numSpecies);
    if (species == null) throw new Error('Unexpected eBird leader count');
    return {
      name: row.userDisplayName,
      species,
      checklists: finiteCount(row.numChecklists) ?? 0,
    };
  });
}

async function nearest(query) {
  const code = requireSpeciesCode(query.sp);
  const { lat, lng } = requireSeqPoint(query);
  const data = await ebirdArray(`data/nearest/geo/recent/${code}?lat=${lat}&lng=${lng}&back=30&maxResults=5`);
  return data.map(observation);
}

async function species(query) {
  const code = requireSpeciesCode(query.sp);
  // The function runs at the edge in parallel; each request still owns the same eight-second cap.
  const feeds = await Promise.all(SEQ_REGIONS.map((region) =>
    ebirdArray(`data/obs/${region}/recent/${code}?back=30`),
  ));
  const sightings = uniqueNewest(feeds.flat());
  return { total: sightings.length, sightings };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const query = req.query ?? {};
  const selected = ROUTES.filter((route) => has(query, route));
  if (selected.length !== 1) return res.status(400).json({ error: 'Choose one eBird query' });
  const route = selected[0];
  res.setHeader('Cache-Control', CACHE[route]);

  try {
    let body;
    switch (route) {
      case 'nearest': body = await nearest(query); break;
      case 'species': body = await species(query); break;
      case 'near': body = await near(query); break;
      case 'notable': body = await notable(query); break;
      case 'visits': body = await visits(query); break;
      case 'checklist': body = await checklist(query); break;
      case 'stats': body = await stats(query); break;
      case 'historic': body = await historic(query); break;
      case 'top': body = await top(query); break;
      default: body = await recentOrList(query, route);
    }
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof BadRequest) return res.status(400).json({ error: 'Invalid query' });
    return res.status(502).json({ error: 'eBird unavailable' });
  }
}
