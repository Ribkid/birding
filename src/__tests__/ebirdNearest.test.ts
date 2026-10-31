import { describe, expect, it } from 'vitest';
import { nearestEbirdSpot } from '../lib/ebird';

const spots = [
  { locId: 'L1', name: 'Near', lat: -27.5005, lng: 153, rich: 50, sp: [] },
  { locId: 'L2', name: 'Far', lat: -27.51, lng: 153, rich: 80, sp: [] },
];

describe('map links to eBird spots', () => {
  it('chooses the nearest eBird spot within 400 metres', () => {
    expect(nearestEbirdSpot(spots, { lat: -27.5, lng: 153 })?.locId).toBe('L1');
  });

  it('returns nothing when every eBird spot is too far away', () => {
    expect(nearestEbirdSpot(spots, { lat: -28, lng: 153 })).toBeNull();
  });
});
