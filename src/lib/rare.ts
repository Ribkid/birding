import { byId, type Species } from './data';
import type { EbirdObservation, EbirdSnapshot } from './ebird';

export interface RareNearbyRow {
  obs: EbirdObservation;
  sp: Species | null;
  isNew: boolean;
}

/** One nearest notable report per species, with app species and the gold new-for-you state resolved. */
export function rareNearbyRows(
  observations: EbirdObservation[],
  snapshot: EbirdSnapshot,
  seen: ReadonlySet<number>,
  limit = 6,
): RareNearbyRow[] {
  const codes = snapshot.codes ?? {};
  const first = new Map<string, EbirdObservation>();
  for (const obs of observations) {
    if (!first.has(obs.code)) first.set(obs.code, obs);
  }
  return [...first.values()].slice(0, limit).map((obs) => {
    const id = codes[obs.code];
    const sp = id == null ? null : byId.get(id) ?? null;
    return { obs, sp, isNew: sp ? !seen.has(sp.id) : false };
  });
}
