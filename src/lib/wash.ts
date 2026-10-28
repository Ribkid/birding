// The plumage wash: what a species photo frame shows while its photo is on its way, so it is never a flat grey
// block. One soft radial gradient in the bird's own colours (core/palettes.js PAL, the 3D models' paint: the head
// at the top, the back around it, the belly at the foot), or in its kind colour for animals and plants. Each colour
// is taken a little towards the theme's sunk surface so the wash sits in the page in light and dark.
import { PAL } from '../core/palettes.js';

interface Named { name: string; kind: string }

const HEX = /^#[0-9a-f]{3,8}$/i;
// PAL rows: back, belly, head, wing, bill, legs, accent, shape.
export function plumage(sp: Named): { head: string; back: string; belly: string } | null {
  if (sp.kind !== 'bird') return null;
  const row = (PAL as Record<string, unknown[]>)[sp.name];
  if (!Array.isArray(row)) return null;
  const [back, belly, head] = row;
  if (![back, belly, head].every((c) => typeof c === 'string' && HEX.test(c))) return null;
  return { head: head as string, back: back as string, belly: belly as string };
}

// How much of the bird's colour (look.css --wash-mix: a little less in the dark theme, so a loading grid doesn't glow).
const soft = (c: string) => `color-mix(in srgb, ${c} var(--wash-mix, 82%), var(--surface-2))`;
// Centred above the frame, so the colours lie in soft curved bands from the top down rather than as a lit ball.
const SHAPE = 'radial-gradient(150% 125% at 50% -12%';

/** The wash for a species, as a background-image value. Learn never uses it, so it can't give an answer away. */
export function washFor(sp: Named): string {
  const p = plumage(sp);
  if (p) return `${SHAPE}, ${soft(p.head)} 0%, ${soft(p.back)} 52%, ${soft(p.belly)} 100%)`;
  const k = `var(--k-${/^[a-z]+$/.test(sp.kind) ? sp.kind : 'bird'})`;
  return `${SHAPE}, color-mix(in srgb, ${k} 45%, var(--surface)) 0%, color-mix(in srgb, ${k} 75%, var(--surface-2)) 52%, color-mix(in srgb, ${k} 55%, #121821) 100%)`;
}
