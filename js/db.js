// Tiny IndexedDB wrapper. Stores: sightings, outings, patches, photos, kv.
const DB_NAME = 'birddex';
const DB_VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sightings')) {
        const s = db.createObjectStore('sightings', { keyPath: 'id', autoIncrement: true });
        s.createIndex('speciesId', 'speciesId');
        s.createIndex('outingId', 'outingId');
      }
      if (!db.objectStoreNames.contains('outings')) db.createObjectStore('outings', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('patches')) db.createObjectStore('patches', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async put(name, value, key) { return wrap((await store(name, 'readwrite')).put(value, key)); },
  async add(name, value) { return wrap((await store(name, 'readwrite')).add(value)); },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async byIndex(name, index, value) { return wrap((await store(name)).index(index).getAll(value)); },
  kvGet(key) { return this.get('kv', key); },
  kvSet(key, value) { return this.put('kv', value, key); },
};
