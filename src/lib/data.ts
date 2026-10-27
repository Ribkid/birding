// Typed facade over the framework-free data/logic modules in src/core.
// Anything the screens need from the dex data should be re-exported here so the
// UI never reaches into core directly.
import * as core from '../core/species.js';
import * as stats from '../core/stats.js';

export interface Species {
  id: number;
  kind: string;
  name: string;
  sci: string;
  group: string;
  habitats: string[];
  size: number | null;
  sizeText: string;
  rarity: number;
  season: string | null;
  nocturnal: boolean;
  notes: string;
  wiki: string | null;
}

export const SPECIES = core.SPECIES as Species[];
export const BIRDS = core.BIRDS as Species[];
export const ANIMALS = core.ANIMALS as Species[];
export const ANIMAL_KINDS = core.ANIMAL_KINDS as string[];
export const GROUPS = core.GROUPS as Record<string, string>;
export const HABITATS = core.HABITATS as Record<string, string>;
export const RARITY = core.RARITY as Record<number, { label: string; one?: string }>;
export const KINDS = core.KINDS as Record<string, { label: string; one: string; plural?: string }>;
export const kindsPresent = core.kindsPresent as string[];
export const byId = core.byId as Map<number, Species>;

export const ofKind = (kind: string): Species[] => core.ofKind(kind) as Species[];
export const dexCode = (id: number): string => core.dexCode(id) as string;

export const inSeason = stats.inSeason as (sp: Species, month: number) => boolean;

/** Species shown under a kind tab. `animals` means every non-plant kind. */
export function scopeFor(kind: string): Species[] {
  return kind === 'animals' ? ANIMALS : ofKind(kind);
}

/** Human label for a kind, e.g. "birds", used in the tally. */
export function pluralFor(kind: string, count: number): string {
  if (kind === 'animals') return count === 1 ? 'animal' : 'animals';
  const meta = KINDS[kind];
  if (!meta) return 'species';
  return count === 1 ? meta.one.toLowerCase() : (meta.plural ?? meta.label).toLowerCase();
}
