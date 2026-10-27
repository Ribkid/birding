// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSighting, draftFromSighting, emptyDraft, type SightingRow } from '../screens/lists/shared';
import { SPECIES, byId } from '../lib/data';
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
        heard: true,
        date: '2026-10-02',
        time: '10:00',
        place: 'Home',
        lat: '-27.4',
        lng: '153.0',
        acc: 8,
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

  it('stores the new GPS accuracy when an edited sighting is re-located', () => {
    const stored = { id: 5, uid: 'u5', speciesId: 9, count: 2, heard: false, date: '2026-10-20', time: '07:15', lat: -27.5, lng: 153.0, acc: 12, place: 'Seed', notes: 'seed', photoId: null, outingId: null, createdAt: 1 } satisfies SightingRow;
    const draft = { ...draftFromSighting(stored), lat: '-27.470000', lng: '153.020000', acc: 15 };
    const { rec } = buildSighting(draft, { ...stored });
    expect(rec).toMatchObject({ id: 5, uid: 'u5', lat: -27.47, lng: 153.02, acc: 15 });
  });

  it('clears acc when the coordinates are removed', () => {
    const { rec } = buildSighting({ ...emptyDraft(), speciesId: 9, acc: 15 });
    expect(rec).toMatchObject({ lat: null, lng: null, acc: null });
  });

  it('loads and edits an old record that has none of the v1 extras', () => {
    const old = { id: 3, speciesId: 9, date: '2026-01-02', time: '08:00', notes: 'old' } as SightingRow;
    const draft = draftFromSighting(old);
    expect(draft).toMatchObject({ heard: false, acc: null, note: 'old' });
    const { rec } = buildSighting(draft, { ...old });
    // v1's edit keeps the record as stored and sets heard; it does not pad the other fields with nulls.
    expect(rec).toMatchObject({ id: 3, heard: false, notes: 'old' });
    expect(rec).not.toHaveProperty('acc');
    expect(rec).not.toHaveProperty('photoId');
    expect(rec).not.toHaveProperty('outingId');
  });

  it('adds acc to an old record once it is re-located', () => {
    const old = { id: 4, speciesId: 9, date: '2026-01-02', time: '08:00', lat: -27.6, lng: 153.1 } as SightingRow;
    const { rec } = buildSighting({ ...draftFromSighting(old), lat: '-27.47', lng: '153.02', acc: 15 }, { ...old });
    expect(rec).toMatchObject({ lat: -27.47, lng: 153.02, acc: 15 });
  });
});

describe('a new sighting', () => {
  it('has exactly the keys v1 writes', () => {
    const { rec } = buildSighting({ ...emptyDraft(), speciesId: 9, lat: '-27.47', lng: '153.02', acc: 15, place: 'Park', note: ' seen ' });
    expect(Object.keys(rec!).sort()).toEqual(
      ['acc', 'count', 'date', 'heard', 'lat', 'lng', 'notes', 'outingId', 'photoId', 'place', 'speciesId', 'time'],
    );
    expect(rec).toMatchObject({ speciesId: 9, count: 1, heard: false, lat: -27.47, lng: 153.02, acc: 15, place: 'Park', notes: 'seen', photoId: null, outingId: null });
  });

  it('keeps Heard only for an animal and drops it for a plant', () => {
    // Plants load at run time from species-new.json, so the test adds one.
    const plantId = 990001;
    byId.set(plantId, { ...SPECIES[0], id: plantId, kind: 'plant' });
    try {
      expect(buildSighting({ ...emptyDraft(), speciesId: 9, heard: true }).rec?.heard).toBe(true);
      expect(buildSighting({ ...emptyDraft(), speciesId: plantId, heard: true }).rec?.heard).toBe(false);
    } finally {
      byId.delete(plantId);
    }
  });
});

describe('legacy notes', () => {
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
