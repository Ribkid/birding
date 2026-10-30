// Public outing photos: a small background queue beside the private sighting-photo sync.
// Local records remain usable with no account and no connection; every remote write is idempotent by uid.
import { db, raw } from './db.js';
import { client, user, onAuth } from './cloud.js';
import { SUPABASE_URL } from './config.js';
import { saveOutingPhotos } from './outingPhotoFiles.js';

const BUCKET = 'outing-photos';
const DELETES_KEY = 'outingPhotos:deletes';
const listeners = new Set();
const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* one screen must not stop the queue */ } } };

export function onOutingPhotosChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function outingPhotoPaths(userId, photo) {
  const base = `${userId}/${photo.outingUid}/${photo.uid}`;
  return { path: `${base}.jpg`, thumbPath: `${base}_t.jpg` };
}

export async function addOutingPhotos(outingUid, prepared) {
  const saved = await saveOutingPhotos(outingUid, prepared);
  notify();
  scheduleOutingPhotoSync();
  return saved;
}

export async function updateOutingPhoto(photo, patch) {
  const next = { ...photo, ...patch, uploadedAt: null };
  await raw.put('photos', next);
  notify();
  scheduleOutingPhotoSync();
  return next;
}

export async function removeOutingPhoto(photo) {
  const userId = photo.ownerId || user()?.id;
  if (userId) {
    const pending = (await db.kvGet(DELETES_KEY)) || [];
    const item = { uid: photo.uid, outingUid: photo.outingUid, userId };
    if (!pending.some(p => p.uid === item.uid && p.userId === item.userId)) pending.push(item);
    await db.kvSet(DELETES_KEY, pending);
  }
  await raw.del('photos', photo.id);
  notify();
  scheduleOutingPhotoSync();
}

export async function syncOutingPhotos(c, userId) {
  const pending = (await db.kvGet(DELETES_KEY)) || [];
  let remaining = [...pending];
  for (const item of pending.filter(p => p.userId === userId)) {
    const { error } = await c.from('outing_photos').delete().eq('uid', item.uid).eq('user_id', userId);
    if (error) throw error;
    const paths = outingPhotoPaths(userId, item);
    const { error: storageError } = await c.storage.from(BUCKET).remove([paths.path, paths.thumbPath]);
    if (storageError) throw storageError;
    remaining = remaining.filter(p => !(p.uid === item.uid && p.userId === item.userId));
    await db.kvSet(DELETES_KEY, remaining);
  }

  const photos = (await db.all('photos')).filter(p => p.kind === 'outing' && !p.uploadedAt && p.blob && p.thumb);
  for (const photo of photos) {
    const paths = outingPhotoPaths(userId, photo);
    const bucket = c.storage.from(BUCKET);
    const options = { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' };
    const { error: fullError } = await bucket.upload(paths.path, photo.blob, options);
    if (fullError) throw fullError;
    const { error: thumbError } = await bucket.upload(paths.thumbPath, photo.thumb, options);
    if (thumbError) throw thumbError;
    const row = {
      uid: photo.uid,
      user_id: userId,
      outing_uid: photo.outingUid,
      path: paths.path,
      thumb_path: paths.thumbPath,
      taken_at: Number.isFinite(photo.takenAt) ? new Date(photo.takenAt).toISOString() : null,
      species_id: photo.speciesId ?? null,
      w: photo.w,
      h: photo.h,
    };
    const { error } = await c.from('outing_photos').upsert(row, { onConflict: 'uid' });
    if (error) throw error;
    await raw.put('photos', { ...photo, uploadedAt: Date.now(), ownerId: userId });
    notify();
  }
}

export async function togglePhotoLike(photo, { client: suppliedClient, onChange } = {}) {
  const original = { ...photo, liked: !!photo.liked, likeCount: Math.max(0, Number(photo.likeCount) || 0) };
  const optimistic = {
    ...original,
    liked: !original.liked,
    likeCount: Math.max(0, original.likeCount + (original.liked ? -1 : 1)),
  };
  onChange?.(optimistic);
  try {
    const c = suppliedClient || await client();
    const { data, error } = await c.rpc('toggle_photo_like', { p_photo: photo.id });
    if (error) throw error;
    const answer = Array.isArray(data) ? data[0] : data;
    if (!answer) throw new Error('The like could not be saved.');
    const saved = { ...original, liked: !!answer.liked, likeCount: Math.max(0, Number(answer.like_count) || 0) };
    onChange?.(saved);
    return saved;
  } catch (error) {
    onChange?.(original);
    throw error;
  }
}

export async function fetchPublicOuting(publicId, outingUid, suppliedClient) {
  const c = suppliedClient || await client();
  const { data, error } = await c.rpc('get_public_outing', { p_public_id: publicId, p_outing_uid: outingUid });
  if (error) throw error;
  if (!data) throw new Error('Outing not found');
  return data;
}

export async function fetchProfilePhotos(publicId, suppliedClient) {
  const c = suppliedClient || await client();
  const { data, error } = await c.rpc('get_profile_photos', { p_public_id: publicId });
  if (error) throw error;
  return data || { mostLiked: [], outings: [] };
}

export const photoUrl = path => path ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}` : '';

// ---------- background retries ----------
let started = false;
let timer = null;
let running = null;
let again = false;
let retryMs = 15000;

async function runQueue() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const u = user();
      if (!u || !navigator.onLine) return;
      await syncOutingPhotos(await client(), u.id);
      retryMs = 15000;
    } catch {
      retryMs = Math.min(retryMs * 2, 5 * 60000);
      const delay = retryMs;
      setTimeout(() => scheduleOutingPhotoSync(), delay);
    }
  })();
  try { await running; } finally {
    running = null;
    if (again) { again = false; scheduleOutingPhotoSync(250); }
  }
}

export function scheduleOutingPhotoSync(delay = 0) {
  if (!user() || !navigator.onLine) return;
  if (running) { again = true; return; }
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void runQueue(); }, delay);
}

export function startOutingPhotoSync() {
  if (started) return;
  started = true;
  onAuth(() => scheduleOutingPhotoSync(250));
  window.addEventListener('online', () => { retryMs = 15000; scheduleOutingPhotoSync(250); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleOutingPhotoSync(500);
  });
  scheduleOutingPhotoSync(500);
}
