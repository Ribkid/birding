// Bird trivia: questions built from the app's own data.
// - Seasons, rarity and best places come from Atlas of Living Australia records for SEQ (data/seq.json).
// - Habitats, size, night activity and groups come from the BirdyDex species notes (js/species.js).
// Each question carries its source so Sarah can see where the fact comes from.
import { SPECIES, GROUPS, HABITATS, byId } from './species.js';
import { seq, monthRates, recordCount, spotsFor, hotspots } from './seqdata.js';
import { MONTHS } from './stats.js';

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[(Math.random() * a.length) | 0];
const fmt = n => n.toLocaleString('en-AU');
const alaSource = sp => {
  const lsid = seq()?.species?.[sp.id]?.lsid;
  return {
    title: `${sp.name} records – Atlas of Living Australia`,
    url: lsid ? `https://bie.ala.org.au/species/${encodeURIComponent(lsid)}` : `https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}`,
  };
};
const ALA_SEQ = { title: 'Atlas of Living Australia records for SEQ since 2016', url: 'https://www.ala.org.au/' };
const NOTES = { title: 'BirdyDex field notes', url: null };
const opt = (key, label, sp = null) => ({ key: String(key), label, sp: sp?.id ?? null });

// ---------- question makers (each returns a question or null) ----------
const makers = {
  // When is it reported most? (ALA monthly records, adjusted for how much birding happens each month)
  peakMonth(sp) {
    const m = monthRates(sp.id);
    if (!m || recordCount(sp.id) < 2500) return null;
    const rel = m.rel;
    const peak = rel.indexOf(1);
    if (Math.min(...rel) > 0.45) return null; // not seasonal enough to make a fair question
    const low = shuffle(rel.map((v, i) => [v, i]).filter(([v, i]) => v < 0.55 && Math.abs(i - peak) > 1)).slice(0, 3);
    if (low.length < 3) return null;
    const options = shuffle([opt(peak, MONTHS[peak]), ...low.map(([, i]) => opt(i, MONTHS[i]))]);
    const lowest = rel.indexOf(Math.min(...rel));
    return {
      type: 'Seasons', img: sp.id, focus: sp.id,
      prompt: `In which month is the ${sp.name} reported most often in SEQ?`,
      options, answer: String(peak),
      explain: `Reports peak in ${MONTHS[peak]} and are lowest in ${MONTHS[lowest]}${sp.season === 's' ? ', as it mainly visits in spring and summer' : sp.season === 'w' ? ', as it is mainly here in autumn and winter' : ''}.`,
      source: alaSource(sp),
    };
  },
  // Which of these is reported least / most often?
  rarity(_, pool) {
    const cands = shuffle(pool.filter(s => recordCount(s.id) > 0)).slice(0, 12);
    for (let tries = 0; tries < 20; tries++) {
      const four = shuffle(cands.slice()).slice(0, 4);
      if (four.length < 4) return null;
      const least = Math.random() < 0.5;
      const sorted = four.slice().sort((a, b) => recordCount(a.id) - recordCount(b.id));
      const [a, b] = least ? [sorted[0], sorted[1]] : [sorted[3], sorted[2]];
      // only ask when the gap is clear (at least double)
      if (least ? recordCount(b.id) < 2 * recordCount(a.id) : recordCount(a.id) < 2 * recordCount(b.id)) continue;
      return {
        type: 'Rarity', img: null, focus: a.id,
        prompt: least ? 'Which of these is reported least often in SEQ?' : 'Which of these is reported most often in SEQ?',
        options: shuffle(four.map(s => opt(s.id, s.name, s))), answer: String(a.id),
        explain: sorted.map(s => `${s.name}: ${fmt(recordCount(s.id))}`).join(', ') + ' records since 2016.',
        source: ALA_SEQ,
      };
    }
    return null;
  },
  // Where in SEQ is it reported most?
  bestSpot(sp) {
    const top = spotsFor(sp.id, 1)[0];
    if (!top || top.c < 30) return null;
    const without = shuffle(hotspots().filter(h => h.rich > 60 && !h.sp.some(([id]) => id === sp.id))).slice(0, 3);
    if (without.length < 3) return null;
    return {
      type: 'Places', img: sp.id, focus: sp.id,
      prompt: `Which of these birding spots has the most ${sp.name} records?`,
      options: shuffle([opt(top.h.name, top.h.name), ...without.map(h => opt(h.name, h.name))]), answer: top.h.name,
      explain: `${top.h.name} has ${fmt(top.c)} records of it. The other spots have none in the records since 2016.`,
      source: alaSource(sp),
    };
  },
  // Which of these would you look for in <habitat>?
  habitat(_, pool) {
    const h = pick(['c', 'r', 'w', 'o']);
    const yes = shuffle(pool.filter(s => s.habitats.includes(h) && s.habitats.length <= 2));
    const no = shuffle(pool.filter(s => !s.habitats.includes(h)));
    if (!yes.length || no.length < 3) return null;
    const a = yes[0];
    return {
      type: 'Habitats', img: null, focus: a.id,
      prompt: `Which of these birds would you go looking for in ${HABITATS[h].toLowerCase()}?`,
      options: shuffle([opt(a.id, a.name, a), ...no.slice(0, 3).map(s => opt(s.id, s.name, s))]), answer: String(a.id),
      explain: `The ${a.name} is found in ${a.habitats.map(x => HABITATS[x].toLowerCase()).join(' and ')}. ${a.notes.split('.')[0]}.`,
      source: NOTES,
    };
  },
  // Which of these is active at night?
  night(_, pool) {
    const yes = shuffle(pool.filter(s => s.nocturnal));
    const no = shuffle(pool.filter(s => !s.nocturnal));
    if (!yes.length || no.length < 3) return null;
    const a = yes[0];
    return {
      type: 'Behaviour', img: null, focus: a.id,
      prompt: 'Which of these birds is active at night?',
      options: shuffle([opt(a.id, a.name, a), ...no.slice(0, 3).map(s => opt(s.id, s.name, s))]), answer: String(a.id),
      explain: `${a.notes.split('.').slice(0, 2).join('.').trim()}.`,
      source: NOTES,
    };
  },
  // Which of these is the biggest / smallest?
  size(_, pool) {
    for (let tries = 0; tries < 20; tries++) {
      const four = shuffle(pool.slice()).slice(0, 4);
      if (four.length < 4) return null;
      const sorted = four.slice().sort((a, b) => a.size - b.size);
      const big = Math.random() < 0.5;
      const a = big ? sorted[3] : sorted[0], b = big ? sorted[2] : sorted[1];
      if (big ? a.size < b.size * 1.3 : b.size < a.size * 1.3) continue;
      return {
        type: 'Size', img: null, focus: a.id,
        prompt: big ? 'Which of these birds is the biggest?' : 'Which of these birds is the smallest?',
        options: shuffle(four.map(s => opt(s.id, s.name, s))), answer: String(a.id),
        explain: sorted.map(s => `${s.name} about ${s.size} cm`).join(', ') + '.',
        source: NOTES,
      };
    }
    return null;
  },
  // What's its scientific name?
  sciName(sp) {
    const others = shuffle(SPECIES.filter(s => s.id !== sp.id && s.group === sp.group));
    const fill = shuffle(SPECIES.filter(s => s.id !== sp.id && s.group !== sp.group));
    const opts = [...others, ...fill].slice(0, 3);
    return {
      type: 'Names', img: sp.id, focus: sp.id,
      prompt: `What is the scientific name of the ${sp.name}?`,
      options: shuffle([opt(sp.id, sp.sci), ...opts.map(s => opt(s.id, s.sci))]), answer: String(sp.id), italic: true,
      explain: `${sp.name}: ${sp.sci}.`,
      source: alaSource(sp),
    };
  },
  // Which group does it belong to?
  group(sp) {
    const others = shuffle(Object.keys(GROUPS).filter(g => g !== sp.group)).slice(0, 3);
    return {
      type: 'Families', img: sp.id, focus: sp.id,
      prompt: `Which group does the ${sp.name} belong to?`,
      options: shuffle([opt(sp.group, GROUPS[sp.group]), ...others.map(g => opt(g, GROUPS[g]))]), answer: sp.group,
      explain: `It is one of the ${GROUPS[sp.group].toLowerCase()}. ${sp.notes.split('.')[0]}.`,
      source: NOTES,
    };
  },
  // Which of these mostly visits in spring and summer?
  visitor(_, pool) {
    const yes = shuffle(pool.filter(s => s.season === 's' && monthRates(s.id)));
    const no = shuffle(pool.filter(s => !s.season));
    if (!yes.length || no.length < 3) return null;
    const a = yes[0];
    const m = monthRates(a.id);
    const peak = m.rel.indexOf(1);
    return {
      type: 'Seasons', img: null, focus: a.id,
      prompt: 'Which of these birds mostly visits SEQ in spring and summer?',
      options: shuffle([opt(a.id, a.name, a), ...no.slice(0, 3).map(s => opt(s.id, s.name, s))]), answer: String(a.id),
      explain: `The ${a.name} arrives for the warmer months; its reports peak in ${MONTHS[peak]}. The others are here all year.`,
      source: alaSource(a),
    };
  },
};

// Build a round with a good mix of question types and no repeated birds.
export function buildTrivia(pool, n = 10) {
  const perBird = ['peakMonth', 'bestSpot', 'sciName', 'group'];
  const general = ['rarity', 'habitat', 'night', 'size', 'visitor'];
  const used = new Set();
  const qs = [];
  const order = shuffle([...perBird, ...perBird, ...general, ...general]);
  for (let attempt = 0; qs.length < n && attempt < 300; attempt++) {
    const type = order[attempt % order.length];
    const sp = pick(pool.filter(s => !used.has(s.id)));
    if (!sp) break;
    const q = makers[type](sp, pool.length >= 8 ? pool : SPECIES);
    if (!q || used.has(q.focus) || qs.some(x => x.prompt === q.prompt || (x.type === q.type && qs.filter(y => y.type === q.type).length >= 2))) continue;
    used.add(q.focus);
    qs.push({ ...q, picked: null });
  }
  return qs;
}

export const TRIVIA_TYPES = ['Seasons', 'Rarity', 'Places', 'Habitats', 'Behaviour', 'Size', 'Names', 'Families'];
export { byId };
