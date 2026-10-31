import { describe, expect, it } from 'vitest';
import {
  compactSnapshot,
  mapTaxonomy,
} from '../../scripts/build-ebird.mjs';

const birds = [
  { id: 1, name: 'First Bird', sci: 'Birdus primus' },
  { id: 2, name: 'Renamed Bird', sci: 'Birdus novus' },
  { id: 3, name: 'Missing Bird', sci: 'Birdus absentus' },
];

describe('eBird taxonomy mapping', () => {
  it('maps eBird species codes to app ids by scientific name and reports unmatched birds', () => {
    const result = mapTaxonomy([
      { speciesCode: 'birpri', sciName: 'Birdus primus' },
      { speciesCode: 'other', sciName: 'Other bird' },
    ], birds);

    expect([...result.byCode]).toEqual([['birpri', 1]]);
    expect(result.unmatched.map((bird) => bird.name)).toEqual(['Renamed Bird', 'Missing Bird']);
  });

  it('uses the explicit scientific-name aliases for app birds with different eBird names', () => {
    const result = mapTaxonomy([
      { speciesCode: 'birren', sciName: 'Birdus veterus' },
    ], birds, { 'Birdus novus': 'Birdus veterus' });

    expect(result.byCode.get('birren')).toBe(2);
    expect(result.unmatched.map((bird) => bird.id)).toEqual([1, 3]);
  });
});

describe('compact eBird snapshots', () => {
  it('keeps the designed tuple schema, drops unknown species and deduplicates recent birds', () => {
    const byCode = new Map([['birpri', 1], ['birren', 2]]);
    const result = compactSnapshot({
      byCode,
      hotspots: [
        { locId: 'L2', locName: 'Small', lat: -27, lng: 153, numSpeciesAllTime: 9, numChecklistsAllTime: 4, latestObsDt: '2026-10-01', subnational2Code: 'AU-QLD-BRI' },
        { locId: 'L1', locName: 'Rich', lat: -28, lng: 152, numSpeciesAllTime: 40, numChecklistsAllTime: 90, latestObsDt: '2026-10-30 08:15', subnational2Code: 'AU-QLD-GOL' },
      ],
      lists: { L1: ['birpri', 'unknown', 'birren'] },
      recent: [
        { locId: 'L1', speciesCode: 'birpri', obsDt: '2026-10-29 07:00' },
        { locId: 'L1', speciesCode: 'birpri', obsDt: '2026-10-30 07:00' },
        { locId: 'L1', speciesCode: 'unknown', obsDt: '2026-10-30' },
      ],
      notable: [
        { locId: 'L1', locName: 'Rich', speciesCode: 'birren', comName: 'Renamed Bird', lat: -28, lng: 152, obsDt: '2026-10-30 09:00', howMany: 3 },
        { locId: 'L2', locName: 'Small', speciesCode: 'unknown', comName: 'Unknown', lat: -27, lng: 153, obsDt: '2026-10-29', howMany: 1 },
        // The same sighting can arrive from two neighbouring region feeds.
        { locId: 'L1', locName: 'Rich', speciesCode: 'birren', comName: 'Renamed Bird', lat: -28, lng: 152, obsDt: '2026-10-30 09:00', howMany: 3 },
      ],
      built: '2026-11-01T00:00:00.000Z',
    });

    expect(result.spots).toEqual([
      ['L1', 'Rich', -28, 152, 40, 90, '2026-10-30 08:15', 'GOL'],
    ]);
    expect(result.lists).toEqual({ L1: [1, 2] });
    expect(result.codes).toEqual({ birpri: 1, birren: 2 });
    expect(result.recent).toEqual({ L1: [[1, '2026-10-30']] });
    expect(result.notable).toEqual([
      { id: 2, name: 'Renamed Bird', loc: 'L1', where: 'Rich', lat: -28, lng: 152, date: '2026-10-30 09:00', n: 3 },
    ]);
    expect(result.built).toBe('2026-11-01T00:00:00.000Z');
    expect(result.source).toBe('eBird');
  });
});
