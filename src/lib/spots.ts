// The Spots tab's data: the 220 SEQ hotspots from seq.json joined to the access facts baked from
// OpenStreetMap (public/data/spot-access.json), her seen set and, when she allows it, her last fix.
//
// Everything that decides what she sees is pure and lives here so it can be tested without a browser:
// the sorts, the suggestions, the filter chips and the name search.
import { haversineKm } from '../core/stats.js';

export interface HotspotLike {
  name: string;
  lat: number;
  lng: number;
  rich: number;
  sp: [number, number][];
}

/** One hotspot's access record, as scripts/build-spot-access.mjs writes it. */
export interface SpotAccess {
  name: string;
  score: number | null;
  reasons: string[];
  note: string | null;
  parkingM: number | null;
  toilets: number;
  birdHides: number;
  shelters: number;
  picnicTables: number;
  pavedPaths: number;
  boardwalks: number;
  wheelchair: 'yes' | 'limited' | null;
  restricted: boolean;
  fee: 'yes' | 'no' | null;
}

export type SortKey = 'rich' | 'records' | 'access' | 'nearest' | 'new';

export interface SpotRow extends HotspotLike {
  idx: number;
  /** Sum of the records of every bird at this hotspot. */
  records: number;
  /** How many of its birds she has never logged. */
  newForYou: number;
  /** Straight-line km from her last fix, or null when her location is not known. */
  distanceKm: number | null;
  access: SpotAccess | null;
}

export interface SpotFilters {
  toilets: boolean;
  parking: boolean;
  birdHide: boolean;
  wheelchair: boolean;
}

export const NO_FILTERS: SpotFilters = { toilets: false, parking: false, birdHide: false, wheelchair: false };

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rich', label: 'Most species' },
  { key: 'records', label: 'Most sightings' },
  { key: 'access', label: 'Easiest access' },
  { key: 'nearest', label: 'Nearest' },
  { key: 'new', label: 'New for you' },
];

export function recordsOf(h: Pick<HotspotLike, 'sp'>): number {
  let total = 0;
  for (const [, count] of h.sp) total += count;
  return total;
}

export function newForYouOf(h: Pick<HotspotLike, 'sp'>, seen: Set<number>): number {
  let fresh = 0;
  for (const [id] of h.sp) if (!seen.has(id)) fresh += 1;
  return fresh;
}

export function buildRows(
  hotspots: HotspotLike[],
  access: Record<string, SpotAccess> | null,
  seen: Set<number>,
  pos: { lat: number; lng: number } | null,
): SpotRow[] {
  return hotspots.map((h, idx) => ({
    idx,
    name: h.name,
    lat: h.lat,
    lng: h.lng,
    rich: h.rich,
    sp: h.sp,
    records: recordsOf(h),
    newForYou: newForYouOf(h, seen),
    distanceKm: pos ? haversineKm(pos, h) : null,
    access: access?.[String(idx)] ?? null,
  }));
}

/** The sorts. Ties fall through to a stable, sensible order rather than the raw hotspot order. */
export function sortSpots(rows: SpotRow[], sort: SortKey): SpotRow[] {
  const byName = (a: SpotRow, b: SpotRow) => a.name.localeCompare(b.name);
  const out = rows.slice();
  switch (sort) {
    case 'records':
      out.sort((a, b) => b.records - a.records || b.rich - a.rich || byName(a, b));
      break;
    case 'access':
      // Unknown access is not ranked as hard: it sits after every known score.
      out.sort((a, b) => (b.access?.score ?? -1) - (a.access?.score ?? -1) || b.rich - a.rich || byName(a, b));
      break;
    case 'nearest':
      out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.rich - a.rich || byName(a, b));
      break;
    case 'new':
      out.sort((a, b) => b.newForYou - a.newForYou || b.rich - a.rich || byName(a, b));
      break;
    case 'rich':
    default:
      out.sort((a, b) => b.rich - a.rich || byName(a, b));
      break;
  }
  return out;
}

/** A spot she may not be able to walk into: its name says so, or OpenStreetMap marks it private. */
export function isRestricted(row: SpotRow): boolean {
  return /restricted access/i.test(row.name) || !!row.access?.restricted || /restricted/i.test(row.access?.note ?? '');
}

/**
 * Up to three spots suggested for her: the ones with the most birds she has not seen, and, when her
 * location is known, weighted towards nearby spots (a spot 25 km away counts half as much). Spots she
 * may not be able to get into come last, so they are suggested only when nothing else fills the three.
 */
export function suggestSpots(rows: SpotRow[], pos: { lat: number; lng: number } | null, limit = 3): SpotRow[] {
  const scored = rows
    .filter((row) => row.newForYou > 0)
    .map((row) => {
      const nearby = pos && row.distanceKm != null ? 1 / (1 + row.distanceKm / 25) : 1;
      return { row, score: row.newForYou * nearby };
    });
  scored.sort(
    (a, b) =>
      Number(isRestricted(a.row)) - Number(isRestricted(b.row)) ||
      b.score - a.score || b.row.newForYou - a.row.newForYou || b.row.rich - a.row.rich || a.row.name.localeCompare(b.row.name),
  );
  return scored.slice(0, limit).map((x) => x.row);
}

/** The filter chips, all of which must hold. A spot with no OSM data fails every filter. */
export function matchesFilters(row: SpotRow, filters: SpotFilters): boolean {
  const a = row.access;
  if (filters.toilets && !(a && a.toilets > 0)) return false;
  if (filters.parking && !(a && a.parkingM != null)) return false;
  if (filters.birdHide && !(a && a.birdHides > 0)) return false;
  if (filters.wheelchair && !(a && (a.wheelchair === 'yes' || a.wheelchair === 'limited'))) return false;
  return true;
}

/** Every word in the search must appear in the name (case does not matter). */
export function matchesSearch(row: SpotRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = row.name.toLowerCase();
  return words.every((word) => name.includes(word));
}

export function filterSpots(rows: SpotRow[], filters: SpotFilters, query: string): SpotRow[] {
  return rows.filter((row) => matchesFilters(row, filters) && matchesSearch(row, query));
}

/** "800 m" under a kilometre, then "1.2 km". */
export function distanceLabel(km: number | null): string {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** The access facts a card shows as badges, most useful first. */
export function accessBadges(access: SpotAccess | null): string[] {
  if (!access) return [];
  const badges: string[] = [];
  if (access.parkingM != null) badges.push(`Parking ${access.parkingM} m`);
  if (access.toilets > 0) badges.push('Toilets');
  if (access.birdHides > 0) badges.push('Bird hide');
  if (access.wheelchair === 'yes') badges.push('Wheelchair access');
  else if (access.wheelchair === 'limited') badges.push('Limited wheelchair access');
  if (access.pavedPaths > 0) badges.push('Paved paths');
  if (access.boardwalks > 0) badges.push('Boardwalk');
  if (access.shelters > 0) badges.push('Shelter');
  if (access.picnicTables > 0) badges.push('Picnic tables');
  return badges;
}

// ---------------------------------------------------------------------------
// The baked file
// ---------------------------------------------------------------------------

let baked: Record<string, SpotAccess> | null = null;
let loading: Promise<Record<string, SpotAccess>> | null = null;

/** The access records already read (empty until the file lands). */
export const spotAccess = (): Record<string, SpotAccess> => baked ?? {};

/**
 * Reads public/data/spot-access.json once. Offline before it has ever been read it resolves to no
 * records, and every spot says "Access not known yet" rather than failing the screen.
 */
export function loadSpotAccess(): Promise<Record<string, SpotAccess>> {
  if (baked) return Promise.resolve(baked);
  loading ??= fetch('/data/spot-access.json')
    .then((response) => (response.ok ? response.json() : { spots: {} }))
    .then((json: { spots?: Record<string, SpotAccess> }) => {
      baked = json.spots ?? {};
      return baked;
    })
    .catch(() => {
      baked = {};
      return baked;
    });
  return loading;
}

/** The ODbL credit, used wherever access appears. */
export const OSM_CREDIT = 'Access data © OpenStreetMap contributors';
export const OSM_URL = 'https://www.openstreetmap.org/copyright';
