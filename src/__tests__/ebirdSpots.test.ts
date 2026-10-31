import { describe, expect, it } from 'vitest';
import {
  applySpotVisibility,
  buildRows,
  filterSpots,
  NO_FILTERS,
  sortSpots,
  suggestSpots,
  type HotspotLike,
} from '../lib/spots';

const spot = (locId: string, name: string, rich: number, checklists: number, latestObsDt: string | null, sp: [number, number][], hasList = true): HotspotLike => ({
  locId, name, lat: -27.5, lng: 153, rich, checklists, latestObsDt, sp, hasList,
});

const ROWS = [
  spot('L1', 'Old quiet', 100, 10, '2026-09-01', [[1, 0], [2, 0], [3, 0]]),
  spot('L2', 'Fresh busy', 80, 500, '2026-10-30', [[1, 0], [2, 0]]),
  spot('L3', 'Small fresh', 20, 50, '2026-10-29', [[3, 0]]),
  spot('L4', 'No baked list', 200, 5, '2026-10-30', [], false),
];

describe('eBird spot rows', () => {
  it('uses locId for access and all-time checklists for Most visited', () => {
    const rows = buildRows(ROWS, { L2: { name: 'Fresh busy', score: 5 } as never }, new Set(), null);
    expect(rows[1].access?.score).toBe(5);
    expect(rows[0].access).toBeNull();
    expect(sortSpots(rows, 'records').map((row) => row.locId)).toEqual(['L2', 'L3', 'L1', 'L4']);
  });

  it('sorts Recently birded by the latest observation, with unknown dates last', () => {
    const rows = buildRows([...ROWS, spot('L5', 'Never', 300, 0, null, [])], null, new Set(), null);
    expect(sortSpots(rows, 'recent').map((row) => row.locId)).toEqual(['L4', 'L2', 'L3', 'L1', 'L5']);
  });

  it('puts spots without a baked list after listed spots for New for you', () => {
    const rows = buildRows(ROWS, null, new Set([1, 2, 3]), null);
    expect(sortSpots(rows, 'new').map((row) => row.locId)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  it('filters spots birded in the last seven days', () => {
    const rows = buildRows(ROWS, null, new Set(), null);
    const filtered = filterSpots(rows, { ...NO_FILTERS, birdedWeek: true }, '', new Date('2026-11-01T12:00:00Z'));
    expect(filtered.map((row) => row.locId)).toEqual(['L2', 'L3', 'L4']);
  });

  it('shows 40-plus species by default, everything on demand, and all matches when searching', () => {
    const rows = buildRows(ROWS, null, new Set(), null);
    expect(applySpotVisibility(rows, '', false).map((row) => row.locId)).toEqual(['L1', 'L2', 'L4']);
    expect(applySpotVisibility(rows, '', true)).toHaveLength(4);
    expect(filterSpots(applySpotVisibility(rows, 'small', false), NO_FILTERS, 'small').map((row) => row.locId)).toEqual(['L3']);
  });

  it('boosts a recently birded spot with birds new for her in suggestions', () => {
    const rows = buildRows(ROWS, null, new Set(), null);
    expect(suggestSpots(rows, null, 1, new Date('2026-11-01T12:00:00Z').getTime())[0].locId).toBe('L2');
  });
});
