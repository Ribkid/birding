// On-device photo identification with BioCLIP (imageomics/bioclip, ViT-B/16), run by onnxruntime-web.
// The image encoder (~87 MB, uint8-quantised ONNX) is fetched in chunks once and kept in Cache Storage,
// so later loads work offline. Scores are restricted to the dex species using precomputed embeddings.
//
// API:
//   loadPhotoModel(onProgress?: (fraction 0..1, label) => void) -> Promise<void>
//   identifyPhoto(blob | File | ImageBitmap | HTMLImageElement | HTMLCanvasElement, { crop?, topK? })
//     -> Promise<[{ id, score }]> (top 5). crop = { x, y, w, h } as fractions of the image (0..1),
//     e.g. from a crop box drawn around the bird; distant birds are identified far better when cropped.
//   isPhotoModelCached() -> Promise<boolean>
//   PHOTO_MODEL_MB  (approx first download size, MB)

const BASE = new URL('/', location.href);
const ORT_DIR = new URL('vendor/ort/', BASE).href;
const MODEL_DIR = new URL('models/bioclip/', BASE).href;
const TEXT_URL = new URL('data/bioclip-text.json', BASE).href;
const CACHE = 'birddex-models';
const SIZE = 224;

export const PHOTO_MODEL_MB = 98; // model 87 MB + runtime 11 MB

let ort = null;
let session = null;
let classes = null;   // { count, dim, scale, text: Float32Array, proto: Float32Array|null, wText, wProto }
let manifest = null;
let loading = null;

function f16ToF32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    out[i] = e === 0 ? s * Math.pow(2, -14) * (f / 1024)
      : e === 31 ? (f ? NaN : s * Infinity)
      : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return out;
}
function b64ToF32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return f16ToF32(new Uint16Array(bytes.buffer));
}

async function cachedFetch(url, { onBytes } = {}) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (_) { /* no Cache Storage (private mode) */ }
  const hit = cache && await cache.match(url);
  if (hit) { const buf = await hit.arrayBuffer(); onBytes?.(buf.byteLength); return buf; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()} (${res.status})`);
  let buf;
  if (onBytes && res.body) {
    const reader = res.body.getReader(); const parts = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(value.length, true); }
    const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  if (cache) { try { await cache.put(url, new Response(buf.slice(0))); } catch (_) {} }
  return buf;
}

export async function isPhotoModelCached() {
  try {
    const m = await (await fetch(MODEL_DIR + 'manifest.json')).json();
    const c = await caches.open(CACHE);
    return !!(await c.match(MODEL_DIR + m.version + '.onnx'));
  } catch (_) { return false; }
}

async function loadClasses() {
  const j = await (await fetch(TEXT_URL)).json();
  classes = {
    count: j.count, dim: j.dim, scale: j.logitScale || 100,
    text: b64ToF32(j.data),
    proto: j.proto ? b64ToF32(j.proto) : null,
    wText: j.weights?.text ?? 1, wProto: j.weights?.proto ?? 0,
  };
}

export function loadPhotoModel(onProgress) {
  if (session) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const report = (f, label) => { try { onProgress?.(Math.max(0, Math.min(1, f)), label); } catch (_) {} };
    report(0, 'Starting');
    manifest = await (await fetch(MODEL_DIR + 'manifest.json')).json();
    const [ortMod] = await Promise.all([import(ORT_DIR + 'ort.wasm.min.mjs'), loadClasses()]);
    ort = ortMod.default || ortMod;
    ort.env.wasm.wasmPaths = ORT_DIR;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

    const wasmBytes = 11.2e6;
    const total = manifest.totalBytes + wasmBytes;
    let done = 0;
    const tick = n => { done += n; report(done / total, 'Downloading the photo model'); };

    // The runtime's .wasm, cached so it also works offline.
    ort.env.wasm.wasmBinary = await cachedFetch(ORT_DIR + 'ort-wasm-simd-threaded.wasm', { onBytes: tick });

    // The model: one cache entry for the whole file, built from chunks on first use.
    const key = MODEL_DIR + manifest.version + '.onnx';
    let modelBuf = null;
    try { const c = await caches.open(CACHE); const hit = await c.match(key); if (hit) modelBuf = await hit.arrayBuffer(); } catch (_) {}
    if (modelBuf) tick(manifest.totalBytes);
    else {
      const parts = [];
      for (const ch of manifest.chunks) {
        const res = await fetch(MODEL_DIR + ch.file);
        if (!res.ok) throw new Error(`Could not download the photo model (${res.status})`);
        const reader = res.body.getReader();
        for (;;) { const { done: d, value } = await reader.read(); if (d) break; parts.push(value); tick(value.length); }
      }
      const all = new Uint8Array(manifest.totalBytes); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      modelBuf = all.buffer;
      try { const c = await caches.open(CACHE); await c.put(key, new Response(modelBuf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (_) {}
    }
    report(0.99, 'Starting the model');
    session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    report(1, 'Ready');
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

async function toBitmap(src) {
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return src;
  if (src instanceof Blob) return createImageBitmap(src, { imageOrientation: 'from-image' });
  return createImageBitmap(src);
}

// open_clip BioCLIP preprocessing, matching torchvision on PIL images:
// Resize(224, bicubic, antialias) on the shortest side, CenterCrop(224), Normalize(mean, std).
// The resize is a port of Pillow's separable antialiased bicubic resample (a = -0.5),
// including its rounding to 8-bit between the horizontal and vertical passes.
const MAX_SIDE = 1600; // very large photos are first reduced by the browser to keep this fast

function bicubic(x) {
  const a = -0.5; x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}
function coeffs(inSize, outSize) {
  const scale = inSize / outSize, fs = Math.max(scale, 1), support = 2 * fs;
  const bounds = new Int32Array(outSize * 2), ksize = Math.ceil(support) * 2 + 1;
  const k = new Float64Array(outSize * ksize);
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale;
    let xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) { const w = bicubic((x + xmin - center + 0.5) / fs); k[i * ksize + x] = w; ww += w; }
    for (let x = 0; x < xmax; x++) if (ww) k[i * ksize + x] /= ww;
    bounds[i * 2] = xmin; bounds[i * 2 + 1] = xmax;
  }
  return { k, bounds, ksize };
}
const clip8 = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function resampleRGB(src, w, h, ow, oh) {
  // horizontal pass
  const hc = coeffs(w, ow), tmp = new Uint8ClampedArray(ow * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < ow; x++) {
    const xmin = hc.bounds[x * 2], n = hc.bounds[x * 2 + 1], ko = x * hc.ksize;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < n; j++) { const w8 = hc.k[ko + j], si = (y * w + xmin + j) * 4; r += src[si] * w8; g += src[si + 1] * w8; b += src[si + 2] * w8; }
    const o = (y * ow + x) * 3; tmp[o] = clip8(r); tmp[o + 1] = clip8(g); tmp[o + 2] = clip8(b);
  }
  // vertical pass
  const vc = coeffs(h, oh), out = new Uint8ClampedArray(ow * oh * 3);
  for (let y = 0; y < oh; y++) {
    const ymin = vc.bounds[y * 2], n = vc.bounds[y * 2 + 1], ko = y * vc.ksize;
    for (let x = 0; x < ow; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) { const w8 = vc.k[ko + j], si = ((ymin + j) * ow + x) * 3; r += tmp[si] * w8; g += tmp[si + 1] * w8; b += tmp[si + 2] * w8; }
      const o = (y * ow + x) * 3; out[o] = clip8(r); out[o + 1] = clip8(g); out[o + 2] = clip8(b);
    }
  }
  return out;
}

function preprocess(bmp) {
  const { mean, std } = manifest;
  let w = bmp.width, h = bmp.height;
  const pre = Math.min(1, MAX_SIDE / Math.min(w, h));
  if (pre < 1) { w = Math.round(w * pre); h = Math.round(h * pre); }
  const c = OffscreenCanvasOr(w, h);
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  cx.drawImage(bmp, 0, 0, w, h);
  const src = cx.getImageData(0, 0, w, h).data;
  // torchvision Resize(int): short side -> 224, long side truncated
  let ow, oh;
  if (w <= h) { ow = SIZE; oh = Math.trunc(SIZE * h / w); } else { oh = SIZE; ow = Math.trunc(SIZE * w / h); }
  const rgb = resampleRGB(src, w, h, ow, oh);
  const top = Math.round((oh - SIZE) / 2), left = Math.round((ow - SIZE) / 2);
  const plane = SIZE * SIZE, out = new Float32Array(3 * plane);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const si = ((y + top) * ow + (x + left)) * 3, i = y * SIZE + x;
    out[i] = (rgb[si] / 255 - mean[0]) / std[0];
    out[plane + i] = (rgb[si + 1] / 255 - mean[1]) / std[1];
    out[2 * plane + i] = (rgb[si + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}
function OffscreenCanvasOr(w, h) {
  // (plain function; returns an OffscreenCanvas where available, else a <canvas>)
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export async function identifyPhoto(src, opts = {}) {
  const { crop = null, topK = 5 } = typeof opts === 'number' ? { topK: opts } : opts;
  await loadPhotoModel();
  let bmp = await toBitmap(src);
  if (crop) {
    const sx = Math.max(0, Math.round(crop.x * bmp.width)), sy = Math.max(0, Math.round(crop.y * bmp.height));
    const sw = Math.max(8, Math.min(bmp.width - sx, Math.round(crop.w * bmp.width)));
    const sh = Math.max(8, Math.min(bmp.height - sy, Math.round(crop.h * bmp.height)));
    bmp = await createImageBitmap(bmp, sx, sy, sw, sh);
  }
  const input = new ort.Tensor('float32', preprocess(bmp), [1, 3, SIZE, SIZE]);
  const out = await session.run({ [manifest.input.name]: input });
  const feat = out[Object.keys(out)[0]].data;
  const { count, dim, scale, text, proto, wText, wProto } = classes;
  const logits = new Float32Array(count);
  for (let c = 0; c < count; c++) {
    let t = 0, p = 0;
    const o = c * dim;
    for (let k = 0; k < dim; k++) { t += text[o + k] * feat[k]; if (proto) p += proto[o + k] * feat[k]; }
    logits[c] = scale * (proto ? wText * t + wProto * p : t);
  }
  let max = -Infinity; for (const v of logits) if (v > max) max = v;
  let sum = 0; const probs = Array.from(logits, v => { const e = Math.exp(v - max); sum += e; return e; });
  return probs.map((p, i) => ({ id: i + 1, score: p / sum }))
    .sort((a, b) => b.score - a.score).slice(0, topK);
}
