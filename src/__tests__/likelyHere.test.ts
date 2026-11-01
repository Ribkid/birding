import { describe, expect, it } from 'vitest';
import { BIRDS } from '../lib/data';
import type { EbirdSnapshot, LiveRecent } from '../lib/ebird';
import { liveLikely, nearestHotspotWithin, nearestSavedHotspotWithin, rankLikely, snapshotLikely } from '../lib/likelyHere';

const ids = BIRDS.slice(0, 6).map((bird) => bird.id);

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [
    ['LNEAR', 'Near Park', -27.5005, 153.0205, 100, 500, '2026-10-31', 'BRI'],
    ['LFAR', 'Far Park', -27.54, 153.06, 100, 500, '2026-10-31', 'BRI'],
  ],
  lists: { LNEAR: [ids[4], ids[0]], LFAR: [ids[5], ids[0]] },
  recent: {
    LNEAR: [[ids[0], '2026-10-31'], [ids[1], '2026-10-20'], [ids[2], '2026-09-01']],
  },
  notable: [],
  codes: { aa: ids[0], bb: ids[1], cc: ids[2], dd: ids[3] },
} as unknown as EbirdSnapshot;

describe('likely here', () => {
  it('chooses a hotspot within one kilometre and refuses a farther one', () => {
    const near = nearestHotspotWithin(SNAPSHOT, { lat: -27.5, lng: 153.02 });
    expect(near?.spot[0]).toBe('LNEAR');
    expect(near?.distanceKm).toBeLessThan(1);
    expect(nearestHotspotWithin(SNAPSHOT, { lat: -27.6, lng: 153.12 })).toBeNull();
  });

  it('falls back to the nearest hotspot inside one kilometre that actually has saved data', () => {
    const withBlank = {
      ...SNAPSHOT,
      spots: [
        ['LBLANK', 'Blank Park', -27.5001, 153.02, 100, 500, '2026-10-31', 'BRI'],
        ['LSAVED', 'Saved Park', -27.5005, 153.0205, 80, 400, '2026-10-31', 'BRI'],
      ],
      lists: { LSAVED: [ids[0]] },
      recent: {},
    } as unknown as EbirdSnapshot;
    const point = { lat: -27.5, lng: 153.02 };
    expect(nearestHotspotWithin(withBlank, point)?.spot[0]).toBe('LBLANK');
    expect(nearestSavedHotspotWithin(withBlank, point)?.spot[0]).toBe('LSAVED');
  });

  it('puts birds she has never seen first and leaves out ones already on the tally', () => {
    const seen = new Set([ids[0], ids[4]]);
    const counted = new Set([ids[2]]);
    expect(rankLikely([ids[0], ids[1], ids[2], ids[3], ids[1], 999999], seen, counted).map((sp) => sp.id))
      .toEqual([ids[1], ids[3], ids[0]]);
  });

  it('uses the last 30 days of the saved spot first, then its saved species list', () => {
    const now = new Date('2026-11-01T10:00:00');
    const recent = snapshotLikely(SNAPSHOT, 'LNEAR', new Set(), new Set(), now);
    expect(recent.map((sp) => sp.id)).toEqual([ids[0], ids[1]]);

    const list = snapshotLikely(SNAPSHOT, 'LFAR', new Set(), new Set(), now);
    expect(list.map((sp) => sp.id)).toEqual([ids[5], ids[0]]);
  });

  it('maps live 30-day observations through the eBird codes', () => {
    const rows: LiveRecent[] = [
      { code: 'aa', sci: '', name: '', date: '2026-10-31 07:00', n: 1 },
      { code: 'bb', sci: '', name: '', date: '2026-10-30 07:00', n: 2 },
      { code: 'aa', sci: '', name: '', date: '2026-10-29 07:00', n: 1 },
    ];
    expect(liveLikely(rows, SNAPSHOT, new Set([ids[0]]), new Set()).map((sp) => sp.id))
      .toEqual([ids[1], ids[0]]);
  });
});
