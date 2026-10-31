import { describe, expect, it } from 'vitest';
import { snapshotIsCurrent } from '../../scripts/build-ebird.mjs';

describe('local eBird snapshot reuse', () => {
  it('reuses only an eBird snapshot built on the same UTC day', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(snapshotIsCurrent({ source: 'eBird', built: '2026-11-01T00:01:00Z' }, now)).toBe(true);
    expect(snapshotIsCurrent({ source: 'eBird', built: '2026-10-31T23:59:00Z' }, now)).toBe(false);
    expect(snapshotIsCurrent(null, now)).toBe(false);
  });
});
