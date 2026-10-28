// v1 state.lastPos: her last position fix, from the Targets page's Near me or from Listen. Targets reuses it for two
// minutes, and the map picker starts there when the sighting or outing has no spot yet. Kept for the session only.
export type Fix = { lat: number; lng: number; acc: number; at: number };

let last: Fix | null = null;

export const getLastPos = (): Fix | null => last;

export function setLastPos(p: { lat: number; lng: number; acc?: number | null }): Fix {
  last = { lat: p.lat, lng: p.lng, acc: p.acc ?? 0, at: Date.now() };
  return last;
}
