// Small text helpers shared by the species page and Compare, as in v1 (birding-refresh js/app.js).
import type { Species } from '../lib/data';
import { parseSize } from '../core/species.js';

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The size with the label that fits it: Length, Wingspan (butterflies, flying-foxes), Height (plants), Shell or Body.
const MEASURE: Record<string, string> = { length: 'Length', wingspan: 'Wingspan', height: 'Height', shell: 'Shell', body: 'Body' };
export function sizeFact(sp: Species): [string, string] | null {
  const t = String(sp.sizeText || '').trim();
  if (!t) return null;
  const p = parseSize(t) as { measure: string } | null;
  if (!p) return [sp.kind === 'plant' ? 'Grows as' : 'Size', cap(t)];
  return [MEASURE[sp.kind === 'plant' ? 'height' : p.measure], cap(t.replace(/^wingspan\s+/i, '').replace(/\s+(shell|body)$/i, '').replace(/^to\b/i, 'up to'))];
}
