// lib/look.ts calmTint: the tint a species page takes from its photo keeps the photo's colour, except that green and
// olive (a bird against leaves) are pulled to the app's neutral slate, so no page behind a species reads as green.
import { describe, expect, it } from 'vitest';
import { NEUTRAL_HUE, NEUTRAL_SAT, calmTint, greenness } from '../lib/look';

// The hue a tint is drawn with, as a person would name it at the page's 36% lightness, where a yellow is olive: khaki
// past 40° reads olive unless it is all but grey.
const reads = (h: number, s: number) => {
  if (s <= 0.1) return 'neutral';
  const x = ((h % 360) + 360) % 360;
  return x < 40 || x >= 330 ? 'warm' : x < 58 ? 'khaki' : x < 170 ? 'green' : x < 195 ? 'teal' : 'cool';
};

describe('greenness', () => {
  it('is 0 for reds, browns, blues and purples, 1 for olive and every green, and eases in and out at the edges', () => {
    for (const h of [0, 15, 30, 38, 195, 215, 260, 300, 359]) expect(greenness(h)).toBe(0);
    for (const h of [48, 58, 65, 80, 102, 130, 161, 170]) expect(greenness(h)).toBe(1);
    expect(greenness(43)).toBeCloseTo(0.5, 5);
    expect(greenness(182.5)).toBeCloseTo(0.5, 5);
    expect(greenness(-280)).toBe(greenness(80));
  });
});

describe('calmTint', () => {
  it('leaves a tint that is not green as it was', () => {
    // Plumed Whistling-Duck, Crimson Rosella, Pacific Black Duck, Peregrine Falcon, a purple.
    for (const [h, s] of [[33, 0.28], [9, 0.28], [215, 0.34], [210, 0.7], [280, 0.5]]) expect(calmTint(h, s)).toEqual([h, s]);
  });

  it('turns an olive or green tint into the neutral slate', () => {
    // The tints the sweep found: Laughing Kookaburra 80°, Crested Pigeon 102°, Topknot Pigeon 65°, Whimbrel 56° (75%),
    // Green Tree Frog 91°, Intermediate Egret 161°.
    for (const [h, s] of [[80, 0.28], [102, 0.28], [65, 0.49], [91, 0.33], [161, 0.28], [74, 0.66]]) {
      expect(calmTint(h, s)).toEqual([NEUTRAL_HUE, NEUTRAL_SAT]);
    }
    // A barely coloured photo stays as grey as it was.
    expect(calmTint(90, 0.08)).toEqual([NEUTRAL_HUE, 0.08]);
  });

  it('never gives a tint that reads green or olive, whatever the photo', () => {
    for (let h = 0; h < 360; h += 0.5) {
      for (const s of [0.28, 0.45, 0.6, 0.75]) {
        const [h2, s2] = calmTint(h, s);
        expect(reads(h2, s2), `${h}° ${s} gave ${h2.toFixed(0)}° ${s2.toFixed(2)}`).not.toMatch(/green|khaki/);
        expect(s2).toBeLessThanOrEqual(s + 1e-9);
      }
    }
  });

  it('keeps khaki on the brown it borders and fades it toward grey as it turns olive, never through green', () => {
    for (const s of [0.28, 0.5, 0.75]) {
      let prev = calmTint(38, s);
      expect(prev).toEqual([38, s]);
      for (let h = 38.5; h < 48; h += 0.5) {
        const now = calmTint(h, s);
        expect(now[0]).toBe(38);
        expect(now[1]).toBeLessThan(prev[1]);
        prev = now;
      }
      expect(prev[1]).toBeLessThan(0.1);
      expect(calmTint(48, s)).toEqual([NEUTRAL_HUE, NEUTRAL_SAT]);
    }
    // Paradise Riflebird's photo (47.5°, 28%) used to come out a greyed olive (53°, 12%); now it is all but grey.
    const [h, s] = calmTint(47.5, 0.28);
    expect([h, +s.toFixed(3)]).toEqual([38, 0.014]);
  });

  it('pulls a teal toward the slate through cyan, never back through green', () => {
    for (let h = 170.5; h < 195; h += 0.5) {
      const [h2] = calmTint(h, 0.6);
      expect(h2).toBeGreaterThanOrEqual(185);
      expect(h2).toBeLessThanOrEqual(NEUTRAL_HUE + 1);
    }
  });
});
