// Live bird-sound ID with BirdNET (runs on the device with TensorFlow.js).
const SAMPLE_RATE = 48000;
const WINDOW = 144000; // 3 s
const BASE = new URL('..', import.meta.url).href;

let worker = null, ready = false, readyP = null;
let ctx = null, stream = null, node = null, analyser = null, ring = null, ringIdx = 0, filled = 0;
let timer = null, raf = null, listening = false;
let labelMap = null;
let handlers = {};

function postProgress(p, text) { handlers.onProgress?.(p, text); }

export function loadListenModel(onProgress) {
  if (readyP) return readyP;
  readyP = new Promise((resolve, reject) => {
    const url = `${BASE}js/birdnet-worker.js?tf=${encodeURIComponent(BASE + 'vendor/tfjs/tf.min.js')}&root=${encodeURIComponent(BASE + 'models')}&lang=en_uk`;
    worker = new Worker(url);
    worker.onerror = e => reject(new Error(e.message || 'The sound model failed to load'));
    worker.onmessage = ({ data }) => {
      if (data.message === 'load_model') onProgress?.(data.progress, 'Downloading the sound model');
      else if (data.message === 'warmup') onProgress?.(75, 'Warming up');
      else if (data.message === 'load_geomodel' || data.message === 'load_labels') onProgress?.(92, 'Almost ready');
      else if (data.message === 'loaded') { ready = true; onProgress?.(100, 'Ready'); resolve(); }
      else if (data.message === 'pooled') handlePooled(data.pooled);
      else if (data.message === 'error') { readyP = null; reject(new Error(data.error)); }
    };
  });
  return readyP;
}

export function setLocation(lat, lng) {
  worker?.postMessage({ message: 'area-scores', latitude: lat, longitude: lng });
}

async function getMap() {
  if (!labelMap) labelMap = await fetch(`${BASE}data/birdnet-map.json`).then(r => r.json());
  return labelMap;
}

function handlePooled(pooled) {
  if (!listening && !handlers.oneShot) return;
  const hits = pooled
    .filter(p => p.confidence >= (handlers.threshold ?? 0.3) && p.geoscore >= 0.01)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(p => ({ index: p.index, name: p.commonName, sci: p.scientificName, confidence: p.confidence, dexId: labelMap?.[p.index] ?? null }));
  handlers.onDetections?.(hits);
}

function draw(canvas) {
  const g = canvas.getContext('2d');
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const w = canvas.width, h = canvas.height;
  // Show 0–12 kHz, where almost all bird song sits.
  const maxBin = Math.floor(bins.length * (12000 / (SAMPLE_RATE / 2)));
  const step = () => {
    if (!listening) return;
    analyser.getByteFrequencyData(bins);
    const img = g.getImageData(2, 0, w - 2, h);
    g.putImageData(img, 0, 0);
    for (let y = 0; y < h; y++) {
      const v = bins[Math.floor((1 - y / h) * maxBin)] / 255;
      g.fillStyle = colour(v);
      g.fillRect(w - 2, y, 2, 1);
    }
    raf = requestAnimationFrame(step);
  };
  g.fillStyle = colour(0); g.fillRect(0, 0, w, h);
  step();
}
function colour(v) {
  // mangrove → azure → robin yellow
  const stops = [[15, 30, 27], [26, 95, 204], [245, 197, 24], [255, 255, 255]];
  const t = Math.min(0.999, Math.max(0, (v - 0.15) / 0.85)) * (stops.length - 1);
  const i = Math.floor(t), f = t - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export async function startListening({ canvas, onDetections, onStatus, threshold = 0.3 }) {
  handlers = { onDetections, onStatus, threshold };
  await getMap();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.2;
  src.connect(hp); hp.connect(analyser);
  ring = new Float32Array(WINDOW); ringIdx = 0; filled = 0;
  await ctx.audioWorklet.addModule(`${BASE}js/audio-processor.js`);
  node = new AudioWorkletNode(ctx, 'audio-processor');
  node.port.onmessage = e => {
    const d = e.data;
    for (let i = 0; i < d.length; i++) { ring[ringIdx] = d[i]; ringIdx = (ringIdx + 1) % WINDOW; }
    filled = Math.min(WINDOW, filled + d.length);
  };
  hp.connect(node);
  const mute = ctx.createGain(); mute.gain.value = 0;
  node.connect(mute); mute.connect(ctx.destination);
  listening = true;
  if (canvas) draw(canvas);
  try { handlers.wake = await navigator.wakeLock?.request('screen'); } catch (_) {}
  const tick = () => {
    if (!listening) return;
    if (ready && filled >= WINDOW / 2) {
      const win = new Float32Array(WINDOW);
      let idx = ringIdx;
      for (let i = 0; i < WINDOW; i++) { win[i] = Math.max(-1, Math.min(1, ring[idx])); idx = (idx + 1) % WINDOW; }
      worker.postMessage({ message: 'predict', pcmAudio: win, overlapSec: 0, sensitivity: 1.0 }, [win.buffer]);
    }
    timer = setTimeout(tick, 1500);
  };
  tick();
  onStatus?.('listening');
}

export function stopListening() {
  listening = false;
  clearTimeout(timer); cancelAnimationFrame(raf);
  try { handlers.wake?.release(); } catch (_) {}
  stream?.getTracks().forEach(t => t.stop());
  try { node?.disconnect(); } catch (_) {}
  try { ctx?.close(); } catch (_) {}
  stream = node = ctx = null;
  handlers.onStatus?.('stopped');
}

export const isListening = () => listening;
