// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSighting, type SightingRow } from '../screens/lists/shared';
import { normaliseSighting } from '../lib/hooks';

describe('editing a sighting', () => {
  it('keeps every stored field, including uid, acc and outingUid', () => {
    const stored = {
      id: 12,
      uid: 'stored-uid',
      updatedAt: 1234,
      createdAt: 1000,
      acc: 8,
      outingUid: 'outing-uid',
      outingId: 3,
      photoId: 4,
      heard: true,
      speciesId: 7,
      count: 2,
      date: '2026-10-01',
      time: '09:30',
      place: 'Home',
      lat: -27.4,
      lng: 153.0,
      notes: 'by the creek',
    } satisfies SightingRow;

    const { rec } = buildSighting(
      {
        speciesId: 7,
        count: '3',
        date: '2026-10-02',
        time: '10:00',
        place: 'Home',
        lat: '-27.4',
        lng: '153.0',
        note: 'by the creek',
      },
      { ...stored },
    );

    expect(rec).toMatchObject({
      id: 12,
      uid: 'stored-uid',
      updatedAt: 1234,
      createdAt: 1000,
      acc: 8,
      outingUid: 'outing-uid',
      outingId: 3,
      photoId: 4,
      heard: true,
      count: 3,
      notes: 'by the creek',
    });
    expect(rec).not.toHaveProperty('note');
  });

  it('maps a legacy note into notes once on read and drops the note key', () => {
    const row = normaliseSighting({ id: 1, speciesId: 2, note: 'old note' });
    expect(row.notes).toBe('old note');
    expect(row).not.toHaveProperty('note');
  });

  it('keeps notes when both fields are present', () => {
    const row = normaliseSighting({ id: 1, speciesId: 2, notes: 'new', note: 'old' });
    expect(row.notes).toBe('new');
    expect(row).not.toHaveProperty('note');
  });
});
