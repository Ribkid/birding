// Choosing a region: which packs to offer, how many birds each has, and which one to start on.
// See docs/plans/2026-11-05-melbourne-region-design.md, section 2.
import { ALL_BIRDS } from '../core/species.js';
import { PACKS, REGION, REGION_KEY, canUse, setRegion, type RegionPack } from './region';

/** Every pack this build lets a device use (an unlaunched pack only shows in a dev build). */
export const usablePacks = (): RegionPack[] => Object.values(PACKS).filter((p) => canUse(p.code));

/** How many of a pack's species are birds. */
export function birdCount(pack: RegionPack): number {
  const birds = new Set((ALL_BIRDS as { id: number }[]).map((b) => b.id));
  return Object.keys(pack.species).filter((id) => birds.has(Number(id))).length;
}

/** The pack whose map box (south, west, north, east) holds the point, if any. */
export function packAt(pos: { lat: number; lng: number } | null | undefined, packs: RegionPack[]): RegionPack | null {
  if (!pos) return null;
  return packs.find(({ map: { bbox: [s, w, n, e] } }) => pos.lat >= s && pos.lat <= n && pos.lng >= w && pos.lng <= e) ?? null;
}

/** The code to preselect: the pack around a known location, else the current region. */
export function preselected(pos: { lat: number; lng: number } | null | undefined, packs: RegionPack[] = usablePacks(), current: string = REGION.code): string {
  return (packAt(pos, packs) ?? packs.find((p) => p.code === current) ?? packs[0])?.code ?? current;
}

/** Saves the choice. A different region reloads the app (setRegion); the same one is just written down. */
export function chooseRegion(code: string): void {
  if (code !== REGION.code) { setRegion(code); return; }
  try { localStorage.setItem(REGION_KEY, code); } catch { /* no storage: the default region stays */ }
}

/** Whether a region was ever saved on this device. */
export function hasStoredRegion(): boolean {
  try { return localStorage.getItem(REGION_KEY) !== null; } catch { return false; }
}
