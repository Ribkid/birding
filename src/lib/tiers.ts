// What the Dex shows about each species she has logged, beyond "seen": heard only (she has only ever heard it) and
// photographed (one of her sightings carries a photo). Decoration only: heard still counts as seen everywhere, so
// the counts, the badges and v1 parity are untouched.
//
// Photographed is core/stats.js badges()'s rule: a species is photographed when any of its sightings has a photoId
// (its photoSpecies set, which the Snapshot and Portfolio badges count). badges() has no heard rule; heard only is
// this file's own: every one of the species' sightings has heard: true, so one sighting she saw takes it off the
// list. A photo synced from another device is a photoId like any other (sync.js gives it a photos row without its
// blob), and nothing here reads the photos store: only the sightings the shared store already holds.
import { useStore, type StoreState } from './store';

export interface Tiers {
  /** Species whose every sighting is heard only. */
  heardOnly: Set<number>;
  /** Species with at least one sighting that has a photo. */
  photographed: Set<number>;
}

/** A sighting as the store holds it (v1's record: speciesId, heard, photoId among its fields). */
type SightingLike = Readonly<Record<string, unknown>>;

/** Heard-only and photographed species for these sightings. */
export function tiersOf(sightings: readonly SightingLike[]): Tiers {
  const heardOnly = new Set<number>();
  const seenProperly = new Set<number>();
  const photographed = new Set<number>();
  for (const s of sightings) {
    const id = Number(s.speciesId);
    if (s.photoId) photographed.add(id);
    if (s.heard) {
      if (!seenProperly.has(id)) heardOnly.add(id);
    } else {
      seenProperly.add(id);
      heardOnly.delete(id);
    }
  }
  return { heardOnly, photographed };
}

/**
 * Whether she has only ever heard this species: the species page's "Heard only so far." on its seen line, by the same
 * rule as the Dex's dashed ring and ear, so the two never disagree.
 */
export function heardOnlySoFar(sightings: readonly { speciesId?: unknown; heard?: unknown }[], speciesId: number): boolean {
  const own = sightings.filter((s) => Number(s.speciesId) === speciesId) as readonly SightingLike[];
  return tiersOf(own).heardOnly.has(speciesId);
}

const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...b].every((x) => a.has(x));

// One selector for every screen that asks: worked out again only when the store's sightings change, and the sets
// keep their identity while what is in them stays the same (an edited note, a new sighting of a seen species), so
// the Dex and its memoised tiles skip redrawing.
let memo: { from: unknown; tiers: Tiers } = { from: null, tiers: { heardOnly: new Set(), photographed: new Set() } };
export function selectTiers(state: Pick<StoreState, 'sightings'>): Tiers {
  if (memo.from === state.sightings) return memo.tiers;
  const next = tiersOf(state.sightings);
  const prev = memo.tiers;
  const heardOnly = sameSet(prev.heardOnly, next.heardOnly) ? prev.heardOnly : next.heardOnly;
  const photographed = sameSet(prev.photographed, next.photographed) ? prev.photographed : next.photographed;
  const tiers = heardOnly === prev.heardOnly && photographed === prev.photographed ? prev : { heardOnly, photographed };
  memo = { from: state.sightings, tiers };
  return tiers;
}

/** Heard-only and photographed species, kept fresh with her sightings. */
export function useTiers(): Tiers {
  return useStore(selectTiers);
}

/** How many of these species pass the test (a kind tab's scope). */
export function countIn(ids: Set<number>, has: (id: number) => boolean): number {
  let n = 0;
  for (const id of ids) if (has(id)) n += 1;
  return n;
}

/** The words a screen reader hears after a tile's name: ', not seen', ', seen', ', heard only', ', seen and photographed'. */
export function tierNote(seen: boolean, heardOnly: boolean, photographed: boolean): string {
  if (!seen) return ', not seen';
  if (heardOnly) return photographed ? ', heard only and photographed' : ', heard only';
  return photographed ? ', seen and photographed' : ', seen';
}
