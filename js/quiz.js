// Question engine for Learn: who to ask about, look-alike-aware wrong answers, question makers and teaching text.
// Pure data in, plain question objects out; js/learn.js draws them. Works in Node for the birds (tests).
import { SPECIES, ANIMALS, GROUPS, HABITATS, KINDS, byId, ofKind, kindsPresent, parseSize } from './species.js';
import { sized, photoFor, localCallsNow, loadCallPack } from './media.js';
import { galleryFor } from './gallery.js';
import { seq, monthRates, recordCount, spotsFor, hotspots } from './seqdata.js';
import { MONTHS, inSeason } from './stats.js';

// ---------- randomness (seeded for the daily challenge, so everyone gets the same set) ----------
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function shuffle(a, rng = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pick = (a, rng = Math.random) => a[(rng() * a.length) | 0];
const fmt = n => n.toLocaleString('en-AU');
const lc = s => String(s).toLowerCase();

// ---------- curated look-alikes (data/lookalikes.json) ----------
let pairs = [];
const tells = new Map(), mates = new Map();
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export function useLookalikes(list) {
  pairs = (Array.isArray(list) ? list : []).filter(p => p && byId.has(p.a) && byId.has(p.b) && p.tell);
  tells.clear(); mates.clear();
  for (const p of pairs) {
    tells.set(pairKey(p.a, p.b), p.tell);
    (mates.get(p.a) || mates.set(p.a, []).get(p.a)).push(p.b);
    (mates.get(p.b) || mates.set(p.b, []).get(p.b)).push(p.a);
  }
  return pairs.length;
}
let laLoading = null;
export function loadLookalikes() {
  laLoading ||= fetch(new URL('../data/lookalikes.json', import.meta.url))
    .then(r => (r.ok ? r.json() : [])).catch(() => []).then(useLookalikes);
  return laLoading;
}
export const tellFor = (a, b) => tells.get(pairKey(a, b)) || null;
export const lookalikesOf = id => mates.get(id) || [];
export const lookalikePairs = () => pairs;

// ---------- sizes with units (parsed in species.js) ----------
export { parseSize };
export function sizeOf(sp) {
  if (!sp) return null;
  if (sp.kind === 'bird') return sp.size ? { cm: sp.size, measure: 'length' } : null;
  const p = parseSize(sp.sizeText);
  return p && sp.kind === 'plant' ? { ...p, measure: 'height' } : p;
}

// ---------- wrong answers that teach ----------
const reptileClass = sp => (sp.group === 'reptile:turtles' ? 'turtle' : sp.group === 'reptile:snakes' ? 'snake' : 'lizard');
// Turtles, snakes and lizards never stand in for each other: that would be a giveaway, not a look-alike.
export const sameClass = (a, b) => a.kind === b.kind && (a.kind !== 'reptile' || reptileClass(a) === reptileClass(b));

export function distractorScore(ans, c) {
  let s = 0;
  if (tellFor(ans.id, c.id)) s += 5;
  if (c.group === ans.group) s += 3;
  const a = sizeOf(ans), b = sizeOf(c);
  if (a && b && a.measure === b.measure && Math.max(a.cm, b.cm) / Math.max(0.1, Math.min(a.cm, b.cm)) < 1.3) s += 2;
  if (ans.habitats.some(h => c.habitats.includes(h))) s += 1;
  if ((ans.season || null) === (c.season || null)) s += 1;
  return s;
}

// Easy: other groups of the same kind. Normal: one close look-alike and two random. Hard: the three closest.
export function pickDistractors(ans, { difficulty = 'normal', n = 3, rng = Math.random, pool = SPECIES } = {}) {
  const cands = pool.filter(c => c.id !== ans.id && c.kind === ans.kind && (sameClass(ans, c) || tellFor(ans.id, c.id)));
  const scored = cands.map(c => ({ c, s: distractorScore(ans, c) + rng() * 0.9 })).sort((x, y) => y.s - x.s);
  let out;
  if (difficulty === 'easy') {
    const far = shuffle(cands.filter(c => c.group !== ans.group && !tellFor(ans.id, c.id)), rng);
    out = far.slice(0, n);
    if (out.length < n) out.push(...shuffle(cands.filter(c => !out.includes(c)), rng).slice(0, n - out.length));
  } else if (difficulty === 'hard') {
    out = scored.slice(0, n).map(x => x.c);
  } else {
    const close = scored.slice(0, 3).map(x => x.c);
    out = close.length ? [pick(close, rng)] : [];
    out.push(...shuffle(cands.filter(c => !out.includes(c)), rng).slice(0, n - out.length));
  }
  return out.slice(0, n);
}

// ---------- who's around, who has what ----------
export const relRate = (id, month) => { const m = monthRates(id); return m ? m.rel[month - 1] : null; };
export const aroundNow = (sp, month, min = 0.5) => (relRate(sp.id, month) ?? (inSeason(sp, month) ? 1 : 0)) >= min;
// Our own offline clips first (js/media.js call pack), then the remote recordings they were cut from are skipped.
export const callsOf = id => {
  const local = localCallsNow(id), orig = new Set(local.map(c => c.orig));
  return [...local, ...(seq()?.species?.[id]?.calls || []).filter(c => !orig.has(c.src))];
};
export const hasCall = id => callsOf(id).length > 0;
export { loadCallPack };
export const hasPhoto = sp => !!photoFor(sp.id) || galleryFor(sp.id).length > 0;
export const CALL_KINDS = ['bird', 'frog'];

export function speciesFor(kind) {
  if (kind === 'animals') return ANIMALS;
  if (kind === 'all') return SPECIES;
  return kindsPresent.includes(kind) ? ofKind(kind) : [];
}
export function poolFor({ kind = 'animals', scope = 'all', seen = new Set(), month = new Date().getMonth() + 1 } = {}) {
  let list = speciesFor(kind);
  if (scope === 'seen') list = list.filter(s => seen.has(s.id));
  if (scope === 'month') list = list.filter(s => aroundNow(s, month));
  return list;
}
// Commoner species first on Easy; Hard brings in the scarce and rare ones.
function byDifficulty(list, difficulty) {
  const cap = difficulty === 'easy' ? 2 : difficulty === 'normal' ? 4 : 5;
  const kept = list.filter(s => s.rarity <= cap);
  return kept.length >= 8 ? kept : list;
}

// ---------- teaching text ----------
const MARK = /\b(black|white|grey|brown|red|orange|yellow|green|blue|purple|pink|chestnut|rufous|olive|buff|cream|golden|gold|scarlet|crimson|glossy|lemon|bronze|cinnamon|tan|silvery?|pale|dark|stripes?|striped|spots?|spotted|dotted|flecks?|barred|bars?|bands?|banded|patch(?:es)?|crest(?:ed)?|bill|eyes?|eye-ring|cap|crown|throat|chest|belly|breast|back|rump|tail|wings?|neck|legs?|feet|toes|face|head|collar|plumes?|wattles?|shield|bark|leaves|leaf|flowers?|fronds?|fruit|cones?|buds?|shell|snout|ears?|scales?|scaly|tongue|pupil|thighs?|streaks?|eyespots?|veins|edges?|mask|hood|bib|eyebrow|necklace|spines?|spiny|warty|fur|coat|muzzle|nose|trunk)\b/i;
export const sentences = text => String(text || '').split(/(?<=[.!?])\s+(?=["'A-Z(])/).map(s => s.trim()).filter(Boolean);
// The sentences that describe how it looks, skipping bare lines like 'Introduced.' or 'The feral city pigeon.'.
export function fieldMarks(sp, n = 3) {
  const ss = sentences(sp?.notes).filter(s => !/^introduced[.;]?$/i.test(s));
  const marks = ss.filter(s => s.length > 12 && MARK.test(s));
  return (marks.length ? marks : ss).slice(0, n);
}
export const fieldMark = sp => fieldMarks(sp, 1)[0] || '';

const CALLISH = /\b(calls?|calling|song|sings?|duets?|listen|whistles?|whistled|notes?|cry|cries|laughing|carries|twitter|bleat|chorus|trill|sound|heard|fills)\b/i;
// Call words quoted in the notes, e.g. 'wonk-wonk-wonk'. Nicknames ('The "storm bird"') don't count.
export function callWords(sp) {
  for (const se of sentences(sp?.notes)) {
    for (const m of se.matchAll(/"([^"]+)"/g)) {
      const before = se.slice(0, m.index).trim();
      const nick = !before || /^(the|a)$/i.test(before) || /^[:)]/.test(se.slice(m.index + m[0].length));
      if (nick || /^[A-Z]$/.test(m[1])) continue;
      if (CALLISH.test(se) || /^[a-z' ]+(?:-[a-z']+)+$/.test(m[1])) return { words: m[1], sentence: se };
    }
  }
  return null;
}

// 'Who am I?': the notes with names and group words blanked (\u0001 marks a blank).
const KEEP = new Set(['the', 'and', 'with', 'of', 'other', 'common', 'eastern', 'western', 'southern', 'northern', 'australian', 'australasian',
  'pacific', 'oriental', 'indo', 'little', 'great', 'greater', 'lesser', 'large', 'small', 'black', 'white', 'grey', 'brown', 'red', 'green',
  'blue', 'yellow', 'orange', 'pink', 'purple', 'golden', 'scarlet', 'crimson', 'chestnut', 'rufous', 'olive', 'pale', 'dark', 'spotted',
  'striped', 'barred', 'banded', 'crested', 'native', 'marine', 'coastal', 'rainforest', 'tailed', 'faced', 'headed', 'necked', 'backed',
  'bellied', 'breasted', 'winged', 'eyed', 'billed', 'throated', 'capped', 'browed', 'shouldered', 'sided', 'legged', 'eared', 'footed', 'nosed',
  ...Object.values(KINDS).flatMap(k => [lc(k.one), lc(k.label)])]);
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = w => [...new Set([w, `${w}s`, `${w}es`, w.replace(/y$/, 'ies'), w.replace(/(ch|sh|x|ss)$/, '$1es')])];
const stem = w => (w.length > 4 && /ies$/.test(w) ? w.replace(/ies$/, 'y') : w.length > 4 && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
export function blankNotes(sp, others = []) {
  let t = String(sp.notes || '');
  const names = [sp, ...others].filter(Boolean);
  for (const s of names) t = t.replace(new RegExp(reEsc(s.name), 'gi'), '\u0001');
  const words = new Set();
  const addWords = (text, keepShort = false) => String(text).toLowerCase().replace(/'s\b/g, '').split(/[^a-z']+/)
    .filter(w => w.length >= (keepShort ? 3 : 4) && !KEEP.has(w)).forEach(w => words.add(stem(w)));
  names.forEach(s => addWords(s.name, true));
  addWords(GROUPS[sp.group] || '');
  addWords(sp.sci || '');
  for (const w of words) t = t.replace(new RegExp(`\\b(?:${forms(w).map(reEsc).join('|')})\\b`, 'gi'), '\u0001');
  return t.replace(/\u0001(?:[\s-]*\u0001)+/g, '\u0001');
}
const clueOk = clue => clue.replace(/\u0001/g, '').replace(/[^a-z]/gi, '').length >= 28;

// ---------- photos ----------
// The Wikipedia picture plus the iNaturalist gallery. A random one first (so you learn the species, not one photo);
// the rest are fallbacks if a picture won't load.
// prefer 'wiki' keeps the Wikipedia lead picture first (duels and fact photos, where the bird must be plain to see).
export function photosFor(id, { size = 'large', rng = Math.random, cached = null, prefer = 'mix' } = {}) {
  const out = [];
  if (photoFor(id)) {
    const src = sized(id, size);
    if (src) out.push({ src, credit: 'Wikipedia', license: '', page: photoFor(id)?.url || '', wiki: true });
  }
  for (const g of galleryFor(id)) out.push({ src: size === 'small' ? (g.thumb || g.src) : g.src, credit: g.credit || '', license: g.license || '', page: g.page || '' });
  if (cached) { // offline: the photo saved on this phone goes first
    const i = out.findIndex(p => p.src === cached);
    const hit = i >= 0 ? out.splice(i, 1)[0] : { src: cached, credit: 'Wikipedia', license: '', page: '' };
    return [hit, ...out];
  }
  // Half the time the Wikipedia picture, otherwise one of the field photos.
  const wiki = out[0]?.wiki ? 1 : 0;
  if (out.length > 1 && prefer !== 'wiki') {
    const i = wiki && rng() < 0.5 ? 0 : wiki + ((rng() * (out.length - wiki)) | 0);
    out.unshift(out.splice(i, 1)[0]);
  }
  return out;
}
// Which of these species have a photo saved in the offline image cache? id -> url
export async function cachedPhotos(list) {
  const out = new Map();
  if (typeof caches === 'undefined') return out;
  let c;
  try { c = await caches.open('birddex-images'); } catch (_) { return out; }
  await Promise.all(list.map(async sp => {
    if (!photoFor(sp.id)) return;
    for (const size of ['large', 'small']) {
      const url = sized(sp.id, size);
      try { if (url && await c.match(url)) { out.set(sp.id, url); return; } } catch (_) {}
    }
  }));
  return out;
}
// Calls saved on this phone (the audio cache, or a same-origin clip the service worker kept). id -> call
export async function cachedCalls(list) {
  const out = new Map();
  if (typeof caches === 'undefined') return out;
  await Promise.all(list.map(async sp => {
    for (const c of callsOf(sp.id)) {
      try { if (await caches.match(c.local || c.src)) { out.set(sp.id, c); return; } } catch (_) {}
    }
  }));
  return out;
}

// ---------- question makers ----------
const optOf = s => ({ key: String(s.id), label: s.name, sp: s.id });
const one = sp => KINDS[sp.kind].one;
const label = k => KINDS[k].label.toLowerCase();

function speciesQ(type, sp, { difficulty = 'normal', rng = Math.random } = {}) {
  const wrong = pickDistractors(sp, { difficulty, rng, pool: ofKind(sp.kind) });
  if (wrong.length < 3) return null;
  return { type, focus: sp.id, answer: String(sp.id), options: shuffle([sp, ...wrong], rng).map(optOf), wrong };
}
export function photoQ(sp, o = {}) {
  const q = speciesQ('photo', sp, o);
  if (!q) return null;
  q.prompt = `Which ${one(sp)} is this?`;
  q.photos = photosFor(sp.id, { size: o.size || 'large', rng: o.photoRng || o.rng, cached: o.cached?.get(sp.id) });
  return q.photos.length ? q : null;
}
export function callQ(sp, o = {}) {
  const list = o.cachedCall ? [o.cachedCall] : callsOf(sp.id);
  if (!list.length) return null;
  const q = speciesQ('call', sp, o);
  if (!q) return null;
  q.prompt = `Which ${one(sp)} is calling?`;
  q.call = pick(list, o.photoRng || o.rng || Math.random);
  q.photos = photosFor(sp.id, { rng: o.photoRng || o.rng, cached: o.cached?.get(sp.id) });
  return q;
}
export function whoQ(sp, o = {}) {
  const q = speciesQ('whoami', sp, o);
  if (!q) return null;
  q.clue = blankNotes(sp, q.wrong);
  if (!clueOk(q.clue)) return null;
  q.prompt = `Which ${one(sp)} am I?`;
  q.photos = photosFor(sp.id, { rng: o.photoRng || o.rng, cached: o.cached?.get(sp.id) });
  return q;
}
// Look-alike duel: two photos, 'Which is the X?'
export function duelQ(pair, o = {}) {
  const rng = o.rng || Math.random;
  const a = byId.get(pair.a), b = byId.get(pair.b);
  if (!a || !b) return null;
  const target = rng() < 0.5 ? a : b;
  const sides = shuffle([a, b], rng).map(s => ({ ...optOf(s), photos: photosFor(s.id, { rng: o.photoRng || rng, cached: o.cached?.get(s.id), prefer: 'wiki' }) }));
  if (sides.some(s => !s.photos.length)) return null;
  return { type: 'duel', focus: target.id, answer: String(target.id), options: sides, prompt: `Which is the ${target.name}?`, tell: pair.tell };
}

// ---------- facts (ported from the trivia branch, one kind per question) ----------
const alaSource = sp => {
  const lsid = seq()?.species?.[sp.id]?.lsid;
  return { title: `${sp.name} records, Atlas of Living Australia`, url: lsid ? `https://bie.ala.org.au/species/${encodeURIComponent(lsid)}` : `https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}` };
};
const ALA_SEQ = { title: 'Atlas of Living Australia records for SEQ since 2016', url: 'https://www.ala.org.au/' };
const NOTES = { title: 'BirdyDex field notes', url: '' };
const tOpt = (key, lab, sp = null) => ({ key: String(key), label: lab, sp: sp?.id ?? null });
// Months at 80% or more of the peak, as 'October to December' when they run on (wrapping past December), else a list.
function peakMonths(rel) {
  const on = rel.map(v => v >= 0.8);
  const n = on.filter(Boolean).length;
  if (!n) return '';
  if (n >= 9) return n === 12 ? 'every month' : 'most of the year';
  // Runs of busy months, longest first: 'October to March, and June'.
  const runs = [];
  for (let i = 0; i < 12; i++) {
    if (!on[i] || on[(i + 11) % 12]) continue;
    let len = 0;
    while (len < 12 && on[(i + len) % 12]) len++;
    runs.push([i, len]);
  }
  const fmtRun = ([s, len]) => (len === 1 ? MONTHS[s] : len === 2 ? `${MONTHS[s]} and ${MONTHS[(s + 1) % 12]}` : `${MONTHS[s]} to ${MONTHS[(s + len - 1) % 12]}`);
  const top = runs.sort((a, b) => b[1] - a[1]).slice(0, 2).map(fmtRun);
  return top.length > 1 ? `${top[0]}, and ${top[1]}` : top[0];
}
export const peaksOf = id => { const m = monthRates(id); return m ? peakMonths(m.rel) : ''; };
const sizeWord = (measure, big) => ({ wingspan: big ? 'has the biggest wingspan' : 'has the smallest wingspan', height: big ? 'grows the tallest' : 'stays the smallest',
  shell: big ? 'has the biggest shell' : 'has the smallest shell' }[measure] || (big ? 'is the biggest' : 'is the smallest'));

export const makers = {
  peakMonth(sp, pool, rng) {
    const m = monthRates(sp.id);
    if (!m || recordCount(sp.id) < (sp.kind === 'bird' ? 2500 : 300)) return null;
    const rel = m.rel, peak = rel.indexOf(1);
    if (Math.min(...rel) > 0.45) return null; // not seasonal enough to be fair
    const low = shuffle(rel.map((v, i) => [v, i]).filter(([v, i]) => v < 0.55 && Math.abs(i - peak) > 1), rng).slice(0, 3);
    if (low.length < 3) return null;
    const lowest = rel.indexOf(Math.min(...rel));
    return { ttype: 'Seasons', img: sp.id, focus: sp.id, prompt: `In which month is the ${sp.name} reported most often in SEQ?`,
      options: shuffle([tOpt(peak, MONTHS[peak]), ...low.map(([, i]) => tOpt(i, MONTHS[i]))], rng), answer: String(peak),
      explain: `Reports peak in ${MONTHS[peak]} and are lowest in ${MONTHS[lowest]}.`, source: alaSource(sp) };
  },
  rarity(sp, pool, rng) {
    const cands = shuffle(pool.filter(s => recordCount(s.id) > 0), rng).slice(0, 12);
    for (let tries = 0; tries < 20; tries++) {
      const four = shuffle(cands.slice(), rng).slice(0, 4);
      if (four.length < 4) return null;
      const least = rng() < 0.5;
      const sorted = four.slice().sort((a, b) => recordCount(a.id) - recordCount(b.id));
      const [a, b] = least ? [sorted[0], sorted[1]] : [sorted[3], sorted[2]];
      if (least ? recordCount(b.id) < 2 * recordCount(a.id) : recordCount(a.id) < 2 * recordCount(b.id)) continue; // only clear gaps
      return { ttype: 'Rarity', img: null, focus: a.id, prompt: `Which of these ${label(a.kind)} is reported ${least ? 'least' : 'most'} often in SEQ?`,
        options: shuffle(four.map(s => tOpt(s.id, s.name, s)), rng), answer: String(a.id),
        explain: `${sorted.map(s => `${s.name}: ${fmt(recordCount(s.id))}`).join('; ')} records since 2016.`, source: ALA_SEQ };
    }
    return null;
  },
  bestSpot(sp, pool, rng) {
    if (sp.kind !== 'bird') return null; // hotspot records are birds only
    const top = spotsFor(sp.id, 1)[0];
    if (!top || top.c < 30) return null;
    const without = shuffle(hotspots().filter(h => h.rich > 60 && !h.sp.some(([id]) => id === sp.id)), rng).slice(0, 3);
    if (without.length < 3) return null;
    return { ttype: 'Places', img: sp.id, focus: sp.id, prompt: `Which of these birding spots has the most ${sp.name} records?`,
      options: shuffle([tOpt(top.h.name, top.h.name), ...without.map(h => tOpt(h.name, h.name))], rng), answer: top.h.name,
      explain: `${top.h.name} has ${fmt(top.c)} records of it. The other spots have none since 2016.`, source: alaSource(sp) };
  },
  habitat(sp, pool, rng) {
    const h = pick(['c', 'r', 'w', 'o'], rng);
    const yes = shuffle(pool.filter(s => s.habitats.includes(h) && s.habitats.length <= 2), rng);
    const no = shuffle(pool.filter(s => !s.habitats.includes(h)), rng);
    if (!yes.length || no.length < 3) return null;
    const a = yes[0];
    return { ttype: 'Habitats', img: null, focus: a.id,
      prompt: a.kind === 'plant' ? `Which of these plants grows in ${lc(HABITATS[h])}?` : `Which of these ${label(a.kind)} would you look for in ${lc(HABITATS[h])}?`,
      options: shuffle([tOpt(a.id, a.name, a), ...no.slice(0, 3).map(s => tOpt(s.id, s.name, s))], rng), answer: String(a.id),
      explain: `The ${a.name} is found in ${a.habitats.map(x => lc(HABITATS[x])).join(' and ')}. ${fieldMark(a)}`, source: NOTES };
  },
  night(sp, pool, rng) {
    if (sp.kind === 'plant') return null;
    const yes = shuffle(pool.filter(s => s.nocturnal), rng), no = shuffle(pool.filter(s => !s.nocturnal), rng);
    if (!yes.length || no.length < 3) return null;
    const a = yes[0];
    return { ttype: 'Behaviour', img: null, focus: a.id, prompt: `Which of these ${label(a.kind)} is active at night?`,
      options: shuffle([tOpt(a.id, a.name, a), ...no.slice(0, 3).map(s => tOpt(s.id, s.name, s))], rng), answer: String(a.id),
      explain: sentences(a.notes).slice(0, 2).join(' '), source: NOTES };
  },
  size(sp, pool, rng) {
    const measure = sizeOf(sp)?.measure;
    const same = pool.filter(s => sizeOf(s)?.measure === measure);
    for (let tries = 0; measure && tries < 20; tries++) {
      const four = shuffle(same.slice(), rng).slice(0, 4);
      if (four.length < 4) return null;
      const sorted = four.slice().sort((a, b) => sizeOf(a).cm - sizeOf(b).cm);
      const big = rng() < 0.5;
      const a = big ? sorted[3] : sorted[0], b = big ? sorted[2] : sorted[1];
      if (big ? sizeOf(a).cm < sizeOf(b).cm * 1.3 : sizeOf(b).cm < sizeOf(a).cm * 1.3) continue;
      return { ttype: 'Size', img: null, focus: a.id, prompt: `Which of these ${label(a.kind)} ${sizeWord(measure, big)}?`,
        options: shuffle(four.map(s => tOpt(s.id, s.name, s)), rng), answer: String(a.id),
        explain: `${sorted.map(s => `${s.name}: ${s.sizeText}`).join('; ')}.`, source: NOTES };
    }
    return null;
  },
  sciName(sp, pool, rng) {
    const kin = ofKind(sp.kind).filter(s => s.id !== sp.id);
    const opts = [...shuffle(kin.filter(s => s.group === sp.group), rng), ...shuffle(kin.filter(s => s.group !== sp.group), rng)].slice(0, 3);
    if (opts.length < 3) return null;
    return { ttype: 'Names', img: sp.id, focus: sp.id, prompt: `What is the scientific name of the ${sp.name}?`, italic: true,
      options: shuffle([tOpt(sp.id, sp.sci), ...opts.map(s => tOpt(s.id, s.sci))], rng), answer: String(sp.id),
      explain: `${sp.name}: ${sp.sci}.`, source: alaSource(sp) };
  },
  group(sp, pool, rng) {
    const groups = [...new Set(ofKind(sp.kind).map(s => s.group))].filter(g => g !== sp.group);
    if (groups.length < 3) return null;
    return { ttype: 'Families', img: sp.id, focus: sp.id, prompt: `Which group does the ${sp.name} belong to?`,
      options: shuffle([tOpt(sp.group, GROUPS[sp.group]), ...shuffle(groups, rng).slice(0, 3).map(g => tOpt(g, GROUPS[g]))], rng), answer: sp.group,
      explain: `It belongs with the ${lc(GROUPS[sp.group])}. ${fieldMark(sp)}`, source: NOTES };
  },
  visitor(sp, pool, rng) {
    if (sp.kind !== 'bird') return null; // only birds migrate in and out
    const yes = shuffle(pool.filter(s => s.season === 's' && monthRates(s.id)), rng), no = shuffle(pool.filter(s => !s.season), rng);
    if (!yes.length || no.length < 3) return null;
    const a = yes[0], peak = monthRates(a.id).rel.indexOf(1);
    return { ttype: 'Seasons', img: null, focus: a.id, prompt: 'Which of these birds mostly visits SEQ in spring and summer?',
      options: shuffle([tOpt(a.id, a.name, a), ...no.slice(0, 3).map(s => tOpt(s.id, s.name, s))], rng), answer: String(a.id),
      explain: `The ${a.name} arrives for the warmer months; its reports peak in ${MONTHS[peak]}. The others are here all year.`, source: alaSource(a) };
  },
  callWords(sp, pool, rng) {
    const cw = callWords(sp);
    if (!cw) return null;
    const wrong = pickDistractors(sp, { rng, pool: ofKind(sp.kind) });
    if (wrong.length < 3) return null;
    return { ttype: 'Calls', img: null, focus: sp.id, prompt: `Which ${one(sp)} calls "${cw.words}"?`,
      options: shuffle([sp, ...wrong], rng).map(optOf), answer: String(sp.id), explain: cw.sentence, source: NOTES };
  },
  notAround(sp, pool, rng, month = new Date().getMonth() + 1) {
    if (sp.kind === 'plant') return null; // plants don't come and go
    const kin = ofKind(sp.kind).filter(s => monthRates(s.id));
    const yes = shuffle(kin.filter(s => relRate(s.id, month) >= 0.8), rng);
    const no = shuffle(kin.filter(s => relRate(s.id, month) < 0.25 && recordCount(s.id) >= 200), rng);
    if (yes.length < 3 || !no.length) return null;
    const a = no[0];
    return { ttype: 'Seasons', img: null, focus: a.id, prompt: `Which of these ${label(a.kind)} is not usually around in ${MONTHS[month - 1]}?`,
      options: shuffle([tOpt(a.id, a.name, a), ...yes.slice(0, 3).map(s => tOpt(s.id, s.name, s))], rng), answer: String(a.id),
      explain: `The ${a.name} is reported most in ${peaksOf(a.id)}. The others are often reported in ${MONTHS[month - 1]}.`, source: alaSource(a) };
  },
};
export function factQ(sp, o = {}) {
  const rng = o.rng || Math.random;
  const pool = ofKind(sp.kind);
  const types = shuffle((o.types || ['peakMonth', 'rarity', 'bestSpot', 'habitat', 'night', 'size', 'sciName', 'group', 'visitor', 'callWords']).slice(), rng);
  for (const t of types) {
    const q = makers[t]?.(sp, pool, rng, o.month);
    if (q && q.options.length >= 3) {
      if (q.img) q.photos = photosFor(q.img, { rng: o.photoRng || rng, cached: o.cached?.get(q.img), prefer: 'wiki' });
      return { type: 'fact', ...q };
    }
  }
  return null;
}

// ---------- more ways to ask (quiz packs and the new quick-play modes) ----------
const prng = o => o.photoRng || o.rng || Math.random;
const leadPhotos = (id, o) => photosFor(id, { rng: prng(o), cached: o.cached?.get(id), prefer: 'wiki' });
const photoOk = (s, o) => (o.offline ? !!o.cached?.has(s.id) : hasPhoto(s));
export const isIntroduced = sp => /\b(introduced|feral)\b/i.test(sp?.notes || '');
// Only snakes whose notes say it plainly; 'mildly venomous, not considered dangerous' is left out on purpose.
export const SNAKE_RULE = "Keep away from any snake you can't identify.";
export function snakeSafety(sp) {
  if (sp?.group !== 'reptile:snakes') return null;
  const t = String(sp.notes || '');
  if (/mildly venomous|not considered dangerous/i.test(t)) return null;
  const safe = /\bnon-venomous\b|\bnot dangerous\b|\bharmless\b/i.test(t);
  const danger = /\bvenomous\b/i.test(t.replace(/non-venomous/gi, ''));
  return safe === danger ? null : safe ? 'safe' : 'danger';
}
// A fact question about one named species, with its photo when there is one. `miss` is what a wrong answer is told.
const named = (sp, q, o) => ({ type: 'fact', img: sp.id, focus: sp.id, source: NOTES, ...q, photos: leadPhotos(sp.id, o) });

// Silhouette: the photo drawn as a dark shape on a light ground, shown in colour once answered.
export function silhouetteQ(sp, o = {}) {
  const q = speciesQ('silhouette', sp, o);
  if (!q) return null;
  q.prompt = `Which ${one(sp)} has this shape?`;
  q.photos = leadPhotos(sp.id, o);
  return q.photos.length ? q : null;
}
// Zoom in: a tight crop near the middle of the photo (where the subject usually is) that pulls back on answer.
export function zoomQ(sp, o = {}) {
  const q = speciesQ('zoom', sp, o);
  if (!q) return null;
  const rng = prng(o);
  q.prompt = `Which ${one(sp)} is this, up close?`;
  q.photos = leadPhotos(sp.id, o);
  q.zoom = { x: Math.round(38 + rng() * 24), y: Math.round(34 + rng() * 26), scale: o.difficulty === 'hard' ? 3.4 : o.difficulty === 'easy' ? 2.2 : 2.8 };
  return q.photos.length ? q : null;
}
// Odd one out: three from this species' group and one from another group of the same kind, as alike as can be.
export function oddQ(sp, o = {}) {
  const rng = o.rng || Math.random;
  const kin = ofKind(sp.kind).filter(s => photoOk(s, o));
  const three = [sp, ...shuffle(kin.filter(s => s.group === sp.group && s.id !== sp.id), rng).slice(0, 2)];
  if (three.length < 3 || !photoOk(sp, o)) return null;
  const outs = kin.filter(s => s.group !== sp.group && sameClass(sp, s))
    .map(c => ({ c, s: Math.max(...three.map(t => distractorScore(t, c))) + rng() * 1.5 })).sort((a, b) => b.s - a.s);
  const odd = outs.length ? pick(outs.slice(0, 4), rng).c : null;
  if (!odd) return null;
  const opts = shuffle([...three, odd], rng).map(s => ({ ...optOf(s), photos: leadPhotos(s.id, o) }));
  if (opts.some(x => !x.photos.length)) return null;
  const grp = lc(GROUPS[sp.group]);
  return { type: 'odd', focus: odd.id, answer: String(odd.id), options: opts, prompt: `Three of these are ${grp}. Which one isn't?`, group: sp.group,
    explain: `The ${odd.name} belongs with the ${lc(GROUPS[odd.group])}. The other three are ${grp}.`, miss: `Not quite. The odd one out is the ${odd.name}.` };
}
// Sound-alikes: a call where every wrong answer is a look-alike or a close relative that also calls.
export function soundAlikeQ(sp, o = {}) {
  if (!CALL_KINDS.includes(sp.kind)) return null;
  const list = o.cachedCalls?.get(sp.id) ? [o.cachedCalls.get(sp.id)] : callsOf(sp.id);
  if (!list.length) return null;
  const rng = o.rng || Math.random;
  const ok = s => s && s.id !== sp.id && s.kind === sp.kind && hasCall(s.id);
  const mates = lookalikesOf(sp.id).map(id => byId.get(id)).filter(ok);
  const kin = ofKind(sp.kind).filter(s => ok(s) && !mates.includes(s))
    .map(c => ({ c, s: (c.group === sp.group ? 4 : 0) + distractorScore(sp, c) + rng() })).sort((a, b) => b.s - a.s).map(x => x.c);
  const wrong = [...shuffle(mates, rng), ...kin].slice(0, 3);
  if (wrong.length < 3) return null;
  return { type: 'call', soundalike: true, focus: sp.id, answer: String(sp.id), options: shuffle([sp, ...wrong], rng).map(optOf), wrong,
    prompt: `Which ${one(sp)} is calling?`, call: pick(list, prng(o)), photos: photosFor(sp.id, { rng: prng(o), cached: o.cached?.get(sp.id) }) };
}
export function nativeQ(sp, o = {}) {
  if (sp.kind === 'plant') return null;
  const intro = isIntroduced(sp);
  return named(sp, { ttype: 'Native or introduced', prompt: `Is the ${sp.name} native, or was it introduced?`,
    options: [tOpt('native', 'Native to Australia'), tOpt('introduced', 'Introduced by people')], answer: intro ? 'introduced' : 'native',
    miss: intro ? 'Not quite. It was introduced.' : `Not quite. It's a native ${one(sp)}.`,
    explain: intro ? `The ${sp.name} was brought to Australia by people and now lives wild here. ${fieldMark(sp)}` : `The ${sp.name} belongs here. ${fieldMark(sp)}` }, o);
}
// Day or night: left out where the notes make it a dawn-and-dusk animal but the flag says day.
export function dayNightQ(sp, o = {}) {
  if (sp.kind === 'plant' || (!sp.nocturnal && /\b(dawn|dusk|early and late)\b/i.test(sp.notes || ''))) return null;
  const se = sentences(sp.notes).find(s => /\b(night|nocturnal|dusk|dawn|by day|warm days|basks?|sun)\b/i.test(s));
  return named(sp, { ttype: 'Day or night', prompt: `When is the ${sp.name} most active?`,
    options: [tOpt('day', 'By day'), tOpt('night', 'At dusk and night')], answer: sp.nocturnal ? 'night' : 'day',
    miss: sp.nocturnal ? 'Not quite. It comes out at dusk and night.' : 'Not quite. It is active by day.',
    explain: `${sp.nocturnal ? `The ${sp.name} is out at dusk and through the night.` : `The ${sp.name} is active by day.`}${se ? ` ${se}` : ''}` }, o);
}
export function whereQ(sp, o = {}) {
  const no = Object.keys(HABITATS).filter(h => !sp.habitats.includes(h));
  if (!sp.habitats.length || no.length < 3) return null;
  const rng = o.rng || Math.random, h = pick(sp.habitats, rng);
  const where = sp.habitats.map(x => lc(HABITATS[x])).join(' and ');
  return named(sp, { ttype: 'Habitats', prompt: sp.kind === 'plant' ? `Where does the ${sp.name} grow?` : `Where would you look for the ${sp.name}?`,
    options: shuffle([tOpt(h, HABITATS[h]), ...shuffle(no, rng).slice(0, 3).map(x => tOpt(x, HABITATS[x]))], rng), answer: h,
    miss: `Not quite. Try ${lc(HABITATS[h])}.`, explain: `${sp.kind === 'plant' ? 'It grows in' : 'Look in'} ${where}. ${fieldMark(sp)}` }, o);
}
const SEASON_TXT = { s: 'Spring and summer', w: 'Autumn and winter', all: 'All year' };
export function whenQ(sp, o = {}) {
  let ans = sp.season;
  if (!ans) {
    const m = monthRates(sp.id);
    if (sp.kind === 'plant' || !m || Math.min(...m.rel) < 0.45) return null; // only call it all-year when the records say so
    ans = 'all';
  }
  const plant = sp.kind === 'plant', peaks = peaksOf(sp.id);
  const se = sentences(sp.notes).find(s => /\b(spring|summer|autumn|winter|cooler|warm|months|migrat\w*|flowers?)\b/i.test(s));
  return named(sp, { ttype: 'Seasons', prompt: plant ? `When does the ${sp.name} flower?` : `When are you most likely to find the ${sp.name} in SEQ?`,
    options: ['s', 'w', 'all'].map(k => tOpt(k, SEASON_TXT[k])), answer: ans, miss: `Not quite. ${SEASON_TXT[ans]}.`,
    explain: `${plant ? `It flowers mainly in ${lc(SEASON_TXT[ans])}.` : ans === 'all' ? `The ${sp.name} is reported all year.` : `The ${sp.name} is mostly about in ${lc(SEASON_TXT[ans])}${peaks && !plant ? `, with reports peaking in ${peaks}` : ''}.`}${se ? ` ${se}` : ''}`,
    source: plant ? NOTES : alaSource(sp) }, o);
}
// Which is bigger: two photos with names, sizes far enough apart (1.4 times) to be a fair question.
const BIGGER = { wingspan: 'Which has the bigger wingspan?', height: 'Which grows taller?', shell: 'Which has the bigger shell?' };
export function biggerQ(sp, o = {}) {
  const a = sizeOf(sp), rng = o.rng || Math.random;
  if (!a || !photoOk(sp, o)) return null;
  const cands = shuffle((o.pool || ofKind(sp.kind)).filter(s => s.id !== sp.id && s.kind === sp.kind && sizeOf(s)?.measure === a.measure && photoOk(s, o)
    && Math.max(sizeOf(s).cm, a.cm) / Math.max(0.1, Math.min(sizeOf(s).cm, a.cm)) >= 1.4), rng);
  const b = cands.find(s => s.group === sp.group) || cands[0];
  if (!b) return null;
  const big = sizeOf(b).cm > a.cm ? b : sp;
  const opts = shuffle([sp, b], rng).map(s => ({ ...optOf(s), photos: leadPhotos(s.id, o) }));
  if (opts.some(x => !x.photos.length)) return null;
  return { type: 'fact', ttype: 'Size', named: true, img: null, focus: sp.id, also: [b.id], answer: String(big.id), options: opts,
    prompt: BIGGER[a.measure] || 'Which is bigger?', sub: "The photos aren't to scale.", miss: `Not quite. The ${big.name} is bigger.`,
    explain: `${sp.name}: ${sp.sizeText}. ${b.name}: ${b.sizeText}.`, source: NOTES };
}
export function snakeQ(sp, o = {}) {
  const s = snakeSafety(sp);
  if (!s) return null;
  return named(sp, { ttype: 'Snake safety', prompt: `Is the ${sp.name} dangerous to people?`, safety: SNAKE_RULE,
    options: [tOpt('danger', 'Yes: venomous, keep away'), tOpt('safe', 'No: not dangerous to people')], answer: s,
    miss: s === 'danger' ? "Not quite. It's venomous: keep well away." : "Not quite. It's not dangerous to people.",
    explain: sentences(sp.notes).filter(x => /venomous|dangerous|harmless/i.test(x)).join(' ') || fieldMark(sp) }, o);
}

// ---------- quiz packs: built from rules over the species data, not hand-typed lists ----------
const inGroups = (...gs) => s => gs.includes(s.group);
const birdIn = h => s => s.kind === 'bird' && s.habitats.includes(h);
export const PACKS = [
  { key: 'backyard', name: 'Backyard birds', kind: 'bird', blurb: 'Garden and park regulars', test: s => birdIn('g')(s) && s.rarity <= 2, types: ['photo', 'call', 'silhouette', 'native', 'zoom', 'whoami'] },
  { key: 'mammals', name: 'Mammals of SEQ', kind: 'mammal', blurb: 'Marsupials, bats and the ones at sea', test: s => s.kind === 'mammal', types: ['photo', 'silhouette', 'daynight', 'where', 'bigger', 'whoami'] },
  { key: 'snakes', name: 'Snakes: dangerous or harmless?', kind: 'reptile', blurb: 'Know which to give a wide berth', test: s => !!snakeSafety(s), types: ['snake', 'photo', 'snake'], safety: true },
  { key: 'frogcalls', name: 'Frogs by call', kind: 'frog', blurb: 'Croaks, bonks and beeps', test: s => s.kind === 'frog' && hasCall(s.id), types: ['call', 'soundalike', 'photo', 'when'] },
  { key: 'butterflies', name: 'Butterflies', kind: 'butterfly', blurb: 'Swallowtails to skippers', test: s => s.kind === 'butterfly', types: ['photo', 'zoom', 'when', 'odd', 'whoami'] },
  { key: 'lookalikes', name: 'Look-alike legends', kind: null, blurb: 'The pairs everyone mixes up', test: s => lookalikesOf(s.id).length > 0, types: ['duel', 'photo', 'duel', 'soundalike'] },
  { key: 'wetland', name: 'Wetland birds', kind: 'bird', blurb: 'Lakes, swamps and creeks', test: birdIn('w'), types: ['photo', 'zoom', 'odd', 'call', 'bigger', 'whoami'] },
  { key: 'raptors', name: 'Birds of prey', kind: 'bird', blurb: 'Eagles, kites, hawks and falcons', test: inGroups('raptors'), types: ['photo', 'silhouette', 'zoom', 'bigger', 'whoami'] },
  { key: 'parrots', name: 'Parrots & cockatoos', kind: 'bird', blurb: 'Loud, bright and everywhere', test: inGroups('parrots'), types: ['photo', 'call', 'zoom', 'odd', 'whoami'] },
  { key: 'honeyeaters', name: 'Honeyeaters', kind: 'bird', blurb: 'Miners, friarbirds and the rest', test: inGroups('honeyeaters'), types: ['photo', 'odd', 'call', 'zoom', 'soundalike'] },
  { key: 'shore', name: 'Shorebirds & seabirds', kind: 'bird', blurb: 'Waders, gulls and terns', test: inGroups('shorebirds', 'seabirds'), types: ['photo', 'silhouette', 'bigger', 'when', 'whoami'] },
  { key: 'rainforest', name: 'Rainforest birds', kind: 'bird', blurb: 'Heard more than seen', test: birdIn('r'), types: ['photo', 'call', 'soundalike', 'zoom', 'whoami'] },
  { key: 'nightbirds', name: 'Night birds', kind: 'bird', blurb: 'Owls, frogmouths and nightjars', test: s => s.kind === 'bird' && s.nocturnal, types: ['photo', 'call', 'silhouette', 'whoami'] },
  { key: 'lizards', name: 'Lizards, skinks & turtles', kind: 'reptile', blurb: 'Dragons, geckos and shells', test: s => s.kind === 'reptile' && s.group !== 'reptile:snakes', types: ['photo', 'zoom', 'where', 'daynight', 'bigger', 'whoami'] },
  { key: 'trees', name: 'Gums, wattles & trees', kind: 'plant', blurb: 'Bark, leaves and blossom', test: inGroups('plant:gums', 'plant:wattles', 'plant:paperbarks', 'plant:rainforest-trees'), types: ['photo', 'zoom', 'when', 'where', 'odd', 'whoami'] },
  { key: 'flowers', name: 'Flowers & orchids', kind: 'plant', blurb: 'Wildflowers, grasses and orchids', test: inGroups('plant:wildflowers', 'plant:ferns-orchids'), types: ['photo', 'zoom', 'when', 'whoami'] },
  { key: 'nightshift', name: 'Night shift', kind: null, blurb: 'Everything that comes out after dark', test: s => s.nocturnal, types: ['photo', 'silhouette', 'call', 'where', 'whoami'] },
  { key: 'seasonal', name: 'Seasonal visitors', kind: null, blurb: 'Here for part of the year', test: s => s.kind !== 'plant' && !!s.season, types: ['photo', 'when', 'call', 'whoami'] },
  { key: 'rare', name: 'Rare finds', kind: null, blurb: 'Scarce and rare across every kind', test: s => s.rarity >= 4, types: ['photo', 'zoom', 'silhouette', 'whoami'] },
];
export const PACK_BY = Object.fromEntries(PACKS.map(p => [p.key, p]));
export const packSpecies = key => (PACK_BY[key] ? SPECIES.filter(PACK_BY[key].test) : []);

// ---------- rounds ----------
export const MODES = ['quick', 'photo', 'call', 'whoami', 'duel', 'rapid', 'silhouette', 'zoom', 'facts'];
const QUICK_PLAN = ['photo', 'photo', 'photo', 'call', 'call', 'whoami', 'whoami', 'duel', 'fact', 'fact'];

const MAKERS = {
  photo: photoQ, whoami: whoQ, fact: factQ, silhouette: silhouetteQ, zoom: zoomQ, odd: oddQ, native: nativeQ, daynight: dayNightQ,
  where: whereQ, when: whenQ, bigger: biggerQ, snake: snakeQ, soundalike: soundAlikeQ,
  call: (sp, o) => callQ(sp, { ...o, cachedCall: o.cachedCalls?.get(sp.id) }),
};
const makeOne = (type, sp, o) => MAKERS[type]?.(sp, o) || null;
const PHOTO_TYPES = ['photo', 'silhouette', 'zoom', 'odd'];
const canAsk = (type, sp, o) => PHOTO_TYPES.includes(type) ? photoOk(sp, o)
  : type === 'call' || type === 'soundalike' ? CALL_KINDS.includes(sp.kind) && (o.offline ? o.cachedCalls?.has(sp.id) : hasCall(sp.id))
  : true;
// Every species a question shows (duels, odd one out, which is bigger), so a round doesn't show one twice.
const shows = q => [q.focus, ...(q.also || []), ...(q.options || []).filter(x => x.photos).map(x => x.sp)];

function pairQ(subj, used, o) {
  const p = shuffle(lookalikePairs().filter(x => (subj.has(x.a) || subj.has(x.b)) && !used.has(x.a) && !used.has(x.b)), o.rng)
    .find(x => !o.offline || (o.cached?.has(x.a) && o.cached?.has(x.b)));
  return p ? duelQ(p, o) : null;
}
// A pack round: its species, its own mix of question types, falling back through the pack's other types.
export function buildPackRound(key, { n = 10, rng = Math.random, offline = null, month = new Date().getMonth() + 1, ids = null } = {}) {
  const pack = PACK_BY[key];
  if (!pack) return [];
  const list = ids ? ids.map(id => byId.get(id)).filter(Boolean) : packSpecies(key);
  const o = { difficulty: 'normal', rng, month, offline: !!offline, cached: offline?.photos || null, cachedCalls: offline?.calls || null };
  const want = Math.min(n, list.length);
  const plan = shuffle(Array.from({ length: want }, (_, i) => pack.types[i % pack.types.length]), rng);
  const order = shuffle(list.slice(), rng);
  const subj = new Set(list.map(s => s.id)), used = new Set(), qs = [];
  for (const t of plan) {
    let q = t === 'duel' ? pairQ(subj, used, o) : null;
    for (const type of q ? [] : [...new Set([t, ...pack.types, 'photo', 'whoami'])]) {
      if (type === 'duel') continue;
      for (const sp of order) {
        if (used.has(sp.id) || !canAsk(type, sp, o)) continue;
        q = makeOne(type, sp, o);
        if (q && !shows(q).some(id => used.has(id))) break;
        q = null;
      }
      if (q) break;
    }
    if (!q) continue;
    shows(q).forEach(id => used.add(id));
    q.pack = key;
    qs.push(q);
  }
  return qs;
}

// Build a practice round. `offline` carries the photos and calls saved on this phone (Maps from cachedPhotos/cachedCalls).
export function buildRound({ mode = 'quick', kind = 'animals', scope = 'all', difficulty = 'normal', seen = new Set(), month = new Date().getMonth() + 1,
  n = 10, ids = null, rng = Math.random, offline = null } = {}) {
  const o = { difficulty, rng, month, offline: !!offline, cached: offline?.photos || null, cachedCalls: offline?.calls || null };
  let subjects = ids ? ids.map(id => byId.get(id)).filter(Boolean) : byDifficulty(poolFor({ kind, scope, seen, month }), difficulty);
  if (mode === 'call') subjects = subjects.filter(s => CALL_KINDS.includes(s.kind));
  const qs = [];
  if (mode === 'duel') {
    const inKind = sp => ids || kind === 'all' || (kind === 'animals' ? sp.kind !== 'plant' : sp.kind === kind);
    const subj = new Set(subjects.map(s => s.id));
    let list = shuffle(lookalikePairs().filter(p => inKind(byId.get(p.a)) && (subj.has(p.a) || subj.has(p.b))), rng);
    if (offline) list = list.filter(p => o.cached?.has(p.a) && o.cached?.has(p.b));
    const used = new Set();
    for (const p of list) {
      if (qs.length >= n) break;
      if (used.has(p.a) || used.has(p.b)) continue;
      const q = duelQ(p, o);
      if (q) { qs.push(q); used.add(p.a); used.add(p.b); }
    }
    return qs;
  }
  const plan = mode === 'quick' ? shuffle(QUICK_PLAN.slice(0, n), rng)
    : Array.from({ length: n }, () => (mode === 'facts' ? 'fact' : mode === 'rapid' ? 'photo' : mode));
  const order = shuffle(subjects.slice(), rng);
  const subj = new Set(subjects.map(s => s.id));
  const used = new Set();
  for (const want of plan) {
    let q = want === 'duel' ? pairQ(subj, used, o) : null;
    // Quick mixes types; if a type can't be asked here (no calls for plants, photos not saved offline) fall back.
    const chain = mode === 'quick' || ids ? [want, 'photo', 'whoami', 'fact'] : [want];
    for (const type of q ? [] : [...new Set(chain)]) {
      if (type === 'duel') continue;
      for (const sp of order) {
        if (used.has(sp.id) || !canAsk(type, sp, o)) continue;
        q = makeOne(type, sp, o);
        if (q && !used.has(q.focus)) break;
        q = null;
      }
      if (q) break;
    }
    if (!q) continue;
    used.add(q.focus);
    if (q.type === 'duel') q.options.forEach(x => used.add(x.sp));
    qs.push(q);
  }
  return qs;
}

// Today's challenge: five questions about species around this month, the same for everyone on the day.
// Only static data picks the species and answers; the photo shown can differ by phone, so it draws on its own stream.
export function buildDaily(dateStr, month) {
  const seed = hashStr(`birdydex-${dateStr}`);
  const rng = seeded(seed), photoRng = seeded(seed ^ 0x9E3779B9);
  const o = { difficulty: 'normal', rng, photoRng, month };
  const around = SPECIES.filter(s => (relRate(s.id, month) ?? 0) >= 0.8);
  const gallery = s => galleryFor(s.id).length > 0;
  const used = new Set();
  const take = (list, fn) => {
    for (const sp of shuffle(list.filter(s => !used.has(s.id)), rng)) {
      const q = fn(sp);
      if (q && !used.has(q.focus)) { used.add(q.focus); if (q.type === 'duel') q.options.forEach(x => used.add(x.sp)); return q; }
    }
    return null;
  };
  const plan = shuffle(['photo', 'call', 'whoami', 'duel', 'fact'], rng);
  const qs = [];
  for (const t of plan) {
    let q = null;
    if (t === 'photo') q = take(around.filter(gallery), sp => photoQ(sp, o));
    if (t === 'call') q = take(around.filter(s => CALL_KINDS.includes(s.kind) && hasCall(s.id)), sp => callQ(sp, o));
    if (t === 'whoami') q = take(around, sp => whoQ(sp, o));
    if (t === 'duel') {
      const ids = new Set(around.map(s => s.id));
      // find, not [0]: same draw as before, but skip a pair whose species another question already asks about
      const p = shuffle(lookalikePairs().filter(x => (ids.has(x.a) || ids.has(x.b)) && gallery(byId.get(x.a)) && gallery(byId.get(x.b))), rng)
        .find(x => !used.has(x.a) && !used.has(x.b));
      q = p ? duelQ(p, o) : null;
      if (q) { used.add(p.a); used.add(p.b); }
    }
    if (t === 'fact') q = take(around, sp => factQ(sp, { ...o, types: ['notAround', 'callWords', 'peakMonth'] }));
    if (!q) q = take(around, sp => whoQ(sp, o));
    if (q) qs.push(q);
  }
  return qs;
}
