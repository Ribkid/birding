// The hunt list is the nearby eBird feed cut down to birds missing from her dex. Kept pure so the ranking and the
// Spots filter can be checked without a browser.
import { haversineKm } from '../core/stats.js';
import { byId, type Species } from './data';
import type { EbirdObservation, EbirdSnapshot } from './ebird';

export interface HuntBird {
  sp: Species;
  obs: EbirdObservation;
  distanceKm: number;
}

export interface HuntResult {
  rows: HuntBird[];
  /** Every place one of the unseen birds was reported, for the Spots Hunt chip. */
  locations: Set<string>;
}

export function cutHunt(
  observations: EbirdObservation[],
  snapshot: EbirdSnapshot,
  seen: ReadonlySet<number>,
): HuntResult {
  const codes = snapshot.codes ?? {};
  const nearest = new Map<number, EbirdObservation>();
  const locations = new Set<string>();

  for (const obs of observations) {
    const id = codes[obs.code];
    if (id == null || seen.has(id)) continue;
    if (!byId.has(id)) continue;
    if (obs.loc) locations.add(obs.loc);
    const previous = nearest.get(id);
    const distance = Number(obs.distanceKm);
    const previousDistance = Number(previous?.distanceKm);
    if (
      !previous ||
      (Number.isFinite(distance) ? distance : Infinity) < (Number.isFinite(previousDistance) ? previousDistance : Infinity) ||
      (distance === previousDistance && obs.date > previous.date)
    ) {
      nearest.set(id, obs);
    }
  }

  const rows = [...nearest.entries()].map(([id, obs]) => ({
    sp: byId.get(id) as Species,
    obs,
    distanceKm: Number.isFinite(Number(obs.distanceKm)) ? Number(obs.distanceKm) : Infinity,
  })).sort((a, b) =>
    a.distanceKm - b.distanceKm ||
    b.obs.date.localeCompare(a.obs.date) ||
    a.sp.name.localeCompare(b.sp.name),
  );

  return { rows, locations };
}

/** Offline (or when the live route fails): the same cut from spot recencies baked into the daily snapshot. */
export function huntFromSnapshot(
  snapshot: EbirdSnapshot,
  point: { lat: number; lng: number },
  seen: ReadonlySet<number>,
  now = new Date(),
  radiusKm = 25,
  days = 7,
): HuntResult {
  const spotById = new Map(snapshot.spots.map(([loc, name, lat, lng]) => [loc, { name, lat, lng }]));
  const codeById = new Map(Object.entries(snapshot.codes ?? {}).map(([code, id]) => [id, code]));
  const observations: EbirdObservation[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oldest = today - days * 86400000;

  for (const [loc, rows] of Object.entries(snapshot.recent ?? {})) {
    const spot = spotById.get(loc);
    if (!spot) continue;
    const distance = haversineKm(point, spot);
    if (distance > radiusKm) continue;
    for (const [id, date] of rows) {
      const when = new Date(`${date}T12:00:00`).getTime();
      if (!Number.isFinite(when) || when < oldest || when > today + 86400000) continue;
      const sp = byId.get(id);
      if (!sp) continue;
      observations.push({
        code: codeById.get(id) ?? String(id),
        sci: sp.sci,
        name: sp.name,
        loc,
        where: spot.name,
        lat: spot.lat,
        lng: spot.lng,
        date,
        n: 1,
        sub: null,
        distanceKm: Number(distance.toFixed(2)),
      });
    }
  }

  return cutHunt(observations, snapshot, seen);
}
