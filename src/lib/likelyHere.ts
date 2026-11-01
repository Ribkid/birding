import { haversineKm } from '../core/stats.js';
import { byId, type Species } from './data';
import type { EbirdSnapshot, EbirdSpotTuple, LiveRecent } from './ebird';

const DAY = 24 * 60 * 60 * 1000;

export interface NearHotspot {
  spot: EbirdSpotTuple;
  distanceKm: number;
}

/** The closest eBird hotspot to an outing place, only when it is within a kilometre. */
export function nearestHotspotWithin(
  snapshot: EbirdSnapshot,
  point: { lat: number; lng: number },
  maxKm = 1,
): NearHotspot | null {
  let best: NearHotspot | null = null;
  for (const spot of snapshot.spots) {
    const distanceKm = haversineKm(point, { lat: spot[2], lng: spot[3] });
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) best = { spot, distanceKm };
  }
  return best;
}

function hasSavedSpecies(snapshot: EbirdSnapshot, locId: string, now: Date): boolean {
  if ((snapshot.lists?.[locId]?.length ?? 0) > 0) return true;
  const cutoff = now.getTime() - 30 * DAY;
  return (snapshot.recent?.[locId] ?? []).some((row) => {
    const time = Date.parse(`${String(row[1]).slice(0, 10)}T00:00:00`);
    return Number.isFinite(time) && time >= cutoff;
  });
}

/** For an offline fallback, the closest hotspot within the radius that actually has saved species. */
export function nearestSavedHotspotWithin(
  snapshot: EbirdSnapshot,
  point: { lat: number; lng: number },
  maxKm = 1,
  now = new Date(),
): NearHotspot | null {
  let best: NearHotspot | null = null;
  for (const spot of snapshot.spots) {
    if (!hasSavedSpecies(snapshot, spot[0], now)) continue;
    const distanceKm = haversineKm(point, { lat: spot[2], lng: spot[3] });
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) best = { spot, distanceKm };
  }
  return best;
}

/** Dex birds in report order, with never-seen birds first and anything already on the tally left out. */
export function rankLikely(
  ids: number[],
  seen: ReadonlySet<number>,
  counted: ReadonlySet<number>,
  limit = 6,
): Species[] {
  const first = new Map<number, number>();
  ids.forEach((id, index) => { if (!first.has(id)) first.set(id, index); });
  return [...first.entries()]
    .map(([id, index]) => ({ sp: byId.get(id), index }))
    .filter((row): row is { sp: Species; index: number } => !!row.sp && !counted.has(row.sp.id))
    .sort((a, b) => Number(seen.has(a.sp.id)) - Number(seen.has(b.sp.id)) || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.sp);
}

/** Live 30-day observations, mapped through the snapshot's eBird codes. */
export function liveLikely(
  rows: LiveRecent[],
  snapshot: EbirdSnapshot,
  seen: ReadonlySet<number>,
  counted: ReadonlySet<number>,
  limit = 6,
): Species[] {
  const codes = snapshot.codes ?? {};
  const ids: number[] = [];
  for (const row of rows) {
    const id = codes[row.code];
    if (id != null) ids.push(id);
  }
  return rankLikely(ids, seen, counted, limit);
}

/**
 * Offline or after a live failure: the saved spot's last 30 days first, then its saved species list.
 * The list fallback is older than 30 days but is the only local data for a hotspot with no recent rows.
 */
export function snapshotLikely(
  snapshot: EbirdSnapshot,
  locId: string,
  seen: ReadonlySet<number>,
  counted: ReadonlySet<number>,
  now = new Date(),
  limit = 6,
): Species[] {
  const cutoff = now.getTime() - 30 * DAY;
  const recent = (snapshot.recent?.[locId] ?? [])
    .filter((row) => {
      const time = Date.parse(`${String(row[1]).slice(0, 10)}T00:00:00`);
      return Number.isFinite(time) && time >= cutoff;
    })
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .map((row) => row[0]);
  if (recent.length) return rankLikely(recent, seen, counted, limit);
  return rankLikely(snapshot.lists?.[locId] ?? [], seen, counted, limit);
}
