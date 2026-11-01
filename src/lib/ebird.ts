import { haversineKm } from '../core/stats.js';
import type { HotspotLike } from './spots';

export type EbirdSpotTuple = [string, string, number, number, number, number, string | null, string];
export interface NotableBird {
  id: number;
  name: string;
  loc: string;
  where: string;
  lat: number;
  lng: number;
  date: string;
  n: number;
}
export interface EbirdRegion {
  name: string;
  ids: number[];
}
export interface EbirdSnapshot {
  built: string;
  source: 'eBird';
  spots: EbirdSpotTuple[];
  lists: Record<string, number[]>;
  regions?: Record<string, EbirdRegion>;
  recent: Record<string, [number, string][]>;
  notable: NotableBird[];
  codes?: Record<string, number>;
}

/** The eleven South East Queensland council areas, keyed by their eBird subnational2 suffix. */
export const REGION_NAMES: Record<string, string> = {
  BRI: 'Brisbane',
  GOL: 'Gold Coast',
  IPS: 'Ipswich',
  LOV: 'Lockyer Valley',
  LOG: 'Logan',
  MRB: 'Moreton Bay',
  RED: 'Redland',
  SCE: 'Scenic Rim',
  SOM: 'Somerset',
  SUN: 'Sunshine Coast',
  TOO: 'Toowoomba',
};
export interface LiveRecent {
  code: string;
  sci: string;
  name: string;
  date: string;
  n: number;
}
/** A compact eBird observation as every round-2 route returns it. */
export interface EbirdObservation extends LiveRecent {
  loc: string;
  where: string;
  lat: number;
  lng: number;
  sub?: string | null;
  distanceKm?: number;
}
export interface SpeciesSightings {
  total: number;
  sightings: EbirdObservation[];
}
export interface EbirdVisit {
  sub: string;
  date: string;
  time: string;
  species: number;
}
export interface RegionalStats {
  date: string;
  checklists: number;
  birders: number;
  species: number;
}
export interface EbirdChecklist {
  sub: string;
  date: string;
  time: string;
  loc: string;
  species: { code: string; name: string; n: number }[];
}
export interface SpotData {
  source: 'eBird' | 'ALA';
  spots: HotspotLike[];
  snapshot: EbirdSnapshot | null;
  notable: NotableBird[];
}

export function decodeEbirdSnapshot(snapshot: EbirdSnapshot) {
  const spots: HotspotLike[] = snapshot.spots.map(([locId, name, lat, lng, rich, checklists, latestObsDt, region]) => ({
    locId,
    name,
    lat,
    lng,
    rich,
    checklists,
    latestObsDt,
    region,
    sp: (snapshot.lists[locId] ?? []).map((id) => [id, 0]),
    hasList: snapshot.lists[locId] != null,
  }));
  return { spots, notable: snapshot.notable };
}

export async function loadSpotData(ala: HotspotLike[], fetcher: typeof fetch = fetch): Promise<SpotData> {
  try {
    const response = await fetcher('/data/ebird/spots.json');
    if (!response.ok) throw new Error('No eBird snapshot');
    const snapshot = await response.json() as EbirdSnapshot;
    if (!Array.isArray(snapshot.spots)) throw new Error('Invalid eBird snapshot');
    const decoded = decodeEbirdSnapshot(snapshot);
    return { source: 'eBird', spots: decoded.spots, notable: decoded.notable, snapshot };
  } catch {
    return { source: 'ALA', spots: ala, notable: [], snapshot: null };
  }
}

export async function fetchLiveEbird(
  kind: 'recent' | 'list',
  locId: string,
  fetcher: typeof fetch = fetch,
  online = typeof navigator !== 'undefined' ? navigator.onLine : false,
): Promise<LiveRecent[] | string[] | null> {
  if (!online) return null;
  try {
    const response = await fetcher(`/api/ebird?${kind}=${encodeURIComponent(locId)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** A small private-function call: enforces the 8 s client wait and treats every failure as no data. */
export async function fetchEbirdQuery<T>(
  query: Record<string, string | number | boolean>,
  fetcher: typeof fetch = fetch,
  online = typeof navigator !== 'undefined' ? navigator.onLine : false,
): Promise<T | null> {
  if (!online) return null;
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) params.set(key, String(value));
    const response = await fetcher(`/api/ebird?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === 'object' ? data as T : null;
  } catch {
    return null;
  }
}

/** eBird hotspot names use a double hyphen and a parenthetical access caveat; our screens use neither. */
export function tidySpotName(name: string): { name: string; restricted: boolean } {
  let restricted = false;
  const tidy = String(name || '')
    .replace(/\s*\((?:some areas\s+)?restricted access\)/gi, () => {
      restricted = true;
      return '';
    })
    .replace(/\s*--\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: tidy || 'eBird hotspot', restricted };
}

/** A fix is sent only to two decimal places (about 1 km). */
export function roughCoord(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function roughLatLng(point: { lat: number; lng: number } | null | undefined): { lat: number; lng: number } | null {
  if (!point) return null;
  const lat = roughCoord(Number(point.lat));
  const lng = roughCoord(Number(point.lng));
  return lat == null || lng == null ? null : { lat, lng };
}

const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;

/** The quiet relative-time wording used on cards: today, yesterday, 2 days ago, last week. */
export function relativeDay(value: string | null | undefined, now = new Date()): string {
  if (!value) return '';
  const when = new Date(String(value).replace(' ', 'T'));
  if (!Number.isFinite(when.getTime())) return '';
  const days = Math.round(dayNumber(now) - dayNumber(when));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'last year' : `${years} years ago`;
}

export function mapLiveRecent(rows: LiveRecent[], birds: { id: number; sci: string }[]) {
  const bySci = new Map(birds.map((bird) => [bird.sci, bird.id]));
  const latest = new Map<number, { id: number; date: string; n: number }>();
  for (const row of rows) {
    const id = bySci.get(row.sci);
    if (id == null) continue;
    const previous = latest.get(id);
    if (!previous || row.date > previous.date) latest.set(id, { id, date: row.date, n: row.n });
  }
  return [...latest.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function liveListIds(codes: string[], snapshot: EbirdSnapshot) {
  return codes.map((code) => snapshot.codes?.[code]).filter((id): id is number => id != null);
}

export function nearestEbirdSpot(spots: HotspotLike[], point: { lat: number; lng: number }): HotspotLike | null {
  let nearest: HotspotLike | null = null;
  let best = 0.4;
  for (const spot of spots) {
    const distance = haversineKm(point, spot);
    if (distance <= best) {
      nearest = spot;
      best = distance;
    }
  }
  return nearest;
}

export const EBIRD_CREDIT = 'Data from eBird (ebird.org), Cornell Lab of Ornithology';
