// The region this install is set to, and helpers for its files and eBird codes.
// See docs/plans/2026-11-05-melbourne-region-design.md.
//
// The region is read once, when this module is first imported, before anything renders. Every list built from it
// (the dex in core/species.js, the area dexes, the map's home view) is fixed for the life of the page; changing
// region saves the choice and reloads (setRegion).
import seq from './seq.js';
import melb from './melb.js';

// Every pack, launched or not: the eBird build and proxy serve them all.
export const PACKS = { seq, melb };
export const DEFAULT_REGION = 'seq';
export const REGION_KEY = 'birddex-region';

// A pack with `launched: false` can only be picked in a dev build (`npm run dev`), never in production.
const DEV = Boolean(import.meta.env?.DEV);

/** Whether this build lets a device use the region. */
export const canUse = (code, dev = DEV) => Object.hasOwn(PACKS, code) && (PACKS[code].launched !== false || dev);

/** The region code saved on this device, or null if none is saved (or it names a region this build can't use). */
export function storedRegion() {
  try {
    const code = globalThis.localStorage?.getItem(REGION_KEY);
    return code && canUse(code) ? code : null;
  } catch (_) {
    return null;
  }
}

// Dev-only switch: open the app with ?region=melb (or ?region=seq) to save that region before anything reads it.
if (DEV) {
  try {
    const code = new URLSearchParams(globalThis.location?.search ?? '').get('region');
    if (code && canUse(code)) globalThis.localStorage?.setItem(REGION_KEY, code);
  } catch (_) {
    // No storage (private mode); the default region is used.
  }
}

export const REGION = PACKS[storedRegion() ?? DEFAULT_REGION];

/** Where a region's own data file is served from, e.g. /data/regions/seq/rates.json. */
export const regionFile = (name, code = REGION.code) => `/data/regions/${code}/${name}`;

/** A council suffix as a full eBird region code: BRI -> AU-QLD-BRI. */
export const ebirdRegion = (council, pack = REGION) => `${pack.ebird.state}-${council}`;

/** A full eBird region code back to its council suffix: AU-QLD-BRI -> BRI. */
export const councilOf = (code, pack = REGION) => String(code ?? '').replace(`${pack.ebird.state}-`, '');

export const councilName = (council, pack = REGION) => pack.ebird.councils[council] ?? council;

const zoneByCouncil = new Map();
for (const pack of Object.values(PACKS)) {
  const m = new Map();
  for (const [zone, { councils }] of Object.entries(pack.ebird.zones)) for (const c of councils) m.set(c, zone);
  zoneByCouncil.set(pack.code, m);
}
/** The area (zone) a council belongs to, or null for a council outside the region. */
export const zoneOf = (council, pack = REGION) => zoneByCouncil.get(pack.code)?.get(council) ?? null;

/** Saves a new region and reloads, so every list is rebuilt for it. */
export function setRegion(code) {
  if (!canUse(code) || code === REGION.code) return;
  try { localStorage.setItem(REGION_KEY, code); } catch (_) { return; }
  location.reload();
}
