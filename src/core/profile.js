// Profile and avatar logic, framework-free. Accounts stay optional.
// The local profile lives in db.kv via sync.js; the public bits live in the profiles table.
import { BIRDS, byId } from './species.js';
import { db } from './db.js';
import { configured, client, user, onAuth } from './cloud.js';
import { localProfile, saveProfile, syncNow, onRemoteChange } from './sync.js';
import { MONTHS } from './stats.js';
import { SUPABASE_URL } from './config.js';

export { configured };
export const signedIn = () => configured && !!user();

// ---------- cached state ----------
let prof = { displayName: '', avatarSpeciesId: null, showOnLeaderboard: true };
let cloud = null; // { uid, publicId, avatarPath, showDex, memberSince }
let cloudAt = 0;
let bound = false;
const subscribers = new Set();
const notify = () => { for (const fn of subscribers) { try { fn(); } catch (_) {} } };
const others = new Map(); // public id -> last get_profile row

export const getProfile = () => prof;
export const getMyCloud = () => (cloud && configured && user() && cloud.uid === user().id ? cloud : null);
export const myName = () => prof?.displayName || user()?.name || (user()?.email || '').split('@')[0] || 'You';
export const getPublicProfileCache = id => others.get(id) || null;

export async function initProfile(onChange) {
  if (onChange) subscribers.add(onChange);
  if (!bound) {
    bound = true;
    onAuth(async () => { prof = await localProfile(); if (user()) await fetchCloud(true); notify(); });
    onRemoteChange(async () => { prof = await localProfile(); notify(); });
  }
  prof = await localProfile();
  if (!cloud) cloud = (await db.kvGet('me:cloud').catch(() => null)) || null;
  if (signedIn()) await fetchCloud();
  notify();
  return prof;
}

export async function refreshProfile() {
  prof = await localProfile();
  return prof;
}

export async function saveMyProfile(patch) {
  prof = await saveProfile(patch);
  return prof;
}

// The signed-in person's own profile row: public id, photo, found-species choice and join date.
export async function fetchCloud(force = false) {
  const u = configured && user();
  if (!u || !navigator.onLine || (!force && Date.now() - cloudAt < 60000)) return getMyCloud();
  cloudAt = Date.now();
  try {
    const c = await client();
    const { data, error } = await c.from('profiles').select('public_id, avatar_path, show_dex, created_at').eq('user_id', u.id).maybeSingle();
    if (error) throw error;
    if (data) await storeCloud(u.id, data);
  } catch (_) { /* offline or not synced yet: keep the cached copy */ }
  return getMyCloud();
}

async function storeCloud(uid, d) {
  cloud = { uid, publicId: d.public_id, avatarPath: d.avatar_path || null, showDex: !!d.show_dex, memberSince: d.created_at || null };
  others.delete(cloud.publicId);
  await db.kvSet('me:cloud', cloud);
  return cloud;
}

// Change the cloud-only columns (photo, found species). A brand-new account may not have its row yet: the profile
// is sent first, then the change is tried again.
export async function setCloud(patch) {
  const c = await client();
  const u = user();
  const go = () => c.from('profiles').update(patch).eq('user_id', u.id).select('public_id, avatar_path, show_dex, created_at');
  let { data, error } = await go();
  if (error) throw error;
  if (!data?.length) {
    await saveProfile({});
    await syncNow();
    ({ data, error } = await go());
    if (error) throw error;
    if (!data?.length) throw new Error('Your profile has not reached the cloud yet. Try again in a minute.');
  }
  await storeCloud(u.id, data[0]);
  return cloud;
}

export const avatarUrl = path => path ? `${SUPABASE_URL}/storage/v1/object/public/avatars/${path.split('/').map(encodeURIComponent).join('/')}` : '';

export const memberSince = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `Member since ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const dayPick = (salt = 0) => {
  const n = Math.floor(Date.now() / 864e5) + salt;
  return BIRDS[(n * 2654435761 >>> 0) % BIRDS.length];
};

// A cover photo for a hero: the latest species found, else the chosen avatar species, else one for today.
export function coverSpecies(sightings = [], avatarSpeciesId = null) {
  const first = new Map();
  for (const s of sightings) {
    const k = `${s.date || ''}${s.time || ''}`;
    if (!first.has(s.speciesId) || k < first.get(s.speciesId)) first.set(s.speciesId, k);
  }
  let best = null, bk = '';
  for (const [id, k] of first) if (byId.get(id) && k >= bk) { best = id; bk = k; }
  return byId.get(best) || byId.get(avatarSpeciesId) || dayPick();
}

export function kindCounts(ids) {
  const c = {};
  for (const id of ids) { const k = byId.get(id)?.kind; if (k) c[k] = (c[k] || 0) + 1; }
  return c;
}

export const problem = x => {
  const m = x?.message || String(x || '');
  if (/fetch|network|Failed/i.test(m)) return 'That needs a connection. Try again when you have signal.';
  if (/size|large|413/i.test(m)) return 'That photo is too big. Try another one.';
  return m || 'Something went wrong. Try again.';
};

// ---------- public profiles ----------
export async function loadPublicProfile(id) {
  const c = await client();
  const { data, error } = await c.rpc('get_profile', { p_public_id: id });
  if (error) throw error;
  if (!data?.[0]) throw new Error('Profile not found');
  others.set(id, data[0]);
  return data[0];
}

export async function myPublicId() {
  let m = await fetchCloud(true);
  if (!m?.publicId) { await saveProfile({}); await syncNow(); m = await fetchCloud(true); }
  return m?.publicId || '';
}

// ---------- avatars: a profile photo (public 'avatars' bucket), else a species, else a letter ----------
export async function uploadAvatarPhoto(blob) {
  const c = await client();
  const u = user();
  const path = `${u.id}/avatar-${Date.now()}.jpg`;
  const { error } = await c.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw error;
  await setCloud({ avatar_path: path });
  await deleteAvatars(c, u.id, path).catch(() => {});
  return path;
}

export async function removeAvatarPhoto() {
  const c = await client();
  await setCloud({ avatar_path: null });
  await deleteAvatars(c, user().id).catch(() => {});
}

// Profile photos: everything in avatars/<uid>/ except `keep`.
export async function deleteAvatars(c, userId, keep = null) {
  const { data, error } = await c.storage.from('avatars').list(userId, { limit: 100 });
  if (error) throw error;
  const gone = (data || []).map(f => `${userId}/${f.name}`).filter(p => p !== keep);
  if (gone.length) { const { error: e2 } = await c.storage.from('avatars').remove(gone); if (e2) throw e2; }
}

// 320 x 320 JPEG, stepping the quality down until it is comfortably under the bucket's 400 KB limit.
export async function squareJpeg(img, sx, sy, side) {
  const c = document.createElement('canvas');
  c.width = c.height = 320;
  const cx = c.getContext('2d');
  if (!cx) throw new Error('This browser could not prepare the photo.');
  cx.imageSmoothingQuality = 'high';
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 320, 320);
  cx.drawImage(img, sx, sy, side, side, 0, 0, 320, 320);
  for (const q of [0.85, 0.75, 0.6]) {
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size < 380 * 1024) return b;
  }
  throw new Error('That photo is too large. Try another one.');
}

export async function resizeImage(file, maxEdge = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  try {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob;
  } finally { bmp.close?.(); }
}
