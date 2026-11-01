import { describe, expect, it } from 'vitest';
import { ebirdAccessSpots } from '../../scripts/build-spot-access.mjs';

describe('eBird access input', () => {
  it('selects the top 800 by species and keeps locId coordinates and names', () => {
    const spots = Array.from({ length: 805 }, (_, index) => [
      `L${index + 1}`, `Spot ${index + 1}`, -27 - index / 1000, 153, index + 10, 100, '2026-10-30', 'BRI',
    ]).reverse();

    const selected = ebirdAccessSpots({ spots });

    expect(selected).toHaveLength(800);
    expect(selected[0]).toEqual({ locId: 'L805', name: 'Spot 805', lat: -27.804, lng: 153, rich: 814 });
    expect(selected.at(-1).locId).toBe('L6');
    expect(selected.every((spot) => typeof spot.locId === 'string')).toBe(true);
    // A slow Overpass run may be capped early; the prefix is the same either way.
    expect(ebirdAccessSpots({ spots }, 400)).toEqual(selected.slice(0, 400));
  });
});
