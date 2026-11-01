import { describe, expect, it } from 'vitest';
import { compactSnapshot } from '../../scripts/build-ebird.mjs';
import { badges } from '../core/stats.js';
import { areaProgress, assignSightingArea } from '../lib/areas';
import type { EbirdSnapshot } from '../lib/ebird';

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [
    ['L1', 'Brisbane Park', -27.5, 153.02, 100, 500, '2026-10-30', 'BRI'],
    ['L2', 'Gold Coast Park', -28.0, 153.4, 80, 400, '2026-10-30', 'GOL'],
    ['L3', 'Sunshine Coast Park', -26.6, 153.0, 70, 300, '2026-10-30', 'SUN'],
  ],
  lists: {},
  recent: {},
  notable: [],
  codes: { birda: 1, birdb: 2, birdc: 3 },
  regions: {
    BRI: { name: 'Brisbane', ids: [1, 2, 3] },
    GOL: { name: 'Gold Coast', ids: [2, 3] },
    SUN: { name: 'Sunshine Coast', ids: [1, 3] },
  },
} as unknown as EbirdSnapshot;

describe('council-area assignment', () => {
  it('uses the nearest eBird hotspot within three kilometres and ignores sightings elsewhere', () => {
    expect(assignSightingArea({ lat: -27.51, lng: 153.02 }, SNAPSHOT)).toBe('BRI');
    expect(assignSightingArea({ lat: -28.01, lng: 153.39 }, SNAPSHOT)).toBe('GOL');
    expect(assignSightingArea({ lat: -27.7, lng: 153.02 }, SNAPSHOT)).toBeNull();
    expect(assignSightingArea({ lat: null, lng: 153.02 }, SNAPSHOT)).toBeNull();
  });

  it('counts each species once per area, and only while it is on that area list', () => {
    const progress = areaProgress([
      { id: 1, speciesId: 1, date: '2026-10-01', time: '06:00', lat: -27.51, lng: 153.02 },
      { id: 2, speciesId: 1, date: '2026-10-02', time: '06:00', lat: -27.52, lng: 153.02 },
      { id: 3, speciesId: 2, date: '2026-10-03', time: '06:00', lat: -27.51, lng: 153.02 },
      { id: 4, speciesId: 1, date: '2026-10-04', time: '06:00', lat: -28.01, lng: 153.39 },
      { id: 5, speciesId: 3, date: '2026-10-05', time: '06:00', lat: null, lng: null },
    ], SNAPSHOT);

    expect(progress.find((area) => area.code === 'BRI')).toMatchObject({ seen: 2, total: 3 });
    expect(progress.find((area) => area.code === 'GOL')).toMatchObject({ seen: 0, total: 2 });
    expect(progress.find((area) => area.code === 'SUN')).toMatchObject({ seen: 0, total: 2 });
  });
});

describe('the area badges', () => {
  it('adds the three area badges after the existing list without changing earlier ids', () => {
    const before = badges([], []) as { id: string }[];
    const after = badges([], [], {}, [
      { code: 'BRI', name: 'Brisbane', seen: 105, total: 405 },
      { code: 'GOL', name: 'Gold Coast', seen: 2, total: 300 },
      { code: 'SUN', name: 'Sunshine Coast', seen: 1, total: 280 },
    ]) as { id: string; name: string; have: number; need: number; done: boolean }[];

    expect(after.slice(0, before.length).map((badge) => badge.id)).toEqual(before.map((badge) => badge.id));
    expect(after.slice(-3)).toMatchObject([
      { name: '100 in one area', have: 100, need: 100, done: true },
      { name: 'Five areas', have: 3, need: 5, done: false },
      { name: 'Every SEQ area', have: 3, need: 3, done: true },
    ]);
  });
});

describe('the region snapshot', () => {
  it('maps each council area species list through the app taxonomy', () => {
    const result = compactSnapshot({
      byCode: new Map([['birda', 1], ['birdb', 2]]),
      hotspots: [],
      lists: {},
      regionLists: { BRI: ['birda', 'unknown', 'birdb', 'birda'], GOL: ['birdb'] },
      recent: [],
      notable: [],
      built: '2026-11-01T00:00:00.000Z',
    });

    expect(result.regions).toEqual({
      BRI: { name: 'Brisbane', ids: [1, 2] },
      GOL: { name: 'Gold Coast', ids: [2] },
    });
  });
});
