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
export interface EbirdSnapshot {
  built: string;
  source: 'eBird';
  spots: EbirdSpotTuple[];
  lists: Record<string, number[]>;
  recent: Record<string, [number, string][]>;
  notable: NotableBird[];
  codes?: Record<string, number>;
}
export interface LiveRecent {
  code: string;
  sci: string;
  name: string;
  date: string;
  n: number;
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
