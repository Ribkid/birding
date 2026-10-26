// Tiny IndexedDB wrapper. Stores: sightings, outings, patches, photos, kv, outbox.
// Records in the synced stores carry a client-made `uid` and `updatedAt` (ms) alongside their numeric id.
// Every write or delete also leaves an entry in `outbox` so js/sync.js knows what to send to the cloud.
const DB_NAME = 'birddex';
const DB_VERSION = 2;
export const SYNCED = ['sightings', 'outings', 'patches', 'photos'];
let dbp;

const newUid = () => crypto.randomUUID();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = req.result, tx = req.transaction;
      if (!db.objectStoreNames.contains('sightings')) {
        const s = db.createObjectStore('sightings', { keyPath: 'id', autoIncrement: true });
        s.createIndex('speciesId', 'speciesId');
        s.createIndex('outingId', 'outingId');
      }
      if (!db.objectStoreNames.contains('outings')) db.createObjectStore('outings', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('patches')) db.createObjectStore('patches', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (e.oldVersion < 2) {
        db.createObjectStore('outbox', { keyPath: 'key' });
        // Give every existing record a uid and updatedAt (the first sign-in uploads them all).
        for (const name of SYNCED) {
          const st = tx.objectStore(name);
          st.createIndex('uid', 'uid', { unique: true });
          st.openCursor().onsuccess = ev => {
            const c = ev.target.result;
            if (!c) return;
            const v = c.value;
            if (!v.uid) { v.uid = newUid(); v.updatedAt = v.updatedAt || v.createdAt || v.at || v.startedAt || Date.now(); c.update(v); }
            c.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

const listeners = new Set();
const changed = name => { for (const fn of listeners) try { fn(name); } catch (_) {} };

// Write a synced record and its outbox entry in one transaction.
async function writeSynced(name, value, method) {
  const db = await open();
  const tx = db.transaction([name, 'outbox'], 'readwrite');
  value.uid ||= newUid();
  value.updatedAt = Math.max(Date.now(), (value.updatedAt || 0) + 1);
  const key = await wrap(tx.objectStore(name)[method](value));
  tx.objectStore('outbox').put({ key: `${name}:${value.uid}`, store: name, uid: value.uid, at: value.updatedAt });
  await done(tx);
  changed(name);
  return key;
}
async function deleteSynced(name, keys) {
  const db = await open();
  const tx = db.transaction([name, 'outbox'], 'readwrite');
  const st = tx.objectStore(name), ob = tx.objectStore('outbox');
  const recs = keys === null ? await wrap(st.getAll()) : await Promise.all(keys.map(k => wrap(st.get(k))));
  const now = Date.now();
  for (const r of recs) {
    if (!r) continue;
    if (r.uid) ob.put({ key: `${name}:${r.uid}`, store: name, uid: r.uid, at: now, deleted: true });
    st.delete(r.id);
  }
  await done(tx);
  changed(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async put(name, value, key) {
    if (SYNCED.includes(name)) return writeSynced(name, value, 'put');
    const r = await wrap((await store(name, 'readwrite')).put(value, key));
    if (name === 'kv') changed(`kv:${key}`);
    return r;
  },
  async add(name, value) { return SYNCED.includes(name) ? writeSynced(name, value, 'add') : wrap((await store(name, 'readwrite')).add(value)); },
  async del(name, key) { return SYNCED.includes(name) ? deleteSynced(name, [key]) : wrap((await store(name, 'readwrite')).delete(key)); },
  async clear(name) { return SYNCED.includes(name) ? deleteSynced(name, null) : wrap((await store(name, 'readwrite')).clear()); },
  async byIndex(name, index, value) { return wrap((await store(name)).index(index).getAll(value)); },
  kvGet(key) { return this.get('kv', key); },
  kvSet(key, value) { return this.put('kv', value, key); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// ---- for js/sync.js only: writes that came from the cloud, so no outbox entry and no new updatedAt ----
export const raw = {
  async byUid(name, uid) { return wrap((await store(name)).index('uid').get(uid)); },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async outbox() { return wrap((await store('outbox')).getAll()); },
  // Drop outbox entries that were sent, unless the record changed again since.
  async ack(entries) {
    const db = await open();
    const tx = db.transaction('outbox', 'readwrite');
    const ob = tx.objectStore('outbox');
    for (const e of entries) {
      const cur = await wrap(ob.get(e.key));
      if (cur && cur.at === e.at && !!cur.deleted === !!e.deleted) ob.delete(e.key);
    }
    await done(tx);
  },
};
