// On-device photo identification with BioCLIP (imageomics/bioclip, ViT-B/16), run by onnxruntime-web.
// The image encoder (~87 MB, uint8-quantised ONNX) is fetched in chunks once and kept in Cache Storage,
// so later loads work offline. Species scores come from data/photoid.json + data/photoid.bin: text
// embeddings and image prototypes per species, plus the scoring weights, views and confidence bands.
// Nothing here hard-codes species counts or kinds; it all follows that file.
//
// API:
//   loadPhotoModel(onProgress?: (fraction 0..1, label) => void) -> Promise<void>
//   identifyPhoto(File | Blob | ImageBitmap, { crop?: {x, y, w, h} fractions | null, kinds?: [kind] | null,
//                 month?: 1..12, onProgress?: ({ phase: 'model', fraction } | { phase: 'view', index, count, view }) => void })
//     -> { results: [{ id, p }], band: 'likely' | 'possibly' | 'unsure', agreement, margin, ms, views: [{ name, top, ms }], bands }
//     agreement = share of views whose own top answer is the final top answer; margin = p1 - p2.
//   photoInfo() -> { kinds, count, metrics, provisional }   (reads photoid.json only, no model)
//   isPhotoModelCached() -> Promise<boolean>
//   PHOTO_MODEL_MB  (approx first download size, MB)
//   window.__photoid.embedView(file, viewName, crop?) -> Float32Array   (raw embedding, for the parity test)
//
// Views (preprocessing matches the reference Python, Pillow + numpy, step for step):
//   pad / padF       whole photo letterboxed onto a square of its mean edge colour, then 224x224 (F = mirrored)
//   centre / centreF short side to 224, centre crop (open_clip's own preprocessing)
//   box / boxF       the crop box, cut square from the full-resolution photo, then 224x224
//   wide / wideF     the box grown 1.3x around its centre (kept inside the photo), then 224x224
// Whole-photo views first reduce the photo so its short side is at most 1600 px (Pillow bicubic).
import { byId } from './species.js';
import { loadSeq, monthRates } from './seqdata.js';

const BASE = new URL('../', import.meta.url);
const ORT_DIR = new URL('vendor/ort/', BASE).href;
const MODEL_DIR = new URL('models/bioclip/', BASE).href;
const DATA_URL = new URL('data/photoid.json', BASE).href;
const WASM_URL = ORT_DIR + 'ort-wasm-simd-threaded.wasm';
const CACHE = 'birddex-models';
const SIZE = 224;
const MAX_SIDE = 1600;      // whole-photo views: short side reduced to this first
const MAX_PIXELS = 24e6;    // bigger originals are scaled down on decode so phones don't run out of memory
const WIDE = 1.3;

export const PHOTO_MODEL_MB = 98; // model 87 MB + runtime 11 MB

let ort = null;
let session = null;
let manifest = null;
let loading = null;
let meta = null, metaP = null;   // photoid.json
let data = null, dataP = null;   // parsed matrices

// ---------- fetching ----------
const openCache = () => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null));
const fileName = url => url.split('/').pop();

// Cache first: big files that never change under the same name (the runtime's .wasm).
async function cachedFetch(url, { onBytes } = {}) {
  const cache = await openCache();
  const hit = cache && await cache.match(url).catch(() => null);
  if (hit) { const buf = await hit.arrayBuffer(); onBytes?.(buf.byteLength); return buf; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${fileName(url)} (${res.status})`);
  let buf;
  if (onBytes && res.body) {
    const reader = res.body.getReader(); const parts = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(value.length); }
    const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  if (cache) { try { await cache.put(url, new Response(buf.slice(0))); } catch (_) {} }
  return buf;
}

// Network first with a short timeout, then our own cache: small files that can change (the model manifest,
// the species data) stay current online and still load in the bush once they've been fetched.
async function freshFetch(url, timeout = 3500) {
  const cache = await openCache();
  const net = fetch(url, { cache: 'no-cache' }).then(async res => {
    if (!res.ok) throw new Error(`Could not download ${fileName(url)} (${res.status})`);
    const buf = await res.arrayBuffer();
    if (cache) cache.put(url, new Response(buf.slice(0))).catch(() => {});
    return buf;
  });
  let timer;
  try {
    return await Promise.race([net, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('slow')), timeout); })]);
  } catch (err) {
    const hit = cache && await cache.match(url).catch(() => null);
    if (hit) { net.catch(() => {}); return hit.arrayBuffer(); }
    return net; // no saved copy: keep waiting for the network, or surface its error
  } finally { clearTimeout(timer); }
}
const fetchJSON = async url => JSON.parse(new TextDecoder().decode(await freshFetch(url)));

export async function isPhotoModelCached() {
  try {
    const m = await fetchJSON(MODEL_DIR + 'manifest.json');
    const c = await openCache();
    return !!(c && await c.match(MODEL_DIR + m.version + '.onnx') && await c.match(WASM_URL));
  } catch (_) { return false; }
}

// ---------- species data ----------
let F16 = null;
function f16Table() {
  if (F16) return F16;
  F16 = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    F16[h] = e === 0 ? s * Math.pow(2, -14) * (f / 1024)
      : e === 31 ? (f ? NaN : s * Infinity)
      : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return F16;
}

function loadMeta() {
  if (!metaP) metaP = fetchJSON(DATA_URL).then(j => (meta = j)).catch(err => { metaP = null; throw err; });
  return metaP;
}

// What the photo data covers, for the Scan screen's wording and kind chips. Doesn't load the model.
export async function photoInfo() {
  const j = await loadMeta();
  const kinds = [...new Set(j.ids.map(id => byId.get(id)?.kind).filter(Boolean))];
  return { kinds, count: j.ids.length, metrics: j.metrics || null, provisional: !!j.provisional };
}

function loadData() {
  if (dataP) return dataP;
  dataP = (async () => {
    const j = await loadMeta();
    const buf = await freshFetch(new URL(j.bin || 'photoid.bin', DATA_URL).href);
    const dim = j.dim, n = j.ids.length;
    const t = f16Table(), u16 = new Uint16Array(buf), all = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) all[i] = t[u16[i]];
    const pRow = j.protos?.row ?? 0, pRows = j.protos?.rows ?? 0;
    if (j.text.rows !== n) throw new Error('The photo ID data is inconsistent. Reload the app and try again.');
    if (all.length < Math.max(j.text.row + j.text.rows, pRow + pRows) * dim) throw new Error('The photo ID data is incomplete. Reload the app and try again.');
    const protosOf = Array.from({ length: n }, () => []);
    (j.protos?.owner || []).slice(0, pRows).forEach((r, k) => protosOf[r]?.push(pRow + k));
    const kindOf = j.ids.map(id => byId.get(id)?.kind || null);
    const unknown = j.ids.filter((id, r) => !kindOf[r]);
    if (unknown.length) console.warn('photoid: ids not in the dex, skipped:', unknown);
    data = { j, dim, all, ids: j.ids, tRow: j.text.row, protosOf, kindOf };
    return data;
  })();
  dataP.catch(() => { dataP = null; });
  return dataP;
}

// ---------- model ----------
export function loadPhotoModel(onProgress) {
  if (session) return loadData().then(() => {});
  if (loading) return loading;
  loading = (async () => {
    const report = (f, label) => { try { onProgress?.(Math.max(0, Math.min(1, f)), label); } catch (_) {} };
    report(0, 'Starting');
    manifest = await fetchJSON(MODEL_DIR + 'manifest.json');
    const [ortMod] = await Promise.all([import(ORT_DIR + 'ort.wasm.min.mjs'), loadData()]);
    ort = ortMod.default || ortMod;
    ort.env.wasm.wasmPaths = ORT_DIR;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

    const wasmBytes = 11.2e6;
    const total = manifest.totalBytes + wasmBytes;
    let done = 0;
    const tick = n => { done += n; report(done / total, 'Downloading the photo model'); };

    // The runtime's .wasm, cached so it also works offline.
    ort.env.wasm.wasmBinary = await cachedFetch(WASM_URL, { onBytes: tick });

    // The model: one cache entry for the whole file, built from chunks on first use.
    const key = MODEL_DIR + manifest.version + '.onnx';
    let modelBuf = null;
    const cache = await openCache();
    try { const hit = cache && await cache.match(key); if (hit) modelBuf = await hit.arrayBuffer(); } catch (_) {}
    if (modelBuf) tick(manifest.totalBytes);
    else {
      const all = new Uint8Array(manifest.totalBytes); let o = 0;
      for (const ch of manifest.chunks) {
        const res = await fetch(MODEL_DIR + ch.file);
        if (!res.ok) throw new Error(`Could not download the photo model (${res.status})`);
        const reader = res.body.getReader();
        for (;;) { const { done: d, value } = await reader.read(); if (d) break; all.set(value, o); o += value.length; tick(value.length); }
      }
      if (o !== manifest.totalBytes) throw new Error('The photo model download was incomplete. Try again on a steadier connection.');
      modelBuf = all.buffer;
      try { await cache?.put(key, new Response(modelBuf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (_) {}
    }
    report(0.99, 'Starting the model');
    session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    report(1, 'Ready');
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// ---------- image decoding ----------
// No colour management: Pillow ignores embedded colour profiles, so the model sees the same numbers.
async function decode(src) {
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return { bmp: src, own: false };
  let bmp;
  try { bmp = await createImageBitmap(src, { imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
  catch (_) { bmp = await createImageBitmap(src); }
  const px = bmp.width * bmp.height;
  if (px > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / px);
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close(); bmp = small;
  }
  return { bmp, own: true };
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
// RGBA pixels of a region at 1:1 (an exact copy, no resampling).
function pixels(bmp, sx, sy, w, h) {
  const c = makeCanvas(w, h), cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  cx.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  return { px: cx.getImageData(0, 0, w, h).data, w, h, ch: 4 };
}

// ---------- Pillow's resampler ----------
// A port of Pillow's separable antialiased bicubic resize (a = -0.5) for 8-bit images, including its
// fixed-point coefficients (22 bits) and its rounding to 8-bit between the horizontal and vertical passes.
const PREC = 22, ONE = 1 << PREC, HALF = 1 << (PREC - 1);
function bicubic(x) {
  const a = -0.5; x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}
function coeffs(inSize, outSize) {
  const scale = inSize / outSize, fs = Math.max(scale, 1), support = 2 * fs, ss = 1 / fs;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2), k = new Int32Array(outSize * ksize), tmp = new Float64Array(ksize);
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) { const w = bicubic((x + xmin - center + 0.5) * ss); tmp[x] = w; ww += w; }
    for (let x = 0; x < xmax; x++) {
      const v = ww !== 0 ? tmp[x] / ww : tmp[x];
      k[i * ksize + x] = v < 0 ? Math.trunc(-0.5 + v * ONE) : Math.trunc(0.5 + v * ONE);
    }
    bounds[i * 2] = xmin; bounds[i * 2 + 1] = xmax;
  }
  return { k, bounds, ksize };
}
const clip8 = v => { v >>= PREC; return v < 0 ? 0 : v > 255 ? 255 : v; };
// img = { px, w, h, ch } (ch 3 or 4) -> { px: RGB, w: ow, h: oh, ch: 3 }
function resize(img, ow, oh) {
  const { px: src, w, h, ch } = img;
  const vc = coeffs(h, oh);
  // Like Pillow, the horizontal pass only covers the rows the vertical pass will read.
  const y0 = vc.bounds[0], y1 = vc.bounds[oh * 2 - 2] + vc.bounds[oh * 2 - 1], rows = y1 - y0;
  let mid, mch;
  if (ow !== w) {
    const hc = coeffs(w, ow);
    mid = new Uint8Array(ow * rows * 3); mch = 3;
    for (let y = 0; y < rows; y++) {
      const row = (y + y0) * w;
      for (let x = 0; x < ow; x++) {
        const xmin = hc.bounds[x * 2], n = hc.bounds[x * 2 + 1], ko = x * hc.ksize;
        let r = HALF, g = HALF, b = HALF;
        for (let j = 0; j < n; j++) { const kk = hc.k[ko + j], si = (row + xmin + j) * ch; r += src[si] * kk; g += src[si + 1] * kk; b += src[si + 2] * kk; }
        const o = (y * ow + x) * 3; mid[o] = clip8(r); mid[o + 1] = clip8(g); mid[o + 2] = clip8(b);
      }
    }
  } else { mid = src.subarray(y0 * w * ch, y1 * w * ch); mch = ch; }
  if (oh === rows && y0 === 0 && oh === h) {
    if (mch === 3) return { px: mid, w: ow, h: oh, ch: 3 };
    const out = new Uint8Array(ow * oh * 3);
    for (let i = 0, o = 0; o < out.length; i += 4, o += 3) { out[o] = mid[i]; out[o + 1] = mid[i + 1]; out[o + 2] = mid[i + 2]; }
    return { px: out, w: ow, h: oh, ch: 3 };
  }
  const out = new Uint8Array(ow * oh * 3);
  for (let y = 0; y < oh; y++) {
    const ymin = vc.bounds[y * 2] - y0, n = vc.bounds[y * 2 + 1], ko = y * vc.ksize;
    for (let x = 0; x < ow; x++) {
      let r = HALF, g = HALF, b = HALF;
      for (let j = 0; j < n; j++) { const kk = vc.k[ko + j], si = ((ymin + j) * ow + x) * mch; r += mid[si] * kk; g += mid[si + 1] * kk; b += mid[si + 2] * kk; }
      const o = (y * ow + x) * 3; out[o] = clip8(r); out[o + 1] = clip8(g); out[o + 2] = clip8(b);
    }
  }
  return { px: out, w: ow, h: oh, ch: 3 };
}

// Python's round(): halves go to the even neighbour.
const pyRound = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

function cropRGB(img, left, top, w, h) {
  const out = new Uint8Array(w * h * 3), { px, ch } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y + top) * img.w + x + left) * ch, o = (y * w + x) * 3;
    out[o] = px[si]; out[o + 1] = px[si + 1]; out[o + 2] = px[si + 2];
  }
  return { px: out, w, h, ch: 3 };
}
function mirror(img) {
  const { w, h, px } = img, out = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * w + x) * 3, o = (y * w + (w - 1 - x)) * 3;
    out[o] = px[si]; out[o + 1] = px[si + 1]; out[o + 2] = px[si + 2];
  }
  return { px: out, w, h, ch: 3 };
}
// torchvision Resize(224) on the short side (long side truncated), then CenterCrop(224).
function centreView(img) {
  const { w, h } = img;
  const [ow, oh] = w <= h ? [SIZE, Math.trunc(SIZE * h / w)] : [Math.trunc(SIZE * w / h), SIZE];
  const r = resize(img, ow, oh);
  return cropRGB(r, pyRound((ow - SIZE) / 2), pyRound((oh - SIZE) / 2), SIZE, SIZE);
}
// Letterbox onto a square filled with the mean edge colour (first/last row, first/last column; truncated).
function padView(img) {
  const { w, h, px, ch } = img, s = Math.max(w, h);
  const sum = [0, 0, 0]; let n = 0;
  const add = (x, y) => { const i = (y * w + x) * ch; sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; n++; };
  for (let x = 0; x < w; x++) add(x, 0);
  for (let x = 0; x < w; x++) add(x, h - 1);
  for (let y = 0; y < h; y++) add(0, y);
  for (let y = 0; y < h; y++) add(w - 1, y);
  const edge = sum.map(v => Math.floor(v / n));
  const sq = new Uint8Array(s * s * 3);
  for (let i = 0; i < sq.length; i += 3) { sq[i] = edge[0]; sq[i + 1] = edge[1]; sq[i + 2] = edge[2]; }
  const ox = (s - w) >> 1, oy = (s - h) >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * w + x) * ch, o = ((y + oy) * s + x + ox) * 3;
    sq[o] = px[si]; sq[o + 1] = px[si + 1]; sq[o + 2] = px[si + 2];
  }
  return resize({ px: sq, w: s, h: s, ch: 3 }, SIZE, SIZE);
}
// The crop box in full-resolution pixels: a square of side min(w*W, h*H) (times grow, at most the short
// side), centred where the box is centred, then shifted to sit inside the photo. Rounding is floor(v + 0.5).
export function boxPixels(crop, W, H, grow = 1) {
  const r = v => Math.floor(v + 0.5);
  const s = Math.max(1, Math.min(r(Math.min(crop.w * W, crop.h * H) * grow), W, H));
  const cx = (crop.x + crop.w / 2) * W, cy = (crop.y + crop.h / 2) * H;
  return { x: Math.min(Math.max(r(cx - s / 2), 0), W - s), y: Math.min(Math.max(r(cy - s / 2), 0), H - s), s };
}

// One photo being analysed: the decoded original, plus lazily built bases for each view.
async function prepare(src, crop) {
  const { bmp, own } = await decode(src);
  const W = bmp.width, H = bmp.height, bases = new Map();
  let whole = null;
  const wholeImg = () => {
    if (whole) return whole;
    const full = pixels(bmp, 0, 0, W, H);
    const pre = Math.min(1, MAX_SIDE / Math.min(W, H));
    whole = pre < 1 ? resize(full, pyRound(W * pre), pyRound(H * pre)) : full;
    return whole;
  };
  const boxImg = grow => {
    if (!crop) throw new Error('This view needs a crop box.');
    const b = boxPixels(crop, W, H, grow);
    return resize(pixels(bmp, b.x, b.y, b.s, b.s), SIZE, SIZE);
  };
  const make = { pad: () => padView(wholeImg()), centre: () => centreView(wholeImg()), box: () => boxImg(1), wide: () => boxImg(WIDE) };
  return {
    rgb(name) {
      const flip = /F$/.test(name), base = flip ? name.slice(0, -1) : name;
      if (!make[base]) throw new Error(`Unknown photo view: ${name}`);
      if (!bases.has(base)) bases.set(base, make[base]());
      return flip ? mirror(bases.get(base)) : bases.get(base);
    },
    close() { if (own) bmp.close(); },
  };
}

// numpy: (x / 255 - mean) / std in float32, one step at a time.
let LUT = null;
function normLUT() {
  if (LUT) return LUT;
  const f = Math.fround;
  LUT = [0, 1, 2].map(c => {
    const t = new Float32Array(256), m = f(manifest.mean[c]), s = f(manifest.std[c]);
    for (let v = 0; v < 256; v++) t[v] = f(f(f(v / 255) - m) / s);
    return t;
  });
  return LUT;
}
async function embedRGB(img) {
  const plane = SIZE * SIZE, out = new Float32Array(3 * plane), [lr, lg, lb] = normLUT(), px = img.px;
  for (let i = 0; i < plane; i++) { out[i] = lr[px[i * 3]]; out[plane + i] = lg[px[i * 3 + 1]]; out[2 * plane + i] = lb[px[i * 3 + 2]]; }
  const res = await session.run({ [manifest.input.name]: new ort.Tensor('float32', out, [1, 3, SIZE, SIZE]) });
  return Float32Array.from(res[Object.keys(res)[0]].data);
}
function l2(v) {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

// ---------- scoring ----------
function scorer(month) {
  const { j, dim, all, ids, tRow, protosOf } = data;
  const s = j.score || {};
  const scale = s.scale ?? 100, wT = s.wText ?? 1, wP = s.wProto ?? 0, T = s.temperature || 1;
  const useMax = s.protoAgg === 'max', textAsProto = s.noProto === 'text-as-proto';
  const pm = j.prior?.month || 0, floor = j.prior?.floor ?? 0.1;
  const prior = new Float64Array(ids.length);
  if (pm > 0 && month >= 1 && month <= 12) ids.forEach((id, r) => {
    const rel = monthRates(id)?.rel?.[month - 1];
    if (rel != null) prior[r] = pm * Math.log(floor + rel); // species without records get no nudge either way
  });
  const dot = (row, f) => { let v = 0; const o = row * dim; for (let k = 0; k < dim; k++) v += all[o + k] * f[k]; return v; };
  return (f, sel) => sel.map(r => {
    const t = dot(tRow + r, f), ps = protosOf[r];
    let v;
    if (ps.length) {
      let a = useMax ? -Infinity : 0;
      for (const row of ps) { const p = dot(row, f); a = useMax ? Math.max(a, p) : a + p; }
      v = wT * t + wP * (useMax ? a : a / ps.length);
    } else v = textAsProto ? (wT + wP) * t : wT * t; // follows score.noProto; default 'text-only'
    return scale * v / T + prior[r];
  });
}
const argmax = a => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);

export async function identifyPhoto(src, opts = {}) {
  const { crop = null, kinds = null, month = new Date().getMonth() + 1, onProgress, topK = 10 } = opts;
  const say = x => { try { onProgress?.(x); } catch (_) {} };
  await loadPhotoModel(fraction => say({ phase: 'model', fraction }));
  if ((data.j.prior?.month || 0) > 0) await loadSeq();
  const t0 = performance.now();
  const sel = data.kindOf.map((k, r) => (k && (!kinds?.length || kinds.includes(k)) ? r : -1)).filter(r => r >= 0);
  if (!sel.length) throw new Error('Photo ID doesn\'t cover that kind yet.');
  const vs = data.j.views || {};
  const names = (crop ? vs.crop || ['box', 'boxF'] : vs.whole || ['pad', 'padF']);
  const score = scorer(month);
  const job = await prepare(src, crop);
  const views = [], feats = [];
  try {
    for (let i = 0; i < names.length; i++) {
      say({ phase: 'view', index: i + 1, count: names.length, view: names[i] });
      const tv = performance.now();
      const f = l2(await embedRGB(job.rgb(names[i])));
      feats.push(f);
      views.push({ name: names[i], top: data.ids[sel[argmax(score(f, sel))]], ms: Math.round(performance.now() - tv) });
    }
  } finally { job.close(); }
  const mean = new Float32Array(data.dim);
  for (const f of feats) for (let k = 0; k < mean.length; k++) mean[k] += f[k];
  const logits = score(l2(mean), sel);
  const max = Math.max(...logits);
  const ex = logits.map(v => Math.exp(v - max)), sum = ex.reduce((a, b) => a + b, 0);
  const ranked = ex.map((e, i) => ({ id: data.ids[sel[i]], p: e / sum })).sort((a, b) => b.p - a.p);
  const p1 = ranked[0].p, p2 = ranked[1]?.p || 0, b = data.j.bands || {};
  const band = p1 >= (b.likely ?? 0.8) ? 'likely' : p1 + p2 >= (b.possibly ?? 0.5) ? 'possibly' : 'unsure';
  const agreement = views.filter(v => v.top === ranked[0].id).length / views.length;
  return {
    results: ranked.slice(0, topK), band, agreement, margin: p1 - p2, ms: Math.round(performance.now() - t0), views,
    bands: { likely: b.likely ?? 0.8, possibly: b.possibly ?? 0.5 },
  };
}

// Test hook for the parity check against the reference Python: the raw model output for one view.
async function embedView(src, name, crop = null) {
  await loadPhotoModel();
  const job = await prepare(src, crop);
  try { return await embedRGB(job.rgb(name)); } finally { job.close(); }
}
// The 224x224 RGB pixels a view feeds the model, to tell preprocessing differences from model differences.
async function viewPixels(src, name, crop = null) {
  const job = await prepare(src, crop);
  try { return job.rgb(name).px; } finally { job.close(); }
}
async function embedPixels(px) {
  await loadPhotoModel();
  return embedRGB({ px, w: SIZE, h: SIZE, ch: 3 });
}
if (typeof window !== 'undefined') window.__photoid = { embedView, viewPixels, embedPixels };
