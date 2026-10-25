// Regional data built from Atlas of Living Australia records (see scripts/build_ala.py).
import { haversineKm } from './stats.js';

let data = null;
export async function loadSeq() {
  if (data) return data;
  try {
    const r = await fetch('data/seq.json');
    data = await r.json();
  } catch (_) { data = { species: {}, hotspots: [], effort: Array(12).fill(1) }; }
  return data;
}
export const seq = () => data;

// Reporting rate per month (species records / all bird records), scaled 0–1 against its best month.
export function monthRates(id) {
  const sp = data?.species?.[id];
  if (!sp || !sp.n) return null;
  const rates = sp.m.map((c, i) => c / Math.max(1, data.effort[i]));
  const max = Math.max(...rates);
  return { raw: rates, rel: rates.map(r => (max ? r / max : 0)) };
}

// How likely a species is in a month, for ranking targets. Higher is easier.
export function likelihood(id, month) {
  const m = monthRates(id);
  if (!m) return 0;
  return m.raw[month - 1] * 1000;
}

export function recordCount(id) { return data?.species?.[id]?.n || 0; }

export function spotsFor(id, limit = 6) {
  if (!data) return [];
  return data.hotspots
    .map(h => ({ h, c: (h.sp.find(([sid]) => sid === id) || [0, 0])[1] }))
    .filter(x => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, limit);
}

export function pointsFor(id) { return data?.species?.[id]?.pts || []; }

export function hotspots() { return data?.hotspots || []; }

// Unseen species recorded at hotspots near a position, ranked by how often they're reported there.
export function nearbyTargets(pos, seen, radiusKm = 15) {
  if (!data) return { spots: [], list: [] };
  const spots = data.hotspots.map(h => ({ h, d: haversineKm(pos, h) })).filter(x => x.d <= radiusKm).sort((a, b) => a.d - b.d);
  const agg = new Map();
  for (const { h, d } of spots) {
    for (const [id, c] of h.sp) {
      if (seen.has(id)) continue;
      const e = agg.get(id) || { id, score: 0, best: null };
      e.score += c;
      if (!e.best || c > e.best.c) e.best = { h, c, d };
      agg.set(id, e);
    }
  }
  return { spots, list: [...agg.values()].sort((a, b) => b.score - a.score) };
}
