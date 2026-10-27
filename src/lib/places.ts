// Places for the location fields: v1 js/app.js nearestPlaceName, reverseGeocode, myPlaces, localPlaceMatches,
// searchAddress and recentPlaces (:347-479). They take the rows as arguments instead of reading v1's global state.
import { haversineKm, inPatch } from '../core/stats.js';
import { hotspots } from '../core/seqdata.js';

export interface LatLng { lat: number; lng: number }
export interface PlaceHit { name: string; lat: number; lng: number; kind: string }
interface PlaceRow { lat?: number | null; lng?: number | null; place?: string | null; createdAt?: number }
interface PatchRow { name: string; lat: number; lng: number; radiusKm: number }
interface HotspotRow { name: string; lat: number; lng: number; rich: number }

const located = <T extends PlaceRow>(r: T): r is T & LatLng => r.lat != null && r.lng != null;

/** The patch she is standing in, or the place of a sighting she logged within 400 m. */
export function nearestPlaceName(pos: LatLng, patches: PatchRow[], sightings: PlaceRow[]): string {
  const p = patches.find(pt => inPatch(pos, pt));
  if (p) return p.name;
  const near = sightings.filter(located).filter(s => s.place && haversineKm(s, pos) < 0.4)
    .sort((a, b) => haversineKm(a, pos) - haversineKm(b, pos))[0];
  return near?.place || '';
}

/** A short 'park, suburb' name for a spot from OpenStreetMap, or '' offline or on any failure. */
export async function reverseGeocode(pos: LatLng): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${pos.lat}&lon=${pos.lng}`, { headers: { 'Accept-Language': 'en-AU' } });
    const j = await r.json();
    const a = j.address || {};
    const local = j.name || a.park || a.nature_reserve || a.road;
    const area = a.suburb || a.town || a.village || a.city;
    return [local, area].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

/** Named places from her own sightings and outings, first use of each name. */
export function myPlaces(sightings: PlaceRow[], outings: PlaceRow[]): PlaceHit[] {
  const m = new Map<string, PlaceHit>();
  for (const s of sightings) if (located(s) && s.place && !m.has(s.place)) m.set(s.place, { name: s.place, lat: s.lat, lng: s.lng, kind: 'Your place' });
  for (const o of outings) if (located(o) && o.place && !m.has(o.place)) m.set(o.place, { name: o.place, lat: o.lat, lng: o.lng, kind: 'Your place' });
  return [...m.values()];
}

/** Patches, her places and hotspots whose names contain every word typed. */
export function localPlaceMatches(q: string, patches: PatchRow[], mine: PlaceHit[], limit = 8): PlaceHit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (t: string) => words.every(w => t.toLowerCase().includes(w));
  return [
    ...patches.filter(p => hit(p.name)).map(p => ({ name: p.name, lat: p.lat, lng: p.lng, kind: 'Your patch' })),
    ...mine.filter(p => hit(p.name)),
    ...(hotspots() as HotspotRow[]).filter(h => hit(h.name)).map(h => ({ name: h.name, lat: h.lat, lng: h.lng, kind: `Hotspot, ${h.rich} birds` })),
  ].slice(0, limit);
}

// OpenStreetMap's Nominatim asks for at most one search a second.
let lastGeocode = 0;
export async function searchAddress(q: string): Promise<PlaceHit[]> {
  const wait = 1100 - (Date.now() - lastGeocode);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeocode = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=151.6,-25.6,153.7,-28.5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'en-AU' } });
  if (!r.ok) throw new Error('Place search is busy. Try again in a moment.');
  return ((await r.json()) as { name?: string; display_name: string; lat: string; lon: string }[]).map(x => ({
    name: x.name || x.display_name.split(',')[0],
    lat: Number(x.lat), lng: Number(x.lon),
    kind: x.display_name.split(',').slice(1, 3).join(',').trim() || 'Place',
  }));
}

/** The six place names she used most recently. */
export const recentPlaces = (sightings: PlaceRow[]): string[] =>
  [...new Set(sightings.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(s => s.place).filter((p): p is string => !!p))].slice(0, 6);

/** The start-an-outing chips: her patches, then recent places, at most eight. */
export const outingPlaceChips = (patches: PatchRow[], sightings: PlaceRow[]): string[] =>
  [...new Set([...patches.map(p => p.name), ...recentPlaces(sightings)])].slice(0, 8);

/** Where a tapped chip is, if it names a patch or one of her places. */
export const knownPlace = (name: string, patches: PatchRow[], mine: PlaceHit[]): LatLng | null =>
  [...patches, ...mine].find(p => p.name === name) || null;
