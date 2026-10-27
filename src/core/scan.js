// The photo-ID pipeline: model readiness, identification and the local scan log.
// The React screen owns the viewfinder, crop box and result cards; nothing here touches the DOM.
import { byId, KINDS } from './species.js';
import { galleryFor } from './gallery.js';
import { sized } from './media.js';
import { db } from './db.js';

const LOG_MAX = 200;
let mod = null;
let info = null;

export const loadPhotoId = async () => (mod ||= await import('./photoid.js'));

export async function photoIdInfo() {
  try {
    const m = await loadPhotoId();
    info = info || await m.photoInfo();
    return info || { kinds: [], metrics: null };
  } catch (_) {
    return { kinds: [], metrics: null };
  }
}
export const scanInfo = () => info;
export const scanSubject = (known, kind) => (kind ? KINDS[kind]?.one : known?.kinds?.length === 1 ? KINDS[known.kinds[0]]?.one : null);

export async function modelCached() {
  const m = await loadPhotoId();
  return m.isPhotoModelCached();
}
export async function ensureModel(onProgress) {
  const m = await loadPhotoId();
  await m.loadPhotoModel(onProgress);
  return m;
}
export const photoModelMb = () => 104;

// Identify a file. Returns the raw identifyPhoto result plus the log timestamp.
export async function identifyScan(file, { crop = null, kinds = null, month = new Date().getMonth() + 1, onProgress } = {}) {
  const m = await ensureModel();
  const res = await m.identifyPhoto(file, { crop, kinds, month, onProgress });
  const logAt = await logScan(res);
  return { res, logAt };
}

export const topResults = res => (res?.results || []).slice(0, 3).map(x => ({ ...x, sp: byId.get(x.id) })).filter(x => x.sp);

export function scanHeadline(res) {
  const top = topResults(res);
  const [a, b] = top;
  if (!a) return "Can't tell from this photo";
  const band = res.band === 'possibly' && !b ? 'unsure' : res.band;
  if (band === 'likely') return `Likely: ${a.sp.name}`;
  if (band === 'possibly') return `Possibly ${a.sp.name} or ${b?.sp?.name || a.sp.name}`;
  return "Can't tell from this photo";
}

export function scanAdvice(res, { whole, multi, kind, known } = {}) {
  const subj = scanSubject(known, kind);
  if (res.band === 'likely') return 'Check the markings against the photos below, then log it.';
  if (res.band === 'possibly') return whole ? `Compare the two below. A box around just the ${subj || 'subject'} often settles it.` : 'Compare the two below. A tighter box or another angle often settles it.';
  if (whole) return `Draw a box around the ${subj || 'subject'} and try again.`;
  if (multi && !kind) return 'Choose what kind it is, or try a tighter box or a photo from another angle.';
  return 'Try a tighter box, or a photo from another angle.';
}

export const bandLevel = (p, bands) => (p >= (bands?.likely ?? 0.8) ? 'strong' : p >= 0.3 ? 'possible' : p >= 0.08 ? 'outside' : 'unlikely');
export const bandWord = level => ({ strong: 'Strong match', possible: 'Possible', outside: 'Outside chance', unlikely: 'Unlikely' })[level];
export const pct = p => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);
export const words = (list, and = 'or') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`);
export const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
export const firstSentence = s => (String(s || '').match(/^.*?[.!?](?=\s|$)/) || [String(s || '')])[0];

// Reference photos for the comparison cards: gallery first, then Wikipedia.
export function scanRefs(id) {
  const g = galleryFor(id).slice(0, 2).map(p => ({ src: p.thumb || p.src, credit: p.credit, from: p.from }));
  if (g.length < 2) { const w = sized(id); if (w && !g.some(p => p.src === w)) g.unshift({ src: w, credit: '', from: 'Wikipedia' }); }
  return g.slice(0, 2);
}

export function accuracyLine(m) {
  if (!m || typeof m !== 'object') return '';
  if (typeof m.text === 'string' && m.text.trim()) return ` ${m.text.trim()}`;
  const frac = v => (typeof v === 'number' && isFinite(v) ? (v > 1 ? v / 100 : v) : null);
  const top1 = frac(m.top1 ?? m.top1Acc ?? m.accuracy), top3 = frac(m.top3 ?? m.top3Acc);
  const n = m.n ?? m.photos ?? m.count;
  if (top1 == null) return '';
  const on = typeof n === 'number' && n > 0 ? ` on ${n.toLocaleString('en-AU')} photos it hadn't seen before` : '';
  let s = ` In testing${on}, it named the right species first ${Math.round(top1 * 100)}% of the time`;
  s += top3 != null ? `, and had it in its top three ${Math.round(top3 * 100)}% of the time.` : '.';
  const lp = frac(m.likelyPrecision ?? m.likely);
  if (lp != null) s += ` When it said Likely, it was right ${Math.round(lp * 100)}% of the time.`;
  return s;
}

export const scanFootnote = known => `Photo ID runs on your phone with BioCLIP, a model from the Imageomics Institute (MIT licence). The first scan downloads about ${photoModelMb()} MB once, best on Wi-Fi. After that it works offline.${accuracyLine(known?.metrics)}`;

export async function logScan(res) {
  const at = Date.now();
  try {
    const log = (await db.kvGet('scanLog')) || [];
    log.push({ at, top: res.results.slice(0, 5).map(r => [r.id, Math.round(r.p * 1000) / 1000]), band: res.band, chosen: null });
    await db.kvSet('scanLog', log.slice(-LOG_MAX));
  } catch (_) {}
  return at;
}
export async function markChosen(at, chosen) {
  if (!at) return;
  try {
    const log = (await db.kvGet('scanLog')) || [];
    const e = log.find(x => x.at === at);
    if (e) { e.chosen = chosen; await db.kvSet('scanLog', log); }
  } catch (_) {}
}
