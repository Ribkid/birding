const BASE = 'https://api.ebird.org/v2/';
const LOC_ID = /^L\d{1,10}$/;
const SPECIES_CODE = /^[a-z0-9]{4,8}$/;
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
    const body = route === 'nearest' ? await nearest(query)
      : route === 'species' ? await species(query)
        : route === 'near' ? await near(query)
          : await recentOrList(query, route);
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof BadRequest) return res.status(400).json({ error: 'Invalid query' });
    return res.status(502).json({ error: 'eBird unavailable' });
  }
}
