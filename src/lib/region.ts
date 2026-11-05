// Typed facade over src/regions (plain JS so the Vercel function and build scripts can share it).
import * as core from '../regions/index.js';

export interface RegionZone {
  name: string;
  councils: string[];
}
export interface RegionPack {
  code: string;
  name: string;
  short: string;
  timeZone: string;
  map: { center: [number, number]; zoom: number; bbox: [number, number, number, number] };
  pointBounds: [number, number, number, number];
  ebird: {
    state: string;
    stateName: string;
    councils: Record<string, string>;
    zones: Record<string, RegionZone>;
    /** What one area is called in badge text: 'council area' in SEQ. */
    areaLabel: string;
    fallbackCouncil: string;
  };
  species: Record<number, number>;
  notes: Record<number, string>;
  /** Group names that replace the shared ones in species.js GROUPS for this region. */
  groups?: Record<string, string>;
}

export const PACKS = core.PACKS as unknown as Record<string, RegionPack>;
export const REGION = core.REGION as unknown as RegionPack;
export const REGION_KEY = core.REGION_KEY;
export const canUse = core.canUse as (code: string) => boolean;
export const storedRegion = core.storedRegion as () => string | null;
export const regionFile = core.regionFile as (name: string, code?: string) => string;
export const ebirdRegion = core.ebirdRegion as (council: string, pack?: RegionPack) => string;
export const councilOf = core.councilOf as (code: string, pack?: RegionPack) => string;
export const councilName = core.councilName as (council: string, pack?: RegionPack) => string;
export const zoneOf = core.zoneOf as (council: string, pack?: RegionPack) => string | null;
export const setRegion = core.setRegion as (code: string) => void;
