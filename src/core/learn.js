// Learn state and scoring, framework-free.
// Progress lives in the key-value store ('learn', 'dailyQuiz', 'quizStats'), never alongside the sightings.
// The React screens own the markup; everything about rounds, boxes and saved scores lives here.
import { byId, KINDS, SPECIES, kindsPresent, ofKind } from './species.js';
import { db } from './db.js';
import { MONTHS } from './stats.js';
import * as Q from './quiz.js';

export const ROUND = 10;
export const RAPID_MS = 60000;
const DAY = 864e5;
const INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 };
const pad = n => String(n).padStart(2, '0');

export const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayBefore = s => { const [y, m, d] = s.split('-').map(Number); return dayStr(new Date(y, m - 1, d - 1)); };
export const yesterdayStr = () => dayBefore(dayStr());
export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const monthName = (d = new Date()) => MONTHS[d.getMonth()];

// ---------- state (kv store) ----------
let L = null, D = null, ST = null, loading = null;
const freshLearn = () => ({ cards: {}, best: {}, duels: { n: 0, won: 0 }, rounds: 0, perfect: 0, prefs: {}, packs: {} });
const freshDaily = () => ({ streak: 0, best: 0, lastDate: '', done: 0, history: {}, today: null });

export function learnReady() {
  loading ||= Promise.all([
    db.kvGet('learn').catch(() => null), db.kvGet('dailyQuiz').catch(() => null), db.kvGet('quizStats').catch(() => null), Q.loadLookalikes(), Q.loadCallPack().catch(() => null),
  ]).then(([l, d, s]) => {
    L = { ...freshLearn(), ...(l && typeof l === 'object' ? l : {}) };
    L.prefs = { kind: 'animals', scope: 'all', difficulty: 'normal', ...(L.prefs || {}) };
    L.duels = { n: 0, won: 0, ...(L.duels || {}) };
    L.packs = L.packs && typeof L.packs === 'object' ? L.packs : {};
    D = { ...freshDaily(), ...(d && typeof d === 'object' ? d : {}) };
    ST = s && typeof s === 'object' ? s : {};
  });
  return loading;
}
if (typeof indexedDB !== 'undefined') learnReady();
let active = null;
export const getActive = () => active;
export const setActive = (game) => { active = game; };
const currentRoute = () => (typeof location !== 'undefined' ? location.hash : '');
// The round (or review deck) to go back to on this route, if any. Like v1 renderLearn, a round is kept while its
// route (window.location.hash when it started, e.g. '#/learn/play/whoami') is the one showing.
export const activeFor = (route = currentRoute(), { deck = false } = {}) => (active && !!active.deck === deck && active.route === route ? active : null);
export const getLearn = () => L;
export const getDaily = () => D;
export const getQuizStats = () => ST;
export const saveLearn = () => db.kvSet('learn', L).catch(() => {});
export const saveDaily = () => db.kvSet('dailyQuiz', D).catch(() => {});
export const saveQuizStats = () => db.kvSet('quizStats', ST).catch(() => {});
export function setPrefs(patch) {
  L.prefs = { ...L.prefs, ...patch };
  saveLearn();
  return L.prefs;
}

// ---------- review deck (Leitner boxes 1-5) ----------
const SKILLS = ['look', 'call'];
const dueAt = box => (box <= 1 ? Date.now() : startOfDay() + INTERVAL_DAYS[box] * DAY);
export function allCards() {
  const out = [];
  for (const [id, c] of Object.entries(L?.cards || {})) for (const k of SKILLS) if (c[k] && byId.has(Number(id))) out.push({ id: Number(id), skill: k, ...c[k] });
  return out;
}
export const dueCards = () => allCards().filter(c => c.due <= Date.now()).sort((a, b) => a.box - b.box || a.due - b.due);
export function setCard(id, skill, box) {
  const c = (L.cards[id] ||= {});
  c[skill] = { box, due: dueAt(box), at: Date.now() };
  return c[skill];
}
export function addCard(id, skill) {
  if (L.cards[id]?.[skill]) return false;
  setCard(id, skill, 1);
  return true;
}
// A miss in a quiz puts the species in the deck, or moves its card back a box, and makes it due now.
function slip(id, skill) {
  const c = L.cards[id]?.[skill];
  setCard(id, skill, c ? Math.max(1, c.box - 1) : 1);
}
export const isMastered = id => { const c = Object.values(L?.cards?.[id] || {}); return c.length > 0 && c.every(x => x.box >= 4); };
// 0..1 for species pages: each card counts from box 1 (0) to box 4 or 5 (1).
export function masteryOf(id) {
  const c = Object.values(L?.cards?.[id] || {});
  return c.length ? c.reduce((t, x) => t + Math.min(1, (x.box - 1) / 3), 0) / c.length : 0;
}
export const cardBoxes = () => allCards();
export const boxes = () => [1, 2, 3, 4, 5].map(b => allCards().filter(c => c.box === b).length);
export const nextDue = () => allCards().filter(c => c.due > Date.now()).sort((a, b) => a.due - b.due)[0] || null;

export function addCards(list, scope) {
  let n = 0;
  for (const s of list) {
    if (addCard(s.id, 'look')) n++;
    if (scope !== 'look' && Q.CALL_KINDS.includes(s.kind) && Q.hasCall(s.id) && addCard(s.id, 'call')) n++;
  }
  saveLearn();
  return n;
}
// Knew it moves a card along a box; missed sends it back to box 1.
export function gradeCard(id, skill, grade) {
  const cur = L.cards[id]?.[skill]?.box || 1;
  const box = grade === 'knew' ? Math.min(5, cur + 1) : grade === 'missed' ? 1 : cur;
  setCard(id, skill, box);
  saveLearn();
  const s = (ST[id] ||= { n: 0, right: 0, lastAt: 0 });
  s.n++; if (grade === 'knew') s.right++; s.lastAt = Date.now();
  saveQuizStats();
  return box;
}

// ---------- stats ----------
export const currentStreak = () => (D && (D.lastDate === dayStr() || D.lastDate === yesterdayStr()) ? D.streak : 0);
export function record(q, right) {
  const s = (ST[q.focus] ||= { n: 0, right: 0, lastAt: 0 });
  s.n++; if (right) s.right++; s.lastAt = Date.now();
  if (!right && q.type !== 'fact') slip(q.focus, q.type === 'call' ? 'call' : 'look');
  if (q.type === 'duel') { L.duels.n++; if (right) L.duels.won++; }
  saveQuizStats(); saveLearn();
}
export function accuracy(kind) {
  let n = 0, r = 0;
  for (const [id, s] of Object.entries(ST || {})) if (byId.get(Number(id))?.kind === kind) { n += s.n; r += s.right; }
  return n ? { n, pct: Math.round(r / n * 100) } : null;
}
// For the Learning badges (stats.js badges(..., learnStats())).
export function learnStats() {
  if (!L) return {};
  const cards = allCards(), packs = Object.values(L.packs);
  return {
    rounds: L.rounds, perfect: L.perfect, duelsWon: L.duels.won, bestStreak: D.best, dailyDone: D.done,
    mastered: Object.keys(L.cards).filter(id => isMastered(id)).length,
    callsMastered: cards.filter(c => c.skill === 'call' && c.box >= 4).length,
    packsDone: packs.filter(x => x.plays > 0).length, packPerfect: packs.filter(x => x.perfect > 0).length,
  };
}
// Per pack: best score (of how many), rounds finished, perfect rounds and the species she has got right in it.
export const packState = key => (L.packs[key] ||= { best: null, of: 0, plays: 0, perfect: 0, got: [] });
export const packProgress = () => Q.PACKS.map(p => {
  const list = Q.packSpecies(p.key), st = L?.packs?.[p.key] || {};
  const ids = new Set(list.map(s => s.id));
  return { ...p, total: list.length, got: (st.got || []).filter(id => ids.has(id)).length, best: st.best, of: st.of, plays: st.plays || 0, perfect: st.perfect || 0 };
});
export const accuracyForKinds = () => kindsPresent.map(k => ({ k, all: ofKind(k).length, mastered: ofKind(k).filter(s => isMastered(s.id)).length, acc: accuracy(k) }));

// ---------- rounds ----------
export const bestKey = (mode, p) => `${mode}|${p.kind}|${p.scope}|${p.difficulty}`;
export const roundModes = Q.MODES;
export const packs = Q.PACKS;
export const packBy = Q.PACK_BY;
export const testSet = id => {
  const sp = byId.get(id);
  if (!sp) return [];
  const near = Q.pickDistractors(sp, { difficulty: 'hard', n: 4, rng: () => 0.5, pool: ofKind(sp.kind) }).map(s => s.id);
  return [...new Set([id, ...Q.lookalikesOf(id), ...near])].slice(0, 5);
};

export const emptyMessage = (mode, p, offline) => {
  if (mode === 'duel' && offline) return 'Duels need photos saved on this phone, and none match yet. Try Who am I? for now.';
  if (p.scope === 'seen') return "Not enough of the ones you've seen for this. Log a few more, or choose Everything.";
  if (mode === 'duel') return 'No look-alike pairs match that choice. Try Everything or another kind.';
  if (mode === 'call') return 'No calls for these. Calls are for birds and frogs.';
  return 'Not enough species match that choice. Try a wider one.';
};

// Build a practice round. Offline: use only photos and calls saved on this phone.
// Returns { game, error, notice }: the screen toasts the error and goes back to the hub when no round can be made, and
// toasts the notice when the round had to change.
export async function newPracticeRound(mode, { ids = null, testId = null, seen = new Set() } = {}) {
  const p = L.prefs, month = new Date().getMonth() + 1;
  const pack = Q.PACK_BY[mode] || null;
  let offline = null, playMode = mode;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const pool = Q.speciesFor(ids || pack ? 'all' : p.kind === 'animals' ? 'all' : p.kind);
    const [photos, calls] = await Promise.all([Q.cachedPhotos(pool), Q.cachedCalls(pool)]);
    offline = { photos, calls };
    if (!pack && ['photo', 'rapid', 'silhouette', 'zoom'].includes(mode) && photos.size < 4) playMode = 'whoami';
    if (mode === 'call' && calls.size < 4) return { game: null, error: 'Calls need a connection, and none are saved on this phone yet.' };
  }
  const qs = pack ? Q.buildPackRound(mode, { n: ROUND, month, ids, offline })
    : Q.buildRound({ mode: playMode, kind: p.kind, scope: ids ? 'all' : p.scope, difficulty: testId ? 'hard' : mode === 'rapid' ? 'normal' : p.difficulty,
      seen, month, n: mode === 'rapid' ? 60 : ids ? Math.min(ROUND, ids.length) : ROUND, ids, offline });
  if (qs.length < (ids ? 1 : pack ? 4 : 3)) {
    return { game: null, error: !pack ? emptyMessage(mode, p, !!offline) : offline ? 'This pack needs more photos or calls saved on this phone. Try it again with a signal.' : 'This pack is still loading. Try again in a moment.' };
  }
  const game = { mode, pack: pack?.key || null, kind: pack ? pack.kind : p.kind, qs, i: 0, score: 0, prefs: pack ? { ...p, difficulty: 'normal' } : { ...p }, practice: !!ids, testId, route: currentRoute() };
  if (mode === 'rapid') Object.assign(game, { endsAt: Date.now() + RAPID_MS, streak: 0, top: 0 });
  // v1 startRound told her (a toast) when no saved photos turned a photo round into field notes.
  return { game, error: '', notice: playMode !== mode ? 'No photos saved on this phone yet, so this round uses field notes.' : '' };
}

export function newDailyRound() {
  const today = dayStr();
  const qs = Q.buildDaily(today, new Date().getMonth() + 1);
  if (!qs.length) return { game: null, error: "Today's challenge needs the species data. Try again in a moment." };
  if (D.today?.date !== today) { D.today = { date: today, picks: [] }; saveDaily(); }
  const picks = D.today.picks;
  picks.forEach((p, i) => { if (qs[i]) qs[i].picked = p.key; });
  const game = { daily: true, date: today, mode: 'daily', qs, i: Math.min(picks.length, qs.length), score: picks.filter(p => p.right).length, route: currentRoute() };
  if (D.history[today] != null) game.done = true;
  return { game, error: '' };
}

export function newDeckRound(cards) {
  return {
    deck: true,
    queue: cards.map(c => ({ id: c.id, skill: c.skill, reps: 0 })),
    total: cards.length, n: 0, tally: { knew: 0, unsure: 0, missed: 0 }, shown: false,
  };
}

// Record one answer. Returns whether it was right; the screen reacts to the returned state.
export function answer(game, q, key) {
  q.picked = key;
  const right = key === q.answer;
  if (right) game.score++;
  if (right && game.pack) {
    const got = packState(game.pack).got;
    for (const id of new Set([q.focus, ...(q.also || []), ...q.options.filter(o => o.photos).map(o => o.sp)])) if (id != null && !got.includes(id)) got.push(id);
  }
  record(q, right);
  if (game.daily) {
    D.today.picks.push({ key, right });
    saveDaily();
  }
  if (game.mode === 'rapid') {
    game.streak = right ? game.streak + 1 : 0;
    game.top = Math.max(game.top, game.streak);
  }
  return right;
}

// Save what a finished round means for streaks, bests and pack records. Safe to call twice.
export function finishRound(game, total) {
  if (game.done) return;
  game.done = true;
  if (game.daily) {
    const today = game.date;
    if (D.history[today] == null) {
      D.history[today] = game.score;
      D.streak = D.lastDate === dayBefore(today) ? D.streak + 1 : D.lastDate === today ? D.streak : 1;
      D.best = Math.max(D.best, D.streak);
      D.lastDate = today; D.done++;
      const keep = Object.keys(D.history).sort().slice(-90);
      D.history = Object.fromEntries(keep.map(k => [k, D.history[k]]));
      saveDaily();
    }
  } else if (game.pack && !game.practice) {
    const P = packState(game.pack);
    P.plays++;
    if (P.best == null || game.score > P.best || (game.score === P.best && total < P.of)) { if (P.best != null && game.score > P.best) game.newBest = true; P.best = game.score; P.of = total; }
    if (game.score === total) P.perfect++;
    L.rounds++;
    if (game.score === total && total >= ROUND) L.perfect++;
    saveLearn();
  } else if (!game.practice) {
    const key = bestKey(game.mode, game.prefs);
    const score = game.mode === 'rapid' ? game.top : game.score;
    if (L.best[key] == null || score > L.best[key]) { if (L.best[key] != null && score > 0) game.newBest = true; L.best[key] = score; }
    L.rounds++;
    if (game.score === total && total >= ROUND && game.prefs.difficulty !== 'easy' && game.mode !== 'rapid') L.perfect++;
    saveLearn();
  }
}

export function roundNote(game, total) {
  if (game.daily) {
    const s = currentStreak();
    return `${s ? `${s} ${s === 1 ? 'day' : 'days'} in a row.` : ''} A new set comes tomorrow.`;
  }
  if (game.mode === 'rapid') return `${game.score} right out of ${total} in 60 seconds.${game.newBest ? ' A new best streak.' : ''}`;
  const missedSome = game.qs.some(q => q.picked != null && q.picked !== q.answer && q.type !== 'fact');
  return `${game.score === total ? (game.pack && !game.practice ? 'A clean sweep: every one right.' : 'A perfect round.') : game.score >= total * 0.7 ? 'Sharp eyes and ears.' : missedSome ? 'Keep at it. The misses are in your review deck now.' : 'Keep at it.'}${game.newBest ? ' A new personal best.' : ''}`;
}

export const resultMode = mode => (mode === 'rapid' ? 'photo' : mode);
export const kindLabel = k => (k === 'animals' ? 'All animals' : KINDS[k]?.label || k);
export const speciesCounts = () => ({ total: SPECIES.length, kinds: kindsPresent.length, plants: ofKind('plant').length });
