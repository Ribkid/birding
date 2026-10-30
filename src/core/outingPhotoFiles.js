// Local-first outing photos: read only the capture date, then make clean JPEGs with no metadata.
import { db, raw } from './db.js';

export function scaledSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

export async function readExifDate(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
      const size = view.getUint16(at + 2);
      if (size < 2 || at + 2 + size > bytes.length) return null;
      if (marker === 0xe1 && size >= 8 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 &&
          bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66 && bytes[at + 8] === 0 && bytes[at + 9] === 0) {
        const found = dateInTiff(view, at + 10, at + 2 + size);
        if (found != null) return found;
      }
      at += 2 + size;
    }
  } catch { /* an unreadable or malformed header simply has no capture time */ }
  return null;
}

function dateInTiff(view, tiff, end) {
  if (tiff + 8 > end) return null;
  const little = view.getUint16(tiff) === 0x4949;
  if (!little && view.getUint16(tiff) !== 0x4d4d) return null;
  const u16 = at => view.getUint16(at, little);
  const u32 = at => view.getUint32(at, little);
  if (u16(tiff + 2) !== 42) return null;
  const ifd0 = tiff + u32(tiff + 4);
  const exif = findTag(ifd0, 0x8769);
  if (!exif) return null;
  const dateIfd = tiff + u32(exif.at + 8);
  const date = findTag(dateIfd, 0x9003);
  if (!date) return null;
  const start = date.size <= 4 ? date.at + 8 : tiff + u32(date.at + 8);
  if (start + 19 > end) return null;
  let text = '';
  for (let i = 0; i < 19; i++) text += String.fromCharCode(view.getUint8(start + i));
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const values = m.slice(1).map(Number);
  const result = new Date(values[0], values[1] - 1, values[2], values[3], values[4], values[5]).getTime();
  return Number.isNaN(result) ? null : result;

  function findTag(ifd, wanted) {
    if (ifd + 2 > end) return null;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      if (at + 12 > end) return null;
      if (u16(at) !== wanted) continue;
      const type = u16(at + 2), n = u32(at + 4);
      const unit = type === 2 ? 1 : type === 4 ? 4 : 0;
      if (!unit || n > 1000) return null;
      return { at, size: unit * n };
    }
    return null;
  }
}

export async function processOutingPhoto(file) {
  const takenAt = await readExifDate(file);
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(file));
  try {
    const size = scaledSize(bmp.width, bmp.height, 2048);
    const thumbSize = scaledSize(bmp.width, bmp.height, 480);
    const [blob, thumb] = await Promise.all([encode(bmp, size), encode(bmp, thumbSize)]);
    return { takenAt, w: size.w, h: size.h, blob, thumb };
  } finally {
    bmp.close?.();
  }
}

async function encode(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('This browser could not prepare the photo.');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, size.w, size.h);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('This browser could not prepare the photo.');
  return blob;
}

export function preselectPhotos(photos, outing, now = Date.now()) {
  const parsed = outing.startedAt != null ? Number(outing.startedAt) : Date.parse(`${outing.date}T${outing.time || '00:00'}`);
  if (!Number.isFinite(parsed)) return [];
  const end = outing.endedAt != null ? Number(outing.endedAt) : now;
  const margin = 30 * 60000;
  return photos.filter(photo => typeof photo.takenAt === 'number' && Number.isFinite(photo.takenAt) &&
    photo.takenAt >= parsed - margin && photo.takenAt <= Math.max(parsed, end) + margin);
}

export async function saveOutingPhotos(outingUid, prepared) {
  const saved = [];
  for (const photo of prepared) {
    const record = {
      uid: crypto.randomUUID(),
      kind: 'outing',
      outingUid,
      takenAt: photo.takenAt ?? null,
      w: photo.w,
      h: photo.h,
      blob: photo.blob,
      thumb: photo.thumb,
      ...(photo.speciesId != null ? { speciesId: photo.speciesId } : {}),
      ...(photo.uploadedAt != null ? { uploadedAt: photo.uploadedAt } : {}),
    };
    record.id = await raw.put('photos', record);
    saved.push(record);
  }
  return saved;
}

export async function listOutingPhotos(outingUid) {
  return (await db.all('photos'))
    .filter(photo => photo.kind === 'outing' && photo.outingUid === outingUid)
    .sort((a, b) => (b.id || 0) - (a.id || 0));
}
