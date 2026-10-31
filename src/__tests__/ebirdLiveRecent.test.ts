import { describe, expect, it } from 'vitest';
import { mapLiveRecent } from '../lib/ebird';

describe('live recent observations', () => {
  it('keeps only the latest report of each species at a hotspot', () => {
    const rows = mapLiveRecent([
      { code: 'birpri', sci: 'Birdus primus', name: 'First Bird', date: '2026-10-29 08:00', n: 1 },
      { code: 'birpri', sci: 'Birdus primus', name: 'First Bird', date: '2026-10-30 08:00', n: 3 },
    ], [{ id: 1, sci: 'Birdus primus' }]);

    expect(rows).toEqual([{ id: 1, date: '2026-10-30 08:00', n: 3 }]);
  });
});
