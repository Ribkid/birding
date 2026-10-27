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
  sizeCm?: number | null;
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

// ---------- types for the refreshed screens ----------
export interface QuizOption {
  key: string;
  label: string;
  sp?: number;
  photos?: PhotoRef[];
}
export interface PhotoRef {
  src: string;
  credit?: string;
  license?: string;
  from?: string;
}
export interface QuizQuestion {
  type: string;
  ttype?: string;
  prompt: string;
  sub?: string;
  focus: number;
  options: QuizOption[];
  answer: string;
  picked?: string | null;
  photos?: PhotoRef[];
  call?: { src: string; local?: string; artist?: string; license?: string };
  clue?: string;
  explain?: string;
  miss?: string;
  tell?: string;
  safety?: string;
  named?: boolean;
  italic?: boolean;
  zoom?: { x: number; y: number; scale: number };
  img?: number;
  wrong?: number[];
  also?: number[];
  source?: { title?: string; url?: string };
  pack?: string;
  [key: string]: unknown;
}
export interface QuizPack {
  key: string;
  name: string;
  kind: string | null;
  blurb: string;
  types: string[];
  safety?: boolean;
}
export interface LearnCard {
  id: number;
  skill: 'look' | 'call';
  box: number;
  due: number;
  at?: number;
}
export interface LearnPrefs {
  kind: string;
  scope: string;
  difficulty: string;
  allPacks?: boolean;
}
export interface PackState {
  best: number | null;
  of: number;
  plays: number;
  perfect: number;
  got: number[];
}
export interface LearnState {
  cards: Record<number, Partial<Record<'look' | 'call', { box: number; due: number; at: number }>>>;
  best: Record<string, number>;
  duels: { n: number; won: number };
  rounds: number;
  perfect: number;
  prefs: LearnPrefs;
  packs: Record<string, PackState>;
}
export interface DailyState {
  streak: number;
  best: number;
  lastDate: string;
  done: number;
  history: Record<string, number>;
  today: { date: string; picks: { key: string; right: boolean }[] } | null;
}
export interface RoundState {
  mode: string;
  pack?: string | null;
  kind?: string;
  qs: QuizQuestion[];
  i: number;
  score: number;
  prefs?: LearnPrefs;
  practice?: boolean;
  testId?: number | null;
  daily?: boolean;
  date?: string;
  endsAt?: number;
  streak?: number;
  top?: number;
  done?: boolean;
  shown?: boolean;
  newBest?: boolean;
  deck?: boolean;
  queue?: { id: number; skill: 'look' | 'call'; reps: number; box?: number; due?: number }[];
  total?: number;
  n?: number;
  tally?: { knew: number; unsure: number; missed: number };
}
export interface LocalProfile {
  displayName: string;
  avatarSpeciesId: number | null;
  showOnLeaderboard: boolean;
}
export interface CloudProfile {
  uid: string;
  publicId: string;
  avatarPath: string | null;
  showDex: boolean;
  memberSince: string | null;
}
export interface PublicProfileRow {
  public_id: string;
  display_name: string;
  avatar_species_id: number | null;
  avatar_path: string | null;
  member_since: string | null;
  show_dex: boolean;
  dex: number[] | null;
  species: number;
  badges: number;
  outings: number;
  is_me?: boolean;
  bird?: number;
  mammal?: number;
  reptile?: number;
  frog?: number;
  butterfly?: number;
  plant?: number;
}
export interface LeaderboardRow {
  rank: number;
  public_id: string | null;
  display_name: string;
  avatar_species_id: number | null;
  avatar_path: string | null;
  species: number;
  outings: number;
  badges: number;
  is_me: boolean;
  bird?: number;
  mammal?: number;
  reptile?: number;
  frog?: number;
  butterfly?: number;
  plant?: number;
}
export interface GroupRow {
  id: string;
  name: string;
  code: string;
  members: number;
}
export interface ScanResult {
  results: { id: number; p: number }[];
  band: 'likely' | 'possibly' | 'unsure';
  agreement: number;
  margin: number;
  ms: number;
  views: { name: string; top: number; ms: number }[];
  bands: { likely: number; possibly: number };
}

export type { LearnPrefs as LearnPreferences };
