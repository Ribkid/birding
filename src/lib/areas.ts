// Area dexes: a sighting belongs to the nearest eBird hotspot within 3 km. That hotspot's subnational2 code is a
// council, and the region pack groups councils into areas (in SEQ each council is its own area; Melbourne groups 37
// councils into 8). The snapshot's `regions` are keyed by area. Pure, so the assignment and the ring counts can be
// tested without IndexedDB.
import { haversineKm } from '../core/stats.js';
import { type EbirdSnapshot } from './ebird';
import { REGION, zoneOf } from './region';

export interface SightingPoint {
  speciesId: number;
  lat?: number | null;
  lng?: number | null;
}

export interface AreaProgress {
  code: string;
  name: string;
  seen: number;
  total: number;
}

const AREA_ORDER = Object.keys(REGION.ebird.zones);

/** The area of the closest eBird hotspot, or null when no hotspot in the region is within the radius. */
export function assignSightingArea(
  sighting: Pick<SightingPoint, 'lat' | 'lng'>,
  snapshot: EbirdSnapshot,
  withinKm = 3,
): string | null {
  const lat = Number(sighting.lat);
  const lng = Number(sighting.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let code: string | null = null;
  let best = withinKm;
  for (const [, , spotLat, spotLng, , , , council] of snapshot.spots) {
    if (!council) continue;
    const distance = haversineKm({ lat, lng }, { lat: spotLat, lng: spotLng });
    if (distance <= best) {
      code = council;
      best = distance;
    }
  }
  return code ? zoneOf(code) : null;
}

/** The council area of the closest eBird hotspot to a rough fix, or null without a fix. */
export function nearestRegionCode(
  snapshot: EbirdSnapshot,
  point: { lat: number; lng: number } | null | undefined,
): string | null {
  if (!point) return null;
  let code: string | null = null;
  let best = Infinity;
  for (const [, , spotLat, spotLng, , , , region] of snapshot.spots) {
    if (!region) continue;
    const distance = haversineKm(point, { lat: spotLat, lng: spotLng });
    if (distance < best) {
      code = region;
      best = distance;
    }
  }
  return code;
}

/** Seen and total species for every area list in the snapshot. */
export function areaProgress(sightings: SightingPoint[], snapshot: EbirdSnapshot): AreaProgress[] {
  const regions = snapshot.regions ?? {};
  const seen = new Map<string, Set<number>>();
  for (const code of Object.keys(regions)) seen.set(code, new Set());

  for (const sighting of sightings) {
    const code = assignSightingArea(sighting, snapshot);
    if (!code) continue;
    const region = regions[code];
    if (!region || !region.ids.includes(sighting.speciesId)) continue;
    seen.get(code)?.add(sighting.speciesId);
  }

  return Object.entries(regions)
    .sort(([a], [b]) => {
      const ai = AREA_ORDER.indexOf(a);
      const bi = AREA_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
    })
    .map(([code, region]) => ({
      code,
      name: region.name || REGION.ebird.zones[code]?.name || code,
      seen: seen.get(code)?.size ?? 0,
      total: region.ids.length,
    }));
}
