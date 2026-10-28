// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSighting, draftFromSighting, emptyDraft, type SightingRow } from '../screens/lists/shared';
import { SPECIES, byId } from '../lib/data';
import { normaliseSighting } from '../lib/hooks';

// A located draft, as Use my location leaves it (v1 Object.assign(rec, { lat, lng, acc })).
const located = { lat: -27.47, lng: 153.02, acc: 15, moved: true };

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

    const { rec } = buildSighting({ ...draftFromSighting(stored), count: '3', date: '2026-10-02', time: '10:00' }, { ...stored });

    expect(rec).toMatchObject({
      id: 12,
      uid: 'stored-uid',
      updatedAt: 1234,
      createdAt: 1000,
      acc: 8,
      lat: -27.4,
      lng: 153.0,
      outingUid: 'outing-uid',
      outingId: 3,
      photoId: 4,
      heard: true,
      count: 3,
      date: '2026-10-02',
      time: '10:00',
      notes: 'by the creek',
    });
    expect(rec).not.toHaveProperty('note');
  });

  it('stores the new GPS accuracy when an edited sighting is re-located', () => {
    const stored = { id: 5, uid: 'u5', speciesId: 9, count: 2, heard: false, date: '2026-10-20', time: '07:15', lat: -27.5, lng: 153.0, acc: 12, place: 'Seed', notes: 'seed', photoId: null, outingId: null, createdAt: 1 } satisfies SightingRow;
    const { rec } = buildSighting({ ...draftFromSighting(stored), ...located }, { ...stored });
    expect(rec).toMatchObject({ id: 5, uid: 'u5', lat: -27.47, lng: 153.02, acc: 15 });
  });

  it('clears acc when a place chip or the map sets the spot', () => {
    const stored = { id: 6, speciesId: 9, date: '2026-10-20', time: '07:15', lat: -27.5, lng: 153.0, acc: 12 } as SightingRow;
    const { rec } = buildSighting({ ...draftFromSighting(stored), lat: -27.55, lng: 152.98, acc: null, moved: true }, { ...stored });
    expect(rec).toMatchObject({ lat: -27.55, lng: 152.98, acc: null });
  });

  it('loads and edits an old record that has none of the v1 extras', () => {
    const old = { id: 3, speciesId: 9, date: '2026-01-02', time: '08:00', notes: 'old' } as SightingRow;
    const draft = draftFromSighting(old);
    expect(draft).toMatchObject({ heard: false, acc: null, notes: 'old', moved: false });
    const { rec } = buildSighting(draft, { ...old });
    // v1's edit keeps the record as stored and sets heard; it does not pad the other fields with nulls.
    expect(rec).toMatchObject({ id: 3, heard: false, notes: 'old' });
    expect(rec).not.toHaveProperty('acc');
    expect(rec).not.toHaveProperty('lat');
    expect(rec).not.toHaveProperty('photoId');
    expect(rec).not.toHaveProperty('outingId');
  });

  it('adds acc to an old record once it is re-located', () => {
    const old = { id: 4, speciesId: 9, date: '2026-01-02', time: '08:00', lat: -27.6, lng: 153.1 } as SightingRow;
    const { rec } = buildSighting({ ...draftFromSighting(old), ...located }, { ...old });
    expect(rec).toMatchObject({ lat: -27.47, lng: 153.02, acc: 15 });
  });

  it('never moves an edited sighting into the running outing', () => {
    const stored = { id: 8, speciesId: 9, date: '2026-10-20', time: '07:15', outingId: null, place: 'Home' } as SightingRow;
    const { rec } = buildSighting(draftFromSighting(stored), { ...stored }, { outing: { id: 2, lat: -27.44, lng: 153.17, place: 'Wetlands' } });
    expect(rec).toMatchObject({ outingId: null, place: 'Home' });
  });
});

describe('a new sighting', () => {
  it('has exactly the keys v1 writes, in v1 order', () => {
    const { rec } = buildSighting({ ...emptyDraft(9), ...located, place: ' Park ', notes: ' seen ' });
    expect(Object.keys(rec!)).toEqual(
      ['speciesId', 'count', 'heard', 'date', 'time', 'lat', 'lng', 'acc', 'place', 'notes', 'photoId', 'outingId'],
    );
    expect(rec).toMatchObject({ speciesId: 9, count: 1, heard: false, lat: -27.47, lng: 153.02, acc: 15, place: 'Park', notes: 'seen', photoId: null, outingId: null });
  });

  it('starts nowhere: lat, lng and acc are null until she locates it', () => {
    const { rec } = buildSighting(emptyDraft(9));
    expect(rec).toMatchObject({ lat: null, lng: null, acc: null, place: '' });
  });

  it('keeps acc only with coordinates', () => {
    const { rec } = buildSighting({ ...emptyDraft(9), acc: 15 });
    expect(rec).toMatchObject({ lat: null, lng: null, acc: null });
  });

  it('keeps Heard only for an animal and drops it for a plant', () => {
    // Plants load at run time from species-new.json, so the test adds one.
    const plantId = 990001;
    byId.set(plantId, { ...SPECIES[0], id: plantId, kind: 'plant' });
    try {
      expect(buildSighting({ ...emptyDraft(9), heard: true }).rec?.heard).toBe(true);
      expect(buildSighting({ ...emptyDraft(plantId), heard: true }).rec?.heard).toBe(false);
    } finally {
      byId.delete(plantId);
    }
  });

  it('reads How many as v1 did: blank is no count, anything else at least one', () => {
    expect(buildSighting({ ...emptyDraft(9), count: '' }).rec?.count).toBeNull();
    expect(buildSighting({ ...emptyDraft(9), count: '4' }).rec?.count).toBe(4);
    expect(buildSighting({ ...emptyDraft(9), count: '0' }).rec?.count).toBe(1);
    expect(buildSighting({ ...emptyDraft(9), count: 'lots' }).rec?.count).toBe(1);
  });

  it('joins the running outing and takes its place when Add to current outing is ticked', () => {
    const outing = { id: 2, lat: -27.44, lng: 153.17, place: 'Sandy Camp Road Wetlands' };
    const { rec } = buildSighting({ ...emptyDraft(9), ...located, place: 'Typed place' }, {}, { outing });
    expect(rec).toMatchObject({ outingId: 2, lat: -27.44, lng: 153.17, acc: null, place: 'Sandy Camp Road Wetlands' });
    // Unticked, it stays a loose sighting where she was.
    expect(buildSighting({ ...emptyDraft(9), ...located }, {}, { outing: null }).rec).toMatchObject({ outingId: null, lat: -27.47, acc: 15 });
  });

  it('points at a new photo, and drops a removed one', () => {
    expect(buildSighting(emptyDraft(9), {}, { photoId: 31 }).rec?.photoId).toBe(31);
    const stored = { id: 9, speciesId: 9, date: '2026-10-20', time: '07:15', photoId: 4 } as SightingRow;
    expect(buildSighting(draftFromSighting(stored), { ...stored }).rec?.photoId).toBe(4);
    expect(buildSighting(draftFromSighting(stored), { ...stored }, { photoId: null }).rec?.photoId).toBeNull();
    expect(buildSighting(draftFromSighting(stored), { ...stored }, { photoId: 32 }).rec?.photoId).toBe(32);
  });

  it("asks for the species and the date in v1's words", () => {
    expect(buildSighting(emptyDraft()).error).toBe('Choose what you saw.');
    expect(buildSighting({ ...emptyDraft(9), date: '' }).error).toBe('Add the date of the sighting.');
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
