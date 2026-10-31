// The Spots tab's data: eBird hotspots when their snapshot exists, otherwise the ALA hotspots from
// seq.json, joined to OpenStreetMap access facts, her seen set and, when allowed, her last fix.
//
// Everything that decides what she sees is pure and lives here so it can be tested without a browser:
// the sorts, the suggestions, the filter chips and the name search.
import { haversineKm } from '../core/stats.js';

export interface HotspotLike {
  locId?: string;
  name: string;
  lat: number;
  lng: number;
  rich: number;
  sp: [number, number][];
  checklists?: number;
  latestObsDt?: string | null;
  region?: string;
  hasList?: boolean;
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

export type SortKey = 'rich' | 'records' | 'recent' | 'access' | 'nearest' | 'new';

export interface SpotRow extends HotspotLike {
  idx: number;
  /** ALA record sum, or eBird all-time checklists. */
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
  birdedWeek: boolean;
}

export const NO_FILTERS: SpotFilters = { toilets: false, parking: false, birdHide: false, wheelchair: false, birdedWeek: false };

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rich', label: 'Most species' },
  { key: 'records', label: 'Most sightings' },
  { key: 'recent', label: 'Recently birded' },
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
    ...h,
    idx,
    hasList: h.hasList ?? true,
    records: h.checklists ?? recordsOf(h),
    newForYou: newForYouOf(h, seen),
    distanceKm: pos ? haversineKm(pos, h) : null,
    access: access?.[h.locId ?? String(idx)] ?? null,
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
    case 'recent':
      out.sort((a, b) => (b.latestObsDt ?? '').localeCompare(a.latestObsDt ?? '') || b.rich - a.rich || byName(a, b));
      break;
    case 'access':
      // Unknown access is not ranked as hard: it sits after every known score.
      out.sort((a, b) => (b.access?.score ?? -1) - (a.access?.score ?? -1) || b.rich - a.rich || byName(a, b));
      break;
    case 'nearest':
      out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.rich - a.rich || byName(a, b));
      break;
    case 'new':
      out.sort((a, b) => Number(b.hasList) - Number(a.hasList) || b.newForYou - a.newForYou || b.rich - a.rich || byName(a, b));
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
 * Up to three spots suggested for her: new birds, weighted towards nearby spots and eBird spots
 * active in the last month. Restricted-access spots come last.
 */
export function suggestSpots(rows: SpotRow[], pos: { lat: number; lng: number } | null, limit = 3, now = Date.now()): SpotRow[] {
  const scored = rows
    .filter((row) => row.newForYou > 0)
    .map((row) => {
      const nearby = pos && row.distanceKm != null ? 1 / (1 + row.distanceKm / 25) : 1;
      const latest = row.latestObsDt ? new Date(row.latestObsDt.replace(' ', 'T')).getTime() : NaN;
      const active = Number.isFinite(latest) && now - latest >= 0 && now - latest <= 31 * 86400000 ? 3 : 1;
      return { row, score: row.newForYou * nearby * active };
    });
  scored.sort(
    (a, b) =>
      Number(isRestricted(a.row)) - Number(isRestricted(b.row)) ||
      b.score - a.score || b.row.newForYou - a.row.newForYou || b.row.rich - a.row.rich || a.row.name.localeCompare(b.row.name),
  );
  return scored.slice(0, limit).map((x) => x.row);
}

/** The filter chips, all of which must hold. A spot with no OSM data fails every access filter. */
export function matchesFilters(row: SpotRow, filters: SpotFilters, now: number | Date = Date.now()): boolean {
  const a = row.access;
  if (filters.toilets && !(a && a.toilets > 0)) return false;
  if (filters.parking && !(a && a.parkingM != null)) return false;
  if (filters.birdHide && !(a && a.birdHides > 0)) return false;
  if (filters.wheelchair && !(a && (a.wheelchair === 'yes' || a.wheelchair === 'limited'))) return false;
  if (filters.birdedWeek) {
    if (!row.latestObsDt) return false;
    const latest = new Date(row.latestObsDt.replace(' ', 'T')).getTime();
    const time = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(latest) || time - latest < 0 || time - latest > 7 * 86400000) return false;
  }
  return true;
}

/** Every word in the search must appear in the name (case does not matter). */
export function matchesSearch(row: SpotRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = row.name.toLowerCase();
  return words.every((word) => name.includes(word));
}

export function filterSpots(rows: SpotRow[], filters: SpotFilters, query: string, now: number | Date = Date.now()): SpotRow[] {
  return rows.filter((row) => matchesFilters(row, filters, now) && matchesSearch(row, query));
}

export function applySpotVisibility(rows: SpotRow[], query: string, showAll: boolean): SpotRow[] {
  return showAll || query.trim() ? rows : rows.filter((row) => row.rich >= 40);
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

export type AccessSource = 'ala' | 'ebird';
const baked: Record<AccessSource, Record<string, SpotAccess> | null> = { ala: null, ebird: null };
const loading: Record<AccessSource, Promise<Record<string, SpotAccess>> | null> = { ala: null, ebird: null };

/** The access records already read (empty until the file lands). */
export const spotAccess = (source: AccessSource = 'ala'): Record<string, SpotAccess> => baked[source] ?? {};

/**
 * Reads the ALA or eBird access file once. Offline it resolves to no records rather than failing the screen.
 */
export function loadSpotAccess(source: AccessSource = 'ala'): Promise<Record<string, SpotAccess>> {
  const current = baked[source];
  if (current) return Promise.resolve(current);
  loading[source] ??= fetch(source === 'ebird' ? '/data/spot-access-ebird.json' : '/data/spot-access.json')
    .then((response) => (response.ok ? response.json() : { spots: {} }))
    .then((json: { spots?: Record<string, SpotAccess> }) => {
      baked[source] = json.spots ?? {};
      return baked[source];
    })
    .catch(() => {
      baked[source] = {};
      return baked[source];
    });
  return loading[source];
}

/** The ODbL credit, used wherever access appears. */
export const OSM_CREDIT = 'Access data © OpenStreetMap contributors';
export const OSM_URL = 'https://www.openstreetmap.org/copyright';
