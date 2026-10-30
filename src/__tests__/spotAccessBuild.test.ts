// The access score baked into public/data/spot-access.json by scripts/build-spot-access.mjs. The formula is
// pure, so it is held here: what earns a point, the 1–5 bounds, the restricted-access cap, and "not known"
// when nothing useful is tagged.
import { describe, expect, it } from 'vitest';
import { emptySummary, scoreAccess } from '../../scripts/build-spot-access.mjs';

/** A summary with the given counts, all else zero. */
function summary(patch: Record<string, unknown> = {}) {
  return Object.assign(emptySummary(), { elements: 1 }, patch);
}

const wheel = (yes = 0, limited = 0) => ({ yes, limited });
const access = (yes = 0, priv = 0, no = 0) => ({ yes, private: priv, no });

describe('the access score', () => {
  it('is unknown when nothing is tagged', () => {
    expect(scoreAccess(emptySummary(), 'Somewhere')).toEqual({ score: null, reasons: [], note: null });
    expect(scoreAccess(null, 'Somewhere').score).toBeNull();
    // Nearby tags that say nothing about access do not make a score with no reason.
    expect(scoreAccess(summary(), 'Somewhere').score).toBeNull();
  });

  it('scores a car park within 250 m as 2, with its distance', () => {
    const result = scoreAccess(summary({ parking: 1, nearestParkingM: 60 }), 'Somewhere');
    expect(result.score).toBe(2);
    expect(result.reasons).toEqual(['Parking 60 m']);
  });

  it('gives half a point for parking out at 400 m, which still rounds to 2', () => {
    expect(scoreAccess(summary({ parking: 1, nearestParkingM: 380 })).score).toBe(2);
    // With toilets too, near parking reaches 3 and far parking stays 2.5, which rounds to 3 as well.
    expect(scoreAccess(summary({ parking: 1, nearestParkingM: 60, toilets: 1 })).score).toBe(3);
  });

  it('rewards toilets, a bird hide, paved paths and wheelchair access', () => {
    const full = scoreAccess(
      summary({
        parking: 1, nearestParkingM: 60, toilets: 1, birdHides: 1,
        pavedPaths: 3, boardwalks: 1, wheelchair: wheel(1), shelters: 1, picnicTables: 2,
      }),
      'Lake A',
    );
    expect(full.score).toBe(5);
    expect(full.reasons).toEqual([
      'Parking 60 m', 'Toilets', 'Bird hide', 'Paved paths and boardwalk',
      'Wheelchair access', 'Picnic tables and shelter',
    ]);
    expect(full.note).toBeNull();
  });

  it('names a boardwalk on its own, and limited wheelchair access without a point', () => {
    const result = scoreAccess(summary({ boardwalks: 2, wheelchair: wheel(0, 1) }), 'Boardwalk');
    expect(result.reasons).toEqual(['Boardwalk', 'Limited wheelchair access']);
    expect(result.score).toBe(2); // 1 + path 1
  });

  it('caps "restricted access" in the name at 2 and says so', () => {
    const result = scoreAccess(
      summary({ parking: 1, nearestParkingM: 40, toilets: 1, birdHides: 1, pavedPaths: 4, wheelchair: wheel(1) }),
      'Golds Scrub Lane (some areas restricted access)',
    );
    expect(result.score).toBe(2);
    expect(result.note).toBe('Restricted access');
  });

  it('caps private or closed access tags at 2 too', () => {
    const result = scoreAccess(
      summary({ parking: 1, nearestParkingM: 40, toilets: 1, birdHides: 1, access: access(0, 1, 0) }),
      'A reserve',
    );
    expect(result.score).toBe(2);
    expect(result.note).toBe('Some access is private or closed');
  });

  it('never falls below 1 or rises above 5', () => {
    const small = scoreAccess(summary({ fee: { yes: 1, no: 0 } }), 'Charged');
    expect(small.score).toBe(1);
    expect(small.reasons).toEqual(['Entry fee']);
    const huge = scoreAccess(
      summary({ parking: 1, nearestParkingM: 5, toilets: 4, birdHides: 2, pavedPaths: 9, boardwalks: 9, wheelchair: wheel(3), shelters: 3, picnicTables: 3 }),
      'Big',
    );
    expect(huge.score).toBe(5);
  });

  it('says an entry fee where OSM has one', () => {
    const result = scoreAccess(summary({ parking: 1, nearestParkingM: 90, fee: { yes: 1, no: 0 } }), 'Park');
    expect(result.reasons).toContain('Entry fee');
  });
});
