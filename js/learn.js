// Learn: today's challenge, practice rounds, look-alike duels, rapid fire and a spaced-repetition review deck.
// Progress lives in the key-value store ('learn', 'dailyQuiz', 'quizStats'), never alongside the sightings.
import { KINDS, HABITATS, SPECIES, byId, kindsPresent, ofKind } from './species.js';
import { db } from './db.js';
import { MONTHS } from './stats.js';
import { lookAfterDraw } from './look.js';
import * as Q from './quiz.js';

const ROUND = 10, RAPID_MS = 60000, DAY = 864e5;
const INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 };
const pad = n => String(n).padStart(2, '0');
const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayBefore = s => { const [y, m, d] = s.split('-').map(Number); return dayStr(new Date(y, m - 1, d - 1)); };
const yesterdayStr = () => dayBefore(dayStr());
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = () => MONTHS[new Date().getMonth()];

const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  close: svg('M6 6l12 12M18 6L6 18', 2.2),
  tick: svg('M5 12.5l4.5 4.5L19 7.5', 2.6),
  cross: svg('M7 7l10 10M17 7L7 17', 2.6),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  quick: svg('M13 3L5 13.5h6L10 21l8-10.5h-6z'),
  photo: svg('M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5M15.5 9.5h.01'),
  call: svg('M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2'),
  whoami: svg('M6 4h9l3 3v13H6zM9 10h6M9 13.5h6M9 17h3'),
  duel: svg('M3.5 6.5h7v11h-7zM13.5 6.5h7v11h-7z'),
  rapid: svg('M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9.5v4l2.5 1.5M10 3h4'),
  facts: svg('M5 6h14v14H5zM5 10h14M9 3.5V7M15 3.5V7'),
  deck: svg('M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10'),
  back: svg('M15 5l-7 7 7 7', 2.2),
  compare: svg('M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4'),
};

// ---------- state (kv store) ----------
let L = null, D = null, ST = null, loading = null;
const freshLearn = () => ({ cards: {}, best: {}, duels: { n: 0, won: 0 }, rounds: 0, perfect: 0, prefs: {} });
const freshDaily = () => ({ streak: 0, best: 0, lastDate: '', done: 0, history: {}, today: null });
export function learnReady() {
  loading ||= Promise.all([
    db.kvGet('learn').catch(() => null), db.kvGet('dailyQuiz').catch(() => null), db.kvGet('quizStats').catch(() => null), Q.loadLookalikes(), Q.loadCallPack().catch(() => null),
  ]).then(([l, d, s]) => {
    L = { ...freshLearn(), ...(l && typeof l === 'object' ? l : {}) };
    L.prefs = { kind: 'animals', scope: 'all', difficulty: 'normal', ...(L.prefs || {}) };
    L.duels = { n: 0, won: 0, ...(L.duels || {}) };
    D = { ...freshDaily(), ...(d && typeof d === 'object' ? d : {}) };
    ST = s && typeof s === 'object' ? s : {};
  });
  return loading;
}
if (typeof indexedDB !== 'undefined') learnReady();
const saveL = () => db.kvSet('learn', L).catch(() => {});
const saveD = () => db.kvSet('dailyQuiz', D).catch(() => {});
const saveST = () => db.kvSet('quizStats', ST).catch(() => {});

// ---------- review deck (Leitner boxes 1-5) ----------
const SKILLS = ['look', 'call'];
const dueAt = box => (box <= 1 ? Date.now() : startOfDay() + INTERVAL_DAYS[box] * DAY);
function allCards() {
  const out = [];
  for (const [id, c] of Object.entries(L?.cards || {})) for (const k of SKILLS) if (c[k] && byId.has(Number(id))) out.push({ id: Number(id), skill: k, ...c[k] });
  return out;
}
const dueCards = () => allCards().filter(c => c.due <= Date.now()).sort((a, b) => a.box - b.box || a.due - b.due);
function setCard(id, skill, box) {
  const c = (L.cards[id] ||= {});
  c[skill] = { box, due: dueAt(box), at: Date.now() };
}
function addCard(id, skill) {
  if (L.cards[id]?.[skill]) return false;
  setCard(id, skill, 1);
  return true;
}
// A miss in a quiz puts the species in the deck, or moves its card back a box, and makes it due now.
function slip(id, skill) {
  const c = L.cards[id]?.[skill];
  setCard(id, skill, c ? Math.max(1, c.box - 1) : 1);
}
const isMastered = id => { const c = Object.values(L?.cards?.[id] || {}); return c.length > 0 && c.every(x => x.box >= 4); };
// 0..1 for species pages: each card counts from box 1 (0) to box 4 or 5 (1).
export function masteryOf(id) {
  const c = Object.values(L?.cards?.[id] || {});
  return c.length ? c.reduce((t, x) => t + Math.min(1, (x.box - 1) / 3), 0) / c.length : 0;
}

// ---------- stats ----------
const currentStreak = () => (D && (D.lastDate === dayStr() || D.lastDate === yesterdayStr()) ? D.streak : 0);
function record(q, right) {
  const s = (ST[q.focus] ||= { n: 0, right: 0, lastAt: 0 });
  s.n++; if (right) s.right++; s.lastAt = Date.now();
  if (!right && q.type !== 'fact') slip(q.focus, q.type === 'call' ? 'call' : 'look');
  if (q.type === 'duel') { L.duels.n++; if (right) L.duels.won++; }
  saveST(); saveL();
}
function accuracy(kind) {
  let n = 0, r = 0;
  for (const [id, s] of Object.entries(ST || {})) if (byId.get(Number(id))?.kind === kind) { n += s.n; r += s.right; }
  return n ? { n, pct: Math.round(r / n * 100) } : null;
}
// For the Learning badges (stats.js badges(..., learnStats())).
export function learnStats() {
  if (!L) return {};
  const cards = allCards();
  return {
    rounds: L.rounds, perfect: L.perfect, duelsWon: L.duels.won, bestStreak: D.best, dailyDone: D.done,
    mastered: Object.keys(L.cards).filter(id => isMastered(id)).length,
    callsMastered: cards.filter(c => c.skill === 'call' && c.box >= 4).length,
  };
}

// ---------- the dex home teaser (integrated later) ----------
function pipsHTML(picks = [], n = 5, cls = 'lh-pips') {
  return `<span class="${cls}" aria-hidden="true">${Array.from({ length: n }, (_, i) => {
    const p = picks[i];
    return `<i class="${p ? (p.right ? 'is-right' : 'is-wrong') : ''}">${p ? (p.right ? I.tick : I.cross) : ''}</i>`;
  }).join('')}</span>`;
}
// learnTeaser(ctx): a small block for the dex home. Synchronous; reads what learnReady() has loaded.
export function learnTeaser(_ctx) {
  if (!L) return '<a class="lt" href="#/learn"><span class="lt-main"><strong>Learn</strong><span>Today\'s challenge, quizzes and your review deck</span></span></a>';
  const today = dayStr();
  const picks = D.today?.date === today ? D.today.picks : [];
  const done = D.history[today] != null;
  const status = done ? `Done for today: ${D.history[today]} of 5` : picks.length ? `${picks.length} of 5 answered` : `Five species around in ${monthName()}`;
  const streak = currentStreak(), due = dueCards().length;
  return `<div class="lt-wrap"><a class="lt" href="#/learn/daily">${pipsHTML(picks, 5, 'lt-pips')}
    <span class="lt-main"><strong>Today's challenge</strong><span>${esc(status)}</span></span>
    ${streak ? `<span class="lt-streak"><b>${streak}</b><span>${streak === 1 ? 'day' : 'days'} in a row</span></span>` : ''}</a>
    ${due ? `<a class="lt-due" href="#/learn/deck">${I.deck}<span><b>${due}</b> ${due === 1 ? 'card' : 'cards'} to review</span></a>` : ''}</div>`;
}

// ---------- audio ----------
let audio = null, audioBtn = null, ticker = null, ringRaf = 0;
// Cached clips come back from ctx.audioUrl as blob: URLs; let each one go when its player is done with it.
const dropUrl = u => { if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u); };
function setPlay(btn, state) {
  if (!btn) return;
  btn.classList.toggle('is-loading', state === 'loading');
  btn.classList.toggle('is-playing', state === true);
  const ic = btn.querySelector('[data-ic]');
  if (ic) ic.innerHTML = state === true ? I.pause : I.play;
}
// The ring round the big play button shows how far through the recording she is (paused: it holds still).
const ringOf = btn => btn?.closest('.lq-player')?.querySelector('[data-ring]') || null;
function trackRing(btn, a) {
  cancelAnimationFrame(ringRaf);
  const ring = ringOf(btn);
  if (!ring) return;
  const step = () => {
    if (audio !== a || a.paused) { ringRaf = 0; return; }
    const d = a.duration;
    if (d && Number.isFinite(d)) ring.style.strokeDashoffset = String(100 - Math.min(1, a.currentTime / d) * 100);
    ringRaf = requestAnimationFrame(step);
  };
  ringRaf = requestAnimationFrame(step);
}
function stopAudio() {
  cancelAnimationFrame(ringRaf); ringRaf = 0;
  if (audio) { audio.onended = audio.onerror = null; audio.pause(); dropUrl(audio.src); }
  const ring = ringOf(audioBtn);
  if (ring) ring.style.strokeDashoffset = '100';
  setPlay(audioBtn, false);
  audio = null; audioBtn = null;
}
function cleanup() { stopAudio(); clearInterval(ticker); ticker = null; }
async function playCall(ctx, call, btn, status, onFail) {
  if (!call) return;
  if (audio && audioBtn === btn) {
    const a = audio;
    if (a.paused) { a.play().then(() => { setPlay(btn, true); trackRing(btn, a); }).catch(() => {}); } else { a.pause(); setPlay(btn, false); }
    return;
  }
  stopAudio();
  audioBtn = btn;
  setPlay(btn, 'loading');
  if (status) status.textContent = 'Loading the call…';
  const src = call.local || call.src;
  let url = src;
  const fail = () => {
    dropUrl(url);
    if (audioBtn !== btn) return;
    setPlay(btn, false); audio = null; audioBtn = null;
    const msg = navigator.onLine ? 'That recording would not play.' : 'This recording needs a connection.';
    if (status) status.textContent = msg; else ctx.toast(msg);
    onFail?.();
  };
  // ALA's server refuses the download that would cache a clip (no CORS), so stream those directly instead of
  // logging a failed fetch every time; same-origin clips (call.local) and other hosts go through the audio cache.
  if (call.local || !/^https:\/\/images\.ala\.org\.au\//.test(src)) { try { url = await ctx.audioUrl(src); } catch (_) {} }
  if (audioBtn !== btn) { dropUrl(url); return; }
  const a = audio = new Audio(url);
  a.onended = () => {
    cancelAnimationFrame(ringRaf); ringRaf = 0;
    const ring = ringOf(btn);
    if (ring) ring.style.strokeDashoffset = '0';
    setPlay(btn, false); if (status) status.textContent = 'Tap to hear it again'; dropUrl(url); audio = null; audioBtn = null;
  };
  a.onerror = fail;
  a.play().then(() => { if (audio === a) { setPlay(btn, true); trackRing(btn, a); if (status) status.textContent = 'Playing'; } }).catch(fail);
}
// The big call player: a play button inside a progress ring, over a waveform that moves while it plays.
// The bars are a drawing, not the sound itself (most recordings come from servers that don't allow reading them).
function waveHTML(seed) {
  const rng = Q.seeded(Q.hashStr(String(seed)));
  return `<span class="lq-wave" aria-hidden="true">${Array.from({ length: 32 }, (_, i) => {
    const env = Math.sin(Math.PI * (i + 0.5) / 32) ** 0.6;
    return `<i style="--h:${(0.16 + 0.84 * env * (0.3 + 0.7 * rng())).toFixed(2)};--j:${i % 7}"></i>`;
  }).join('')}</span>`;
}
const callPlayerHTML = (sp, { play = 'answer', call = null, extra = '' } = {}) => `<div class="lq-call kind--${sp.kind}">
  <span class="lq-player"><svg class="lq-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" pathLength="100"/><circle class="lq-ring-fg" data-ring cx="60" cy="60" r="54" pathLength="100"/></svg>
  <button class="lq-play" ${play ? `data-play="${play}"` : 'data-play'} aria-label="Play the call"><span data-ic>${I.play}</span></button></span>
  ${waveHTML(call?.src || sp.id)}
  <p class="lq-status" data-status aria-live="polite">Tap to listen</p>${call ? `<p class="lq-credit">${esc(credit(call))}</p>` : ''}${extra}</div>`;
const credit = c => (c ? `Recording: ${String(c.artist || 'Unknown').slice(0, 50)}${c.license ? `, ${c.license}` : ''}` : '');

// ---------- photos with fallbacks ----------
const photoCredit = p => (p ? `Photo: ${String(p.credit || 'Unknown').slice(0, 50)}${p.license ? `, ${p.license}` : ''}` : '');
// `missing` is HTML (already escaped) shown when no photo will load. Inside a button use inline: true (spans only).
function photoHTML(photos, { alt = '', cls = 'lq-photo', missing = '', inline = false } = {}) {
  const [p, ...rest] = photos || [];
  const [box, cap] = inline ? ['span', 'span'] : ['figure', 'figcaption'];
  if (!p) return `<${box} class="${cls} is-missing" data-photo><span class="lq-nophoto">${missing || 'No photo saved on this phone.'}</span></${box}>`;
  return `<${box} class="${cls}" data-photo><span class="whole"><img class="whole-bg" src="${esc(p.src)}" alt="" aria-hidden="true" decoding="async">
    <img class="whole-fg" src="${esc(p.src)}" alt="${esc(alt)}" decoding="async" data-chain="${esc(JSON.stringify(rest.slice(0, 4).map(x => [x.src, photoCredit(x)])))}"></span>
    <span class="lq-nophoto" hidden>${missing || 'This photo needs a connection.'}</span>
    <${cap} class="lq-credit">${esc(photoCredit(p))}</${cap}></${box}>`;
}
// When a photo fails (offline, moved), try the next one; when none are left, show the text in its place.
function wireImages(root) {
  for (const img of root.querySelectorAll('img[data-chain]')) {
    img.addEventListener('error', () => {
      const fig = img.closest('[data-photo]');
      let chain = [];
      try { chain = JSON.parse(img.dataset.chain || '[]'); } catch (_) {}
      const next = chain.shift();
      img.dataset.chain = JSON.stringify(chain);
      if (next) {
        img.src = next[0];
        const bg = fig.querySelector('.whole-bg'); if (bg) bg.src = next[0];
        const cr = fig.querySelector('.lq-credit'); if (cr) cr.textContent = next[1];
        return;
      }
      fig.classList.add('is-missing');
      fig.querySelector('.lq-nophoto')?.removeAttribute('hidden');
      fig.querySelector('.lq-credit')?.replaceChildren();
      fig.dispatchEvent(new CustomEvent('photo-missing', { bubbles: true }));
    });
  }
}
function preload(q) {
  const src = q?.photos?.[0]?.src || q?.options?.[0]?.photos?.[0]?.src;
  if (src) { const im = new Image(); im.decoding = 'async'; im.src = src; }
  if (q?.type === 'duel') { const im = new Image(); im.src = q.options[1]?.photos?.[0]?.src || ''; }
}
const clueHTML = clue => esc(clue).replace(/\u0001/g, '<span class="lq-blank"><span class="sr">blank</span></span>');

// Redrawing the view drops keyboard and TalkBack focus onto <body>. If she was working inside the view, put focus on
// the new screen's heading so she keeps her place and hears the next question.
const focusWithin = view => view.contains(document.activeElement) && document.activeElement !== view;
const focusHead = (view, had) => { if (had) view.querySelector('h1')?.focus({ preventScroll: true }); };

// ---------- routing ----------
let game = null;
export async function renderLearn(ctx, sub = '', arg = '') {
  const hash = location.hash;
  ctx.state.cleanup = cleanup;
  if (!L) { ctx.view.innerHTML = '<div class="learn learn--loading" aria-busy="true"></div>'; await learnReady().catch(() => {}); if (location.hash !== hash) return; }
  if (game && game.route !== hash) game = null;
  if (sub === 'daily') return renderDaily(ctx);
  if (sub === 'deck') return renderDeck(ctx);
  if (sub === 'play' && Q.MODES.includes(arg)) {
    if (game && !game.daily && !game.deck) return game.done ? drawResults(ctx) : drawQuestion(ctx);
    return startRound(ctx, arg);
  }
  return renderHub(ctx);
}
const toHub = () => location.replace('#/learn');

// ---------- hub ----------
const MODE_INFO = {
  quick: ['Quick 10', 'A mix of photos, calls, field notes and facts.'],
  photo: ['Photo', 'Name it from a photo.'],
  call: ['Call', 'Listen, then pick the bird or frog.'],
  whoami: ['Who am I?', 'Field notes with the names blanked out.'],
  duel: ['Look-alike duels', 'Two that get mixed up. Pick the right one.'],
  rapid: ['Rapid fire', 'As many in a row as you can in 60 seconds.'],
  facts: ['Seasons and facts', 'When, where and how big. No photos needed.'],
};
const DIFF = { easy: ['Easy', 'Wrong answers come from other groups.'], normal: ['Normal', 'One look-alike among the answers.'], hard: ['Hard', 'Every wrong answer is one of its closest matches.'] };
const bestKey = (mode, p) => `${mode}|${p.kind}|${p.scope}|${p.difficulty}`;
const kindLabel = k => (k === 'animals' ? 'All animals' : KINDS[k].label);

// ---------- photos for the hub and results ----------
// Photos already on screen once this session go straight in, so cards redrawn by a choice don't flicker.
const shownSrc = new Set();
const imgTag = (src, alt = '') => (src ? `<img class="fade${shownSrc.has(src) ? ' in' : ''}" src="${esc(src)}" alt="${esc(alt)}" decoding="async" data-face>` : '');
function wireFaces(root) {
  for (const img of root.querySelectorAll('img[data-face]')) {
    const done = () => { img.classList.add('in'); shownSrc.add(img.getAttribute('src')); };
    if (img.complete && img.naturalWidth) { done(); continue; }
    img.addEventListener('load', done, { once: true });
    // Offline or moved: the card's own colour shows instead of a broken picture.
    img.addEventListener('error', () => img.classList.add('is-gone'), { once: true });
  }
}
const faceSrc = (id, size = 'small') => Q.photosFor(id, { size, prefer: 'wiki' })[0]?.src || '';
// One photo per practice card, the same all day for a kind: commoner species, none twice, a look-alike pair for duels.
let faces = { key: '', v: null };
function modeFaces(kind) {
  const key = `${dayStr()}|${kind}`;
  if (faces.key === key) return faces.v;
  const all = Q.speciesFor(kind).filter(Q.hasPhoto);
  if (!all.length) return {}; // the photo index hasn't arrived yet: try again next time
  const rng = Q.seeded(Q.hashStr(`faces|${key}`));
  const common = all.filter(s => s.rarity <= 2);
  const pool = Q.shuffle((common.length >= 12 ? common : all).slice(), rng);
  const inKind = s => s && Q.hasPhoto(s) && (kind === 'animals' ? s.kind !== 'plant' : s.kind === kind);
  const pair = Q.shuffle(Q.lookalikePairs().filter(x => inKind(byId.get(x.a)) && inKind(byId.get(x.b))), rng)[0];
  const used = new Set(pair ? [pair.a, pair.b] : []), v = {};
  if (pair) v.duel = [pair.a, pair.b];
  for (const m of Q.MODES) {
    if (v[m]) continue;
    const ok = m === 'call' ? s => Q.CALL_KINDS.includes(s.kind) && Q.hasCall(s.id) : () => true;
    const s = pool.find(x => !used.has(x.id) && ok(x)) || pool.find(x => !used.has(x.id));
    if (s) { used.add(s.id); v[m] = [s.id]; }
  }
  faces = { key, v };
  return v;
}
// The challenge card takes its colour from a species about this month that isn't in today's set (that set is
// drawn from the commonest, 80% of peak and up), so the picture never gives an answer away.
function heroFace(month) {
  const rate = s => Q.relRate(s.id, month) ?? 0;
  let list = SPECIES.filter(s => rate(s) >= 0.5 && rate(s) < 0.8 && Q.hasPhoto(s));
  if (!list.length) list = SPECIES.filter(s => s.rarity <= 2 && Q.hasPhoto(s));
  return list.length ? list[(Q.seeded(Q.hashStr(`hero|${dayStr()}`))() * list.length) | 0] : null;
}

// Bars, meters and pips fill the first time they are seen; after that they are drawn full.
let hubOnce = false, pipsSeen = { date: '', n: 0 };
function growOnView(root) {
  const els = [...root.querySelectorAll('[data-grow]')];
  if (!els.length) return;
  if (typeof IntersectionObserver !== 'function') { els.forEach(el => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver(ens => {
    for (const en of ens) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }, { threshold: 0.4 });
  els.forEach(el => io.observe(el));
}
function heroPips(picks, today) {
  const from = pipsSeen.date === today ? pipsSeen.n : 0;
  pipsSeen = { date: today, n: picks.length };
  const anim = !reduced();
  return `<span class="lh-pips" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => {
    const p = picks[i];
    const cls = p ? `${p.right ? 'is-right' : 'is-wrong'}${anim && i >= from ? ' is-new' : ''}` : '';
    return `<i class="${cls}" style="--j:${Math.max(0, i - from)}">${p ? (p.right ? I.tick : I.cross) : ''}</i>`;
  }).join('')}</span>`;
}
// A segmented choice; the thumb glides to the pressed button (--idx), which keeps aria-pressed.
function segHTML(attr, items, cur, label) {
  const idx = Math.max(0, items.findIndex(([k]) => k === cur));
  return `<div class="lh-seg" role="group" aria-label="${esc(label)}" style="--n:${items.length};--idx:${idx}"><span class="lh-seg-thumb" aria-hidden="true"></span>${
    items.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${k === cur}">${esc(l)}</button>`).join('')}</div>`;
}
const boxesHTML = (boxes, cls = '') => {
  const maxBox = Math.max(1, ...boxes);
  return `<span class="lh-boxes ${cls}" aria-hidden="true">${boxes.map((n, i) => `<span class="lh-box"><b>${n}</b><span class="lh-box-bar"><i style="--h:${(n / maxBox).toFixed(3)};--j:${i}"></i></span><em>${i + 1}</em></span>`).join('')}</span>`;
};

function renderHub(ctx) {
  const { view } = ctx;
  game = null;
  const p = L.prefs, today = dayStr(), month = monthName();
  const picks = D.today?.date === today ? D.today.picks : [];
  const doneToday = D.history[today] != null;
  const streak = currentStreak();
  const cards = allCards(), due = dueCards().length;
  const boxes = [1, 2, 3, 4, 5].map(b => cards.filter(c => c.box === b).length);
  const dailyLine = doneToday ? `Done: ${D.history[today]} of 5. A new set comes tomorrow.` : picks.length ? `${picks.length} of 5 answered. Pick up where you left off.` : `Five species around in ${month}. About two minutes.`;
  const kinds = ['animals', ...kindsPresent];
  const scopes = [['all', 'Everything'], ['seen', "Ones I've seen"], ['month', `Around in ${month}`]];
  const now = new Date();
  const grow = !hubOnce && !reduced() ? ' data-grow' : '';
  hubOnce = true;
  const hero = heroFace(now.getMonth() + 1);
  view.innerHTML = `
    <header class="page-head"><h1 class="lh-title">Learn</h1></header>
    <div class="learn">
      ${navigator.onLine ? '' : '<p class="lh-offline" role="status">No signal. Questions use the photos and calls saved on this phone, plus field notes.</p>'}
      <a class="lh-daily${doneToday ? ' is-done' : ''}" href="#/learn/daily">
        ${hero ? `<span class="lh-daily-photo" aria-hidden="true">${imgTag(faceSrc(hero.id, 'large'))}</span>` : ''}
        <span class="lh-daily-top">
          <span class="lh-date" aria-hidden="true"><b>${now.getDate()}</b><span>${esc(month)}</span></span>
          ${streak ? `<span class="lh-streak"><b>${streak}</b><span>${streak === 1 ? 'day' : 'days'} in a row</span></span>` : ''}
        </span>
        <span class="lh-daily-main"><strong>Today's challenge</strong><span>${esc(dailyLine)}</span></span>
        <span class="lh-daily-foot">${heroPips(picks, today)}<span class="lh-go">${doneToday ? 'See how you went' : picks.length ? 'Carry on' : 'Start'}</span></span>
      </a>

      <section class="lh-sec" aria-labelledby="lh-deck-h">
        <div class="lh-sec-h"><h2 id="lh-deck-h">Review deck</h2><a href="#/learn/deck">${cards.length ? 'Open' : 'Set up'}</a></div>
        ${cards.length ? `<a class="lh-deck${due ? ' is-due' : ''}" href="#/learn/deck" aria-label="${due} ${due === 1 ? 'card' : 'cards'} due. Open the review deck"${grow}>
          ${boxesHTML(boxes)}
          <span class="lh-deck-txt"><strong>${due ? `<b>${due}</b> ${due === 1 ? 'card' : 'cards'} to review` : 'Nothing due right now'}</strong><span class="small muted">Know a card and it moves along a box. Box 4 and 5 count as mastered.</span></span></a>`
          : '<p class="small muted lh-empty">Species you miss in a round land here, so they come back until you know them. You can also add a set yourself.</p>'}
      </section>

      <section class="lh-sec" aria-labelledby="lh-play-h">
        <div class="lh-sec-h"><h2 id="lh-play-h">Practise</h2></div>
        <div class="lh-kinds" role="group" aria-label="What to practise">${kinds.map(k => `<button type="button" class="lh-kind${k !== 'animals' ? ` kind--${k}` : ''}" data-kind="${k}" aria-pressed="${p.kind === k}"><i aria-hidden="true"></i>${esc(kindLabel(k))}</button>`).join('')}</div>
        ${segHTML('scope', scopes, p.scope, 'Which species')}
        ${segHTML('diff', Object.entries(DIFF).map(([k, [l]]) => [k, l]), p.difficulty, 'Difficulty')}
        <p class="small muted lh-hint" data-hint>${esc(DIFF[p.difficulty][1])}</p>
        <ul class="lh-modes${p.kind !== 'animals' ? ` kind--${p.kind}` : ''}" data-modes>${modesHTML(p)}</ul>
      </section>

      <section class="lh-sec" aria-labelledby="lh-prog-h">
        <div class="lh-sec-h"><h2 id="lh-prog-h">How you're going</h2></div>
        ${progressHTML(grow)}
      </section>
    </div>`;
  wireFaces(view);
  const card = view.querySelector('.lh-daily');
  if (hero) ctx.applyTint?.(card, faceSrc(hero.id), null);
  growOnView(view);
  ctx.stagger?.(view, '.lh-daily, .lh-deck, .lh-modes > li', { key: 'learn-hub' });
  view.querySelector('.lh-kind[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  view.onclick = e => {
    const k = e.target.closest('[data-kind]'), sc = e.target.closest('[data-scope]'), d = e.target.closest('[data-diff]');
    if (k) L.prefs.kind = k.dataset.kind;
    if (sc) L.prefs.scope = sc.dataset.scope;
    if (d) L.prefs.difficulty = d.dataset.diff;
    if (k || sc || d) { saveL(); syncHub(ctx, k || sc || d); return; }
    if (e.target.closest('[data-off]')) { e.preventDefault(); ctx.toast('Calls are for birds and frogs. Choose All animals, Birds or Frogs.'); }
  };
  view.onchange = null;
}

// A choice changes the controls and cards in place: focus stays on the button she pressed and the thumb can glide.
function syncHub(ctx, btn) {
  const { view } = ctx, p = L.prefs;
  const press = (attr, val) => { for (const b of view.querySelectorAll(`[data-${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(`data-${attr}`) === val)); };
  press('kind', p.kind); press('scope', p.scope); press('diff', p.difficulty);
  for (const seg of view.querySelectorAll('.lh-seg')) seg.style.setProperty('--idx', Math.max(0, [...seg.querySelectorAll('button')].findIndex(b => b.getAttribute('aria-pressed') === 'true')));
  const hint = view.querySelector('[data-hint]');
  if (hint) hint.textContent = DIFF[p.difficulty][1];
  const modes = view.querySelector('[data-modes]');
  if (modes) {
    modes.className = `lh-modes${p.kind !== 'animals' ? ` kind--${p.kind}` : ''}`;
    modes.innerHTML = modesHTML(p);
    wireFaces(modes);
  }
  if (btn?.matches('.lh-kind')) {
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    if (!reduced()) { btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop'); }
  }
}

function modesHTML(p) {
  const callOk = Q.CALL_KINDS.includes(p.kind) || p.kind === 'animals';
  const f = modeFaces(p.kind);
  return Q.MODES.map(m => {
    const [title, desc] = MODE_INFO[m];
    const b = L.best[bestKey(m, p)], off = m === 'call' && !callOk;
    const ids = f[m] || [];
    const pics = ids.map(id => imgTag(faceSrc(id, m === 'quick' ? 'large' : 'small'))).join('');
    return `<li class="${m === 'quick' ? 'lh-mode--wide' : ''}"><a class="lh-mode lh-mode--${m}${off ? ' is-off' : ''}" href="#/learn/play/${m}"${off ? ' aria-disabled="true" data-off' : ''}>
      <span class="lh-mode-bg${ids.length > 1 ? ' is-split' : ''}" aria-hidden="true">${pics}</span>
      <span class="lh-mode-top"><span class="lh-mode-ic" aria-hidden="true">${I[m]}</span>
      ${b != null ? `<span class="lh-best">${m === 'rapid' ? 'Best streak' : 'Best'} <b>${b}</b>${m === 'rapid' ? '' : `<span>/${ROUND}</span>`}</span>` : ''}</span>
      <span class="lh-mode-txt"><strong>${title}</strong><span class="lh-mode-desc">${off ? 'Calls are for birds and frogs. Choose All animals, Birds or Frogs.' : desc}</span></span></a></li>`;
  }).join('');
}

// Mastered (box 4+) and accuracy for each kind she has practised; one line for the rest.
function progressHTML(grow = '') {
  const rows = kindsPresent.map(k => ({ k, all: ofKind(k).length, m: ofKind(k).filter(s => isMastered(s.id)).length, acc: accuracy(k) }));
  const active = rows.filter(r => r.acc || r.m), idle = rows.filter(r => !r.acc && !r.m);
  if (!active.length) return '<p class="small muted lh-empty">Answer a few questions and your accuracy, and how many species you have mastered, show here for each kind.</p>';
  const names = idle.map(r => KINDS[r.k].label.toLowerCase());
  return `<ul class="lh-prog"${grow}>${active.map(({ k, all, m, acc }, i) => `<li class="kind--${k}"><span class="lh-dot" aria-hidden="true"></span>
      <span class="lh-prog-main"><strong>${KINDS[k].label}</strong><span class="lh-meter" aria-hidden="true"><span style="--p:${(m / all).toFixed(3)};--j:${i}"></span></span>
      <span class="small muted">${m} of ${all} mastered</span></span>
      <span class="lh-acc">${acc ? `<b>${acc.pct}%</b><span>right of ${acc.n}</span>` : '<span>No answers yet</span>'}</span></li>`).join('')}</ul>
    ${names.length ? `<p class="small muted lh-empty">Nothing yet for ${esc(names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0])}.</p>` : ''}`;
}


// ---------- practice rounds ----------
function emptyMessage(mode, p, offline) {
  if (mode === 'duel' && offline) return 'Duels need photos saved on this phone, and none match yet. Try Who am I? for now.';
  if (p.scope === 'seen') return "Not enough of the ones you've seen for this. Log a few more, or choose Everything.";
  if (mode === 'duel') return 'No look-alike pairs match that choice. Try Everything or another kind.';
  if (mode === 'call') return 'No calls for these. Calls are for birds and frogs.';
  return 'Not enough species match that choice. Try a wider one.';
}
async function startRound(ctx, mode, { ids = null } = {}) {
  const p = L.prefs, month = new Date().getMonth() + 1;
  const route = location.hash;
  let offline = null, playMode = mode;
  if (!navigator.onLine) {
    const pool = Q.speciesFor(ids ? 'all' : p.kind === 'animals' ? 'all' : p.kind);
    const [photos, calls] = await Promise.all([Q.cachedPhotos(pool), Q.cachedCalls(pool)]);
    if (location.hash !== route) return;
    offline = { photos, calls };
    if (['photo', 'rapid'].includes(mode) && photos.size < 4) {
      ctx.toast('No photos saved on this phone yet, so this round uses field notes.');
      playMode = 'whoami';
    }
    if (mode === 'call' && calls.size < 4) {
      ctx.toast('Calls need a connection, and none are saved on this phone yet.');
      return toHub();
    }
  }
  const qs = Q.buildRound({ mode: playMode, kind: p.kind, scope: ids ? 'all' : p.scope, difficulty: mode === 'rapid' ? 'normal' : p.difficulty,
    seen: ctx.seenSet(), month, n: mode === 'rapid' ? 60 : ids ? Math.min(ROUND, ids.length) : ROUND, ids, offline });
  if (qs.length < (ids ? 1 : 3)) { ctx.toast(emptyMessage(mode, p, !!offline)); return toHub(); }
  game = { route, mode, qs, i: 0, score: 0, prefs: { ...p }, practice: !!ids };
  if (mode === 'rapid') Object.assign(game, { endsAt: Date.now() + RAPID_MS, streak: 0, top: 0 });
  drawQuestion(ctx);
}

function headHTML() {
  const total = game.qs.length;
  if (game.mode === 'rapid') {
    const left = Math.max(0, game.endsAt - Date.now());
    return `<header class="lq-head"><button class="iconbtn" data-quit aria-label="Stop and go back to Learn">${I.close}</button>
      <span class="lq-bar lq-bar--time" aria-hidden="true"><span data-timebar style="transform:scaleX(${(left / RAPID_MS).toFixed(3)})"></span></span>
      <span class="lq-count" data-secs aria-label="Seconds left">${Math.ceil(left / 1000)}<span>s</span></span></header>
      <p class="lq-hud" role="status"><span>In a row <b data-streak>${game.streak}</b></span><span>Best this round <b data-top>${game.top}</b></span></p>`;
  }
  const n = game.i + 1;
  return `<header class="lq-head"><button class="iconbtn" data-quit aria-label="${game.daily ? 'Back to Learn. Your answers so far are saved' : 'Stop and go back to Learn'}">${game.daily ? I.back : I.close}</button>
    <span class="lq-bar" role="progressbar" aria-label="Question ${n} of ${total}" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${n}"><span style="transform:scaleX(${((n - 1) / total).toFixed(3)})"></span></span>
    <span class="lq-count" aria-hidden="true">${n}<span>/${total}</span></span></header>
    <p class="lq-kicker">${game.daily ? "Today's challenge" : esc(MODE_INFO[game.mode]?.[0] || '')}${game.practice ? '<span>The ones you missed</span>' : ''}</p>`;
}
function optionsHTML(q) {
  if (q.type === 'duel') {
    return `<div class="lq-duel">${q.options.map((o, i) => `<button class="lq-side" data-pick="${esc(o.key)}" aria-label="Photo ${i === 0 ? 'on the left' : 'on the right'}">
      ${photoHTML(o.photos, { alt: '', cls: 'lq-photo lq-photo--duel', missing: 'Photo not saved on this phone', inline: true })}
      <span class="lq-side-name" data-name></span><span class="lq-opt-mark" aria-hidden="true"></span></button>`).join('')}</div>`;
  }
  const grid = game.mode === 'rapid' ? ' lq-options--grid' : '';
  return `<div class="lq-options${grid}" role="group" aria-label="Answers">${q.options.map(o => `<button class="lq-opt" data-pick="${esc(o.key)}">
    <span class="lq-opt-label ${q.italic ? 'is-sci' : ''}">${esc(o.label)}</span><span class="lq-opt-mark" aria-hidden="true"></span><span class="sr" data-sr></span></button>`).join('')}</div>`;
}
function mediaHTML(q) {
  const sp = byId.get(q.focus);
  if (q.type === 'photo') return photoHTML(q.photos, { alt: `Mystery ${KINDS[sp.kind].one}`, missing: `This photo needs a connection. Here are its field notes instead: ${clueHTML(Q.blankNotes(sp, q.wrong))}` });
  if (q.type === 'call') return `<div class="lq-call"><button class="lq-play" data-play="answer" aria-label="Play the call"><span data-ic>${I.play}</span></button>
    <p class="lq-status" data-status aria-live="polite">Tap to listen</p><p class="lq-credit">${esc(credit(q.call))}</p>
    <p class="lq-hint" data-callhint hidden>Field notes: ${clueHTML(Q.blankNotes(sp, q.wrong))}</p></div>`;
  if (q.type === 'whoami') return `<blockquote class="lq-clue">${clueHTML(q.clue)}</blockquote>`;
  if (q.type === 'fact' && q.photos?.length) return photoHTML(q.photos, { alt: byId.get(q.img)?.name || '', cls: 'lq-photo lq-photo--small' });
  return '';
}

function drawQuestion(ctx) {
  const { view } = ctx;
  const had = focusWithin(view);
  cleanup();
  const q = game.qs[game.i];
  if (!q || (game.mode === 'rapid' && Date.now() >= game.endsAt)) return drawResults(ctx);
  view.innerHTML = `<div class="lq-screen lq-screen--${game.mode}">${headHTML()}
    <div class="lq lq--${q.type}">
      <h1 class="lq-prompt" tabindex="-1">${esc(q.prompt)}</h1>
      ${q.type === 'duel' ? '<p class="lq-sub">Tap the photo you think it is.</p>' : ''}
      ${mediaHTML(q)}
      ${optionsHTML(q)}
      <div class="lq-fb" data-fb tabindex="-1"></div>
    </div></div>`;
  wireImages(view);
  focusHead(view, had);
  preload(game.qs[game.i + 1]);
  if (q.picked != null) showAnswer(ctx, q, { restore: true });
  if (game.mode === 'rapid') {
    ticker = setInterval(() => {
      const left = Math.max(0, game.endsAt - Date.now());
      const bar = view.querySelector('[data-timebar]'), secs = view.querySelector('[data-secs]');
      if (bar) bar.style.transform = `scaleX(${(left / RAPID_MS).toFixed(3)})`;
      if (secs) secs.firstChild.textContent = String(Math.ceil(left / 1000));
      if (!left) { clearInterval(ticker); ticker = null; if (!q.picked) drawResults(ctx); }
    }, 200);
  }
  view.onclick = e => {
    if (e.target.closest('[data-quit]')) { cleanup(); game = null; return toHub(); }
    const play = e.target.closest('[data-play]');
    if (play) {
      const which = play.dataset.play;
      const sp = which === 'answer' ? byId.get(q.focus) : byId.get(Number(which));
      const call = which === 'answer' && q.call ? q.call : Q.callsOf(sp.id)[(Math.random() * Q.callsOf(sp.id).length) | 0];
      const status = play.closest('.lq-call')?.querySelector('[data-status]') || null; // feedback buttons keep their label; the icon shows play or pause
      playCall(ctx, call, play, status, () => { const h = view.querySelector('[data-callhint]'); if (h && q.picked == null) h.hidden = false; });
      return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk && q.picked == null) return answer(ctx, q, pk.dataset.pick);
    if (e.target.closest('[data-next]')) { stopAudio(); game.i++; drawQuestion(ctx); }
    if (e.target.closest('[data-finish]')) drawResults(ctx);
  };
  view.onchange = null;
}

function answer(ctx, q, key) {
  q.picked = key;
  const right = key === q.answer;
  if (right) game.score++;
  record(q, right);
  navigator.vibrate?.(right ? 30 : [40, 60, 40]);
  if (game.daily) {
    D.today.picks.push({ key, right });
    saveD();
  }
  if (game.mode === 'rapid') {
    game.streak = right ? game.streak + 1 : 0;
    game.top = Math.max(game.top, game.streak);
    showAnswer(ctx, q, { brief: true });
    // Only move on if she's still on this round: leaving within the pause must not paint the quiz over another screen.
    const g = game;
    setTimeout(() => { if (game === g && location.hash === g.route && g.qs[g.i] === q) { g.i++; drawQuestion(ctx); } }, right ? 450 : 1100);
    return;
  }
  showAnswer(ctx, q);
}

// Mark the answers (tick and cross as well as colour) and show what to learn from it.
function showAnswer(ctx, q, { brief = false, restore = false } = {}) {
  const { view } = ctx;
  const right = q.picked === q.answer;
  for (const b of view.querySelectorAll('[data-pick]')) {
    const k = b.dataset.pick, isAns = k === q.answer, isPick = k === q.picked;
    b.classList.add(isAns ? 'is-right' : isPick ? 'is-wrong' : 'is-dim');
    if (restore || reduced()) b.classList.add('no-anim');
    b.setAttribute('aria-disabled', 'true');
    const mark = b.querySelector('.lq-opt-mark');
    if (mark) mark.innerHTML = isAns ? I.tick : isPick ? I.cross : '';
    const sr = b.querySelector('[data-sr]');
    if (sr) sr.textContent = isAns ? ' (right answer)' : isPick ? ' (your answer)' : '';
    const nm = b.querySelector('[data-name]');
    if (nm) { const o = q.options.find(x => x.key === k); nm.textContent = o.label; b.setAttribute('aria-label', `${o.label}${isAns ? ' (right answer)' : isPick ? ' (your answer)' : ''}`); }
  }
  if (game.mode === 'rapid') {
    const st = view.querySelector('[data-streak]'), tp = view.querySelector('[data-top]');
    if (st) st.textContent = game.streak;
    if (tp) tp.textContent = game.top;
  }
  const fb = view.querySelector('[data-fb]');
  if (!fb) return;
  fb.innerHTML = feedbackHTML(q, right, brief);
  fb.className = `lq-fb ${right ? 'is-right' : 'is-wrong'} ${brief ? 'lq-fb--brief' : ''} ${restore || reduced() ? 'no-anim' : ''}`;
  wireImages(fb);
  if (!brief && !restore) {
    fb.focus({ preventScroll: true });
    requestAnimationFrame(() => fb.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
  }
}

function feedbackHTML(q, right, brief) {
  const ans = byId.get(q.focus);
  const pickedOpt = q.options.find(o => o.key === q.picked);
  const pickedSp = pickedOpt?.sp ? byId.get(pickedOpt.sp) : null;
  const ansLabel = q.options.find(o => o.key === q.answer)?.label || '';
  const speciesQ = q.type !== 'fact' || q.ttype === 'Calls';
  const verdictText = right ? 'Correct.' : q.type === 'duel' ? `Not quite. That one is the ${pickedSp?.name}.`
    : speciesQ ? `Not quite. It's the ${ans.name}.` : q.options.find(o => o.key === q.answer)?.sp ? `Not quite. It's the ${ansLabel}.` : `Not quite. It's ${ansLabel}.`;
  const verdict = `<p class="lq-verdict">${right ? I.tick : I.cross}<span>${esc(verdictText)}</span></p>`;
  if (brief) return verdict;
  const tell = q.type === 'duel' ? q.tell : !right && pickedSp ? Q.tellFor(ans.id, pickedSp.id) : null;
  const cw = q.type === 'call' ? Q.callWords(ans) : null;
  const line = q.type === 'fact' ? q.explain : cw ? cw.sentence : Q.fieldMark(ans);
  const showPhoto = q.type === 'call' || q.type === 'whoami';
  const last = game.i + 1 >= game.qs.length;
  const actions = [];
  if (Q.hasCall(ans.id) && q.type !== 'fact') actions.push(`<button class="btn lq-act" data-play="${q.type === 'call' ? 'answer' : ans.id}"><span data-ic>${I.play}</span><span data-label>${q.type === 'call' ? 'Hear it again' : 'Hear its call'}</span></button>`);
  if (!right && pickedSp && Q.hasCall(pickedSp.id) && q.type !== 'fact') actions.push(`<button class="btn lq-act" data-play="${pickedSp.id}"><span data-ic>${I.play}</span><span data-label>Hear the one you picked</span></button>`);
  if (!right && pickedSp && pickedSp.kind === ans.kind) actions.push(`<a class="btn lq-act" href="#/compare/${ans.id}/${pickedSp.id}">${I.compare}<span>Compare the two</span></a>`);
  return `${verdict}
    ${speciesQ ? `<p class="lq-name"><a href="#/bird/${ans.id}">${esc(ans.name)}</a> <span class="lq-sci">${esc(ans.sci)}</span></p>` : ''}
    ${showPhoto && q.photos?.length ? photoHTML(q.photos, { alt: ans.name, cls: 'lq-photo lq-photo--answer' }) : ''}
    ${line ? `<p class="lq-line">${esc(line)}</p>` : ''}
    ${tell ? `<p class="lq-tell"><strong>How to tell them apart.</strong> ${esc(tell)}</p>` : ''}
    ${q.type === 'fact' && q.source?.title ? `<p class="lq-source">Source: ${q.source.url ? `<a href="${esc(q.source.url)}" target="_blank" rel="noopener">${esc(q.source.title)}</a>` : esc(q.source.title)}</p>` : ''}
    ${actions.length ? `<div class="lq-actions">${actions.join('')}</div>` : ''}
    <button class="btn btn--primary btn--block lq-next" ${last ? 'data-finish' : 'data-next'}>${last ? (game.daily ? 'See today\'s result' : 'See how you went') : 'Next question'}</button>`;
}

// ---------- results ----------
function drawResults(ctx) {
  const { view } = ctx;
  const had = focusWithin(view);
  cleanup();
  const asked = game.qs.filter(q => q.picked != null);
  const total = game.mode === 'rapid' ? asked.length : game.qs.length;
  const missed = asked.filter(q => q.picked !== q.answer);
  let note = '';
  if (!game.done) {
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
        saveD();
      }
    } else if (!game.practice) {
      const key = bestKey(game.mode, game.prefs);
      const score = game.mode === 'rapid' ? game.top : game.score;
      if (L.best[key] == null || score > L.best[key]) { if (L.best[key] != null && score > 0) game.newBest = true; L.best[key] = score; }
      L.rounds++;
      if (game.score === total && total >= ROUND && game.prefs.difficulty !== 'easy' && game.mode !== 'rapid') L.perfect++;
      saveL();
    }
  }
  if (game.daily) {
    const s = currentStreak();
    note = `${s ? `${s} ${s === 1 ? 'day' : 'days'} in a row.` : ''} A new set comes tomorrow.`;
  } else if (game.mode === 'rapid') {
    note = `${game.score} right out of ${total} in 60 seconds.${game.newBest ? ' A new best streak.' : ''}`;
  } else {
    note = `${game.score === total ? 'A perfect round.' : game.score >= total * 0.7 ? 'Sharp eyes and ears.' : missed.some(q => q.type !== 'fact') ? 'Keep at it. The misses are in your review deck now.' : 'Keep at it.'}${game.newBest ? ' A new personal best.' : ''}`;
  }
  const big = game.mode === 'rapid' ? game.top : game.score;
  const of = game.mode === 'rapid' ? 'in a row' : `of ${total}`;
  view.innerHTML = `<div class="lr">
    <header class="page-head"><h1 class="lh-title" tabindex="-1">${game.daily ? "Today's challenge" : esc(MODE_INFO[game.mode][0])}</h1></header>
    <div class="lr-score ${reduced() ? 'no-anim' : ''}" role="status"><b>${big}</b><span>${esc(of)}</span></div>
    <p class="lr-note">${esc(note)}</p>
    <div class="lr-actions">
      ${missed.length && !game.daily ? `<button class="btn btn--primary btn--block" data-again-missed>Practise ${missed.length === 1 ? 'the one' : missed.length > ROUND ? `${ROUND} of the ${missed.length}` : `the ${missed.length}`} you missed</button>` : ''}
      ${game.daily ? '<a class="btn btn--primary btn--block" href="#/learn">Back to Learn</a>' : `<button class="btn ${missed.length ? '' : 'btn--primary'} btn--block" data-again>Play again</button>`}
      ${game.daily && missed.some(x => x.type !== 'fact') ? '<a class="btn btn--block" href="#/learn/deck">Review the ones you missed</a>' : ''}
      ${game.daily ? '' : '<button class="btn btn--quiet btn--block" data-hub>Back to Learn</button>'}
    </div>
    ${game.mode === 'rapid' && missed.length ? '<h2 class="lr-h">The ones you missed</h2>' : ''}
    <ul class="lr-list">${(game.mode === 'rapid' ? missed.slice(0, 15) : asked).map(q => {
      const ok = q.picked === q.answer, sp = byId.get(q.focus);
      const picked = q.options.find(o => o.key === q.picked);
      const title = q.type === 'fact' && q.ttype !== 'Calls' ? q.prompt : sp.name;
      return `<li class="${ok ? 'is-right' : 'is-wrong'}"><span class="lr-mark">${ok ? I.tick : I.cross}<span class="sr">${ok ? 'Right' : 'Wrong'}</span></span>
        <a class="lr-main" href="#/bird/${sp.id}"><strong>${esc(title)}</strong><span class="small muted">${ok ? (q.type === 'fact' ? esc(q.options.find(o => o.key === q.answer)?.label) : 'Got it') : `You picked ${esc(picked?.label || 'nothing')}`}</span></a></li>`;
    }).join('')}</ul>
  </div>`;
  focusHead(view, had);
  view.onclick = e => {
    if (e.target.closest('[data-again]')) { game = null; startRound(ctx, ROUTE_MODE()); }
    if (e.target.closest('[data-again-missed]')) {
      const ids = [...new Set(missed.map(q => q.focus))].slice(0, ROUND);
      const mode = game.mode === 'rapid' ? 'photo' : game.mode;
      game = null;
      startRound(ctx, mode, { ids });
    }
    if (e.target.closest('[data-hub]')) { game = null; toHub(); }
  };
  view.onchange = null;
}
const ROUTE_MODE = () => (location.hash.match(/^#\/learn\/play\/(\w+)/) || [])[1] || 'quick';

// ---------- today's challenge ----------
function renderDaily(ctx) {
  const today = dayStr();
  if (!game || !game.daily || game.date !== today) {
    const qs = Q.buildDaily(today, new Date().getMonth() + 1);
    if (!qs.length) { ctx.toast('Today\'s challenge needs the species data. Try again in a moment.'); return toHub(); }
    if (D.today?.date !== today) { D.today = { date: today, picks: [] }; saveD(); }
    const picks = D.today.picks;
    picks.forEach((p, i) => { if (qs[i]) qs[i].picked = p.key; });
    game = { route: location.hash, daily: true, date: today, mode: 'daily', qs, i: Math.min(picks.length, qs.length), score: picks.filter(p => p.right).length };
    if (D.history[today] != null) game.done = true;
  }
  if (game.i >= game.qs.length) return drawResults(ctx);
  drawQuestion(ctx);
}

// ---------- review deck ----------
function renderDeck(ctx) {
  if (game?.deck && game.queue) return game.queue.length ? drawCard(ctx) : drawDeckDone(ctx);
  const { view } = ctx;
  game = { route: location.hash, deck: true };
  const p = L.prefs, cards = allCards(), due = dueCards();
  const boxes = [1, 2, 3, 4, 5].map(b => cards.filter(c => c.box === b).length);
  const maxBox = Math.max(1, ...boxes);
  const next = cards.filter(c => c.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  const nextTxt = next ? (startOfDay(next.due) <= startOfDay() ? 'More come due later today.' : `Next ones are due ${new Date(next.due).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}.`) : '';
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/learn" aria-label="Back to Learn">${I.back}</a><h1 class="lh-title">Review deck</h1></header>
    <div class="learn">
      <div class="ld-summary">
        <span class="lh-boxes lh-boxes--big" aria-hidden="true">${boxes.map((n, i) => `<span class="lh-box"><b>${n}</b><i style="--h:${Math.round(n / maxBox * 100)}%"></i><em>${i + 1}</em></span>`).join('')}</span>
        <p class="small muted">${cards.length ? `${cards.length} cards. ${boxes[3] + boxes[4]} in box 4 or 5, which count as mastered.` : 'No cards yet.'} Knew it moves a card along a box: it comes back after 1, 3, 7, then 21 days. Missed sends it back to box 1.</p>
      </div>
      ${due.length ? `<button class="btn btn--primary btn--block" data-review>Review ${due.length > 20 ? 20 : due.length} ${due.length === 1 ? 'card' : 'cards'}</button>`
        : `<p class="ld-none" role="status">${cards.length ? `Nothing to review right now. ${esc(nextTxt)}` : 'Add a set to start. Species you miss in any round are added for you.'}</p>`}
      <section class="lh-sec"><div class="lh-sec-h"><h2>Add cards</h2></div>
        <div class="ld-add">
          <button class="btn btn--block" data-add="month">${I.facts}<span>Add 10 ${esc(p.kind === 'animals' ? 'animals' : KINDS[p.kind].label.toLowerCase())} around in ${esc(monthName())}</span></button>
          <button class="btn btn--block" data-add="seen">${I.deck}<span>Add the ones I've seen</span></button>
        </div>
        <p class="small muted">Birds and frogs with recordings get a call card as well as a photo card.</p>
      </section>
    </div>`;
  view.onclick = e => {
    if (e.target.closest('[data-review]')) {
      game.queue = dueCards().slice(0, 20).map(c => ({ id: c.id, skill: c.skill, reps: 0 }));
      game.total = game.queue.length; game.n = 0; game.tally = { knew: 0, unsure: 0, missed: 0 };
      drawCard(ctx);
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const month = new Date().getMonth() + 1;
      let list = add.dataset.add === 'month'
        ? Q.poolFor({ kind: p.kind, scope: 'month', month }).sort((a, b) => (Q.relRate(b.id, month) ?? 0) - (Q.relRate(a.id, month) ?? 0) || a.rarity - b.rarity)
        : [...ctx.seenSet()].map(id => byId.get(id)).filter(Boolean);
      list = list.filter(s => !L.cards[s.id]).slice(0, add.dataset.add === 'month' ? 10 : 30);
      let n = 0;
      for (const s of list) { if (addCard(s.id, 'look')) n++; if (Q.CALL_KINDS.includes(s.kind) && Q.hasCall(s.id) && addCard(s.id, 'call')) n++; }
      saveL();
      ctx.toast(n ? `Added ${n} ${n === 1 ? 'card' : 'cards'}.` : add.dataset.add !== 'seen' ? 'Those are all in the deck already.'
        : ctx.seenSet().size ? 'Everything you have seen is already in the deck.' : 'Nothing logged yet. Log a sighting and it can go in the deck.');
      game = null; renderDeck(ctx);
    }
  };
  view.onchange = null;
}
function drawCard(ctx) {
  const { view } = ctx;
  const had = focusWithin(view);
  cleanup();
  const c = game.queue[0];
  const sp = byId.get(c.id);
  game.revealed = false;
  const photos = Q.photosFor(sp.id);
  const front = c.skill === 'call'
    ? `<div class="lq-call"><button class="lq-play" data-play aria-label="Play the call"><span data-ic>${I.play}</span></button><p class="lq-status" data-status aria-live="polite">Tap to listen</p></div>`
    : photoHTML(photos, { alt: `Mystery ${KINDS[sp.kind].one}`, missing: `This photo needs a connection. Its field notes: ${clueHTML(Q.blankNotes(sp))}` });
  const mates = Q.lookalikesOf(sp.id).map(id => byId.get(id)).filter(Boolean);
  const peaks = Q.peaksOf(sp.id), cw = Q.callWords(sp);
  view.innerHTML = `<div class="lq-screen">
    <header class="lq-head"><a class="iconbtn" href="#/learn/deck" data-quit aria-label="Stop reviewing">${I.close}</a>
      <span class="lq-bar" role="progressbar" aria-label="Card ${game.n + 1} of ${game.total}" aria-valuemin="1" aria-valuemax="${game.total}" aria-valuenow="${game.n + 1}"><span style="transform:scaleX(${(game.n / Math.max(1, game.total)).toFixed(3)})"></span></span>
      <span class="lq-count" aria-hidden="true">${game.queue.length}<span> left</span></span></header>
    <p class="lq-kicker">Review deck<span>Box ${L.cards[sp.id]?.[c.skill]?.box || 1}, ${c.skill === 'call' ? 'by call' : 'by sight'}</span></p>
    <div class="lq ld-card">
      <h1 class="lq-prompt" tabindex="-1">${c.skill === 'call' ? `Whose call is this?` : `Which ${KINDS[sp.kind].one} is this?`}</h1>
      ${front}
      <button class="btn btn--primary btn--block" data-reveal>Show the answer</button>
      <div class="ld-back" data-back hidden tabindex="-1">
        <p class="ld-name"><a href="#/bird/${sp.id}">${esc(sp.name)}</a></p>
        <p class="lq-sci">${esc(sp.sci)}${sp.kind !== 'bird' ? ` <span class="kindtag kind--${sp.kind}">${esc(KINDS[sp.kind].one)}</span>` : ''}</p>
        <ul class="ld-marks">${Q.fieldMarks(sp, 3).map(s => `<li>${esc(s)}</li>`).join('')}${cw && c.skill === 'call' ? `<li>Listen for "${esc(cw.words)}".</li>` : ''}</ul>
        ${mates[0] ? `<p class="lq-tell"><strong>Not to be confused with the ${esc(mates[0].name)}.</strong> ${esc(Q.tellFor(sp.id, mates[0].id))}</p>` : ''}
        <dl class="ld-facts">${peaks ? `<div><dt>Most reported</dt><dd>${esc(cap(peaks))}</dd></div>` : ''}<div><dt>Where</dt><dd>${esc(sp.habitats.map(h => HABITATS[h]).join(', ') || 'Not recorded')}</dd></div></dl>
        ${c.skill === 'call' ? photoHTML(photos, { alt: sp.name, cls: 'lq-photo lq-photo--answer' }) : ''}
        <div class="ld-grade" role="group" aria-label="How did you go?">
          <button class="btn" data-grade="missed">${I.cross}<span>Missed</span></button>
          <button class="btn" data-grade="unsure"><span>Unsure</span></button>
          <button class="btn btn--primary" data-grade="knew">${I.tick}<span>Knew it</span></button>
        </div>
      </div>
    </div></div>`;
  wireImages(view);
  focusHead(view, had);
  const nextC = game.queue[1] && byId.get(game.queue[1].id);
  if (nextC && game.queue[1].skill === 'look') preload({ photos: Q.photosFor(nextC.id) });
  view.onclick = e => {
    if (e.target.closest('[data-quit]')) { e.preventDefault(); cleanup(); game = null; renderDeck(ctx); return; }
    const play = e.target.closest('[data-play]');
    if (play) {
      const list = Q.callsOf(sp.id);
      return playCall(ctx, list[(Math.random() * list.length) | 0], play, view.querySelector('[data-status]'));
    }
    if (e.target.closest('[data-reveal]')) {
      const back = view.querySelector('[data-back]');
      back.hidden = false;
      e.target.closest('[data-reveal]').hidden = true;
      wireImages(back);
      back.focus({ preventScroll: true });
      requestAnimationFrame(() => back.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
      return;
    }
    const g = e.target.closest('[data-grade]');
    if (g) gradeCard(ctx, c, g.dataset.grade);
  };
  view.onchange = null;
}
function gradeCard(ctx, c, grade) {
  const cur = L.cards[c.id]?.[c.skill]?.box || 1;
  const box = grade === 'knew' ? Math.min(5, cur + 1) : grade === 'missed' ? 1 : cur;
  setCard(c.id, c.skill, box);
  saveL();
  const s = (ST[c.id] ||= { n: 0, right: 0, lastAt: 0 });
  s.n++; if (grade === 'knew') s.right++; s.lastAt = Date.now();
  saveST();
  game.tally[grade]++;
  game.queue.shift();
  // Box 1 is due again straight away: see it once or twice more this session.
  if (box === 1 && c.reps < 2) game.queue.push({ ...c, reps: c.reps + 1 }); else game.n++;
  if (game.queue.length) drawCard(ctx); else drawDeckDone(ctx);
}
function drawDeckDone(ctx) {
  const { view } = ctx;
  const had = focusWithin(view);
  cleanup();
  const t = game.tally || { knew: 0, unsure: 0, missed: 0 };
  view.innerHTML = `<div class="lr">
    <header class="page-head"><h1 class="lh-title" tabindex="-1">Deck reviewed</h1></header>
    <div class="lr-score" role="status"><b>${t.knew}</b><span>knew it</span></div>
    <p class="lr-note">${t.unsure ? `${t.unsure} unsure. ` : ''}${t.missed ? `${t.missed} missed, and they'll come back soon. ` : ''}Cards you knew come back in a few days.</p>
    <div class="lr-actions"><a class="btn btn--primary btn--block" href="#/learn">Back to Learn</a><button class="btn btn--block" data-deck>Deck overview</button></div>
  </div>`;
  focusHead(view, had);
  view.onclick = e => { if (e.target.closest('[data-deck]')) { game = null; renderDeck(ctx); } };
}
