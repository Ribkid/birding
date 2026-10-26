// Cloud sync for signed-in people. IndexedDB stays the source of truth on the phone;
// this sends the outbox to Supabase and pulls changes made on other devices.
// Conflicts: last write wins on updatedAt (the server ignores older writes, see keep_newest()).
import { db, raw } from './db.js';
import { client, user } from './cloud.js';
import { badges } from './stats.js';

const BATCH = 200;
const TABLES = ['patches', 'outings', 'sightings']; // outings before sightings, so sightings can find their outing
const PHOTO_BUCKET = 'photos';
const iso = ms => new Date(ms || Date.now()).toISOString();
const ms = t => (t ? Date.parse(t) : 0);
const int = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const dateOrNull = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
const pick = (o, known) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !known.includes(k) && !k.startsWith('_') && typeof v !== 'function' && !(v instanceof Blob)));
const photoPath = (userId, uid) => `${userId}/${uid}.jpg`;

// ---------- record <-> row ----------
const KNOWN = {
  sightings: ['id', 'uid', 'speciesId', 'count', 'heard', 'date', 'time', 'lat', 'lng', 'acc', 'place', 'notes', 'photoId', 'outingId', 'outingUid', 'createdAt', 'updatedAt'],
  outings: ['id', 'uid', 'date', 'time', 'startedAt', 'past', 'place', 'lat', 'lng', 'endedAt', 'complete', 'distanceKm', 'durationMin', 'notes', 'updatedAt'],
  patches: ['id', 'uid', 'name', 'lat', 'lng', 'radiusKm', 'updatedAt'],
};

async function toRow(name, r, userId) {
  const base = { uid: r.uid, user_id: userId, extra: pick(r, KNOWN[name]), updated_at: iso(r.updatedAt), deleted_at: null };
  if (name === 'sightings') {
    const outing = r.outingId != null ? await db.get('outings', r.outingId) : null;
    const photo = r.photoId != null ? await db.get('photos', r.photoId) : null;
    return { ...base, species_id: int(r.speciesId), count: int(r.count), heard: !!r.heard, date: dateOrNull(r.date), time: r.time || null,
      lat: num(r.lat), lng: num(r.lng), acc: num(r.acc), place: r.place || null, notes: r.notes || null,
      photo_uid: photo?.uid || null, outing_uid: outing?.uid || r.outingUid || null, created_at_ms: int(r.createdAt) };
  }
  if (name === 'outings') {
    return { ...base, date: dateOrNull(r.date), time: r.time || null, started_at_ms: int(r.startedAt), past: !!r.past, place: r.place || null,
      lat: num(r.lat), lng: num(r.lng), ended_at_ms: int(r.endedAt), complete: !!r.complete, distance_km: num(r.distanceKm),
      duration_min: int(r.durationMin), notes: r.notes || '' };
  }
  return { ...base, name: r.name || '', lat: num(r.lat), lng: num(r.lng), radius_km: num(r.radiusKm) };
}

async function fromRow(name, row, local) {
  const rec = { ...(row.extra || {}), uid: row.uid, updatedAt: ms(row.updated_at) };
  if (local) rec.id = local.id;
  if (name === 'sightings') {
    let outingId = null, outingUid;
    if (row.outing_uid) {
      const o = await raw.byUid('outings', row.outing_uid);
      if (o) outingId = o.id; else outingUid = row.outing_uid; // outing not here yet; fixed up later
    }
    let photoId = null;
    if (row.photo_uid) {
      const p = await raw.byUid('photos', row.photo_uid);
      photoId = p ? p.id : await raw.put('photos', { uid: row.photo_uid, blob: null, at: rec.updatedAt, updatedAt: rec.updatedAt, remote: true });
    }
    if (local?.photoId && local.photoId !== photoId) await raw.del('photos', local.photoId);
    Object.assign(rec, { speciesId: row.species_id, count: row.count, heard: !!row.heard, date: row.date || '', time: row.time || '',
      lat: row.lat, lng: row.lng, acc: row.acc, place: row.place || '', notes: row.notes || '', photoId, outingId,
      createdAt: row.created_at_ms ?? rec.updatedAt });
    if (outingUid) rec.outingUid = outingUid;
  } else if (name === 'outings') {
    Object.assign(rec, { date: row.date || '', time: row.time || '00:00', startedAt: row.started_at_ms, past: !!row.past, place: row.place || '',
      lat: row.lat, lng: row.lng, endedAt: row.ended_at_ms, complete: !!row.complete, distanceKm: row.distance_km,
      durationMin: row.duration_min, notes: row.notes || '' });
  } else {
    Object.assign(rec, { name: row.name || '', lat: row.lat, lng: row.lng, radiusKm: row.radius_km });
  }
  return rec;
}

// Same thing logged twice (say, a backup restored on two phones): match on content, not uid.
const contentKey = {
  sightings: r => [r.speciesId ?? r.species_id, r.date, r.time || '', (r.place || '').trim().toLowerCase(), r.count ?? '', (r.notes || '').trim()].join('|'),
  outings: r => [r.date, r.time || '', (r.place || '').trim().toLowerCase()].join('|'),
  patches: r => [(r.name || '').trim().toLowerCase(), Number(r.lat).toFixed(4), Number(r.lng).toFixed(4)].join('|'),
};

// ---------- status ----------
let status = { state: 'off', text: '' };
const statusFns = new Set();
function setStatus(state, text = '') {
  status = { state, text, at: Date.now() };
  for (const fn of statusFns) try { fn(status); } catch (_) {}
}
export const syncStatus = () => status;
export const onStatus = fn => { statusFns.add(fn); return () => statusFns.delete(fn); };

let remoteFns = new Set();
export const onRemoteChange = fn => { remoteFns.add(fn); return () => remoteFns.delete(fn); };
const remoteChanged = () => { for (const fn of remoteFns) try { fn(); } catch (_) {} };

// ---------- pull ----------
async function fetchSince(c, table, userId, since) {
  const out = [];
  let cursor = since;
  for (;;) {
    let q = c.from(table).select('*').eq('user_id', userId).order('synced_at', { ascending: true }).limit(1000);
    if (cursor) q = q.gt('synced_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
    cursor = data[data.length - 1].synced_at;
  }
  return out;
}

async function applyRows(name, rows) {
  let changed = 0;
  for (const row of rows) {
    const local = await raw.byUid(name, row.uid);
    const at = ms(row.updated_at);
    if (local && (local.updatedAt || 0) >= at) continue;
    if (row.deleted_at) {
      if (local) {
        if (name === 'sightings' && local.photoId) await raw.del('photos', local.photoId);
        await raw.del(name, local.id);
        changed++;
      }
      continue;
    }
    await raw.put(name, await fromRow(name, row, local));
    changed++;
  }
  return changed;
}

async function fixOutingLinks() {
  for (const s of await db.all('sightings')) {
    if (!s.outingUid) continue;
    const o = await raw.byUid('outings', s.outingUid);
    if (o) { delete s.outingUid; s.outingId = o.id; await raw.put('sightings', s); }
  }
}

async function pull(c, userId) {
  let changed = 0;
  for (const t of TABLES) {
    const key = `sync:cursor:${t}`;
    const since = await db.kvGet(key);
    // look back a little: rows committed out of order by a slow device still arrive
    const rows = await fetchSince(c, t, userId, since ? iso(ms(since) - 120000) : null);
    changed += await applyRows(t, rows);
    if (rows.length) await db.kvSet(key, rows[rows.length - 1].synced_at);
  }
  await fixOutingLinks();
  changed += await pullProfile(c, userId);
  return changed;
}

// ---------- push ----------
async function pushPhotos(c, userId, entries, progress) {
  let n = 0;
  for (const e of entries) {
    const path = photoPath(userId, e.uid);
    if (e.deleted) {
      const { error } = await c.storage.from(PHOTO_BUCKET).remove([path]);
      if (error) throw error;
    } else {
      const rec = await raw.byUid('photos', e.uid);
      if (rec?.blob) {
        const { error } = await c.storage.from(PHOTO_BUCKET).upload(path, rec.blob, { upsert: true, contentType: rec.blob.type || 'image/jpeg' });
        if (error) throw error;
      }
    }
    progress?.(++n, entries.length);
  }
}

async function pushTable(c, userId, name, entries, progress) {
  const dels = entries.filter(e => e.deleted), ups = entries.filter(e => !e.deleted);
  let n = 0;
  for (let i = 0; i < ups.length; i += BATCH) {
    const rows = [];
    for (const e of ups.slice(i, i + BATCH)) {
      const rec = await raw.byUid(name, e.uid);
      if (rec) rows.push(await toRow(name, rec, userId));
    }
    if (rows.length) {
      const { error } = await c.from(name).upsert(rows, { onConflict: 'uid' });
      if (error) throw error;
    }
    n += Math.min(BATCH, ups.length - i);
    progress?.(n, ups.length);
  }
  for (let i = 0; i < dels.length; i += BATCH) {
    const part = dels.slice(i, i + BATCH);
    const at = iso(Math.max(...part.map(e => e.at)));
    const { error } = await c.from(name).update({ deleted_at: at, updated_at: at }).in('uid', part.map(e => e.uid)).eq('user_id', userId);
    if (error) throw error;
  }
}

async function push(c, userId, entries, progress) {
  const by = name => entries.filter(e => e.store === name);
  await pushPhotos(c, userId, by('photos'), progress && ((d, t) => progress('photos', d, t)));
  for (const t of TABLES) await pushTable(c, userId, t, by(t), progress && ((d, total) => progress(t, d, total)));
  await pushProfile(c, userId);
}

// ---------- profile (name, avatar, leaderboard choice, settings, badge count) ----------
let applyingRemote = false;
export async function localProfile() {
  return (await db.kvGet('profile')) || { displayName: '', avatarSpeciesId: null, showOnLeaderboard: true, updatedAt: 0 };
}
export async function saveProfile(patch) {
  const p = { ...(await localProfile()), ...patch, updatedAt: Date.now() };
  await db.kvSet('profile', p);
  await db.kvSet('sync:profileDirty', true);
  schedule(500);
  return p;
}
async function pullProfile(c, userId) {
  const { data, error } = await c.from('profiles').select('display_name, avatar_species_id, show_on_leaderboard, settings, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return 0;
  const local = await localProfile();
  if (local.updatedAt >= ms(data.updated_at)) return 0;
  applyingRemote = true;
  try {
    await db.kvSet('profile', { displayName: data.display_name || '', avatarSpeciesId: data.avatar_species_id, showOnLeaderboard: data.show_on_leaderboard, updatedAt: ms(data.updated_at) });
    if (data.settings && Object.keys(data.settings).length) await db.kvSet('settings', { ...((await db.kvGet('settings')) || {}), ...data.settings });
  } finally { applyingRemote = false; }
  return 1;
}
async function badgeCount() {
  const [s, o] = await Promise.all([db.all('sightings'), db.all('outings')]);
  return badges(s, o).filter(b => b.done).length;
}
async function pushProfile(c, userId) {
  const count = await badgeCount();
  if (await db.kvGet('sync:profileDirty')) {
    const p = await localProfile();
    const row = { user_id: userId, display_name: p.displayName?.trim() || null, avatar_species_id: p.avatarSpeciesId ?? null,
      show_on_leaderboard: p.showOnLeaderboard !== false, settings: (await db.kvGet('settings')) || {}, badges_count: count, updated_at: iso(p.updatedAt) };
    const { error } = await c.from('profiles').upsert(row, { onConflict: 'user_id' });
    if (error) throw error;
    await db.kvSet('sync:profileDirty', false);
    await db.kvSet('sync:badges', count);
  } else if ((await db.kvGet('sync:badges')) !== count) {
    const { error } = await c.from('profiles').update({ badges_count: count }).eq('user_id', userId);
    if (error) throw error;
    await db.kvSet('sync:badges', count);
  }
}

// ---------- first sign-in: merge this phone with the account, never dropping anything ----------
const NOUN = { sightings: ['sighting', 'sightings'], outings: ['outing', 'outings'], patches: ['patch', 'patches'], photos: ['photo', 'photos'] };
const say = (n, store) => `${n} ${NOUN[store][n === 1 ? 0 : 1]}`;

async function migrate(c, userId) {
  // Records made under another account on this phone get fresh uids, so they become this account's own copies.
  const owner = await db.kvGet('sync:owner');
  if (owner && owner !== userId) {
    for (const name of ['photos', ...TABLES]) for (const r of await db.all(name)) { r.uid = crypto.randomUUID(); await raw.put(name, r); }
  }
  await db.kvSet('sync:owner', userId);

  setStatus('migrating', 'Checking your account…');
  const outboxBefore = await raw.outbox();
  let changed = 0;
  for (const t of TABLES) {
    const remote = await fetchSince(c, t, userId, null);
    // adopt the cloud uid for a local record that is clearly the same thing
    const byUidRemote = new Set(remote.map(r => r.uid));
    const free = new Map();
    for (const r of remote) if (!r.deleted_at) {
      const k = contentKey[t](t === 'sightings' ? { ...r, speciesId: r.species_id } : r);
      if (!free.has(k)) free.set(k, r);
    }
    for (const r of remote) if (!r.deleted_at && (await raw.byUid(t, r.uid))) free.delete(contentKey[t](t === 'sightings' ? { ...r, speciesId: r.species_id } : r));
    for (const local of await db.all(t)) {
      if (byUidRemote.has(local.uid)) continue;
      const match = free.get(contentKey[t](local));
      if (match) { free.delete(contentKey[t](local)); local.uid = match.uid; await raw.put(t, local); }
    }
    changed += await applyRows(t, remote);
    if (remote.length) await db.kvSet(`sync:cursor:${t}`, remote[remote.length - 1].synced_at);
  }
  await fixOutingLinks();
  // keep this phone's settings if the account has none yet
  const { data: prof } = await c.from('profiles').select('settings, updated_at, display_name').eq('user_id', userId).maybeSingle();
  if (prof && (!prof.settings || !Object.keys(prof.settings).length)) {
    const lp = await localProfile();
    await db.kvSet('profile', { ...lp, displayName: lp.displayName || prof.display_name || '', updatedAt: Date.now() });
    await db.kvSet('sync:profileDirty', true);
  } else changed += await pullProfile(c, userId);

  // upload everything on this phone (the server keeps whichever copy is newer)
  const all = [];
  for (const name of ['photos', ...TABLES]) {
    for (const r of await db.all(name)) if (r.uid && (name !== 'photos' || r.blob)) all.push({ key: `${name}:${r.uid}`, store: name, uid: r.uid, at: r.updatedAt || 0 });
  }
  const deletions = outboxBefore.filter(e => e.deleted);
  const total = all.filter(e => e.store === 'sightings').length;
  setStatus('migrating', total ? `Backing up ${say(total, 'sightings')}…` : 'Backing up…');
  await push(c, userId, [...all, ...deletions], (store, d, t) => {
    setStatus('migrating', store === 'sightings' ? `Backing up ${say(t, 'sightings')}… ${d} of ${t}` : `Backing up ${say(t, store)}… ${d} of ${t}`);
  });
  await raw.ack(outboxBefore);
  await db.kvSet('sync:user', userId);
  return changed;
}

// ---------- photos from other devices: fetch with signed URLs, keep on the phone ----------
let fetchingPhotos = false;
async function fetchMissingPhotos(c, userId) {
  if (fetchingPhotos) return;
  fetchingPhotos = true;
  try {
    const missing = (await db.all('photos')).filter(p => !p.blob && p.uid);
    let got = 0;
    for (let i = 0; i < missing.length; i += 50) {
      const part = missing.slice(i, i + 50);
      const { data, error } = await c.storage.from(PHOTO_BUCKET).createSignedUrls(part.map(p => photoPath(userId, p.uid)), 600);
      if (error) throw error;
      for (const [j, d] of (data || []).entries()) {
        if (!d.signedUrl) continue;
        try {
          const res = await fetch(d.signedUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          const cur = await raw.byUid('photos', part[j].uid);
          if (cur && !cur.blob) { await raw.put('photos', { ...cur, blob, remote: false }); got++; }
        } catch (_) {}
      }
    }
    if (got) remoteChanged();
  } finally { fetchingPhotos = false; }
}

// ---------- the loop ----------
let running = null, again = false, timer = null, retryMs = 0;

export function schedule(delay = 3000) {
  if (!user()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

export async function pendingCount() { return (await raw.outbox()).length; }

export async function syncNow() {
  const u = user();
  if (!u) { setStatus('off'); return; }
  if (running) { again = true; return running; }
  running = (async () => {
    if (!navigator.onLine) { setStatus('offline', 'Offline, will sync'); return; }
    try {
      const c = await client();
      let changed = 0;
      if ((await db.kvGet('sync:user')) !== u.id) changed += await migrate(c, u.id);
      else {
        setStatus('syncing', 'Syncing…');
        const entries = await raw.outbox();
        if (entries.length || await db.kvGet('sync:profileDirty')) await push(c, u.id, entries);
        await raw.ack(entries);
        changed += await pull(c, u.id);
        await pushProfile(c, u.id); // badge count may have changed after the pull
      }
      retryMs = 0;
      await db.kvSet('sync:lastAt', Date.now());
      setStatus('saved', 'Saved to cloud');
      if (changed) remoteChanged();
      fetchMissingPhotos(c, u.id).catch(() => {});
    } catch (err) {
      const offline = !navigator.onLine || /fetch|network/i.test(err?.message || '');
      setStatus(offline ? 'offline' : 'error', offline ? 'Offline, will sync' : `Couldn't sync (${err?.message || 'unknown problem'}). Will try again.`);
      retryMs = Math.min(retryMs ? retryMs * 2 : 15000, 5 * 60000);
      schedule(retryMs);
    }
  })();
  try { await running; } finally {
    running = null;
    if (again) { again = false; schedule(500); }
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  db.onChange(name => {
    if (applyingRemote || !user()) return;
    if (name === 'kv:settings') { saveProfile({}).catch(() => {}); return; } // settings travel with the profile
    if (!name.startsWith('kv:')) schedule();
  });
  window.addEventListener('online', () => schedule(500));
  window.addEventListener('offline', () => { if (user()) setStatus('offline', 'Offline, will sync'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (status.at || 0) > 60000) schedule(500);
  });
}

// ---------- leaving ----------
export async function forgetSync({ wipeLocal }) {
  clearTimeout(timer);
  for (const k of ['sync:user', 'sync:cursor:sightings', 'sync:cursor:outings', 'sync:cursor:patches', 'sync:badges', 'sync:profileDirty', 'sync:lastAt', 'profile']) await db.kvSet(k, null);
  if (wipeLocal) {
    for (const s of ['sightings', 'outings', 'patches', 'photos', 'outbox']) await raw.clear(s);
    await db.kvSet('activeOuting', null);
    await db.kvSet('sync:owner', null);
  }
  setStatus('off');
}

export async function deleteCloudPhotos(c, userId) {
  for (;;) {
    const { data, error } = await c.storage.from(PHOTO_BUCKET).list(userId, { limit: 1000 });
    if (error) throw error;
    if (!data?.length) return;
    const { error: e2 } = await c.storage.from(PHOTO_BUCKET).remove(data.map(f => `${userId}/${f.name}`));
    if (e2) throw e2;
    if (data.length < 1000) return;
  }
}
