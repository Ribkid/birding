// Shared helpers for the field-tools screens (Scan and Listen).
// Sighting records match the shape the v1 sighting sheet wrote, and a photo is
// stored as a blob record first so the sighting can point at it.
import { db } from '../../core/db.js';
import { saveSighting } from '../lists/shared';

export interface SightingInput {
  speciesId: number;
  notes: string;
  photoBlob?: Blob | null;
  lat?: number | null;
  lng?: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const todayStr = (d = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const timeStr = (d = new Date()): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/** Write a sighting, keeping the picked photo as a blob record like v1 did. */
export async function logSighting({ speciesId, notes, photoBlob = null, lat = null, lng = null }: SightingInput): Promise<number> {
  let photoId: number | null = null;
  try {
    if (photoBlob) {
      photoId = (await db.add('photos', { blob: photoBlob, at: Date.now() })) as number;
    }
    const rec = {
      speciesId,
      count: 1,
      heard: false,
      date: todayStr(),
      time: timeStr(),
      lat,
      lng,
      acc: null,
      place: '',
      notes,
      photoId,
      outingId: null,
      createdAt: Date.now(),
    };
    // The shared save: a species new to the dex is celebrated, a badge earned is toasted and the nudge is offered,
    // as after v1's sighting sheet.
    return await saveSighting(rec);
  } catch (err) {
    // Don't leave an orphaned photo behind if the sighting could not be saved.
    if (photoId !== null) {
      try {
        await db.del('photos', photoId);
      } catch {
        /* the photo record is already gone or the store is unavailable */
      }
    }
    throw err;
  }
}
