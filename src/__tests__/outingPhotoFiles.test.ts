// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored: any[] = [];
vi.mock('../core/db.js', () => ({
  db: { all: async (name: string) => name === 'photos' ? stored : [] },
  raw: {
    put: async (_name: string, value: any) => {
      if (value.id == null) value.id = stored.length + 1;
      const at = stored.findIndex((r) => r.id === value.id);
      if (at < 0) stored.push(value); else stored[at] = value;
      return value.id;
    },
  },
}));

import {
  listOutingPhotos,
  preselectPhotos,
  processOutingPhoto,
  readExifDate,
  saveOutingPhotos,
  scaledSize,
} from '../core/outingPhotoFiles.js';

function exifFixture(): File {
  const tiff = new Uint8Array(64);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x8769, true);
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 26, true);
  v.setUint32(22, 0, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 0x9003, true);
  v.setUint16(30, 2, true);
  v.setUint32(32, 20, true);
  v.setUint32(36, 44, true);
  v.setUint32(40, 0, true);
  tiff.set(new TextEncoder().encode('2026:10:30 07:15:24\0'), 44);
  const app1 = new Uint8Array(6 + tiff.length);
  app1.set(new TextEncoder().encode('Exif\0\0'), 0);
  app1.set(tiff, 6);
  const bytes = new Uint8Array(2 + 4 + app1.length + 2);
  bytes.set([0xff, 0xd8, 0xff, 0xe1], 0);
  new DataView(bytes.buffer).setUint16(4, app1.length + 2);
  bytes.set(app1, 6);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return new File([bytes], 'bird.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  stored.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EXIF capture time', () => {
  it('reads DateTimeOriginal as the phone’s local capture time', async () => {
    expect(await readExifDate(exifFixture())).toBe(new Date(2026, 9, 30, 7, 15, 24).getTime());
  });

  it('returns null for a JPEG without EXIF', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'plain.jpg', { type: 'image/jpeg' });
    expect(await readExifDate(file)).toBeNull();
  });
});

describe('re-encoding', () => {
  it('keeps small photos their size and scales either orientation to the long edge', () => {
    expect(scaledSize(4000, 2000, 2048)).toEqual({ w: 2048, h: 1024 });
    expect(scaledSize(1000, 4000, 2048)).toEqual({ w: 512, h: 2048 });
    expect(scaledSize(640, 480, 2048)).toEqual({ w: 640, h: 480 });
    expect(scaledSize(1000, 4000, 480)).toEqual({ w: 120, h: 480 });
  });

  it('returns new full-size and thumbnail JPEGs, not the metadata-bearing original', async () => {
    const sizes: number[][] = [];
    const qualities: number[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 2000, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn(), imageSmoothingQuality: 'high' }) as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type, quality) {
      sizes.push([this.width, this.height]);
      qualities.push(Number(quality));
      cb(new Blob(['re-encoded'], { type }));
    });

    const original = exifFixture();
    const photo = await processOutingPhoto(original);
    expect(photo).toMatchObject({ takenAt: new Date(2026, 9, 30, 7, 15, 24).getTime(), w: 2048, h: 1024 });
    expect(sizes).toEqual([[2048, 1024], [480, 240]]);
    expect(qualities).toEqual([0.82, 0.82]);
    expect(await photo.blob.text()).toBe('re-encoded');
    expect(await photo.thumb.text()).toBe('re-encoded');
    expect(photo.blob).not.toBe(original);
  });
});

describe('outing time-window preselection', () => {
  it('selects capture times from 30 minutes before start through 30 minutes after end', () => {
    const outing = { startedAt: new Date(2026, 9, 30, 7).getTime(), endedAt: new Date(2026, 9, 30, 9).getTime() };
    const photos = [
      { takenAt: new Date(2026, 9, 30, 6, 29, 59).getTime() },
      { takenAt: new Date(2026, 9, 30, 6, 30).getTime() },
      { takenAt: new Date(2026, 9, 30, 9, 30).getTime() },
      { takenAt: new Date(2026, 9, 30, 9, 30, 1).getTime() },
      { takenAt: null },
    ];
    expect(preselectPhotos(photos, outing)).toEqual([photos[1], photos[2]]);
  });

  it('uses the current time as the end of a live outing and falls back to its date and start time', () => {
    const now = new Date(2026, 9, 30, 8).getTime();
    const outing = { date: '2026-10-30', time: '07:00' };
    const inside = { takenAt: new Date(2026, 9, 30, 7, 45).getTime() };
    const after = { takenAt: new Date(2026, 9, 30, 8, 31).getTime() };
    expect(preselectPhotos([inside, after], outing, now)).toEqual([inside]);
  });
});

describe('local outing photo records', () => {
  it('stores only the new outing shape and finds it without mixing in sighting photos', async () => {
    stored.push({ id: 1, uid: 'sighting-photo', blob: new Blob(['sighting']) });
    const prepared = { takenAt: 123, w: 2048, h: 1024, blob: new Blob(['full']), thumb: new Blob(['thumb']) };
    const [saved] = await saveOutingPhotos('outing-uid', [prepared]);
    expect(saved).toMatchObject({ uid: expect.any(String), kind: 'outing', outingUid: 'outing-uid', ...prepared });
    expect(saved).not.toHaveProperty('uploadedAt');
    expect(await listOutingPhotos('outing-uid')).toEqual([saved]);
    expect(await listOutingPhotos('another-outing')).toEqual([]);
  });
});
