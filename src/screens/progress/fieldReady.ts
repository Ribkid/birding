// "Ready for the field": what works on this phone with no signal (v1 js/app.js:2574-2700).
import { KINDS, SPECIES, byId } from '../../lib/data';
import { cachedIndex, callPackStatus, downloadAll, loadCallPack, photoFor, saveCallPack, sized } from '../../core/media.js';
import { galleryFor } from '../../core/gallery.js';

export type FieldKey = 'app' | 'photos' | 'calls' | 'maps' | 'listen' | 'scan';
export interface FieldResult { ok: boolean; text: string; get?: boolean; link?: string; linkText?: string }
export type FieldReport = (fraction: number | null, text: string) => void;

export const FIELD: { key: FieldKey; label: string }[] = [
  { key: 'app', label: 'The app' },
  { key: 'photos', label: 'Species photos' },
  { key: 'calls', label: 'Call clips' },
  { key: 'maps', label: 'Maps' },
  { key: 'listen', label: 'Listen' },
  { key: 'scan', label: 'Scan a photo' },
];

export const fieldLabel = (key: FieldKey) => FIELD.find((f) => f.key === key)?.label || key;
const mbText = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;
const rootUrl = (path: string) => new URL(`/${path}`, location.href).href;
const cacheUrls = async (name: string) => {
  if (!(await caches.has(name))) return new Set<string>();
  return new Set((await (await caches.open(name)).keys()).map((req) => req.url));
};

async function askWorker(type: string, ms = 3000): Promise<{ version: string; total: number; saved: number } | null> {
  const sw = navigator.serviceWorker?.controller
    || (await navigator.serviceWorker?.getRegistration().catch(() => null))?.active;
  if (!sw) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ms);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    sw.postMessage({ type }, [channel.port2]);
  });
}

async function listenSaved() {
  const model = await caches.match(rootUrl('models/birdnet/model.json'));
  if (!model) return false;
  const manifest = await model.clone().json().catch(() => null);
  const shards = (manifest?.weightsManifest || [])
    .flatMap((w: { paths?: string[] }) => w.paths || [])
    .map((p: string) => rootUrl(`models/birdnet/${p}`));
  const files = [
    rootUrl('vendor/tfjs/tf.min.js'),
    rootUrl('models/birdnet/labels/en_us.txt'),
    rootUrl('models/birdnet/labels/en_uk.txt'),
    ...shards,
  ];
  return (await Promise.all(files.map((file) => caches.match(file)))).every(Boolean);
}

// Average sizes measured over the set in October 2026 (v1 js/app.js:2583).
const PHOTO_WIKI = 207e3;
const PHOTO_GALLERY = 58e3;
const photoBytes = (all = false) =>
  SPECIES.reduce((total, sp) => total
    + (all || photoFor(sp.id) ? PHOTO_WIKI : 0)
    + Math.min(4, galleryFor(sp.id).length) * PHOTO_GALLERY, 0);

// Who the saved clips are of, e.g. '178 birds and 27 frogs' (v1 renderSettings, js/app.js:2467-2469).
export async function callWho(): Promise<string> {
  const pack = ((await loadCallPack()) || {}) as Record<string, unknown>;
  const kinds: Record<string, number> = {};
  for (const id of Object.keys(pack)) {
    const k = byId.get(Number(id))?.kind || 'bird';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  return Object.entries(kinds)
    .map(([k, n]) => `${n} ${n === 1 ? KINDS[k]?.one ?? k : (KINDS[k]?.label ?? k).toLowerCase()}`)
    .join(' and ');
}

export async function checkField(key: FieldKey, who = ''): Promise<FieldResult> {
  if (key === 'app') {
    if (!('serviceWorker' in navigator)) return { ok: false, text: "This browser can't keep the app for offline use." };
    const status = await askWorker('shell-status');
    if (!status) return { ok: false, text: 'Not saved for offline yet.', get: true };
    return status.saved >= status.total
      ? { ok: true, text: 'Saved. It opens and runs with no signal.' }
      : { ok: false, text: `${status.saved} of ${status.total} app files saved.`, get: true };
  }
  if (key === 'photos') {
    await Promise.all([cachedIndex(), import('../../core/gallery.js').then((m) => m.loadExtras())]);
    const list = SPECIES.filter((sp) => photoFor(sp.id));
    const size = mbText(photoBytes(!list.length));
    if (!list.length) return { ok: false, text: `Not saved yet. About ${size}.`, get: true };
    const have = await cacheUrls('birddex-images');
    const abs = (url: string | null) => {
      if (!url) return '';
      try { return new URL(url).href; } catch { return url; }
    };
    const haveN = list.filter((sp) => have.has(abs(sized(sp.id, 'small'))) && have.has(abs(sized(sp.id, 'large')))).length;
    return haveN >= list.length
      ? { ok: true, text: `Saved for all ${list.length} species with a photo.` }
      : { ok: false, text: `Saved for ${haveN} of ${list.length} species. About ${size}.`, get: true };
  }
  if (key === 'calls') {
    const status = await callPackStatus();
    if (!status.total) return { ok: false, text: "Couldn't check the call clips. Open Settings again with signal." };
    return status.saved >= status.total
      ? { ok: true, text: `Saved: ${status.total} short clips${who ? ` of ${who}` : ''}.` }
      : { ok: false, text: `${status.saved} of ${status.total} clips saved. About ${mbText(status.bytes - status.savedBytes)}.`, get: true };
  }
  if (key === 'maps') {
    const n = (await cacheUrls('birddex-tiles')).size;
    return n
      ? { ok: true, text: `${n.toLocaleString('en-AU')} map squares saved from areas you've opened. Other areas need signal.` }
      : { ok: false, text: "No map areas saved yet. Open the map with signal and look over the places you'll visit.", link: '#/map', linkText: 'Open the map' };
  }
  if (key === 'listen') {
    return (await listenSaved())
      ? { ok: true, text: 'Sound model saved. Listen names birds by their calls with no signal.' }
      : { ok: false, text: 'Sound model not saved yet. About 60 MB.', get: true };
  }
  const photo = await import('../../core/photoid.js');
  return (await photo.isPhotoModelCached())
    ? { ok: true, text: 'Photo model saved. Scan works with no signal.' }
    : { ok: false, text: `Photo model not saved yet. About ${photo.PHOTO_MODEL_MB} MB.`, get: true };
}

const FIELD_GET: Record<FieldKey, (report: FieldReport) => Promise<void>> = {
  async app(report) {
    report(null, 'Saving the app files…');
    if (!navigator.serviceWorker) throw new Error('This browser cannot keep the app for offline use');
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register('/sw.js');
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]);
    }
    const status = await askWorker('shell-fill', 180000);
    if (!status || status.saved < status.total) throw new Error('some app files did not download');
  },
  photos(report) {
    return downloadAll((done: number, total: number) => report(total ? done / total : 0, `Saving photos: ${done} of ${total} species`));
  },
  async calls(report) {
    const result = await saveCallPack((done: number, total: number) => report(total ? done / total : 0, `Saving calls: ${done} of ${total}`));
    if (result.failed) throw new Error(`${result.failed} clips didn't download`);
  },
  async maps() {
    throw new Error('Open the map with signal first');
  },
  async listen(report) {
    const listen = await import('../../core/listen.js');
    await listen.loadListenModel((p: number, text: string) => report(p / 100, `${text}: ${p}%`));
  },
  async scan(report) {
    const photo = await import('../../core/photoid.js');
    await photo.loadPhotoModel((f: number, label: string) => report(f, `${label}: ${Math.round(f * 100)}%`));
  },
};

export interface FieldJob {
  last: [number | null, string];
  subs: Set<FieldReport>;
  p: Promise<void>;
}
export const fieldJobs = new Map<FieldKey, FieldJob>();
export function fieldJob(key: FieldKey): FieldJob {
  const running = fieldJobs.get(key);
  if (running) return running;
  const job: FieldJob = { last: [null, ''], subs: new Set(), p: Promise.resolve() };
  const report: FieldReport = (fraction, text) => {
    job.last = [fraction, text];
    job.subs.forEach((fn) => fn(fraction, text));
  };
  job.p = Promise.resolve()
    .then(() => FIELD_GET[key](report))
    .finally(() => fieldJobs.delete(key));
  fieldJobs.set(key, job);
  return job;
}
