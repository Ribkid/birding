import { SPECIES, GROUPS, HABITATS, RARITY, byId, KINDS, ANIMAL_KINDS, ANIMALS, BIRDS, ofKind, dexCode, kindsPresent, parseSize } from './species.js';
import { loadExtras, galleryFor, infoFor } from './gallery.js';
import { db } from './db.js';
import { loadIndex, cachedIndex, photoFor, sized, details, calls, audioUrl, downloadAll, onMediaReady, loadCallPack, localCalls, hasLocalCall, callPackStatus, saveCallPack } from './media.js';
import { speciesList, periodFilter, totals, yearTotals, targets, badges, inPatch, haversineKm, MONTHS, inSeason } from './stats.js';
import { toEbirdCsv } from './ebird.js';
import { loadSeq, seq, monthRates, likelihood, recordCount, spotsFor, pointsFor, hotspots, nearbyTargets } from './seqdata.js';
import { openCard, confetti, shareCard } from './card3d.js';
import { renderLearn, learnStats, learnReady, learnTeaser, masteryOf } from './learn.js';
import { tellFor, lookalikesOf, loadLookalikes, callWords, sentences, peaksOf } from './quiz.js';
import { renderStats } from './statsview.js';
import { renderScan } from './scan.js';
import { initLook, lookAfterDraw, applyTint, tintFrom, stagger } from './look.js';
import { describeArea } from './mapinfo.js';
import { initAccount, accountChip, renderAccountSection, renderLeaderboard, leaderboardLink } from './account.js';
import { vt, nameFor, flip, countUp, motionOK, settle, report } from './motion.js';
import { openLayer, closeLayer, closeAllLayers, onLayerKey, topLayer, layers, keepFocus } from './layers.js';

const relRate = (id, month) => { const m = monthRates(id); return m ? m.rel[month - 1] : null; };
const targetOpts = () => seq()?.hotspots?.length ? { score: likelihood, rel: relRate } : {};

// ---------- state ----------
const state = {
  sightings: [], outings: [], patches: [],
  settings: { colourUnseen: false, theme: 'auto' },
  activeOutingId: null,
  dex: { q: '', show: 'all', group: '', habitat: '', rarity: '', season: false, sort: 'dex', layout: 'grid' },
  listen: { hits: new Map() },
  installPrompt: null,
  listSort: 'dex',
};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dexNo = id => dexCode(id);
const kindOf = id => byId.get(id)?.kind || 'bird';
const kindTag = sp => sp.kind === 'bird' ? '' : `<span class="kindtag kind--${sp.kind}">${esc(KINDS[sp.kind].one)}</span>`;
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = d => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ---------- data ----------
async function loadData() {
  const [sightings, outings, patches, settings, active] = await Promise.all([
    db.all('sightings'), db.all('outings'), db.all('patches'), db.kvGet('settings'), db.kvGet('activeOuting'),
  ]);
  Object.assign(state, { sightings, outings, patches });
  if (settings) Object.assign(state.settings, settings);
  state.activeOutingId = active && outings.find(o => o.id === active && !o.endedAt) ? active : null;
}
const seenSet = () => new Set(state.sightings.map(s => s.speciesId));
const sightingsOf = id => state.sightings.filter(s => s.speciesId === id)
  .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
const activeOuting = () => state.outings.find(o => o.id === state.activeOutingId) || null;

// photos stored as blobs
const photoUrls = new Map();
async function photoUrl(id) {
  if (!id) return null;
  if (photoUrls.has(id)) return photoUrls.get(id);
  const rec = await db.get('photos', id);
  if (!rec?.blob) return null; // a synced photo still downloading
  const url = URL.createObjectURL(rec.blob);
  photoUrls.set(id, url);
  return url;
}
// Her own photos load only as they come near the screen, so a long log doesn't decode hundreds of full-size JPEGs.
const photoWatch = new Set();
const fillPhoto = async img => { const url = await photoUrl(Number(img.dataset.photo)); if (url && img.isConnected) img.src = url; };
const photoIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { photoIO.unobserve(e.target); photoWatch.delete(e.target); fillPhoto(e.target); }
}, { rootMargin: '400px 0px' }) : null;
function hydratePhotos(root = document) {
  for (const img of photoWatch) if (!img.isConnected) { photoIO.unobserve(img); photoWatch.delete(img); }
  for (const img of $$('img[data-photo]:not([src])', root)) {
    img.loading = 'lazy'; img.decoding = 'async';
    if (!photoIO) { fillPhoto(img); continue; }
    if (!photoWatch.has(img)) { photoWatch.add(img); photoIO.observe(img); }
  }
}
async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
  cx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}

// ---------- small UI pieces ----------
const band = (id, seen) => `<span class="band band--${kindOf(id)} ${seen ? 'band--on' : ''}" aria-label="Dex number ${dexNo(id)}">${dexNo(id)}</span>`;
const pips = r => `<span class="pips pips--${r}" title="${RARITY[r].label}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span>`;
// Photos fade in the first time they arrive. Ones already shown this session come back at full strength, so a
// redraw (a filter, a sync) doesn't make the whole grid blink.
const shown = new Set();
document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.classList.contains('fade')) shown.add(e.target.getAttribute('src')); }, true);
const fade = url => shown.has(url) ? 'fade in' : 'fade';
const ONLOAD = `onload="this.classList.add('in')"`;
// Images that were already complete when inserted (memory cache) show at once, with no fade.
function settleImages(root) {
  for (const img of $$('img.fade:not(.in)', root)) if (img.complete && img.naturalWidth) { img.classList.add('in'); shown.add(img.getAttribute('src')); }
}
// whole: show the entire photo (no cropping) over a soft blurred copy, for big views.
// alt: '' where the name is already written next to the photo (tiles, rows), so it isn't read twice.
// data-sp/data-size let a later photo index swap in a better picture without redrawing the page.
function birdImg(sp, size = 'small', cls = '', { whole = false, alt = sp.name } = {}) {
  const url = sized(sp.id, size);
  if (url && whole) return wholeImg(url, alt, cls);
  return url
    ? `<img class="${cls} ${fade(url)}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-sp="${sp.id}" data-size="${size}" ${ONLOAD} onerror="this.classList.add('img-missing')">`
    : `<span class="${cls} img-missing" ${alt ? `role="img" aria-label="${esc(alt)}"` : 'aria-hidden="true"'} data-sp="${sp.id}" data-size="${size}"></span>`;
}
// lazy: the picture waits in data-src until the page asks for it (gallery slides she hasn't swiped to yet).
const wholeImg = (url, alt, cls = '', { lazy = false } = {}) => {
  const src = lazy ? `data-src="${esc(url)}"` : `src="${esc(url)}"`, f = lazy ? 'fade' : fade(url);
  return `<span class="whole ${cls}"><img class="whole-bg ${f}" ${src} alt="" aria-hidden="true" loading="lazy" decoding="async" ${ONLOAD}><img class="whole-fg ${f}" ${src} alt="${esc(alt)}" loading="lazy" decoding="async" ${ONLOAD} onerror="this.closest('.whole').classList.add('img-missing')"></span>`;
};
// The first hero photo on a page (marked data-hero-frame) is the one thing worth fetching first.
function prioritiseHero(root) {
  for (const img of $$('[data-hero-frame] img', root)) { img.loading = 'eager'; img.fetchPriority = 'high'; }
}
// After the photo index arrives: swap better pictures into place instead of redrawing (a call keeps playing,
// the gallery keeps its slide).
function patchSpeciesImages(root = document) {
  for (const el of $$('[data-sp]', root)) {
    const sp = byId.get(Number(el.dataset.sp));
    const url = sp && sized(sp.id, el.dataset.size || 'small');
    if (!url) continue;
    if (el.tagName === 'IMG') {
      if (el.getAttribute('src') === url) continue;
      // A photo already on screen stays until its replacement is ready, so the tile never blanks.
      if (el.complete && el.naturalWidth) {
        const next = new Image(); next.src = url;
        next.decode().then(() => { if (el.isConnected) { shown.add(url); el.src = url; } }, () => {});
      } else { el.classList.remove('img-missing'); el.src = url; }
    }
    else el.outerHTML = birdImg(sp, el.dataset.size || 'small', [...el.classList].filter(c => c !== 'img-missing').join(' '));
  }
}
const icon = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor"><path d="M12 6V2.6M16.2 7.8l2.4-2.4M18 12h3.4M16.2 16.2l2.4 2.4M12 18v3.4M7.8 16.2l-2.4 2.4M6 12H2.6M7.8 7.8L5.4 5.4" stroke-width="3.4"/><circle cx="12" cy="12" r="6.6" stroke-width="2.2"/><circle cx="12" cy="12" r="2.4" stroke-width="2"/></g></svg>',
  install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5zM13.5 7.3l3.2 3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5h6v2.5H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 12l1.8 1.8 3.4-3.4M8.5 17h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  outing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.4-6-10.2a6 6 0 0 1 12 0C18 15.6 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.6 10.6l1.7 1.7 3.2-3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.8V15M12 18.5v.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  learn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// Screen readers hear status through one live region that is always in the page (a region created together with
// its text is often missed). Clearing it first lets the same message be announced twice.
let announceT = 0;
function announce(msg) {
  const el = document.getElementById('announce');
  if (!el) return;
  clearTimeout(announceT);
  el.textContent = '';
  announceT = setTimeout(() => { el.textContent = msg; }, 60);
}
// One toast at a time, about 4.5 s, tap to dismiss. It is announced through the live region, not read twice.
let toastEl = null, toastT = 0;
function toast(msg) {
  announce(msg);
  clearTimeout(toastT);
  toastEl?.remove();
  const t = toastEl = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.setAttribute('aria-hidden', 'true');
  const hide = () => {
    if (t.classList.contains('toast--out')) return;
    t.classList.add('toast--out');
    if (toastEl === t) toastEl = null;
    setTimeout(() => t.remove(), 260);
  };
  t.addEventListener('click', hide);
  document.body.append(t);
  toastT = setTimeout(hide, 4500);
}

// ---------- sheets ----------
// A sheet is a layer (js/layers.js). It slides up, and on a user dismiss (scrim, Cancel, Escape, drag) slides back
// down before it is removed. Replacing it with another sheet, or a route change, removes it at once.
// modal: false is for the patch sheet over the map, which leaves the map usable.
const openSheetLayer = () => layers().reverse().find(l => l.kind === 'sheet') || null;
const sheetOpen = () => !!$('.sheet-wrap:not([data-closing])');
function openSheet(html, { onOpen, wide, modal = true, cls = '' } = {}) {
  const prev = openSheetLayer();
  const returnTo = prev ? prev.returnTo : document.activeElement;
  if (prev) closeSheet({ reason: 'replace' });
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${cls} ${prev ? 'sheet-wrap--swap' : ''}`;
  wrap.innerHTML = `<div class="sheet-scrim" data-close></div>
    <div class="sheet ${wide ? 'sheet--wide' : ''}" role="dialog">
      <div class="sheet-grip" aria-hidden="true"></div>${html}</div>`;
  document.body.append(wrap);
  const sheet = $('.sheet', wrap);
  const layer = openLayer(wrap, { dialog: sheet, modal, lock: true, returnTo, close: reason => closeSheet({ reason }) });
  layer.kind = 'sheet';
  // @starting-style gives the entry slide; older browsers get it from the class arriving a frame later.
  if (window.CSSStartingStyleRule) wrap.classList.add('open');
  else requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  wrap.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) closeSheet({ reason: c.matches('.sheet-scrim') ? 'scrim' : 'button' });
  });
  wireSheetDrag(wrap, sheet);
  const first = $('input:not([type=hidden]):not([type=file]), select, textarea, button, a[href]', sheet);
  onOpen?.(sheet);
  if (first && !first.matches('[data-noautofocus]')) setTimeout(() => { if (!wrap.hasAttribute('data-closing')) first.focus({ preventScroll: true }); }, 50);
  return sheet;
}
function closeSheet({ reason = 'button' } = {}) {
  const layer = openSheetLayer();
  if (!layer) return;
  const w = layer.el, instant = reason === 'replace' || reason === 'nav';
  const done = state.onSheetClose; state.onSheetClose = null;
  w.setAttribute('data-closing', ''); w.inert = true;
  closeLayer(layer, { restore: !instant });
  done?.();
  if (instant) w.remove(); else exitSheet(w, reason);
}
function exitSheet(w, reason) {
  const sheet = $('.sheet', w), scrim = $('.sheet-scrim', w);
  // Hand over from wherever a drag left the sheet to the CSS exit (under reduced motion it fades where it is).
  sheet.style.transition = ''; scrim.style.opacity = '';
  if (motionOK() || reason !== 'drag') sheet.style.transform = '';
  getComputedStyle(sheet).transform;
  const anims = w.getAnimations({ subtree: true });
  Promise.race([Promise.allSettled(anims.map(a => a.finished)), new Promise(r => setTimeout(r, 450))]).then(() => w.remove());
}
// A route change doesn't wait for a sheet that is still sliding away.
const flushClosingSheets = () => $$('.sheet-wrap[data-closing]').forEach(w => w.remove());

// Drag a sheet down to dismiss it: from the grip and the top 56px, or from anywhere once it is scrolled to the top.
// It follows the finger 1:1, resists upward, and closes past 30% of its height or on a quick flick.
function wireSheetDrag(wrap, sheet) {
  const scrim = $('.sheet-scrim', wrap);
  const rubber = d => 56 * (1 - 1 / (d / 140 + 1));
  let g = null;
  // Moves are followed on the window, so a mouse that leaves the sheet (dragging up past its top) still counts.
  const move = e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.on) {
      if (Math.hypot(dx, dy) < 8) return;
      // Sideways is a chip row scrolling; upward in the body is ordinary scrolling.
      if (Math.abs(dx) > Math.abs(dy) || (!g.handle && (dy < 0 || sheet.scrollTop > 0))) { stop(); return; }
      g.on = true;
      sheet.style.transition = 'none';
      wrap.classList.add('sheet-wrap--drag');
    }
    g.dy = dy;
    sheet.style.transform = `translateY(${dy >= 0 ? dy : -rubber(-dy)}px)`;
    scrim.style.opacity = String(1 - Math.min(1, Math.max(0, dy) / g.h) * 0.8);
    g.pts.push([e.timeStamp, e.clientY]);
    if (g.pts.length > 8) g.pts.shift();
  };
  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const s = g;
    stop();
    if (!s.on) return;
    // The tap that ends a drag is not a click on whatever is under the finger.
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    wrap.classList.remove('sheet-wrap--drag');
    const [t0, y0] = s.pts.find(([t]) => e.timeStamp - t <= 100) || s.pts[0];
    const v = (e.clientY - y0) / Math.max(1, e.timeStamp - t0);
    if (e.type === 'pointerup' && (s.dy > s.h * 0.3 || v > 0.5)) { closeSheet({ reason: 'drag' }); return; }
    sheet.style.transition = motionOK() ? 'transform var(--dur-3) var(--ease-spring)' : 'none';
    sheet.style.transform = ''; scrim.style.opacity = '';
    setTimeout(() => { if (!g) sheet.style.transition = ''; }, 400);
  };
  const stop = () => {
    g = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  sheet.addEventListener('pointerdown', e => {
    if (g || e.button > 0 || wrap.hasAttribute('data-closing')) return;
    if (e.target.closest('input, textarea, select, [contenteditable], .leaflet-container')) return;
    const r = sheet.getBoundingClientRect();
    const handle = e.clientY - r.top < 56;
    if (!handle && sheet.scrollTop > 0) return;
    // A list scrolled inside the sheet (the avatar picker) scrolls back up rather than dragging the sheet away.
    for (let n = e.target; n && n !== sheet; n = n.parentElement) if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, h: r.height, handle, on: false, dy: 0, pts: [[e.timeStamp, e.clientY]] };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  // On touch, once the sheet is being dragged the page must not scroll or pull to refresh underneath.
  sheet.addEventListener('touchmove', e => { if (g?.on && e.cancelable) e.preventDefault(); }, { passive: false });
}

// Resolves true for the confirm button, false for Cancel or any other way of closing.
function confirmSheet(title, body, okLabel, danger = false) {
  return new Promise(resolve => {
    const s = openSheet(`<h2 class="sheet-title">${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row-end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(okLabel)}</button></div>`);
    s.addEventListener('click', e => {
      const yes = e.target.closest('[data-yes]');
      if (!yes && !e.target.closest('[data-no]')) return;
      // Answer first: closing fires onSheetClose, which would otherwise answer false before the true got through.
      state.onSheetClose = null;
      resolve(!!yes);
      closeSheet();
    });
    state.onSheetClose = () => resolve(false);
  });
}

// ---------- geolocation ----------
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share location'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? 'Location permission was denied. Allow it in your browser settings.' : 'Could not get your location. Try again outside or near a window.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
function nearestPlaceName(pos) {
  const p = state.patches.find(pt => inPatch(pos, pt));
  if (p) return p.name;
  const near = state.sightings.filter(s => s.lat != null && s.place && haversineKm(s, pos) < 0.4)
    .sort((a, b) => haversineKm(a, pos) - haversineKm(b, pos))[0];
  return near?.place || '';
}
async function reverseGeocode(pos) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${pos.lat}&lon=${pos.lng}`, { headers: { 'Accept-Language': 'en-AU' } });
    const j = await r.json();
    const a = j.address || {};
    const local = j.name || a.park || a.nature_reserve || a.road;
    const area = a.suburb || a.town || a.village || a.city;
    return [local, area].filter(Boolean).join(', ');
  } catch (_) { return ''; }
}
// Places: hotspots, patches and places from past sightings, plus an address search (OpenStreetMap).
function myPlaces() {
  const m = new Map();
  for (const s of state.sightings) if (s.lat != null && s.place && !m.has(s.place)) m.set(s.place, { name: s.place, lat: s.lat, lng: s.lng, kind: 'Your place' });
  for (const o of state.outings) if (o.lat != null && o.place && !m.has(o.place)) m.set(o.place, { name: o.place, lat: o.lat, lng: o.lng, kind: 'Your place' });
  return [...m.values()];
}
function localPlaceMatches(q, limit = 8) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = t => words.every(w => t.toLowerCase().includes(w));
  return [
    ...state.patches.filter(p => hit(p.name)).map(p => ({ name: p.name, lat: p.lat, lng: p.lng, kind: 'Your patch' })),
    ...myPlaces().filter(p => hit(p.name)),
    ...hotspots().filter(h => hit(h.name)).map(h => ({ name: h.name, lat: h.lat, lng: h.lng, kind: `Hotspot, ${h.rich} birds` })),
  ].slice(0, limit);
}
let lastGeocode = 0;
async function searchAddress(q) {
  // OpenStreetMap's Nominatim asks for at most one search a second.
  const wait = 1100 - (Date.now() - lastGeocode);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeocode = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=151.6,-25.6,153.7,-28.5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'en-AU' } });
  if (!r.ok) throw new Error('Place search is busy. Try again in a moment.');
  return (await r.json()).map(x => ({
    name: x.name || x.display_name.split(',')[0],
    lat: Number(x.lat), lng: Number(x.lon),
    kind: x.display_name.split(',').slice(1, 3).join(',').trim() || 'Place',
  }));
}
const placeRow = (p, i) => `<li><button type="button" class="row" data-placeidx="${i}"><span class="row-main"><strong>${esc(p.name)}</strong><span class="small muted">${esc(p.kind)}</span></span></button></li>`;

// Full-screen map to pick a spot by searching or moving the map. Resolves {lat, lng, place} or null.
function openLocationPicker(init = {}) {
  return new Promise(async resolve => {
    const ov = document.createElement('div');
    ov.className = 'locpick';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Choose a place');
    ov.innerHTML = `
      <div class="locpick-top">
        <div class="search-bar search-bar--map">${icon.search}<input type="search" placeholder="Search a park, suburb, address or hotspot" aria-label="Search for a place" autocomplete="off" data-lq>
          <button type="button" class="iconbtn" data-lclose aria-label="Cancel">${icon.close}</button></div>
        <ul class="rows locpick-res hidden" data-lres></ul>
      </div>
      <div class="locpick-mapwrap"><div class="locpick-map" data-lmap></div><div class="locpick-pin" aria-hidden="true">${icon.pin}</div></div>
      <div class="locpick-bottom">
        <p class="small muted">Move the map so the pin sits on the spot, or search above.</p>
        <label class="field"><span>Place name</span><input data-lname value="${esc(init.place || '')}" placeholder="e.g. Oxley Creek Common" autocomplete="off"></label>
        <div class="row-end"><button type="button" class="btn" data-lclose>Cancel</button><button type="button" class="btn btn--primary" data-luse>Use this place</button></div>
      </div>`;
    document.body.append(ov);
    let map, closed = false;
    const close = (val, reason) => {
      if (closed) return;
      closed = true; map?.remove(); ov.remove(); closeLayer(layer, { restore: reason !== 'nav' }); resolve(val);
    };
    // Escape closes only this picker; the sighting sheet underneath stays as it was.
    const layer = openLayer(ov, { label: 'Choose a place', close: reason => close(null, reason) });
    ov.focus({ preventScroll: true });
    try { await loadLeaflet(); } catch (_) { toast('The map needs an internet connection the first time.'); close(null); return; }
    if (closed) return;
    const L = window.L;
    const start = init.lat != null ? [init.lat, init.lng] : state.lastPos ? [state.lastPos.lat, state.lastPos.lng] : [-27.47, 153.02];
    map = L.map($('[data-lmap]', ov), { zoomControl: false }).setView(start, init.lat != null || state.lastPos ? 15 : 10);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    $('.locpick-mapwrap', ov).append(baseLayers(map, L));
    setTimeout(() => map.invalidateSize(), 50);
    const q = $('[data-lq]', ov), res = $('[data-lres]', ov), name = $('[data-lname]', ov);
    let found = [], timer = null, nameTouched = !!init.place;
    name.addEventListener('input', () => { nameTouched = true; });
    const show = (list, more = '') => {
      found = list;
      res.innerHTML = list.map(placeRow).join('') + more;
      res.classList.toggle('hidden', !list.length && !more);
    };
    const run = async () => {
      const text = q.value.trim();
      const local = localPlaceMatches(text);
      if (text.length < 3) { show(local); return; }
      show(local, '<li class="small muted pad">Searching places…</li>');
      try {
        const remote = await searchAddress(text);
        if (q.value.trim() !== text) return;
        show([...local, ...remote], remote.length || local.length ? '' : '<li class="small muted pad">No places found. Try a suburb or park name.</li>');
      } catch (err) { show(local, `<li class="small muted pad">${esc(err.message)}</li>`); }
    };
    q.addEventListener('input', () => { clearTimeout(timer); show(localPlaceMatches(q.value.trim())); timer = setTimeout(run, 700); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } });
    ov.addEventListener('click', async e => {
      const b = e.target.closest('[data-placeidx]');
      if (b) {
        const p = found[Number(b.dataset.placeidx)];
        map.setView([p.lat, p.lng], 16);
        name.value = p.name; nameTouched = true;
        res.classList.add('hidden'); q.blur();
      }
      if (e.target.closest('[data-lclose]')) close(null);
      if (e.target.closest('[data-luse]')) {
        const c = map.getCenter();
        let place = name.value.trim();
        if (!place || !nameTouched) place = nearestPlaceName({ lat: c.lat, lng: c.lng }) || await reverseGeocode({ lat: c.lat, lng: c.lng }) || place;
        close({ lat: c.lat, lng: c.lng, place });
      }
    });
    // On a phone the main path is dragging the map, so don't pop the keyboard over it.
    if (!matchMedia('(pointer: coarse)').matches && (document.activeElement === ov || document.activeElement === document.body)) q.focus();
  });
}

const recentPlaces = () => [...new Set(state.sightings.slice().sort((a, b) => b.createdAt - a.createdAt).map(s => s.place).filter(Boolean))].slice(0, 6);

// ---------- saving sightings ----------
async function saveSighting(rec) {
  const before = seenSet();
  const badgesBefore = new Set(badges(state.sightings, state.outings).filter(b => b.done).map(b => b.id));
  if (rec.id) {
    await db.put('sightings', rec);
    state.sightings = state.sightings.map(s => s.id === rec.id ? rec : s);
  } else {
    rec.createdAt = Date.now();
    rec.id = await db.add('sightings', rec);
    state.sightings.push(rec);
  }
  navigator.storage?.persist?.();
  const newBadges = badges(state.sightings, state.outings).filter(b => b.done && !badgesBefore.has(b.id));
  state.lastSaveNew = !before.has(rec.speciesId);
  if (state.lastSaveNew) celebrate(byId.get(rec.speciesId), newBadges);
  else if (newBadges.length) toast(`Badge earned: ${newBadges.map(b => b.name).join(', ')}`);
  return rec;
}
async function deleteSighting(id) {
  const s = state.sightings.find(x => x.id === id);
  if (s?.photoId) await db.del('photos', s.photoId);
  await db.del('sightings', id);
  state.sightings = state.sightings.filter(x => x.id !== id);
}

// New for the dex: a dialog with the photo settling in, the band clamping on and the count stamping up by one.
function celebrate(sp, newBadges) {
  navigator.vibrate?.([60, 40, 120]);
  confetti();
  const hist = sightingsOf(sp.id);
  const first = hist[hist.length - 1];
  const seen = seenSet();
  const ofIt = ofKind(sp.kind), got = ofIt.filter(x => seen.has(x.id)).length;
  const animalsGot = ANIMALS.filter(x => seen.has(x.id)).length;
  const verb = sp.kind === 'plant' ? 'found' : 'seen';
  // The overall animal tally only adds something once the dex holds more than birds.
  const total = sp.kind !== 'plant' && ANIMALS.length > ofIt.length;
  const id = `cel-${sp.id}-${Date.now()}`;
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `<div class="celebrate-card">
    <div class="celebrate-photo">${birdImg(sp, 'large', '', { whole: true })}<span class="band band--${sp.kind} band--on band--big band--clamp">${dexNo(sp.id)}</span></div>
    <p class="celebrate-kicker" id="${id}-k">New for your dex</p>
    <h2 id="${id}-h">${esc(sp.name)}</h2>
    <p class="celebrate-count"><b class="celebrate-n" data-count>${got}</b> of ${ofIt.length} ${KINDS[sp.kind].label.toLowerCase()} ${verb}</p>
    ${total ? `<p class="celebrate-total small muted"><span data-count-all>${animalsGot}</span> of ${ANIMALS.length} animals in your dex</p>` : ''}
    ${newBadges.length ? `<p class="celebrate-badges">Badge earned: ${newBadges.map(b => `<strong>${esc(b.name)}</strong>`).join(', ')}</p>` : ''}
    <div class="row-center"><button class="btn" data-share>${icon.share} Share</button><button class="btn" data-card>See card</button><button class="btn btn--primary" data-dismiss>Nice</button></div></div>`;
  document.body.append(el);
  settleImages(el);
  // While the large photo loads, show the small one she has just seen in the dex.
  const small = sized(sp.id, 'small'), frame = $('.celebrate-photo .whole', el);
  if (frame && small && shown.has(small)) frame.style.backgroundImage = `url("${small.replace(/"/g, '%22')}")`;
  let layer;
  const done = (reason, then) => {
    if (!closeLayer(layer, { restore: !then && reason !== 'nav' })) return;
    if (reason === 'nav') { el.remove(); return; }
    el.classList.add('celebrate--out');
    setTimeout(() => el.remove(), 220);
    then?.();
  };
  layer = openLayer(el, { dialog: $('.celebrate-card', el), labelledBy: `${id}-k ${id}-h`, close: reason => done(reason) });
  const info = { seen: true, isNew: true, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-share]')) { shareCard(sp, info); return; }
    if (e.target.closest('[data-card]')) { const back = layer.returnTo; done('button', () => openCard(sp, info, { returnTo: back })); return; }
    if (e.target.closest('[data-dismiss]') || e.target === el) done('button');
  });
  $('[data-dismiss]', el).focus({ preventScroll: true });
  // Count lands after the card has popped in.
  countUp($('[data-count]', el), got - 1, got, { delay: 380 });
  if (total) countUp($('[data-count-all]', el), animalsGot - 1, animalsGot, { delay: 520 });
}

// ---------- sighting sheet ----------
function speciesPicker(selectedId) {
  const sp = selectedId ? byId.get(selectedId) : null;
  return `<div class="picker" data-picker>
    <input type="hidden" name="speciesId" value="${sp ? sp.id : ''}">
    <div class="picker-chosen ${sp ? '' : 'hidden'}">${sp ? pickerChosen(sp) : ''}</div>
    <div class="picker-search ${sp ? 'hidden' : ''}">
      <label class="field"><span>What did you see?</span><input type="search" placeholder="Type a name, e.g. kookaburra" autocomplete="off" data-picker-q></label>
      <ul class="picker-results" data-picker-results></ul>
    </div></div>`;
}
const pickerChosen = sp => `<div class="chosen">${birdImg(sp, 'small', 'chosen-img')}<div><strong>${esc(sp.name)}</strong><em>${esc(sp.sci)}</em></div><button type="button" class="btn btn--small" data-picker-change>Change</button></div>`;
function matchSpecies(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  return SPECIES.map(s => {
    const hay = `${s.name} ${s.sci} ${dexNo(s.id)}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
    const score = s.name.toLowerCase().startsWith(q) ? 0 : hay.includes(' ' + q) ? 1 : 2;
    return { s, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.s.id - b.s.id).slice(0, limit).map(x => x.s);
}
function wirePicker(root, onPick) {
  const p = $('[data-picker]', root);
  const q = $('[data-picker-q]', p), res = $('[data-picker-results]', p);
  const seen = seenSet();
  q?.addEventListener('input', () => {
    res.innerHTML = matchSpecies(q.value).map(s => `<li><button type="button" data-pick="${s.id}">${band(s.id, seen.has(s.id))}<span>${esc(s.name)}</span></button></li>`).join('')
      || (q.value.trim() ? '<li class="muted pad">Nothing by that name in the dex.</li>' : '');
  });
  p.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const sp = byId.get(Number(pick.dataset.pick));
      $('input[name=speciesId]', p).value = sp.id;
      $('.picker-chosen', p).innerHTML = pickerChosen(sp);
      $('.picker-chosen', p).classList.remove('hidden');
      $('.picker-search', p).classList.add('hidden');
      onPick?.(sp);
    }
    if (e.target.closest('[data-picker-change]')) {
      $('.picker-chosen', p).classList.add('hidden');
      $('.picker-search', p).classList.remove('hidden');
      q.value = ''; res.innerHTML = ''; q.focus();
    }
  });
}

// The notes prompt and 'Heard only' follow the kind she picked (plants can't be heard).
const NOTES_HINT = { bird: 'Behaviour, plumage, who you were with…', mammal: 'Behaviour, tracks, who you were with…', reptile: 'Basking, size, behaviour…',
  frog: 'Calling, weather, where it was…', butterfly: 'Feeding on, markings, behaviour…', plant: 'Flowering, fruit, where it grows…' };
const notesHint = kind => NOTES_HINT[kind] || 'What it was doing, who you were with…';
function fitSheetToKind(sheet, kind) {
  const heard = $('[data-heard]', sheet);
  if (heard) { heard.classList.toggle('hidden', kind === 'plant'); if (kind === 'plant') $('input', heard).checked = false; }
  const notes = $('textarea[name=notes]', sheet);
  if (notes) notes.placeholder = notesHint(kind);
}

async function openSightingSheet({ speciesId = null, sightingId = null, autoGps = false, photoBlob = null, notes = '' } = {}) {
  const existing = sightingId ? state.sightings.find(s => s.id === sightingId) : null;
  const rec = existing ? { ...existing } : {
    speciesId, count: 1, heard: false, date: todayStr(), time: timeStr(),
    lat: null, lng: null, acc: null, place: '', notes, photoId: null, outingId: null,
  };
  const outing = !existing && activeOuting();
  let newPhoto = photoBlob || null, removePhoto = false;
  const existingPhoto = rec.photoId ? await photoUrl(rec.photoId) : null;
  const sheet = openSheet(`
    <h2 class="sheet-title">${existing ? 'Edit sighting' : 'Log a sighting'}</h2>
    <form class="form" data-form novalidate>
      ${speciesPicker(rec.speciesId)}
      <div class="grid2">
        <label class="field"><span>How many</span>
          <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer">−</button>
          <input name="count" inputmode="numeric" pattern="[0-9]*" value="${rec.count ?? ''}" placeholder="?" aria-label="Count">
          <button type="button" data-step="1" aria-label="One more">+</button></div></label>
        <label class="check ${rec.speciesId && kindOf(rec.speciesId) === 'plant' ? 'hidden' : ''}" data-heard><input type="checkbox" name="heard" ${rec.heard ? 'checked' : ''}><span>Heard only</span></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${rec.date}" max="${todayStr()}"></label>
        <label class="field"><span>Time</span><input type="time" name="time" value="${rec.time || ''}"></label>
      </div>
      ${outing ? `<label class="check check--card"><input type="checkbox" name="toOuting" checked><span>Add to current outing at ${esc(outing.place || 'this spot')}</span></label>` : ''}
      <fieldset class="loc" ${outing ? 'data-outing-hides' : ''}>
        <legend>Where</legend>
        <div class="loc-row"><button type="button" class="btn" data-gps>${icon.pin} Use my location</button><button type="button" class="btn" data-pickmap>${icon.search} Choose on map</button></div>
        <span class="muted small" data-gps-status>${rec.lat != null ? `${rec.lat.toFixed(4)}, ${rec.lng.toFixed(4)}` : 'No location yet'}</span>
        <label class="field"><span>Place name</span><input name="place" value="${esc(rec.place)}" placeholder="e.g. Oxley Creek Common" autocomplete="off"></label>
        <div class="chips chips--scroll" data-recent>${recentPlaces().map(p => `<button type="button" class="chip" data-place="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </fieldset>
      <div class="photo-field">
        <div class="photo-preview" data-photo-preview>${existingPhoto ? `<img src="${existingPhoto}" alt="Your photo">` : ''}</div>
        <label class="btn">${icon.cam} <span data-photo-label>${existingPhoto ? 'Replace photo' : 'Add photo'}</span><input type="file" accept="image/*" data-photo-input hidden></label>
        <button type="button" class="btn btn--quiet ${existingPhoto ? '' : 'hidden'}" data-photo-remove>Remove</button>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="${notesHint(rec.speciesId && kindOf(rec.speciesId))}">${esc(rec.notes)}</textarea></label>
      <p class="form-error" data-error role="alert"></p>
      <div class="row-end">
        ${existing ? '<button type="button" class="btn btn--danger btn--quiet" data-delete>Delete</button><span class="spacer"></span>' : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${existing ? 'Save changes' : 'Save sighting'}</button>
      </div>
    </form>`, { onOpen: s => wirePicker(s, sp => fitSheetToKind(s, sp.kind)) });
  const form = $('[data-form]', sheet);
  const status = $('[data-gps-status]', sheet);
  const toOuting = $('[name=toOuting]', form);
  const locSet = $('.loc', form);
  const syncOuting = () => locSet.classList.toggle('hidden', !!toOuting?.checked);
  toOuting?.addEventListener('change', syncOuting); syncOuting();
  if (photoBlob) {
    $('[data-photo-preview]', sheet).innerHTML = `<img src="${URL.createObjectURL(photoBlob)}" alt="Your photo">`;
    $('[data-photo-label]', sheet).textContent = 'Replace photo';
    $('[data-photo-remove]', sheet).classList.remove('hidden');
  }
  if (autoGps && !outing) setTimeout(() => $('[data-gps]', sheet)?.click(), 0);

  sheet.addEventListener('click', async e => {
    const step = e.target.closest('[data-step]');
    if (step) { const inp = form.count; inp.value = Math.max(1, (Number(inp.value) || 0) + Number(step.dataset.step)); }
    const pl = e.target.closest('[data-place]');
    if (pl) {
      form.place.value = pl.dataset.place;
      const known = [...state.patches, ...myPlaces()].find(p => p.name === pl.dataset.place);
      if (known) { Object.assign(rec, { lat: known.lat, lng: known.lng, acc: null }); status.textContent = `${known.lat.toFixed(4)}, ${known.lng.toFixed(4)}`; }
    }
    if (e.target.closest('[data-pickmap]')) {
      const r = await openLocationPicker({ lat: rec.lat, lng: rec.lng, place: form.place.value });
      if (r) { Object.assign(rec, { lat: r.lat, lng: r.lng, acc: null }); status.textContent = `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`; form.place.value = r.place || form.place.value; }
    }
    if (e.target.closest('[data-gps]')) {
      status.textContent = 'Finding you…';
      try {
        const pos = await getPosition();
        Object.assign(rec, pos);
        status.textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`;
        if (!form.place.value) {
          form.place.value = nearestPlaceName(pos) || await reverseGeocode(pos);
        }
      } catch (err) { status.textContent = err.message; }
    }
    if (e.target.closest('[data-photo-remove]')) {
      newPhoto = null; removePhoto = true;
      $('[data-photo-preview]', sheet).innerHTML = '';
      $('[data-photo-label]', sheet).textContent = 'Add photo';
      e.target.closest('[data-photo-remove]').classList.add('hidden');
    }
    if (e.target.closest('[data-delete]')) {
      if (await confirmSheet('Delete this sighting?', 'It will be removed from your lists. This cannot be undone.', 'Delete', true)) {
        await deleteSighting(existing.id); toast('Sighting deleted'); render();
      }
    }
  });
  $('[data-photo-input]', sheet).addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    newPhoto = await resizeImage(f); removePhoto = false;
    $('[data-photo-preview]', sheet).innerHTML = `<img src="${URL.createObjectURL(newPhoto)}" alt="Your photo">`;
    $('[data-photo-label]', sheet).textContent = 'Replace photo';
    $('[data-photo-remove]', sheet).classList.remove('hidden');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const id = Number(form.speciesId.value);
    if (!id) { $('[data-error]', form).textContent = 'Choose what you saw.'; return; }
    if (!form.date.value) { $('[data-error]', form).textContent = 'Add the date of the sighting.'; return; }
    rec.speciesId = id;
    rec.count = form.count.value ? Math.max(1, parseInt(form.count.value, 10) || 1) : null;
    rec.heard = kindOf(id) !== 'plant' && form.heard.checked;
    rec.date = form.date.value; rec.time = form.time.value;
    rec.place = form.place.value.trim();
    rec.notes = form.notes.value.trim();
    if (toOuting?.checked) {
      rec.outingId = outing.id;
      Object.assign(rec, { lat: outing.lat, lng: outing.lng, place: outing.place });
    }
    if (removePhoto && rec.photoId) { await db.del('photos', rec.photoId); rec.photoId = null; }
    if (newPhoto) {
      if (rec.photoId) await db.del('photos', rec.photoId);
      rec.photoId = await db.add('photos', { blob: newPhoto, at: Date.now() });
    }
    closeSheet();
    await saveSighting(rec);
    if (existing) toast('Changes saved'); else if (!state.lastSaveNew) toast(`${byId.get(id).name} saved`);
    render();
  });
}

// ---------- outings (checklists) ----------
function openPlusSheet() {
  const o = activeOuting();
  const ones = (photoKinds || []).map(k => KINDS[k].one);
  const s = openSheet(`<h2 class="sheet-title">Add a sighting</h2>
    <div class="plus-options">
      <button class="plus-opt plus-opt--main" data-one>${icon.pencil}<strong>Log one sighting</strong><span>A single sighting with photo, place and notes.</span></button>
      ${o ? `<button class="plus-opt" data-resume>${icon.outing}<strong>Back to your outing</strong><span>${esc(o.place || 'Current outing')}, started ${o.time}</span></button>`
          : `<button class="plus-opt" data-outing>${icon.clipboard}<strong>Start or add an outing</strong><span>Tally everything at one place, like an eBird checklist. Works for earlier outings too.</span></button>`}
      <div class="plus-id">
        <a class="plus-opt plus-opt--id" href="#/listen" data-close>${icon.mic}<strong>Listen</strong><span>Name birds by their calls</span></a>
        <a class="plus-opt plus-opt--id" href="#/scan" data-close>${icon.scan}<strong>Scan a photo</strong><span>${ones.length ? `Name ${article(ones[0])} ${esc(listWords(ones, 'or'))} from a photo` : 'Name what you photographed'}</span></a>
      </div>
    </div>`);
  s.addEventListener('click', e => {
    if (e.target.closest('[data-one]')) openSightingSheet();
    if (e.target.closest('[data-outing]')) openStartOuting();
    if (e.target.closest('[data-resume]')) { closeSheet(); location.hash = `#/outing/${o.id}`; }
  });
}
function openStartOuting() {
  const pos = {};
  const now = new Date();
  const s = openSheet(`<h2 class="sheet-title">Start or add an outing</h2>
    <form class="form" data-form novalidate>
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr(now)}" max="${todayStr(now)}"></label>
        <label class="field"><span>Start time</span><input type="time" name="time" value="${timeStr(now)}"></label>
      </div>
      <p class="small muted">For an outing earlier today or on another day, change the date and start time.</p>
      <fieldset class="loc"><legend>Where</legend>
        <div class="loc-row"><button type="button" class="btn" data-gps>${icon.pin} Use my location</button><button type="button" class="btn" data-pickmap>${icon.search} Choose on map</button></div>
        <span class="muted small" data-gps-status>No location yet</span>
        <label class="field"><span>Place name</span><input name="place" placeholder="e.g. Sandy Camp Road Wetlands" autocomplete="off"></label>
        <div class="chips chips--scroll">${[...new Set([...state.patches.map(p => p.name), ...recentPlaces()])].slice(0, 8).map(p => `<button type="button" class="chip" data-place="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </fieldset>
      <p class="form-error" data-error role="alert"></p>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn--primary" data-go>Start outing</button></div>
    </form>`);
  const form = $('[data-form]', s), status = $('[data-gps-status]', s);
  const isPast = () => {
    const t = new Date(`${form.date.value}T${form.time.value || '00:00'}`).getTime();
    return Date.now() - t > 20 * 60 * 1000;
  };
  const syncLabel = () => { $('[data-go]', s).textContent = isPast() ? 'Add outing' : 'Start outing'; };
  form.date.addEventListener('change', syncLabel); form.time.addEventListener('change', syncLabel);
  const locate = async () => {
    status.textContent = 'Finding you…';
    try {
      Object.assign(pos, await getPosition());
      status.textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`;
      if (!form.place.value) form.place.value = nearestPlaceName(pos) || await reverseGeocode(pos);
    } catch (err) { status.textContent = err.message; }
  };
  s.addEventListener('click', async e => {
    if (e.target.closest('[data-gps]')) locate();
    if (e.target.closest('[data-pickmap]')) {
      const r = await openLocationPicker({ lat: pos.lat, lng: pos.lng, place: form.place.value });
      if (r) { Object.assign(pos, { lat: r.lat, lng: r.lng }); status.textContent = `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`; form.place.value = r.place || form.place.value; }
    }
    const pl = e.target.closest('[data-place]');
    if (pl) {
      form.place.value = pl.dataset.place;
      const known = [...state.patches, ...myPlaces()].find(p => p.name === pl.dataset.place);
      if (known) { Object.assign(pos, { lat: known.lat, lng: known.lng }); status.textContent = `${known.lat.toFixed(4)}, ${known.lng.toFixed(4)}`; }
    }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('[data-error]', form);
    const startAt = new Date(`${form.date.value}T${form.time.value || '00:00'}`);
    if (!form.date.value || isNaN(startAt)) { err.textContent = 'Add the date of the outing.'; return; }
    if (startAt.getTime() > Date.now() + 5 * 60 * 1000) { err.textContent = 'The start time is in the future. Pick a time that has already happened.'; return; }
    const past = isPast();
    const o = { date: form.date.value, time: form.time.value || '00:00', startedAt: startAt.getTime(), past, place: form.place.value.trim(),
      lat: pos.lat ?? null, lng: pos.lng ?? null, endedAt: null, complete: false, distanceKm: null, durationMin: null, notes: '' };
    o.id = await db.add('outings', o);
    state.outings.push(o);
    state.activeOutingId = o.id;
    await db.kvSet('activeOuting', o.id);
    closeSheet();
    if (past) toast('Outing added. Tally what you saw, then tap Finish.');
    location.hash = `#/outing/${o.id}`;
  });
}
async function tally(outing, speciesId, delta) {
  const rec = state.sightings.find(s => s.outingId === outing.id && s.speciesId === speciesId);
  if (rec) {
    const next = (rec.count || 1) + delta;
    if (next <= 0) { await deleteSighting(rec.id); return; }
    rec.count = next;
    await db.put('sightings', rec);
  } else if (delta > 0) {
    await saveSighting({ speciesId, count: 1, heard: false, date: outing.date, time: outing.past || outing.endedAt ? outing.time : timeStr(), lat: outing.lat, lng: outing.lng,
      acc: null, place: outing.place, notes: '', photoId: null, outingId: outing.id });
  }
}
function openFinishOuting(o) {
  const mins = o.past ? 60 : Math.max(1, Math.round((Date.now() - o.startedAt) / 60000));
  const n = state.sightings.filter(s => s.outingId === o.id).length;
  const loc = { lat: o.lat, lng: o.lng };
  const s = openSheet(`<h2 class="sheet-title">${o.endedAt ? 'Outing details' : 'Finish outing'}</h2>
    <p class="muted">${plural(n, 'species', 'species')} so far.</p>
    <form class="form" data-form>
      <label class="field"><span>Place name</span><input name="place" value="${esc(o.place || '')}" autocomplete="off"></label>
      <div class="loc-row"><button type="button" class="btn btn--small" data-pickmap>${icon.search} ${o.lat != null ? 'Move on map' : 'Choose on map'}</button><span class="small muted" data-gps-status>${o.lat != null ? `${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}` : 'No location yet'}</span></div>
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${o.date}" max="${todayStr()}"></label>
        <label class="field"><span>Start time</span><input type="time" name="time" value="${o.time}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Duration (minutes)</span><input name="dur" inputmode="numeric" value="${o.durationMin || mins}"></label>
        <label class="field"><span>Distance walked (km)</span><input name="km" inputmode="decimal" placeholder="0 if you stayed put" value="${o.distanceKm ?? ''}"></label>
      </div>
      <label class="check check--card"><input type="checkbox" name="complete" ${o.complete || !o.endedAt ? 'checked' : ''}><span>I logged every bird I could identify. eBird calls this a complete checklist.</span></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Weather, tide, company…">${esc(o.notes)}</textarea></label>
      <div class="row-end"><button type="button" class="btn" data-close>${o.endedAt ? 'Cancel' : 'Keep going'}</button><button class="btn btn--primary">${o.endedAt ? 'Save details' : 'Finish outing'}</button></div>
    </form>`);
  s.addEventListener('click', async e => {
    if (!e.target.closest('[data-pickmap]')) return;
    const r = await openLocationPicker({ lat: loc.lat, lng: loc.lng, place: $('[name=place]', s).value });
    if (r) { Object.assign(loc, { lat: r.lat, lng: r.lng }); $('[data-gps-status]', s).textContent = `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`; if (r.place) $('[name=place]', s).value = r.place; }
  });
  $('[data-form]', s).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const startAt = new Date(`${f.date.value}T${f.time.value || '00:00'}`);
    Object.assign(o, { endedAt: o.endedAt || Date.now(), durationMin: parseInt(f.dur.value, 10) || mins,
      distanceKm: parseFloat(f.km.value) || 0, complete: f.complete.checked, notes: f.notes.value.trim(),
      place: f.place.value.trim(), date: f.date.value || o.date, time: f.time.value || o.time,
      startedAt: isNaN(startAt) ? o.startedAt : startAt.getTime(), lat: loc.lat, lng: loc.lng });
    await db.put('outings', o);
    // keep the outing's birds in step with its place and date
    for (const r of state.sightings.filter(x => x.outingId === o.id)) {
      Object.assign(r, { date: o.date, place: o.place, lat: o.lat, lng: o.lng });
      if (o.past) r.time = o.time;
      await db.put('sightings', r);
    }
    if (state.activeOutingId === o.id) { state.activeOutingId = null; await db.kvSet('activeOuting', null); }
    closeSheet();
    toast('Outing finished');
    location.hash = `#/outing/${o.id}`;
    render();
  });
}

// ---------- views ----------
const routes = [
  [/^#\/?$/, () => renderDex()],
  [/^#\/dex$/, () => renderDex()],
  [/^#\/bird\/(\d+)$/, m => renderBird(Number(m[1]))],
  [/^#\/lists$/, () => renderLists()],
  [/^#\/list\/([\w-]+)$/, m => renderList(m[1])],
  [/^#\/patch\/(\d+)(?:\/([\w-]+))?$/, m => renderList(m[2] || 'life', Number(m[1]))],
  [/^#\/targets$/, () => renderTargets()],
  [/^#\/outing\/(\d+)$/, m => renderOuting(Number(m[1]))],
  [/^#\/log$/, () => renderLog()],
  [/^#\/map$/, () => renderMap()],
  [/^#\/map\/sp\/(\d+)$/, m => renderMap(Number(m[1]))],
  [/^#\/badges$/, () => renderBadges()],
  [/^#\/leaderboard$/, () => renderLeaderboard()],
  [/^#\/settings$/, () => renderSettings()],
  [/^#\/map\/at\/(-?[\d.]+),(-?[\d.]+)$/, m => renderMap(null, [Number(m[1]), Number(m[2])])],
  [/^#\/compare\/(\d+)\/(\d+)$/, m => renderCompare(Number(m[1]), Number(m[2]))],
  [/^#\/stats$/, () => renderStats(ctx)],
  [/^#\/learn(?:\/(daily|deck|play|test)(?:\/(\w+))?)?$/, m => renderLearn(ctx, m[1], m[2])],
  [/^#\/quiz$/, () => location.replace('#/learn')],
  [/^#\/listen$/, () => renderListen()],
  [/^#\/scan$/, () => renderScan(ctx)],
];
let lastRoute = '';
// Draw the current route. Synchronous: async screens fill in later and are tidied up when they finish.
// Redrawing the same route (a sync, a save) keeps keyboard focus on the same control.
function render() {
  const hash = location.hash || '#/dex';
  return hash === lastRoute ? keepFocus(() => drawRoute(hash), { fallback: '#view h1' }) : drawRoute(hash);
}
function drawRoute(hash) {
  const fresh = hash !== lastRoute;
  if (state.map && !hash.startsWith('#/map')) { state.map.remove(); state.map = null; }
  state.cleanup?.(); state.cleanup = null;
  let out;
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { out = fn(m); break; }
  }
  const tab = hash.split('/')[1] || 'dex';
  const tabFor = { bird: 'dex', dex: 'dex', compare: 'dex', listen: 'dex', scan: 'dex', lists: 'lists', list: 'lists', patch: 'lists', targets: 'lists', outing: 'lists', log: 'lists', stats: 'lists', map: 'map', badges: 'badges', settings: 'badges', quiz: 'badges', learn: 'badges', leaderboard: 'badges' }[tab] || 'dex';
  $$('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tabFor ? 'page' : 'false'));
  renderOutingBar();
  // A new route starts at the top, except going back, which returns to where she was.
  if (fresh) { window.scrollTo(0, state.navScroll || 0); state.navScroll = 0; lastRoute = hash; }
  afterDraw();
  // A screen that fails while it fills in is reported here, as it was before transitions wrapped it, so what this
  // returns settles without rejecting.
  if (out && typeof out.then === 'function') return out.then(() => { if ((location.hash || '#/dex') === hash) afterDraw(); }, report);
  return out;
}
// Page title from the screen's heading, the hero photo first in line, cached photos shown at once, her photos lazily.
function afterDraw() {
  const h1 = $('h1', view);
  let t = '';
  if (h1) { const c = h1.cloneNode(true); c.querySelectorAll('small').forEach(n => n.remove()); t = c.textContent.replace(/\s+/g, ' ').trim(); }
  document.title = !t || /BirdyDex/.test(t) ? "Sarah's BirdyDex" : `${t} – BirdyDex`;
  prioritiseHero(view);
  settleImages(view);
  hydratePhotos(view);
  lookAfterDraw(view);
}

// ---------- navigation motion ----------
// How deep each screen sits. Deeper is 'forward' (the new page rises), shallower is 'back', level is a tab 'swap'.
const DEPTH = { dex: 0, lists: 0, map: 0, badges: 0, learn: 0, bird: 1, list: 1, patch: 1, targets: 1, stats: 1, log: 1, listen: 1, scan: 1, settings: 1, quiz: 1, leaderboard: 1, compare: 2, outing: 2 };
const routeDepth = h => DEPTH[(h || '#/dex').split('/')[1] || 'dex'] ?? 1;
const navKind = (from, to) => { const a = routeDepth(from), b = routeDepth(to); return b > a ? 'forward' : b < a ? 'back' : 'swap'; };
const scrollMem = new Map();
const THUMB = '.tile-img, .row-thumb, .botd-img, .cmp-img';
let morph = null; // { id, url, kind } of a photo just tapped on its way to a species page
// Which kind of photo opened each species page (a tile, Bird of the day, a row), so Back shrinks into that one.
const cameFrom = new Map();
const thumbKind = thumb => THUMB.split(', ').find(s => thumb.matches(s)) || '';
// The photo itself flies, not its frame: the seen ring and tick stay behind and fade with the page.
const pic = thumb => $(':scope > img, :scope > .whole', thumb) || thumb;
const inView = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 56 && r.top < innerHeight - 64; };

// Tapping a photo that links to a species names it, so the view transition grows it into that page's hero.
function nameTappedPhoto(e) {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || state.suppressClick || !motionOK()) return;
  const a = e.target.closest?.('a[href^="#/bird/"]');
  if (!a || a.getAttribute('href') === location.hash) return;
  const thumb = a.matches(THUMB) ? a : $(THUMB, a);
  if (!thumb) return;
  const el = pic(thumb);
  const m = morph = { id: Number(a.getAttribute('href').split('/')[2]), url: $('img', thumb)?.currentSrc || '', kind: thumbKind(thumb) };
  nameFor(el, 'sp-hero');
  // If no navigation follows (a long press, a cancelled tap), take the name off again.
  setTimeout(() => { if (morph === m) { morph = null; if (!document.documentElement.dataset.nav) el.style.viewTransitionName = ''; } }, 700);
}

function onRouteChange() {
  const from = lastRoute, to = location.hash || '#/dex';
  scrollMem.set(from, scrollY);
  const nav = navKind(from, to);
  const toId = Number(to.match(/^#\/bird\/(\d+)$/)?.[1]) || null;
  const fromId = Number(from.match(/^#\/bird\/(\d+)$/)?.[1]) || null;
  const tapped = morph && morph.id === toId ? morph : null;
  morph = null;
  if (tapped) cameFrom.set(to, tapped.kind);
  // Going back from a species page: its hero shrinks back into the photo it came from, if that is on screen.
  let shrinkTo = null;
  if (!tapped && fromId && nav === 'back' && motionOK()) {
    const hero = $('[data-hero-frame]', view);
    if (hero && inView(hero)) { nameFor(hero, 'sp-hero'); shrinkTo = fromId; }
  }
  state.navScroll = nav === 'back' ? scrollMem.get(to) || 0 : 0;
  vt(() => {
    closeAllLayers('nav');
    flushClosingSheets();
    const out = render();
    const waits = [out];
    if (tapped) {
      const frame = $('[data-hero-frame]', view);
      if (frame) {
        // The small photo is already decoded, so the hero shows it while the large one loads.
        const box = $('.whole, .img-missing', frame) || frame;
        if (tapped.url) Object.assign(box.style, { backgroundImage: `url("${tapped.url.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: '50% 30%' });
        nameFor(frame, 'sp-hero');
      }
    }
    if (shrinkTo) {
      // Back returns her to where she was and never scrolls the page to find a target: the photo shrinks into a
      // copy of it that is already on screen, preferring the kind she tapped, or the page simply fades back.
      const kind = cameFrom.get(from);
      const on = $$(`[data-tile="${shrinkTo}"] :is(.tile-img, .row-thumb), a[href="#/bird/${shrinkTo}"] :is(${THUMB}), a[href="#/bird/${shrinkTo}"]:is(${THUMB})`, view).filter(inView);
      const t = (kind && on.find(el => el.matches(kind))) || on[0];
      if (t) {
        nameFor(pic(t), 'sp-hero');
        const img = $('img', t);
        if (img?.decode) waits.push(img.decode());
      }
    } else if (fromId && nav === 'back') {
      // Dex groups off screen only have an estimated height, so the remembered scroll can land a little off:
      // make sure the tile she opened is in sight.
      const t = $(`[data-tile="${fromId}"]`, view);
      if (t && !inView(t)) t.scrollIntoView({ block: 'center' });
    }
    return settle(Promise.all(waits), 150);
  }, { nav }).then(focusPageHeading);
}

// After a route change, focus the new screen's heading so a screen reader announces where she is.
// Left alone if she is already typing in the page, or a layer has opened meanwhile.
function focusPageHeading() {
  if (topLayer()) return;
  const a = document.activeElement;
  if (a && a.isConnected && view.contains(a) && a.matches('input, textarea, select')) return;
  const h = $('h1', view);
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } else view.focus({ preventScroll: true });
}

function renderOutingBar() {
  const bar = $('#outing-bar');
  const o = activeOuting();
  const show = !!o && location.hash !== `#/outing/${o.id}`;
  if (document.body.classList.contains('has-outing') !== show) {
    document.body.classList.toggle('has-outing', show);
    state.map?.invalidateSize?.();
  }
  if (!show) { bar.hidden = true; return; }
  const n = state.sightings.filter(s => s.outingId === o.id).length;
  bar.hidden = false;
  bar.innerHTML = `<a href="#/outing/${o.id}"><span class="pulse" aria-hidden="true"></span><span><strong>Outing in progress</strong> ${esc(o.place || '')}</span><span class="outing-bar-n">${plural(n, 'species', 'species')}</span></a>`;
}

// Dex
const inScope = (s, scope = state.dex.kind || 'animals') => scope === 'all' ? true : scope === 'animals' ? s.kind !== 'plant' : s.kind === scope;
const scopeNoun = (scope, n) => scope === 'animals' ? (n === 1 ? 'animal' : 'animals') : scope === 'all' ? 'species' : (n === 1 ? KINDS[scope].one : KINDS[scope].label.toLowerCase());
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const listWords = (list, and = 'and') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`);
function dexFilter(seen) {
  const f = state.dex;
  const q = f.q.trim().toLowerCase();
  const month = new Date().getMonth() + 1;
  return SPECIES.filter(s => inScope(s) &&
    (!q || `${s.name} ${s.sci} ${dexNo(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one}`.toLowerCase().includes(q)) &&
    (f.show === 'all' || (f.show === 'seen') === seen.has(s.id)) &&
    (!f.group || s.group === f.group) && (!f.habitat || s.habitats.includes(f.habitat)) &&
    (!f.rarity || s.rarity === Number(f.rarity)) &&
    (!f.season || (relRate(s.id, month) ?? (inSeason(s, month) ? 1 : 0)) >= 0.35));
}
function lastSeenOf(id) { const h = sightingsOf(id); return h[0] ? h[0].date + (h[0].time || '') : ''; }

// '<Kind> of the day' follows the kind tab (a bird for All animals). The pick holds all day.
function ofTheDay(seen, scope) {
  const k = scope === 'animals' || scope === 'all' ? 'bird' : scope;
  const now = new Date(), month = now.getMonth() + 1;
  let pool = targets({ seen, month, kinds: [k], ...targetOpts() }).slice(0, 40);
  if (!pool.length) pool = ofKind(k);
  if (!pool.length) return '';
  const key = Number(todayStr(now).replace(/-/g, ''));
  const sp = pool[(key * 2654435761 >>> 0) % pool.length];
  const spot = spotsFor(sp.id, 1)[0];
  const when = k === 'plant' && sp.season && inSeason(sp, month) ? 'Flowering now' : relRate(sp.id, month) >= 0.8 ? 'Often reported right now' : 'Around this month';
  const why = seen.has(sp.id) ? 'One of yours. Say hello again today.' : `${when}${spot ? `. Try ${spot.h.name}.` : '.'}`;
  return `<a class="today-card botd kind--${sp.kind}" href="#/bird/${sp.id}">
    <span class="botd-img">${birdImg(sp, 'small', '', { alt: '' })}</span>
    <span class="botd-txt"><span class="botd-k">${cap(KINDS[k].one)} of the day</span><strong>${esc(sp.name)}</strong><span class="botd-why">${esc(why)}</span></span></a>`;
}

// What photo ID covers (from data/photoid.json, read once), so Scan isn't offered for kinds it can't name.
let photoKinds = null, photoKindsP = null;
function scanCard(scope) {
  const single = scope !== 'animals' && scope !== 'all';
  const labels = (photoKinds || []).map(k => KINDS[k].label.toLowerCase());
  const missing = single && labels.length && !photoKinds.includes(scope);
  const title = missing ? `Scan a photo (${listWords(labels)})` : 'Scan a photo';
  const sub = missing ? `No ${KINDS[scope].label.toLowerCase()} yet` : labels.length ? `${cap(listWords(labels))} by photo` : 'Name it from a photo';
  return `${icon.scan}<span><strong>${esc(title)}</strong><span>${esc(sub)}</span></span>`;
}
function knowPhotoKinds() {
  photoKindsP ||= import('./photoid.js').then(m => m.photoInfo()).then(info => {
    photoKinds = info.kinds;
    const card = $('[data-scancard]', view);
    if (card) card.innerHTML = scanCard(state.dex.kind);
  }).catch(() => { photoKindsP = null; });
}

// Today: one scrolling row of small cards. Listen and Scan, the pick of the day for this tab, and Learn.
function todayRail(seen, scope) {
  const single = scope !== 'animals' && scope !== 'all';
  const [lt, ls] = single && scope !== 'bird' ? ['Listen (birds)', scope === 'frog' ? 'Frog calls to compare' : 'Birds by call'] : ['Listen', 'Birds by call'];
  return `<section class="today" aria-label="Today">
    ${state.installPrompt ? `<button class="today-card today-tool" data-install>${icon.install}<span><strong>Install</strong><span>Add to your home screen</span></span></button>` : ''}
    <a class="today-card today-tool" href="#/listen">${icon.mic}<span><strong>${lt}</strong><span>${ls}</span></span></a>
    <a class="today-card today-tool" href="#/scan" data-scancard>${scanCard(scope)}</a>
    ${ofTheDay(seen, scope)}
    ${learnTeaser(ctx)}
  </section>`;
}

// The kind rail is the tally: each tab carries its own seen/total and a thin progress bar.
function kindRail(seen, scope) {
  if (kindsPresent.length < 2) return '';
  const tab = (k, label, list, cls = '') => {
    const got = list.filter(s => seen.has(s.id)).length, n = list.length;
    return `<button role="tab" class="kind-tab kind--${k === 'animals' ? 'all' : k} ${cls}" aria-selected="${scope === k}" data-kind="${k}">
      <span class="kind-tab-l">${label}</span>
      <span class="kind-tab-n" aria-hidden="true"><b data-kn="${got}" data-of="${n}">${got}</b>/${n}</span>
      <span class="kind-tab-bar" aria-hidden="true"><i style="transform:scaleX(${(got / Math.max(1, n)).toFixed(3)})"></i></span>
      <span class="sr-only">, ${got} of ${n} ${k === 'plant' ? 'found' : 'seen'}</span></button>`;
  };
  return `<div class="kind-tabs" role="tablist" aria-label="What to show">
    ${tab('animals', 'All animals', ANIMALS)}
    ${ANIMAL_KINDS.filter(k => kindsPresent.includes(k)).map(k => tab(k, KINDS[k].label, ofKind(k))).join('')}
    ${kindsPresent.includes('plant') ? tab('plant', 'Plants', ofKind('plant'), 'kind-tab--quiet') : ''}</div>`;
}
// A count that changed since the last draw (a new sighting) counts up; the first draw just shows the numbers.
let dexCounts = null;
function countKindTabs() {
  const now = {};
  for (const b of $$('[data-kn]', view)) {
    const k = b.closest('[data-kind]').dataset.kind, n = Number(b.dataset.kn), of = Math.max(1, Number(b.dataset.of));
    const was = dexCounts?.[k];
    now[k] = n;
    if (was == null || was === n) continue;
    countUp(b, was, n, { delay: 200 });
    if (motionOK()) b.closest('.kind-tab').querySelector('.kind-tab-bar i').animate(
      [{ transform: `scaleX(${was / of})` }, { transform: `scaleX(${n / of})` }], { duration: 600, delay: 200, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
  }
  dexCounts = now;
}

// The horizontal rails keep where they were scrolled to across a redraw; the chosen kind tab is kept in sight.
const RAILS = ['.kind-tabs', '.today', '.chips--dex'];
function keepRails(draw) {
  const was = RAILS.map(s => $(s, view)?.scrollLeft);
  draw();
  RAILS.forEach((s, i) => { const el = $(s, view); if (el && was[i]) el.scrollLeft = was[i]; });
  const rail = $('.kind-tabs', view), on = rail && $('[aria-selected="true"]', rail);
  if (on && (on.offsetLeft < rail.scrollLeft || on.offsetLeft + on.offsetWidth > rail.scrollLeft + rail.clientWidth)) {
    rail.scrollLeft = on.offsetLeft - (rail.clientWidth - on.offsetWidth) / 2;
  }
}
// Filters, sorts, kinds and layout: tiles glide to their new places and focus stays on the control she used.
const redrawDex = () => { keepFocus(() => flip(() => renderDex())); sayDexCount(); };
let sayT = 0;
function sayDexCount(delay = 0) {
  clearTimeout(sayT);
  sayT = setTimeout(() => {
    if (!/^#\/(dex)?$/.test(location.hash || '#/dex')) return;
    const n = dexFilter(seenSet()).length;
    announce(`${n} ${scopeNoun(state.dex.kind, n)}`);
  }, delay);
}

function dexEmpty(f, seen, filtersOn) {
  const noun = scopeNoun(f.kind, 2), q = f.q.trim();
  const clear = `<button class="btn" data-reset>${q && !filtersOn ? 'Clear search' : 'Clear filters'}</button>`;
  if (q) {
    return `<div class="empty"><p class="empty-h">No ${noun} match "${esc(q)}"${filtersOn ? ' with these filters' : ''}.</p>
      <p class="small">Check the spelling or try part of a name. Search everything to look through places and your sightings too.</p>
      <div class="row-center"><button class="btn btn--primary" data-search>Search everything</button>${clear}</div></div>`;
  }
  if (f.show === 'seen' && !SPECIES.some(s => inScope(s) && seen.has(s.id))) {
    return `<div class="empty"><p class="empty-h">No ${noun} logged yet.</p>
      <p class="small">Press and hold any tile to log it, or tap the + button.</p>
      <div class="row-center"><button class="btn btn--primary" data-show="all">Show all ${noun}</button></div></div>`;
  }
  return `<div class="empty"><p class="empty-h">None of the ${noun} match all of these filters.</p>
    <p class="small">Turn one off, or clear them all to see the whole dex again.</p><div class="row-center">${clear}</div></div>`;
}

// Off-screen groups skip rendering until they're near (content-visibility); this is their size until then.
function groupSize(n, layout) {
  if (layout === 'list') return 52 + n * 69;
  const w = Math.min(innerWidth, 760) - 32, min = innerWidth >= 700 ? 130 : 104;
  const cols = Math.max(1, Math.floor((w + 10) / (min + 10))), rows = Math.ceil(n / cols);
  return 60 + rows * ((w - (cols - 1) * 10) / cols + 64) + (rows - 1) * 16;
}

function renderDex() {
  keepRails(drawDex);
  countKindTabs();
  if (!photoKinds) knowPhotoKinds();
}
function drawDex() {
  const seen = seenSet();
  const f = state.dex;
  f.kind ||= 'animals';
  const list = dexFilter(seen);
  const scopeAll = SPECIES.filter(s => inScope(s));
  const filtersOn = !!(f.habitat || f.group || f.rarity || f.season || f.show !== 'all');
  const isSeen = s => seen.has(s.id);
  const hidden = s => `<span class="sr-only">, ${isSeen(s) ? 'seen' : 'not seen'}</span>`;
  const tile = s => `<li><a class="tile kind--${s.kind} ${isSeen(s) ? 'tile--seen' : ''}" href="#/bird/${s.id}" data-tile="${s.id}">
      <span class="tile-img">${birdImg(s, 'small', '', { alt: '' })}</span>
      ${band(s.id, isSeen(s))}
      <span class="tile-name">${esc(s.name)}${hidden(s)}</span></a></li>`;
  // Under a group heading the group name would repeat on every row, so rows show the scientific name instead.
  const row = s => `<li><a class="row row--sp kind--${s.kind}" href="#/bird/${s.id}" data-tile="${s.id}"><span class="row-thumb ${isSeen(s) ? 'row-thumb--seen' : ''}">${birdImg(s, 'small', '', { alt: '' })}</span>
      <span class="row-main"><strong>${esc(s.name)}${hidden(s)}</strong><span class="muted small">${f.sort === 'dex' ? `<i>${esc(s.sci)}</i>` : esc(GROUPS[s.group])}</span></span>${pips(s.rarity)} ${band(s.id, isSeen(s))}</a></li>`;
  const block = items => f.layout === 'list' ? `<ul class="rows pad-x">${items.map(row).join('')}</ul>` : `<ul class="dex-grid">${items.map(tile).join('')}</ul>`;
  let body;
  if (!list.length) body = dexEmpty(f, seen, filtersOn);
  else if (f.sort === 'dex') {
    const byGroup = {};
    list.forEach(s => (byGroup[s.group] ||= []).push(s));
    body = Object.keys(GROUPS).filter(g => byGroup[g]).map((g, i) => {
      const k = SPECIES.find(s => s.group === g)?.kind || 'bird';
      const all = SPECIES.filter(s => s.group === g);
      const got = all.filter(isSeen).length;
      const later = i ? ` style="contain-intrinsic-size:auto ${Math.round(groupSize(byGroup[g].length, f.layout))}px"` : '';
      return `<section class="dex-group kind--${k}${i ? ' dex-group--later' : ''}"${later}><h2 class="dex-group-h"><span>${GROUPS[g]}</span><span class="dex-group-n"><span aria-hidden="true">${got}/${all.length}</span><span class="sr-only">${got} of ${all.length} seen</span></span></h2>${block(byGroup[g])}</section>`;
    }).join('');
  } else {
    const sorted = list.slice().sort(
      f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : f.sort === 'rarity' ? (a, b) => b.rarity - a.rarity || a.id - b.id
      : (a, b) => lastSeenOf(b.id).localeCompare(lastSeenOf(a.id)) || a.id - b.id);
    body = `<section class="dex-group">${block(sorted)}</section>`;
  }
  view.innerHTML = `
    <header class="dex-head">
      <div class="dex-head-top">
        <h1 class="wordmark"><img class="logo" src="icons/logo.svg" alt="" width="40" height="40"><span class="wordmark-txt">Sarah's BirdyDex<small>South East Queensland</small></span></h1>
        <div class="head-actions">
          ${accountChip()}
          <button class="iconbtn" data-search aria-label="Search everything">${icon.search}</button>
          <a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a>
        </div>
      </div>
      ${kindRail(seen, f.kind)}
      ${todayRail(seen, f.kind)}
    </header>
    <div class="dex-tools">
      <div class="searchbox searchbox--dex">${icon.search}<input type="search" placeholder="Filter ${scopeAll.length} ${scopeNoun(f.kind, 2)}" value="${esc(f.q)}" data-q aria-label="Filter by name"></div>
      <button class="iconbtn iconbtn--tool" data-layout aria-label="${f.layout === 'list' ? 'Show as grid' : 'Show as list'}">${f.layout === 'list' ? icon.grid : icon.list}</button>
    </div>
    <div class="chips chips--scroll chips--dex" role="group" aria-label="Filter and sort">
      ${[['all', 'All'], ['seen', 'Seen'], ['unseen', 'Not seen']].map(([v, l]) => `<button class="chip ${f.show === v ? 'chip--on' : ''}" data-show="${v}" aria-pressed="${f.show === v}">${l}</button>`).join('')}
      <button class="chip ${f.season ? 'chip--on' : ''}" data-season aria-pressed="${f.season}">In season now</button>
      <select class="chip chip--select ${f.sort !== 'dex' ? 'chip--on' : ''}" data-sort aria-label="Sort">
        ${[['dex', 'Dex order'], ['name', 'Name A–Z'], ['rarity', 'Rarest first'], ['recent', 'Recently seen']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="chip chip--select ${f.rarity ? 'chip--on' : ''}" data-rarity aria-label="Rarity">
        <option value="">Any rarity</option>${Object.entries(RARITY).map(([k, v]) => `<option value="${k}" ${String(f.rarity) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <select class="chip chip--select ${f.habitat ? 'chip--on' : ''}" data-habitat aria-label="Habitat">
        <option value="">Any habitat</option>${Object.entries(HABITATS).map(([k, v]) => `<option value="${k}" ${f.habitat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="chip chip--select ${f.group ? 'chip--on' : ''}" data-group aria-label="Group">
        <option value="">All groups</option>${Object.entries(GROUPS).filter(([k]) => scopeAll.some(s => s.group === k)).map(([k, v]) => `<option value="${k}" ${f.group === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${filtersOn ? '<button class="chip" data-reset>Clear</button>' : ''}
    </div>
    ${(f.q || filtersOn) && list.length ? `<p class="list-count"><b>${list.length}</b> ${scopeNoun(f.kind, list.length)}</p>` : ''}
    <div class="dex ${state.settings.colourUnseen ? 'dex--colour' : ''}">${body}</div>
    <p class="small muted pad dex-tip">Tip: press and hold anything in the dex to log it quickly.</p>`;
  const qi = $('[data-q]', view);
  // Typing redraws without motion (tiles sliding on every key would be noise); the count is read out once she pauses.
  qi.addEventListener('input', () => {
    state.dex.q = qi.value;
    const pos = qi.selectionStart;
    renderDex();
    const n = $('[data-q]', view); n.focus(); n.setSelectionRange(pos, pos);
    sayDexCount(900);
  });
  view.onclick = e => {
    if (state.suppressClick && e.target.closest('[data-tile]')) { state.suppressClick = false; e.preventDefault(); return; }
    const sh = e.target.closest('[data-show]');
    if (sh) { state.dex.show = sh.dataset.show; redrawDex(); return; }
    if (e.target.closest('[data-season]')) { state.dex.season = !state.dex.season; redrawDex(); return; }
    const kt = e.target.closest('[data-kind]');
    if (kt) { if (state.dex.kind !== kt.dataset.kind) { state.dex.kind = kt.dataset.kind; state.dex.group = ''; redrawDex(); } return; }
    if (e.target.closest('[data-layout]')) { state.dex.layout = state.dex.layout === 'list' ? 'grid' : 'list'; redrawDex(); return; }
    if (e.target.closest('[data-reset]')) { state.dex = { ...state.dex, q: '', show: 'all', group: '', habitat: '', rarity: '', season: false }; redrawDex(); return; }
    const se = e.target.closest('[data-search]');
    if (se) openSearch(se.closest('.empty') ? state.dex.q.trim() : '');
    if (e.target.closest('[data-install]')) promptInstall();
  };
  view.onchange = e => {
    if (e.target.matches('[data-habitat]')) state.dex.habitat = e.target.value;
    if (e.target.matches('[data-group]')) state.dex.group = e.target.value;
    if (e.target.matches('[data-rarity]')) state.dex.rarity = e.target.value;
    if (e.target.matches('[data-sort]')) state.dex.sort = e.target.value;
    redrawDex();
  };
  wireLongPress(view);
}

// Press and hold a bird to log it fast (with GPS filled in).
function wireLongPress(root) {
  let timer = null, startX = 0, startY = 0;
  root.onpointerdown = e => {
    const t = e.target.closest('[data-tile]');
    if (!t) return;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      state.suppressClick = true;
      setTimeout(() => { state.suppressClick = false; }, 800);
      navigator.vibrate?.(25);
      openSightingSheet({ speciesId: Number(t.dataset.tile), autoGps: true });
    }, 520);
  };
  const cancel = e => { if (timer && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - startX, e.clientY - startY) > 10)) { clearTimeout(timer); timer = null; } };
  root.onpointerup = root.onpointercancel = () => cancel();
  root.onpointermove = cancel;
  root.oncontextmenu = e => { if (e.target.closest('[data-tile]')) e.preventDefault(); };
}

// Calls: our own clips first (they play offline), then the full Atlas of Living Australia recordings (streamed,
// online only: that server can't be cached from here), then Wikimedia Commons. Commons is only searched when there
// is no local clip, because its two searches take a couple of seconds on mobile data.
async function getCalls(sp) {
  const local = await localCalls(sp.id);
  const used = new Set(local.map(c => c.orig));
  const ala = navigator.onLine ? (seq()?.species?.[sp.id]?.calls || []).filter(c => !used.has(c.src)).map(c => ({
    ...c, title: `Full ${c.from === 'iNaturalist Australia' ? 'iNaturalist' : c.from} recording`,
  })) : [];
  let commons = [];
  if (!local.length) try { commons = await calls(sp); } catch (_) {}
  return [...local, ...ala, ...commons].slice(0, 4);
}
// Offline, only species with a local clip can be played.
const hasCalls = id => hasLocalCall(id) || (navigator.onLine && !!seq()?.species?.[id]?.calls?.length);
// Credit line for a recording. Our clips are cut down from the original, which the licence asks us to say.
const callCredit = c => `By ${c.page ? `<a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(String(c.artist || 'Unknown').slice(0, 50))}</a>` : esc(String(c.artist || 'Unknown').slice(0, 50))}${c.license ? `, ${esc(c.license)}` : ''}.${c.local ? ` Trimmed from the ${c.from === 'iNaturalist Australia' ? 'iNaturalist' : 'original'} recording.` : ''}`;

// Species detail
// Look-alikes when there's no curated pair: the same kind, nearest in real size, from its own group unless that group
// has fewer than two others (the Koala is alone in its group), then from the whole kind.
function similarSpecies(sp, n = 4) {
  const kin = SPECIES.filter(s => s.id !== sp.id && s.kind === sp.kind);
  const group = kin.filter(s => s.group === sp.group);
  const gap = s => (s.sizeCm && sp.sizeCm ? Math.abs(Math.log(s.sizeCm / sp.sizeCm)) : 1);
  return (group.length >= 2 ? group : kin).map(s => ({ s, d: gap(s) })).sort((a, b) => a.d - b.d).slice(0, n).map(x => x.s);
}
// The size with the label that fits it: Length, Wingspan (butterflies, flying-foxes), Height (plants), Shell or Body.
const MEASURE = { length: 'Length', wingspan: 'Wingspan', height: 'Height', shell: 'Shell', body: 'Body' };
function sizeFact(sp) {
  const t = String(sp.sizeText || '').trim();
  if (!t) return null;
  const p = parseSize(t);
  if (!p) return [sp.kind === 'plant' ? 'Grows as' : 'Size', cap(t)];
  return [MEASURE[sp.kind === 'plant' ? 'height' : p.measure], cap(t.replace(/^wingspan\s+/i, '').replace(/\s+(shell|body)$/i, '').replace(/^to\b/i, 'up to'))];
}
const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// Non-bird tiers rank each kind against itself, so the line says so.
const rarityText = sp => (sp.kind === 'bird' ? `${RARITY[sp.rarity].label} in SEQ` : `${RARITY[sp.rarity].label} for ${article(KINDS[sp.kind].one)} ${KINDS[sp.kind].one} in SEQ`);
function seasonText(sp) {
  if (sp.kind === 'plant') return sp.season === 's' ? 'Mostly spring to summer' : sp.season === 'w' ? 'Mostly autumn to winter' : 'Year round';
  return sp.season === 's' ? (sp.kind === 'bird' ? 'Mostly September to April' : 'Most active September to April') : sp.season === 'w' ? 'Mostly April to September' : 'All year';
}
// From the Learn review deck: Learnt once every card for it is in box 4 or 5, Learning while any card is on its way.
function masteryMark(id) {
  const m = masteryOf(id);
  if (!m) return '';
  return m >= 1 ? `<span class="mastery mastery--done">${icon.tick}Learnt</span>`
    : `<span class="mastery"><i style="--p:${Math.round(m * 100)}" aria-hidden="true"></i>Learning</span>`;
}

// Photos for the species page: the Wikipedia picture first, then the gallery (data/gallery.json).
function heroPhotos(sp) {
  const out = [];
  const wiki = photoFor(sp.id);
  if (wiki) out.push({ src: sized(sp.id, 'large'), wiki: true, credit: '', license: '', page: wiki.url });
  for (const g of galleryFor(sp.id)) if (!out.some(o => o.src === g.src)) out.push({ ...g });
  return out.slice(0, 7);
}
// One small line under the photo: the author (linked to the source) and the licence.
const author = a => String(a || '').replace(/\s*\(?\bhttps?:\/\/[^\s)]*\)?/g, '').trim().slice(0, 60) || 'Unknown';
const creditHTML = ph => `Photo: ${ph.page ? `<a href="${esc(ph.page)}" target="_blank" rel="noopener">${esc(author(ph.credit))}</a>` : esc(author(ph.credit))}${ph.license ? `, ${esc(ph.license)}` : ''}`;
// Only the first photo loads with the page. The next loads when she starts to swipe, and each one after that as
// she reaches the one before it.
function wireGallery(photos) {
  const g = $('[data-gallery]', view);
  if (!g || photos.length < 2) return;
  const slides = $$('.slide', g), counter = $('[data-count-i]', view), cr = $('[data-credit]', view);
  const load = i => {
    if (!slides[i]) return;
    for (const img of $$('img[data-src]', slides[i])) { img.loading = 'eager'; img.src = img.dataset.src; img.removeAttribute('data-src'); }
  };
  const wake = () => load(1);
  for (const ev of ['pointerdown', 'touchstart', 'focus']) g.addEventListener(ev, wake, { once: true, passive: true });
  let last = 0;
  g.addEventListener('scroll', () => {
    const i = Math.round(g.scrollLeft / Math.max(1, g.clientWidth));
    load(i); load(i + 1);
    if (i === last) return;
    last = i;
    if (counter) counter.textContent = i + 1;
    if (cr) { cr.dataset.idx = i; cr.innerHTML = photos[i]?.credit ? creditHTML(photos[i]) : ''; }
  }, { passive: true });
  g.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') g.scrollBy({ left: g.clientWidth, behavior: 'smooth' });
    if (e.key === 'ArrowLeft') g.scrollBy({ left: -g.clientWidth, behavior: 'smooth' });
  });
}
const sourceLabel = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };
function infoSection(info) {
  return `<h2 class="h2">About</h2><p>${esc(info.text)}</p>
    ${info.status ? `<p class="status"><strong>Conservation status:</strong> ${esc(info.status)}</p>` : ''}
    ${info.sources.length ? `<p class="small sources"><span class="muted">Sources:</span> ${info.sources.map(src => `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title || sourceLabel(src.url))}</a>`).join('; ')}</p>` : ''}`;
}

// How to spot it: the field notes as short marks, the call words, size, when, group, habitats and a quick test.
function spotSection(sp) {
  const cw = callWords(sp);
  const marks = sentences(sp.notes).filter(s => !/^introduced[.;]?$/i.test(s) && s !== cw?.sentence).slice(0, 4);
  const size = sizeFact(sp), peaks = peaksOf(sp.id);
  const when = sp.kind === 'plant' && sp.season ? ['Flowers', seasonText(sp)]
    : ['When', !peaks ? seasonText(sp) : /every month|most of the year/.test(peaks) ? 'Reported all year' : `Peaks in ${peaks}`];
  const playable = cw && hasCalls(sp.id);
  const callLine = cw && esc(cw.sentence).replace(`&quot;${esc(cw.words)}&quot;`, `<q>${esc(cw.words)}</q>`);
  return `<section class="spot" aria-labelledby="spot-h">
    <h2 class="h2" id="spot-h">How to spot it</h2>
    ${marks.length ? `<ul class="spot-marks">${marks.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${cw ? `<div class="spot-call">${playable ? `<button class="playbtn spot-play" data-callplay aria-label="Play its call">${icon.play}</button>` : `<span class="spot-call-ic" aria-hidden="true">${icon.mic}</span>`}<p>${callLine}</p></div>` : ''}
    <dl class="facts">
      ${size ? `<div><dt>${size[0]}</dt><dd>${esc(size[1])}</dd></div>` : ''}
      <div><dt>${when[0]}</dt><dd>${esc(when[1])}</dd></div>
      <div><dt>Group</dt><dd><a href="#/dex" data-filter-group="${esc(sp.group)}">${esc(GROUPS[sp.group])}</a></dd></div>
    </dl>
    <ul class="spot-hab" aria-label="Where to look">${sp.habitats.map(h => `<li>${esc(HABITATS[h])}</li>`).join('')}${sp.nocturnal ? '<li class="spot-hab--night">Active at night</li>' : ''}</ul>
    <a class="btn spot-test" href="#/learn/test/${sp.id}">${icon.learn}<span>Test me on this</span></a>
  </section>`;
}

// Easy to confuse with: the curated look-alikes first (with how to tell them apart), then the nearest in size.
function confuseSection(sp) {
  const curated = lookalikesOf(sp.id).map(id => byId.get(id)).filter(Boolean);
  const list = [...curated.map(s => ({ s, tell: tellFor(sp.id, s.id) })),
    ...similarSpecies(sp, 4).filter(s => !curated.includes(s)).map(s => ({ s }))].slice(0, Math.max(4, curated.length));
  if (!list.length) return '';
  // A snap carousel of photo cards. The photo carries .cmp-img so it grows into that species' hero when tapped.
  return `<section class="confuse" aria-labelledby="confuse-h"><h2 class="h2" id="confuse-h">Easy to confuse with</h2>
    <p class="small muted">Easy to mix up. Tap Compare to see them side by side.</p>
    <ul class="lk-rail">${list.map(({ s, tell }) => `<li class="lk-card kind--${s.kind}">
      <a class="lk-sp" href="#/bird/${s.id}"><span class="lk-photo cmp-img">${birdImg(s, 'small', '', { alt: '' })}</span>
        <strong class="lk-name">${esc(s.name)}</strong></a>
      <p class="lk-tell${tell ? '' : ' muted'}">${esc(tell || cap(s.sizeText || ''))}</p>
      <a class="btn btn--small lk-cmp" href="#/compare/${sp.id}/${s.id}" aria-label="Compare with the ${esc(s.name)}">Compare</a></li>`).join('')}</ul></section>`;
}

function renderBird(id) {
  const sp = byId.get(id);
  if (!sp) { location.hash = '#/dex'; return; }
  const hash = location.hash;
  const hist = sightingsOf(id);
  const first = hist[hist.length - 1];
  const seen = hist.length > 0;
  const prev = [...SPECIES].reverse().find(s => s.kind === sp.kind && s.id < id), next = SPECIES.find(s => s.kind === sp.kind && s.id > id);
  const isBird = sp.kind === 'bird';
  const photos = heroPhotos(sp);
  const info = infoFor(sp.id);
  const cardInfo = { seen, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };
  const curated = lookalikesOf(id).length > 0;
  const snaps = hist.filter(h => h.photoId);
  const kindWord = KINDS[sp.kind].label.toLowerCase();
  // Prev/next: a photo chip for the neighbour in the dex, of the same kind.
  const chip = (s, dir) => `<a class="pn pn--${dir} kind--${s.kind}" href="#/bird/${s.id}">${icon.back}<span class="pn-ph">${birdImg(s, 'small', '', { alt: '' })}</span>
    <span class="pn-txt"><span class="sr-only">${dir === 'prev' ? 'Previous' : 'Next'}: </span><span class="pn-no">${dexNo(s.id)}</span><strong>${esc(s.name)}</strong></span></a>`;
  // The hero runs under the status bar: the photos, a scrim tinted from the photo, and the name set on it. Glass
  // controls float on top. The page's sheet slides up over its bottom edge.
  view.innerHTML = `
    <article class="bird kind--${sp.kind}">
      <div class="bird-hero" data-hero-box>
        <div class="hero-photo">
          <div class="gallery" data-gallery tabindex="0" aria-label="Photos of the ${esc(sp.name)}${photos.length > 1 ? '. Swipe for more.' : ''}">
            ${photos.length ? photos.map((ph, i) => `<figure class="slide"${i ? '' : ' data-hero-frame'}>${wholeImg(ph.src, `${sp.name}${photos.length > 1 ? `, photo ${i + 1} of ${photos.length}` : ''}`, 'bird-photo', { lazy: i > 0 })}</figure>`).join('')
              : `<figure class="slide" data-hero-frame><span class="bird-photo img-missing" role="img" aria-label="${esc(sp.name)}"></span></figure>`}
          </div>
        </div>
        <div class="hero-model hidden" data-model aria-label="3D model of a ${esc(sp.name)}. Drag to turn it."></div>
        <div class="hero-scrim" aria-hidden="true"></div>
        <div class="hero-cap">
          <div class="hero-meta">${band(sp.id, seen)}${kindTag(sp)}${photos.length > 1 ? `<span class="hero-count" data-count aria-hidden="true"><b data-count-i>1</b>/${photos.length}</span>` : ''}</div>
          <h1 class="bird-name">${esc(sp.name)}</h1>
          <p class="sci">${esc(sp.sci)}</p>
          <p class="hero-credit" data-credit>${photos[0]?.credit ? creditHTML(photos[0]) : ''}</p>
        </div>
        <a class="iconbtn iconbtn--float" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
        <button class="iconbtn iconbtn--float iconbtn--right" data-search aria-label="Search everything">${icon.search}</button>
        <div class="hero-tabs" role="tablist" aria-label="View">
          <button role="tab" aria-selected="true" data-hero="photo">${photos.length > 1 ? 'Photos' : 'Photo'}</button>
          ${isBird ? '<button role="tab" aria-selected="false" data-hero="model">3D model</button>' : ''}
          <button role="tab" aria-selected="false" data-hero="card">Card</button>
        </div>
      </div>
      <div class="bird-body">
        <div class="bird-sum"><span class="rarity-line">${pips(sp.rarity)}<span>${rarityText(sp)}</span></span><span data-mastery>${masteryMark(id)}</span></div>
        <div class="bird-actions">
          <button class="btn btn--primary btn--grow" data-log>${seen ? 'Log another sighting' : 'Log a sighting'}</button>
          ${seen ? `<button class="btn btn--share" data-sharecard aria-label="Share card">${icon.share}</button>` : ''}
        </div>
        ${seen ? `<p class="seen-line">Seen ${plural(hist.length, 'time')}. First on ${fmtDate(first.date)}${first.place ? ` at ${esc(first.place)}` : ''}.</p>` : ''}

        ${spotSection(sp)}
        <div data-confuse${curated ? ' data-curated' : ''}>${confuseSection(sp)}</div>
        ${whereSection(sp)}
        ${isBird || sp.kind === 'frog' ? '<section class="call" data-calls aria-live="polite"><h2 class="h2">Calls</h2><p class="muted small">Looking for recordings…</p></section>' : ''}

        <section class="wiki" data-wiki>${info ? infoSection(info) : ''}</section>

        <section class="mine" aria-labelledby="mine-h">
          <h2 class="h2" id="mine-h">Your sightings</h2>
          ${snaps.length ? `<ul class="mine-strip">${snaps.map(h => `<li><button class="mine-ph" data-edit="${h.id}" aria-label="Your photo from ${fmtDate(h.date)}"><img data-photo="${h.photoId}" alt=""></button></li>`).join('')}</ul>` : ''}
          ${seen ? `<ul class="hist">${hist.map(h => `<li><button class="hist-row" data-edit="${h.id}">
            <span class="hist-main"><strong>${fmtDate(h.date)}</strong>${h.time ? ` <span class="muted">${h.time}</span>` : ''}<br><span class="muted">${esc(h.place || 'No place name')}</span></span>
            <span class="hist-n">${h.count ? `×${h.count}` : 'X'}${h.heard ? '<br><span class="muted small">heard</span>' : ''}</span></button></li>`).join('')}</ul>`
          : `<p class="muted mine-empty">Not seen yet. When you find ${sp.kind === 'plant' ? 'it' : 'one'}, log it here and its card fills in with colour.</p>`}
        </section>

        <nav class="more-links">
          ${isBird ? `<a href="https://xeno-canto.org/species/${sp.sci.replace(' ', '-')}" target="_blank" rel="noopener">More calls on xeno-canto</a>` : ''}
          <a href="https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}" target="_blank" rel="noopener">Atlas of Living Australia</a>
        </nav>
        ${prev || next ? `<nav class="prevnext" aria-label="More ${esc(kindWord)}">${prev ? chip(prev, 'prev') : '<span></span>'}${next ? chip(next, 'next') : ''}</nav>` : ''}
      </div>
      <div class="logbar" data-logbar inert>
        ${band(sp.id, seen)}<strong>${esc(sp.name)}</strong>
        <button class="btn btn--primary btn--small" data-log aria-label="Log a sighting of the ${esc(sp.name)}">Log it</button>
      </div>
    </article>`;
  // 3D model: three.js arrives on demand. If she has left (or switched back) before it lands, nothing is mounted.
  let disposeModel = null, alive = true, mounting = false;
  const showHero = async which => {
    $$('[data-hero]', view).forEach(b => b.setAttribute('aria-selected', String(b.dataset.hero === which)));
    if (which === 'card') { openCard(sp, cardInfo); $$('[data-hero]', view).forEach(b => b.setAttribute('aria-selected', String(b.dataset.hero === (disposeModel ? 'model' : 'photo')))); return; }
    const box = $('[data-model]', view);
    $('.hero-photo', view).classList.toggle('hidden', which !== 'photo');
    $('[data-credit]', view).classList.toggle('hidden', which !== 'photo');
    $('[data-count]', view)?.classList.toggle('hidden', which !== 'photo');
    $('.bird-hero', view).classList.toggle('bird-hero--model', which === 'model');
    box.classList.toggle('hidden', which !== 'model');
    if (which !== 'model' || disposeModel || mounting) return;
    mounting = true;
    box.innerHTML = '<p class="model-loading">Building the model…</p>';
    let mod = null;
    try { mod = await import('./model3d.js'); } catch (_) {}
    mounting = false;
    if (!alive || !box.isConnected) return;
    if (!mod) { box.innerHTML = '<p class="model-loading">3D needs signal the first time.</p>'; return; }
    try { box.innerHTML = '<p class="model-hint">Drag to turn</p>'; disposeModel = mod.mountBird(box, sp); }
    catch (_) { box.innerHTML = '<p class="model-loading">3D needs a newer browser.</p>'; }
  };
  // Once the Log button has scrolled away, a slim bar with the name and a Log button rises above the tab bar.
  const logbar = $('[data-logbar]', view), mainLog = $('.bird-actions [data-log]', view);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => {
    const show = !e.isIntersecting && e.boundingClientRect.top < 0;
    logbar.classList.toggle('logbar--on', show);
    logbar.inert = !show;
  }) : null;
  io?.observe(mainLog);
  // Season bars grow up the first time they come into view.
  const grow = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); grow.unobserve(e.target); }
  }), { rootMargin: '0px 0px -12% 0px' }) : null;
  $$('[data-grow]', view).forEach(el => (grow ? grow.observe(el) : el.classList.add('is-in')));
  const audioStops = [];
  state.cleanup = () => { alive = false; disposeModel?.(); disposeModel = null; io?.disconnect(); grow?.disconnect(); audioStops.forEach(f => f()); };
  let callsWired;
  const callsReady = new Promise(r => { callsWired = r; });
  view.onclick = e => {
    if (e.target.closest('[data-log]')) openSightingSheet({ speciesId: id });
    const ed = e.target.closest('[data-edit]');
    if (ed) openSightingSheet({ sightingId: Number(ed.dataset.edit) });
    const fg = e.target.closest('[data-filter-group]');
    if (fg) state.dex = { ...state.dex, kind: sp.kind === 'plant' ? 'plant' : 'animals', q: '', show: 'all', group: fg.dataset.filterGroup, habitat: '', rarity: '', season: false, sort: 'dex' };
    const h = e.target.closest('[data-hero]');
    if (h) showHero(h.dataset.hero);
    if (e.target.closest('[data-sharecard]')) shareCard(sp, cardInfo);
    if (e.target.closest('[data-search]')) openSearch();
    // The call words' play button plays the first recording in Calls, with the same player.
    if (e.target.closest('[data-callplay]')) callsReady.then(() => $('[data-calls] [data-play="0"]', view)?.click());
  };
  view.onchange = null;
  wireGallery(photos);
  const here = () => location.hash === hash;
  // Learn progress and the curated look-alikes load at start-up; fill them in if they arrive after the page.
  if (!masteryOf(id)) learnReady().then(() => { const m = here() && $('[data-mastery]', view); if (m) m.innerHTML = masteryMark(id); }).catch(() => {});
  if (!curated) loadLookalikes().then(() => {
    const box = here() && $('[data-confuse]', view);
    if (box && lookalikesOf(id).length) { box.innerHTML = confuseSection(sp); box.dataset.curated = ''; afterDraw(); }
  });
  // Wikipedia text and photo credit
  details(sp).then(d => {
    if (!here()) return;
    if (d?.credit && photos[0]?.wiki) { photos[0].credit = d.credit.artist; photos[0].license = d.credit.license; photos[0].page = d.credit.page; }
    const cr = $('[data-credit]', view);
    if (cr && photos[0]?.credit && !cr.dataset.idx) cr.innerHTML = creditHTML(photos[0]);
    const w = $('[data-wiki]', view);
    if (!info && d?.extract && w) w.innerHTML = `<h2 class="h2">About</h2><p>${esc(d.extract)}</p><p class="small muted">From <a href="${esc(d.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>`;
  }).catch(() => {});
  getCalls(sp).then(list => {
    if (!here()) return;
    const box = $('[data-calls]', view);
    if (!box) return;
    if (!list.length) {
      box.innerHTML = !navigator.onLine ? '<h2 class="h2">Calls</h2><p class="muted small">Calls for this one need an internet connection.</p>'
        : isBird ? '<h2 class="h2">Calls</h2><p class="muted small">No free recording found for this bird. Try the xeno-canto link below.</p>' : '';
      return;
    }
    box.innerHTML = `<h2 class="h2">Calls</h2><canvas class="viz" data-viz aria-hidden="true"></canvas>` + list.map((c, i) => `<div class="call-row">
      <button class="playbtn" data-play="${i}" aria-label="Play recording ${i + 1}">${icon.play}</button>
      <div class="call-meta"><span class="call-title">${esc(c.title.slice(0, 70))}</span>
      <span class="small muted call-credit">${callCredit(c)}</span>
      <span class="call-progress"><span></span></span></div></div>`).join('');
    // Two players: our clips (and downloaded Commons files) can feed the visualiser; streamed ALA recordings can't,
    // and an element wired to the visualiser plays them silent, so they get a plain one.
    const fx = new Audio(), plain = new Audio();
    let audio = fx, playing = -1, actx = null, analyser = null, raf = null, srcNode = null;
    const canvas = $('[data-viz]', box);
    const draw = () => {
      const g = canvas.getContext('2d');
      const W = canvas.width = canvas.clientWidth * devicePixelRatio, H = canvas.height = canvas.clientHeight * devicePixelRatio;
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--azure').trim();
      const sun = getComputedStyle(document.documentElement).getPropertyValue('--sun').trim();
      const tick = () => {
        analyser.getByteFrequencyData(bins);
        g.clearRect(0, 0, W, H);
        const n = 48, bw = W / n;
        for (let i = 0; i < n; i++) {
          const v = bins[Math.floor(i * bins.length * 0.5 / n)] / 255;
          g.fillStyle = v > 0.7 ? sun : accent;
          const h = Math.max(2, v * H);
          g.fillRect(i * bw + 1, H - h, bw - 2, h);
        }
        raf = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(raf); tick();
    };
    const setIcons = () => {
      $$('[data-play]', box).forEach(b => { const on = Number(b.dataset.play) === playing && !audio.paused; b.innerHTML = on ? icon.pause : icon.play; b.setAttribute('aria-label', on ? 'Pause' : `Play recording ${Number(b.dataset.play) + 1}`); });
      const sp0 = $('[data-callplay]', view), on0 = playing === 0 && !audio.paused;
      if (sp0) { sp0.innerHTML = on0 ? icon.pause : icon.play; sp0.setAttribute('aria-label', on0 ? 'Pause its call' : 'Play its call'); }
    };
    let stopped = false;
    for (const el of [fx, plain]) {
      el.addEventListener('timeupdate', () => {
        const bar = $$('.call-progress span', box)[playing];
        if (el === audio && bar && el.duration) bar.style.width = `${el.currentTime / el.duration * 100}%`;
      });
      ['play', 'pause', 'ended'].forEach(ev => el.addEventListener(ev, setIcons));
      el.addEventListener('ended', () => { canvas.classList.remove('on'); cancelAnimationFrame(raf); });
      el.addEventListener('error', () => {
        if (stopped || el !== audio || !el.getAttribute('src')) return;
        toast(navigator.onLine ? 'That recording would not play. Try another.' : 'That call is not saved on this phone yet. Save calls in Settings.');
      });
    }
    fx.addEventListener('play', () => canvas.classList.add('on'));
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-play]');
      if (!b) return;
      const i = Number(b.dataset.play);
      if (i === playing) { audio.paused ? audio.play() : audio.pause(); return; }
      playing = i; b.classList.add('loading');
      const url = await audioUrl(list[i].src);
      b.classList.remove('loading');
      if (playing !== i) return;
      // The visualiser can only read audio from this site or downloaded blobs.
      const readable = url.startsWith('blob:') || list[i].local;
      audio.pause();
      audio = readable ? fx : plain;
      if (readable) {
        try {
          if (!actx) { actx = new AudioContext(); analyser = actx.createAnalyser(); analyser.fftSize = 256; srcNode = actx.createMediaElementSource(fx); srcNode.connect(analyser); analyser.connect(actx.destination); }
          actx.resume(); draw();
        } catch (_) {}
      } else { canvas.classList.remove('on'); cancelAnimationFrame(raf); }
      $$('.call-progress span', box).forEach(x => { x.style.width = '0'; });
      audio.src = url;
      audio.play().catch(() => {});
      setIcons();
    });
    audioStops.push(() => { stopped = true; for (const el of [fx, plain]) { el.pause(); el.removeAttribute('src'); } cancelAnimationFrame(raf); actx?.close(); });
  }).catch(() => { const box = $('[data-calls]', view); if (box && here()) box.innerHTML = '<h2 class="h2">Calls</h2><p class="muted small">Calls need an internet connection the first time.</p>'; })
    .finally(() => callsWired());
}

function renderCompare(a, b) {
  const A = byId.get(a), B = byId.get(b);
  if (!A || !B) { location.hash = '#/dex'; return; }
  const hash = location.hash;
  const seen = seenSet();
  const tellHTML = () => { const t = tellFor(a, b); return t ? `<p class="cmp-tell"><strong>How to tell them apart.</strong> ${esc(t)}</p>` : ''; };
  // Two tall photo cards side by side, the curated tell line on a glass band across their foot, then the facts.
  const card = sp => `<a href="#/bird/${sp.id}" class="cmp-card cmp-img kind--${sp.kind}">${birdImg(sp, 'large', '', { alt: '' })}
    <span class="cmp-cap">${band(sp.id, seen.has(sp.id))}<h2 class="cmp-name">${esc(sp.name)}</h2></span></a>`;
  const col = sp => {
    const m = monthRates(sp.id), size = sizeFact(sp);
    return `<div class="cmp-col kind--${sp.kind}">
      <div class="cmp-id">${kindTag(sp)}${pips(sp.rarity)}</div>
      <p class="sci small">${esc(sp.sci)}</p>
      <dl class="cmp-facts">${size ? `<dt>${size[0]}</dt><dd>${esc(size[1])}</dd>` : ''}<dt>Look in</dt><dd>${sp.habitats.map(h => HABITATS[h]).join(', ')}</dd></dl>
      ${m ? `<div class="season season--mini" data-grow aria-hidden="true">${m.rel.map((v, i) => `<i style="height:${Math.max(3, v * 100)}%;--i:${i}"></i>`).join('')}</div><div class="season-labels" aria-hidden="true">${[...'JFMAMJJASOND'].map(c => `<span>${c}</span>`).join('')}</div>` : ''}
      <p class="small cmp-notes">${esc(sp.notes)}</p>
      ${hasCalls(sp.id) ? `<button class="btn btn--small" data-cplay="${sp.id}" aria-label="Play the call of the ${esc(sp.name)}">${icon.play} Call</button>` : ''}
    </div>`;
  };
  view.innerHTML = `
    <div class="compare">
      <header class="page-head page-head--back"><a class="iconbtn" href="#/bird/${A.id}" aria-label="Back">${icon.back}</a><h1>Compare</h1></header>
      <div class="cmp-stage">${card(A)}${card(B)}<div class="cmp-tellbox" data-tell>${tellHTML()}</div></div>
      <div class="cmp">${col(A)}${col(B)}</div>
    </div>`;
  if (!tellFor(a, b)) loadLookalikes().then(() => { const box = location.hash === hash && $('[data-tell]', view); if (box) box.innerHTML = tellHTML(); });
  // The month bars grow once, as they come into view.
  requestAnimationFrame(() => requestAnimationFrame(() => $$('[data-grow]', view).forEach(el => el.classList.add('is-in'))));
  let audio = null;
  view.onclick = async e => {
    const p = e.target.closest('[data-cplay]');
    if (!p) return;
    audio?.pause();
    const list = await getCalls(byId.get(Number(p.dataset.cplay)));
    if (!list.length) { toast('No recording for this one yet.'); return; }
    audio = new Audio(await audioUrl(list[0].src)); audio.play().catch(() => toast('That recording would not play.'));
  };
  view.onchange = null;
  state.cleanup = () => audio?.pause();
}

function whereSection(sp) {
  const m = monthRates(sp.id);
  if (!m) return '';
  const now = new Date().getMonth();
  const spots = spotsFor(sp.id, 6), near = spots[0]?.near;
  const L = 'JFMAMJJASOND';
  return `<section class="where" aria-labelledby="where-h">
    <h2 class="h2" id="where-h">When and where</h2>
    <h3 class="h3">When it's reported</h3>
    <div class="season" data-grow role="img" aria-label="Reporting rate by month, highest in ${MONTHS[m.rel.indexOf(1)]}">${m.rel.map((v, i) => `<i class="${i === now ? 'now' : ''}" style="height:${Math.max(3, Math.round(v * 100))}%;--i:${i}"></i>`).join('')}</div>
    <div class="season-labels" aria-hidden="true">${[...L].map(c => `<span>${c}</span>`).join('')}</div>
    <p class="small muted">How often it's reported in SEQ each month, from ${recordCount(sp.id).toLocaleString('en-AU')} records since 2016 in the Atlas of Living Australia.</p>
    ${spots.length ? `<h3 class="h3">${near ? 'Places near its records' : 'Best places in SEQ'}</h3>
    <ul class="spots">${spots.map(({ h, c }) => `<li><span>${esc(h.name)}</span><span class="num">${c.toLocaleString('en-AU')}</span></li>`).join('')}</ul>
    <p class="small muted">${near ? 'Named places within 3 km of where it has been recorded, with the number of records around each.' : 'Number of records at each spot.'}</p>` : ''}
    <a class="btn" href="#/map/sp/${sp.id}">${icon.pin} Show where it's reported</a>
  </section>`;
}

// Lists hub
function renderLists() {
  const now = new Date();
  const t = totals(state.sightings, now);
  const seen = seenSet();
  const month = now.getMonth() + 1;
  const tg = targets({ seen, month, ...targetOpts() }).slice(0, 5);
  const outings = state.outings.slice().sort((a, b) => b.startedAt - a.startedAt);
  const years = yearTotals(state.sightings).filter(y => y.year !== String(now.getFullYear()));
  view.innerHTML = `
    <header class="page-head"><h1>Lists</h1><div class="head-actions"><button class="iconbtn" data-search aria-label="Search everything">${icon.search}</button></div></header>
    <div class="quicklinks pad-x"><a class="btn" href="#/stats">${icon.chart} Stats</a><a class="btn" href="#/learn">${icon.learn} Learn</a></div>
    <div class="totals">
      <a href="#/list/life"><b>${t.life}</b><span>Life list</span></a>
      <a href="#/list/year"><b>${t.year}</b><span>${now.getFullYear()} list</span></a>
      <a href="#/list/month"><b>${t.month}</b><span>${MONTHS[now.getMonth()]}</span></a>
    </div>

    <section class="block">
      <div class="block-h"><h2 class="h2">Targets for ${MONTHS[now.getMonth()]}</h2><a href="#/targets">See all</a></div>
      <p class="muted small">Birds you haven't seen that are most often reported in SEQ this month.</p>
      <a class="btn btn--block near-btn" href="#/targets" data-near>${icon.pin} Find targets near me</a>
      <ul class="rows">${tg.map(s => rowSpecies(s, `${RARITY[s.rarity].label}. ${s.habitats.map(h => HABITATS[h]).slice(0, 2).join(', ')}`)).join('') || '<li class="muted pad">You have seen every likely bird for this month. Impressive.</li>'}</ul>
    </section>

    <section class="block">
      <div class="block-h"><h2 class="h2">Patches</h2><a href="#/map" data-newpatch>New patch</a></div>
      <p class="muted small">A patch is a place you visit often, like your yard or a local park. Any sighting inside its circle counts automatically.</p>
      ${state.patches.length ? `<ul class="patches">${state.patches.map(p => {
        const inside = state.sightings.filter(s => inPatch(s, p));
        const pt = totals(inside, now);
        return `<li><a href="#/patch/${p.id}"><strong>${esc(p.name)}</strong><span class="muted small">${p.radiusKm} km radius</span>
          <span class="patch-nums"><span><b>${pt.life}</b> life</span><span><b>${pt.year}</b> ${now.getFullYear()}</span><span><b>${pt.month}</b> ${MONTHS[now.getMonth()].slice(0, 3)}</span></span></a></li>`;
      }).join('')}</ul>` : '<p class="empty-inline">No patches yet. Add your yard first: it is the most fun list to grow.</p>'}
    </section>

    <section class="block">
      <div class="block-h"><h2 class="h2">Outings</h2><a href="#/log">All sightings</a></div>
      ${outings.length ? `<ul class="rows">${outings.slice(0, 12).map(o => {
        const n = state.sightings.filter(s => s.outingId === o.id).length;
        return `<li><a class="row" href="#/outing/${o.id}"><span class="row-main"><strong>${esc(o.place || 'Unnamed place')}</strong><span class="muted small">${fmtDate(o.date)}, ${o.time}${o.endedAt ? (o.durationMin ? `, ${o.durationMin} min` : '') : ', in progress'}</span></span><span class="row-n">${n}</span></a></li>`;
      }).join('')}</ul>` : '<p class="empty-inline">Start an outing with the + button to tally everything you see at one spot.</p>'}
    </section>

    ${years.length ? `<section class="block"><h2 class="h2">Past years</h2><ul class="rows">${years.map(y => `<li><a class="row" href="#/list/${y.year}"><span class="row-main"><strong>${y.year}</strong></span><span class="row-n">${y.count}</span></a></li>`).join('')}</ul></section>` : ''}
  `;
  view.onclick = e => {
    if (e.target.closest('[data-search]')) openSearch();
    if (e.target.closest('[data-newpatch]')) state.mapMode = 'patch';
    if (e.target.closest('[data-near]')) { (state.targetF ||= { month: now.getMonth() + 1, habitat: '', scope: 'life' }).scope = 'near'; }
  };
  view.onchange = null;
}

function rowSpecies(s, sub, right = '') {
  const seen = seenSet().has(s.id);
  return `<li><a class="row row--sp" href="#/bird/${s.id}"><span class="row-thumb ${seen ? 'row-thumb--seen' : ''}">${birdImg(s)}</span>
    <span class="row-main"><strong>${esc(s.name)}</strong><span class="muted small">${sub}</span></span>${right || band(s.id, seen)}</a></li>`;
}

// A row of kind chips (shown only once other animals or plants are in the dex).
function kindChips(current, attr = 'data-lk', withAll = true) {
  if (kindsPresent.length < 2) return '';
  const opts = [...(withAll ? [['all', 'Everything']] : []), ...kindsPresent.map(k => [k, KINDS[k].label])];
  return `<div class="chips chips--scroll" role="group" aria-label="Kind">${opts.map(([k, l]) => `<button class="chip ${k !== 'all' ? `kind--${k} chip--kind` : ''} ${current === k ? 'chip--on' : ''}" ${attr}="${k}" aria-pressed="${current === k}">${l}</button>`).join('')}</div>`;
}

function renderList(period, patchId = null) {
  const now = new Date();
  const patch = patchId ? state.patches.find(p => p.id === patchId) : null;
  if (patchId && !patch) { location.hash = '#/lists'; return; }
  let src = state.sightings;
  if (patch) src = src.filter(s => inPatch(s, patch));
  const map = speciesList(src.filter(periodFilter(period, now)));
  const lk = state.listKind || 'all';
  let entries = [...map.entries()].map(([id, e]) => ({ sp: byId.get(id), ...e })).filter(e => e.sp && (lk === 'all' || e.sp.kind === lk));
  if (state.listSort === 'dex') entries.sort((a, b) => a.sp.id - b.sp.id);
  else entries.sort((a, b) => (b.first.date + b.first.time).localeCompare(a.first.date + a.first.time));
  const label = period === 'life' ? 'Life list' : period === 'year' ? `${now.getFullYear()} list` : period === 'month' ? `${MONTHS[now.getMonth()]} ${now.getFullYear()}` : `${period} list`;
  const base = patch ? `#/patch/${patch.id}` : '#/list';
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a>
      <div><h1>${patch ? esc(patch.name) : label}</h1>${patch ? `<p class="muted small">${label}, within ${patch.radiusKm} km</p>` : ''}</div></header>
    <div class="chips">
      ${['life', 'year', 'month'].map(p => `<a class="chip ${period === p ? 'chip--on' : ''}" href="${patch ? `${base}/${p}` : `${base}/${p}`}">${p === 'life' ? 'Life' : p === 'year' ? now.getFullYear() : MONTHS[now.getMonth()]}</a>`).join('')}
      <span class="spacer"></span>
      <button class="chip" data-sort>${state.listSort === 'dex' ? 'Dex order' : 'Newest first'}</button>
    </div>
    ${kindChips(lk)}
    <p class="list-count"><b>${entries.length}</b> ${entries.length === 1 ? 'species' : 'species'}</p>
    <ul class="rows">${entries.map(e => rowSpecies(e.sp, `First ${fmtDate(e.first.date)}${e.count > 1 ? `, seen ${e.count} times` : ''}`)).join('') || '<li class="muted pad">Nothing on this list yet.</li>'}</ul>
    ${patch ? `<div class="row-end pad"><button class="btn btn--danger btn--quiet" data-delpatch>Delete patch</button></div>` : ''}`;
  view.onclick = async e => {
    if (e.target.closest('[data-sort]')) { state.listSort = state.listSort === 'dex' ? 'date' : 'dex'; renderList(period, patchId); }
    const lkb = e.target.closest('[data-lk]');
    if (lkb) { state.listKind = lkb.dataset.lk; renderList(period, patchId); }
    if (e.target.closest('[data-delpatch]') && await confirmSheet(`Delete ${patch.name}?`, 'Your sightings stay; only the patch list is removed.', 'Delete patch', true)) {
      await db.del('patches', patch.id); state.patches = state.patches.filter(p => p.id !== patch.id); location.hash = '#/lists';
    }
  };
  view.onchange = null;
  hydratePhotos(view);
}

async function renderTargets() {
  const now = new Date();
  const f = state.targetF ||= { month: now.getMonth() + 1, habitat: '', scope: 'life' };
  f.kind ||= 'bird';
  if (f.kind !== 'bird' && f.scope === 'near') f.scope = 'life';
  const lifeSeen = seenSet();
  const seen = f.scope === 'year' ? new Set(state.sightings.filter(periodFilter('year', now)).map(s => s.speciesId)) : lifeSeen;
  const head = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a><h1>Targets</h1></header>
    <div class="chips">
      ${f.kind === 'bird' ? `<button class="chip ${f.scope === 'near' ? 'chip--on' : ''}" data-scope="near">${icon.pin} Near me</button>` : ''}
      <button class="chip ${f.scope === 'life' ? 'chip--on' : ''}" data-scope="life">Life list</button>
      <button class="chip ${f.scope === 'year' ? 'chip--on' : ''}" data-scope="year">${now.getFullYear()} list</button>
      ${f.scope !== 'near' ? `<select class="chip chip--select" data-month aria-label="Month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${f.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>` : ''}
      <select class="chip chip--select ${f.habitat ? 'chip--on' : ''}" data-habitat aria-label="Habitat"><option value="">Any habitat</option>${Object.entries(HABITATS).map(([k, v]) => `<option value="${k}" ${f.habitat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${kindChips(f.kind, 'data-tk', false)}`;
  view.onclick = e => {
    const sc = e.target.closest('[data-scope]'); if (sc) { f.scope = sc.dataset.scope; renderTargets(); }
    const tk = e.target.closest('[data-tk]'); if (tk) { f.kind = tk.dataset.tk; renderTargets(); }
  };
  view.onchange = e => {
    if (e.target.matches('[data-month]')) f.month = Number(e.target.value);
    if (e.target.matches('[data-habitat]')) f.habitat = e.target.value;
    renderTargets();
  };
  if (f.scope === 'near') {
    view.innerHTML = head + `<p class="muted small pad-x" data-near-status>Finding you…</p><ul class="rows pad-x" data-near-list></ul>`;
    let pos = state.lastPos;
    try { if (!pos || Date.now() - pos.at > 120000) { pos = { ...(await getPosition()), at: Date.now() }; state.lastPos = pos; } }
    catch (err) { $('[data-near-status]', view).textContent = err.message; return; }
    if (location.hash !== '#/targets' || f.scope !== 'near') return;
    const { spots, list } = nearbyTargets(pos, lifeSeen, 15);
    const filtered = list.filter(x => { const sp = byId.get(x.id); return sp && (!f.habitat || sp.habitats.includes(f.habitat)); });
    $('[data-near-status]', view).innerHTML = spots.length
      ? `Birds you haven't seen that are recorded at the ${plural(spots.length, 'hotspot')} within 15 km of you. Most often reported first.`
      : 'No hotspots within 15 km. Try the life list targets instead.';
    $('[data-near-list]', view).innerHTML = filtered.slice(0, 60).map(x => {
      const sp = byId.get(x.id);
      return rowSpecies(sp, `Best spot: ${esc(x.best.h.name)} (${x.best.d.toFixed(1)} km)`, pips(sp.rarity));
    }).join('');
    hydratePhotos(view);
    return;
  }
  const list = targets({ seen, month: f.month, habitat: f.habitat, kinds: [f.kind], ...targetOpts() });
  view.innerHTML = head + `
    <p class="muted small pad-x">${KINDS[f.kind].label} you still need that are reported in SEQ in ${MONTHS[f.month - 1]}. The most often reported come first.</p>
    <p class="list-count"><b>${list.length}</b> to find</p>
    <ul class="rows pad-x">${list.map(s => rowSpecies(s, `${RARITY[s.rarity].label}. ${s.habitats.map(h => HABITATS[h]).join(', ')}`, pips(s.rarity))).join('')}</ul>`;
}

function renderOuting(id) {
  const o = state.outings.find(x => x.id === id);
  if (!o) { location.hash = '#/lists'; return; }
  const live = !o.endedAt;
  const editing = live || state.editOuting === id;
  const recs = state.sightings.filter(s => s.outingId === id);
  const counts = new Map(recs.map(r => [r.speciesId, r]));
  const q = state.tallyQ || '';
  const results = q ? matchSpecies(q, 12) : [];
  const ordered = recs.slice().sort((a, b) => b.createdAt - a.createdAt).map(r => byId.get(r.speciesId)).filter(Boolean);
  const mins = live ? Math.round((Date.now() - o.startedAt) / 60000) : o.durationMin;
  const tallyRow = sp => {
    const r = counts.get(sp.id);
    return `<li class="tally-row ${r ? 'tally-row--on' : ''}">
      <a class="tally-sp" href="#/bird/${sp.id}"><span class="row-thumb">${birdImg(sp)}</span><span><strong>${esc(sp.name)}</strong>${!seenSetCache.has(sp.id) || (r && isFirstEver(r)) ? '<span class="lifer">New for your dex</span>' : ''}</span></a>
      ${editing ? `<div class="tally-ctl">${r ? `<button data-dec="${sp.id}" aria-label="One fewer ${esc(sp.name)}">−</button><span class="tally-n">${r.count ?? 'X'}</span>` : ''}<button data-inc="${sp.id}" class="tally-inc" aria-label="Add ${esc(sp.name)}">+</button></div>`
        : `<span class="tally-n">${r?.count ?? 'X'}</span>`}</li>`;
  };
  const seenSetCache = new Set(state.sightings.filter(s => s.outingId !== id).map(s => s.speciesId));
  const isFirstEver = r => !seenSetCache.has(r.speciesId);
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a>
      <div><h1>${esc(o.place || 'Outing')}</h1><p class="muted small">${fmtDate(o.date)}, started ${o.time}${mins != null ? `, ${mins} min` : ''}${!live ? (o.complete ? '. Complete checklist.' : '.') : ''}</p></div></header>
    <p class="list-count"><b>${recs.length}</b> species${!live && o.distanceKm ? `, ${o.distanceKm} km` : ''}</p>
    ${editing ? `<div class="searchbox searchbox--sticky">${icon.search}<input type="search" placeholder="Add a species: type a name" value="${esc(q)}" data-tq aria-label="Find a species to add"></div>
      ${q ? `<ul class="tally-list">${results.map(tallyRow).join('') || '<li class="muted pad">Nothing by that name in the dex.</li>'}</ul><hr class="rule">` : ''}` : ''}
    <ul class="tally-list">${ordered.map(tallyRow).join('') || (editing ? '<li class="muted pad">Search above to add the first species. Tap + again each time you count another.</li>' : '')}</ul>
    ${o.notes ? `<p class="pad-x">${esc(o.notes)}</p>` : ''}
    <div class="row-end pad">
      ${live ? `<button class="btn btn--danger btn--quiet" data-cancel>Discard</button><span class="spacer"></span><button class="btn btn--primary" data-finish>Finish outing</button>`
             : `<button class="btn btn--danger btn--quiet" data-cancel>Delete outing</button><span class="spacer"></span><button class="btn" data-editbirds>${editing ? 'Done editing species' : 'Edit species'}</button><button class="btn" data-finish>Edit details</button>`}
    </div>`;
  const tq = $('[data-tq]', view);
  tq?.addEventListener('input', () => {
    state.tallyQ = tq.value;
    const pos = tq.selectionStart;
    renderOuting(id);
    const n = $('[data-tq]', view); n.focus(); n.setSelectionRange(pos, pos);
  });
  view.onclick = async e => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc || dec) {
      e.preventDefault();
      await tally(o, Number((inc || dec).dataset.inc || (inc || dec).dataset.dec), inc ? 1 : -1);
      if (inc && state.tallyQ) state.tallyQ = '';
      keepFocus(() => renderOuting(id), { fallback: '[data-tq], #view h1' });
    }
    if (e.target.closest('[data-finish]')) openFinishOuting(o);
    if (e.target.closest('[data-editbirds]')) { state.editOuting = editing ? null : id; state.tallyQ = ''; renderOuting(id); }
    if (e.target.closest('[data-cancel]') && await confirmSheet(live ? 'Discard this outing?' : 'Delete this outing?', `This removes the outing and its ${plural(recs.length, 'sighting')}. This cannot be undone.`, live ? 'Discard' : 'Delete', true)) {
      for (const r of recs) await deleteSighting(r.id);
      await db.del('outings', id);
      state.outings = state.outings.filter(x => x.id !== id);
      if (state.activeOutingId === id) { state.activeOutingId = null; await db.kvSet('activeOuting', null); }
      location.hash = '#/lists';
    }
  };
  view.onchange = null;
}

function renderLog() {
  const list = state.sightings.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const byDate = {};
  list.forEach(s => (byDate[s.date] ||= []).push(s));
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a><h1>All sightings</h1></header>
    ${Object.entries(byDate).map(([d, items]) => `<section class="block"><h2 class="h2">${fmtDate(d)}</h2><ul class="rows">${items.map(s => {
      const sp = byId.get(s.speciesId);
      return `<li><button class="row row--sp" data-edit="${s.id}"><span class="row-thumb">${s.photoId ? `<img data-photo="${s.photoId}" alt="">` : birdImg(sp)}</span>
        <span class="row-main"><strong>${esc(sp?.name)}</strong><span class="muted small">${s.time || ''} ${esc(s.place || '')}</span></span><span class="row-n">${s.count ?? 'X'}</span></button></li>`;
    }).join('')}</ul></section>`).join('') || '<div class="empty"><p>No sightings yet. Tap + to log your first sighting.</p></div>'}`;
  view.onclick = e => { const ed = e.target.closest('[data-edit]'); if (ed) openSightingSheet({ sightingId: Number(ed.dataset.edit) }); };
  view.onchange = null;
}

// Map
// One load at a time; a failed one (no signal, not saved yet) is tidied away so the next try starts clean.
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return leafletP ||= new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js'; s.onload = res;
    s.onerror = () => { s.remove(); css.remove(); leafletP = null; rej(new Error('The map could not load')); };
    document.head.append(s);
  });
}
// No signal: a card below the map's controls (the search bar and chips stay usable above it).
// 'nolib': the map itself isn't on the phone yet. 'tiles': the map works, but areas not opened before stay blank.
function mapNote(kind) {
  const wrap = $('.mapwrap', view);
  if (!wrap || $('.map-note', wrap) || (kind === 'tiles' && state.mapNoteHidden)) return;
  const n = document.createElement('div');
  n.className = `map-note map-note--${kind}`;
  n.innerHTML = kind === 'nolib'
    ? `<h2 class="map-note-h">The map needs signal the first time</h2>
      <p>Open it once with signal and it works offline after that, showing the areas you looked at.</p>
      <button type="button" class="btn btn--small btn--primary" data-map-retry>Try again</button>`
    : `<p><strong>No signal.</strong> Areas you haven't opened before stay blank. Hotspots and your sightings still show.</p>
      <button type="button" class="iconbtn" data-map-note-x aria-label="Hide this message">${icon.close}</button>`;
  wrap.append(n);
  announce(kind === 'nolib' ? 'The map needs signal the first time.' : "No signal. Areas you haven't opened before stay blank.");
}
// Map or satellite base layers, remembered on this device. Returns a control element to put in the page.
function baseLayers(map, L, { onTileError } = {}) {
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  const sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 19, crossOrigin: true, attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics and the GIS User Community' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, opacity: 0.9 }),
  ]);
  const ctl = document.createElement('div');
  ctl.className = 'layer-toggle';
  ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Map style');
  ctl.innerHTML = '<button type="button" data-layer="map">Map</button><button type="button" data-layer="sat">Satellite</button>';
  const set = mode => {
    if (mode === 'sat') { map.removeLayer(osm); sat.addTo(map); } else { map.removeLayer(sat); osm.addTo(map); }
    map.getContainer().classList.toggle('map--sat', mode === 'sat');
    ctl.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layer === mode)));
  };
  set(state.settings.mapLayer === 'sat' ? 'sat' : 'map');
  if (onTileError) [osm, ...sat.getLayers()].forEach(l => l.on('tileerror', onTileError));
  ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    e.stopPropagation();
    state.settings.mapLayer = b.dataset.layer;
    db.kvSet('settings', state.settings);
    set(b.dataset.layer);
  });
  L.DomEvent.disableClickPropagation(ctl);
  return ctl;
}

async function renderMap(spId = null, at = null) {
  const mode = state.mapMode; state.mapMode = null;
  const f = state.mapF ||= { show: 'all', hot: true, hotFocus: false, need: false };
  const focus = spId ? byId.get(spId) : null;
  const hotOn = focus ? f.hotFocus : f.hot;
  if (state.map) { state.map.remove(); state.map = null; }
  view.innerHTML = `
    <h1 class="sr-only">Map</h1>
    <div class="mapwrap">
      <div id="map" aria-label="Map of your sightings and SEQ birding hotspots"></div>
      <div class="map-top">
        <div class="search-bar search-bar--map">${icon.search}<input type="search" placeholder="Search species, hotspots, suburbs, parks" aria-label="Search the map" autocomplete="off" data-mq>
          <button type="button" class="iconbtn hidden" data-mqx aria-label="Clear search">${icon.close}</button></div>
        <ul class="rows map-res hidden" data-mres></ul>
      </div>
      <div class="map-ctl chips">
        ${focus ? `<a class="chip chip--on" href="#/map" aria-label="Stop showing ${esc(focus.name)}">${esc(focus.name)} ✕</a>` : ''}
        <button class="chip ${hotOn ? 'chip--on' : ''}" data-hot aria-pressed="${hotOn}">Hotspots</button>
        ${!focus ? `<button class="chip ${f.need ? 'chip--on' : ''}" data-need aria-pressed="${f.need}">Birds I need</button>` : ''}
        <button class="chip ${f.show === 'all' ? 'chip--on' : ''}" data-mshow="all" aria-pressed="${f.show === 'all'}">My sightings</button>
        <button class="chip ${f.show === 'photos' ? 'chip--on' : ''}" data-mshow="photos" aria-pressed="${f.show === 'photos'}">With photos</button>
        <button class="chip ${f.show === 'none' ? 'chip--on' : ''}" data-mshow="none" aria-pressed="${f.show === 'none'}">Hide mine</button>
        <button class="chip" data-locate>${icon.pin} Me</button>
      </div>
      <button class="btn btn--primary map-patch" data-patch>New patch here</button>
      <div class="map-cross hidden" aria-hidden="true"></div>
    </div>`;
  view.onchange = null;
  try { await loadLeaflet(); } catch (_) {
    if (!location.hash.startsWith('#/map')) return;
    mapNote('nolib');
    view.onclick = e => { if (e.target.closest('[data-map-retry]')) keepFocus(() => renderMap(spId, at), { fallback: '[data-map-retry], [data-mq]' }); };
    return;
  }
  if (!location.hash.startsWith('#/map')) return;
  const L = window.L;
  const map = state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView(state.mapView?.c || [-27.47, 153.02], state.mapView?.z || 9);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Offline, a map square not opened before fails to load: say why the map has gaps (again on the next visit).
  $('.mapwrap', view).append(baseLayers(map, L, { onTileError: () => { if (!navigator.onLine) { state.tilesOffline = true; mapNote('tiles'); } } }));
  if (!navigator.onLine && state.tilesOffline) mapNote('tiles');
  map.on('moveend', () => { state.mapView = { c: map.getCenter(), z: map.getZoom() }; });
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--azure').trim(), ink = css.getPropertyValue('--lori').trim();
  for (const p of state.patches) {
    L.circle([p.lat, p.lng], { radius: p.radiusKm * 1000, color: ink, weight: 2, fillOpacity: 0.06, dashArray: '6 6', bubblingMouseEvents: false })
      .addTo(map).bindPopup(`<strong>${esc(p.name)}</strong><br><a href="#/patch/${p.id}">Open patch list</a>`);
  }
  const seen = seenSet();
  if (focus) {
    const pts = pointsFor(focus.id);
    const max = Math.max(1, ...pts.map(p => p[2]));
    pts.forEach(([la, ln, c]) => L.circle([la, ln], { bubblingMouseEvents: false, radius: 450 + 900 * Math.sqrt(c / max), stroke: false, fillColor: ink, fillOpacity: 0.25 + 0.45 * Math.sqrt(c / max) })
      .addTo(map).bindPopup(`<strong>${esc(focus.name)}</strong><br>${c.toLocaleString('en-AU')} records in this 1 km square since 2016`));
    if (pts.length && !state.mapView) map.fitBounds(pts.map(p => [p[0], p[1]]), { padding: [40, 40], maxZoom: 12 });
  }
  const hotMarkers = [];
  if (hotOn) {
    const gold = css.getPropertyValue('--gold').trim();
    const maxNeed = Math.max(1, ...hotspots().map(h => h.sp.filter(([id]) => !seen.has(id)).length));
    for (const h of hotspots()) {
      const has = focus ? h.sp.find(([id]) => id === focus.id) : true;
      if (focus && !has) continue;
      const got = h.sp.filter(([id]) => seen.has(id)).length;
      const needAll = h.sp.filter(([id]) => !seen.has(id));
      const need = needAll.slice(0, 6).map(([id]) => byId.get(id)).filter(Boolean);
      const t = needAll.length / maxNeed;
      const style = f.need && !focus
        ? { radius: 3 + 11 * t, color: '#3A2A00', weight: 1.5, fillColor: t > 0.66 ? ink : gold, fillOpacity: 0.35 + 0.6 * t, bubblingMouseEvents: false }
        : { radius: 4 + Math.min(6, h.rich / 30), color: '#3A2A00', weight: 1.5, fillColor: gold, fillOpacity: 0.9, bubblingMouseEvents: false };
      const mk = L.circleMarker([h.lat, h.lng], style);
      hotMarkers.push({ h, mk });
      mk.addTo(map).bindPopup(`<div data-desc><span class="pop-h">${esc(h.name)}</span>${h.rich} dex birds recorded here. You have seen ${got}.<p class="pop-src">Looking up this place…</p></div>
          ${need.length ? `Still to find (${needAll.length}):<ul class="pop-need">${need.map(sp => `<li><a href="#/bird/${sp.id}">${esc(sp.name)}</a></li>`).join('')}</ul>` : ''}
          <a href="https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}" target="_blank" rel="noopener">Directions</a>`, { maxWidth: 260 });
      mk.on('popupopen', async ev => {
        const html = await describeArea(h.lat, h.lng, { hotspot: h, seen }).catch(() => null);
        const box = ev.popup.getElement()?.querySelector('[data-desc]');
        if (html && box) { box.innerHTML = html; ev.popup.update(); }
      });
    }
  }
  const groups = {};
  state.sightings.filter(s => s.lat != null && f.show !== 'none' && (f.show === 'all' || s.photoId)).forEach(s => {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`; (groups[k] ||= []).push(s);
  });
  const pts = [];
  for (const items of Object.values(groups)) {
    const s0 = items[0];
    pts.push([s0.lat, s0.lng]);
    const names = [...new Set(items.map(s => s.speciesId))].map(id => byId.get(id)).filter(Boolean);
    const kinds = [...new Set(names.map(sp => sp.kind))];
    const dot = kinds.length === 1 ? (css.getPropertyValue(`--k-${kinds[0]}`).trim() || accent) : accent;
    L.circleMarker([s0.lat, s0.lng], { radius: Math.min(14, 6 + names.length), color: '#fff', weight: 2, fillColor: dot, fillOpacity: 0.95, bubblingMouseEvents: false })
      .addTo(map).bindPopup(`<strong>${esc(s0.place || 'Sighting')}</strong><br>${names.slice(0, 12).map(sp => `<a href="#/bird/${sp.id}">${esc(sp.name)}</a>`).join('<br>')}${names.length > 12 ? `<br>and ${names.length - 12} more` : ''}`);
  }
  if (at) {
    map.setView(at, 15);
    const near = hotMarkers.find(({ h }) => Math.abs(h.lat - at[0]) < 0.002 && Math.abs(h.lng - at[1]) < 0.002);
    if (near) setTimeout(() => near.mk.openPopup(), 300);
  }
  else if (!state.mapView && !focus && pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  const startPatch = async () => {
    $('.map-cross').classList.remove('hidden');
    let circle = L.circle(map.getCenter(), { radius: 1000, color: ink, weight: 2, fillOpacity: 0.1 }).addTo(map);
    const move = () => circle.setLatLng(map.getCenter());
    map.on('move', move);
    const s = openSheet(`<h2 class="sheet-title">New patch</h2>
      <p class="muted small">Move the map so the circle covers your patch, then name it.</p>
      <form class="form" data-form>
        <label class="field"><span>Name</span><input name="name" placeholder="e.g. Our yard" required autocomplete="off"></label>
        <label class="field"><span>Radius: <output data-rout>1</output> km</span><input type="range" name="r" min="0.1" max="8" step="0.1" value="1"></label>
        <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn--primary">Save patch</button></div>
      </form>`, { modal: false, cls: 'sheet-wrap--map' });
    const form = $('[data-form]', s);
    form.r.addEventListener('input', () => { circle.setRadius(form.r.value * 1000); $('[data-rout]', s).textContent = form.r.value; });
    state.onSheetClose = () => { map.off('move', move); circle.remove(); $('.map-cross')?.classList.add('hidden'); };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.name.value.trim()) return;
      const c = map.getCenter();
      const p = { name: form.name.value.trim(), lat: c.lat, lng: c.lng, radiusKm: Number(form.r.value) };
      p.id = await db.add('patches', p);
      state.patches.push(p);
      closeSheet();
      toast(`${p.name} added`);
      location.hash = `#/patch/${p.id}`;
    });
  };
  // ---- map search ----
  const mq = $('[data-mq]', view), mres = $('[data-mres]', view), mqx = $('[data-mqx]', view);
  let results = [], mtimer = null, tempMarker = null;
  const goTo = r => {
    mres.classList.add('hidden'); mq.blur();
    if (r.bird) { location.hash = `#/map/sp/${r.bird}`; return; }
    map.setView([r.lat, r.lng], r.zoom || 15);
    const hm = hotMarkers.find(({ h }) => Math.abs(h.lat - r.lat) < 0.0005 && Math.abs(h.lng - r.lng) < 0.0005);
    if (hm) { setTimeout(() => hm.mk.openPopup(), 250); return; }
    tempMarker?.remove();
    tempMarker = L.marker([r.lat, r.lng]).addTo(map).bindPopup(`<span class="pop-h">${esc(r.name)}</span>${esc(r.kind || '')}`);
    setTimeout(() => tempMarker.openPopup(), 250);
  };
  const resRow = (r, i) => `<li><button type="button" class="row" data-ri="${i}">${r.bird ? `<span class="row-thumb">${birdImg(byId.get(r.bird))}</span>` : ''}<span class="row-main"><strong>${esc(r.name)}</strong><span class="small muted">${esc(r.kind)}</span></span></button></li>`;
  const showRes = (list, extra = '') => { results = list; mres.innerHTML = list.map(resRow).join('') + extra; mres.classList.toggle('hidden', !list.length && !extra); hydratePhotos(mres); };
  const localResults = text => {
    if (!text) {
      // Nothing typed: suggest the hotspots with the most birds she still needs.
      const best = hotspots().map(h => ({ h, n: h.sp.filter(([id]) => !seen.has(id)).length })).sort((a, b) => b.n - a.n).slice(0, 5)
        .map(({ h, n }) => ({ name: h.name, lat: h.lat, lng: h.lng, kind: `Hotspot: ${n} birds you still need` }));
      return [...state.patches.map(p => ({ name: p.name, lat: p.lat, lng: p.lng, kind: 'Your patch', zoom: 14 })), ...best];
    }
    const birds = matchSpecies(text, 5).map(sp => ({ bird: sp.id, name: sp.name, kind: `${KINDS[sp.kind].one.replace(/^./, c => c.toUpperCase())}: show where it's reported` }));
    return [...birds, ...localPlaceMatches(text, 8)];
  };
  const runSearch = async () => {
    const text = mq.value.trim();
    const local = localResults(text);
    if (text.length < 3) { showRes(local); return; }
    showRes(local, '<li class="small muted pad">Searching places…</li>');
    try {
      const remote = await searchAddress(text);
      if (mq.value.trim() !== text) return;
      showRes([...local, ...remote.map(r => ({ ...r, zoom: 14 }))], remote.length || local.length ? '' : '<li class="small muted pad">Nothing found. Try a suburb, park or bird name.</li>');
    } catch (err) { showRes(local, `<li class="small muted pad">${esc(err.message)}</li>`); }
  };
  mq.addEventListener('focus', () => showRes(localResults(mq.value.trim())));
  mq.addEventListener('input', () => { mqx.classList.toggle('hidden', !mq.value); clearTimeout(mtimer); showRes(localResults(mq.value.trim())); mtimer = setTimeout(runSearch, 700); });
  mq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(mtimer); runSearch(); } if (e.key === 'Escape') { mres.classList.add('hidden'); mq.blur(); } });
  // Tap anywhere on the map for a short description of that spot.
  map.on('click', async e => {
    if (!mres.classList.contains('hidden')) { mres.classList.add('hidden'); return; }
    if (sheetOpen()) return;
    const { lat, lng } = e.latlng;
    const pop = L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent('<p class="pop-src">Looking up this spot…</p>').openOn(map);
    const html = await describeArea(lat, lng, { seen }).catch(() => '<p class="pop-desc">Couldn\'t look this spot up. Check the internet connection.</p>');
    if (map.hasLayer(pop)) pop.setContent(`${html}<a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>`);
  });
  view.onclick = async e => {
    const ri = e.target.closest('[data-ri]');
    if (ri) { goTo(results[Number(ri.dataset.ri)]); return; }
    if (e.target.closest('[data-map-note-x]')) { state.mapNoteHidden = true; $('.map-note', view)?.remove(); mq.focus(); return; }
    if (e.target.closest('[data-mqx]')) { mq.value = ''; mqx.classList.add('hidden'); tempMarker?.remove(); mq.focus(); showRes(localResults('')); return; }
    if (e.target.closest('[data-need]')) { f.need = !f.need; keepFocus(() => renderMap(spId)); return; }
    const ms = e.target.closest('[data-mshow]');
    if (ms) { f.show = ms.dataset.mshow; keepFocus(() => renderMap(spId)); }
    if (e.target.closest('[data-hot]')) { if (focus) f.hotFocus = !f.hotFocus; else f.hot = !f.hot; keepFocus(() => renderMap(spId)); }
    if (e.target.closest('[data-patch]')) startPatch();
    if (e.target.closest('[data-locate]')) {
      try { const p = await getPosition(); map.setView([p.lat, p.lng], 15); L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 3, fillColor: ink, fillOpacity: 1 }).addTo(map); }
      catch (err) { toast(err.message); }
    }
  };
  if (mode === 'patch') {
    try { const p = await getPosition(); map.setView([p.lat, p.lng], 14); } catch (_) {}
    startPatch();
  }
  setTimeout(() => map.invalidateSize(), 50);
}

// Badges: a trophy shelf. Each section has its own emblem (inline SVG, drawn in the section's colour by the CSS).
// Earned badges are filled and come first; the rest are outlined, with a ring that fills as she gets closer.
const EMBLEM = {
  milestone: '<path class="e-tail" d="M21 40l-6 20 9-4.5 5 7.5 4-17zM43 40l6 20-9-4.5-5 7.5-4-17z"/><circle class="e-body" cx="32" cy="28" r="22"/><circle class="e-line" cx="32" cy="28" r="17"/>',
  kind: '<path class="e-body" d="M32 4l24 14v28L32 60 8 46V18z"/><path class="e-line" d="M32 11l18 10.5v21L32 53 14 42.5v-21z"/>',
  rarity: '<path class="e-body" d="M20 8h24l14 16-26 34L6 24z"/><path class="e-line" d="M6 24h52M20 8l6 16 6-16 6 16 6-16M26 24l6 34 6-34"/>',
  habit: '<path class="e-body" d="M32 5l23 8v17c0 15-10 25-23 29C19 55 9 45 9 30V13z"/><path class="e-line" d="M32 11l17 6v13c0 11-7.5 19-17 22.5C22.5 49 15 41 15 30V17z"/>',
  learning: '<rect class="e-tail" x="15" y="7" width="36" height="46" rx="6" transform="rotate(9 33 30)"/><rect class="e-body" x="12" y="10" width="36" height="46" rx="6" transform="rotate(-5 30 33)"/>',
  habitat: '<path class="e-body" d="M32 4c15 9 23 23 20 37-2.5 10-11 16-20 19-9-3-17.5-9-20-19C9 27 17 13 32 4z"/><path class="e-line" d="M32 13v46M32 27l-9-7M32 27l9-7M32 39l-11-8M32 39l11-8M32 50l-8-6M32 50l8-6"/>',
  group: '<rect class="e-body" x="5" y="17" width="54" height="30" rx="8"/><path class="e-line" d="M11 22.5h42"/>',
};
let badgesWaited = false, badgesEarned = 0;
function renderBadges() {
  const learning = learnStats();
  // Learning progress loads from the kv store at start-up; draw again once it's in.
  if (!Object.keys(learning).length && !badgesWaited) { badgesWaited = true; learnReady().then(() => { if (location.hash === '#/badges') renderBadges(); }).catch(() => {}); }
  const list = badges(state.sightings, state.outings, learning);
  const earned = list.filter(b => b.done).length;
  const sections = [['milestone', 'Milestones'], ['kind', 'Animals & plants'], ['rarity', 'Rarities'], ['habit', 'Habits'], ['learning', 'Learning'], ['habitat', 'Habitats'], ['group', 'Complete a group']]
    .filter(([k]) => list.some(b => b.kind === k));
  const shown = k => k !== 'rarity' && k !== 'habitat'; // gems and leaves carry no number
  const badge = (b, k) => `<li class="badge badge--${k} ${b.done ? 'badge--done' : ''}${k === 'kind' ? ` kind--${b.id.split('-')[1]}` : ''}" style="--p:${Math.round(b.have / b.need * 100)}">
      <span class="emb" aria-hidden="true">${b.done ? '' : '<span class="emb-ring"></span>'}<svg viewBox="0 0 64 64">${EMBLEM[k]}</svg>${shown(k) ? `<b class="emb-n">${b.need}</b>` : ''}</span>
      <strong class="badge-name">${esc(b.name)}</strong>
      <span class="badge-desc">${esc(b.desc)}<span class="sr-only">. ${b.done ? 'Earned' : `${b.have} of ${b.need} so far`}.</span></span></li>`;
  view.innerHTML = `
    <header class="page-head"><h1>Badges</h1><div class="head-actions"><button class="iconbtn" data-search aria-label="Search everything">${icon.search}</button><a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a></div></header>
    <div class="quicklinks pad-x"><a class="btn" href="#/learn">${icon.learn} Learn</a><a class="btn" href="#/stats">${icon.chart} Stats</a>${leaderboardLink()}</div>
    <p class="list-count shelf-count"><b data-earned>${earned}</b> of ${list.length} earned</p>
    ${sections.map(([k, title]) => {
      const items = list.filter(b => b.kind === k);
      const done = items.filter(b => b.done);
      return `<section class="block shelf-sec"><h2 class="h2 shelf-h"><span>${title}</span><span class="shelf-n" aria-hidden="true">${done.length}/${items.length}</span></h2>
        <ul class="shelf">${[...done, ...items.filter(b => !b.done)].map(b => badge(b, k)).join('')}</ul></section>`;
    }).join('')}`;
  // The earned count stamps up from where it was last time (from nothing on the first visit).
  countUp($('[data-earned]', view), badgesEarned, earned, { delay: 150 });
  badgesEarned = earned;
  view.onclick = e => { if (e.target.closest('[data-search]')) openSearch(); }; view.onchange = null;
}

// Settings
async function renderSettings() {
  const pack = await loadCallPack();
  const packKinds = {};
  for (const id of Object.keys(pack)) { const k = kindOf(Number(id)); packKinds[k] = (packKinds[k] || 0) + 1; }
  const callWho = Object.entries(packKinds).map(([k, n]) => plural(n, KINDS[k].one, KINDS[k].label.toLowerCase())).join(' and ');
  let usage = '';
  try { const est = await navigator.storage.estimate(); usage = `${(est.usage / 1e6).toFixed(1)} MB used on this phone`; } catch (_) {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  if (location.hash !== '#/settings') return; // left while the call pack was loading
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/badges" aria-label="Back">${icon.back}</a><h1>Settings</h1></header>
    <section class="block ready" aria-labelledby="field-h">
      <h2 class="h2" id="field-h">Ready for the field</h2>
      <p class="muted small" data-field-sum>What works on this phone with no signal.</p>
      <ul class="ready-list" data-field-list>${FIELD.map(f => `<li class="ready-row" data-field="${f.key}">
        <span class="ready-mark" aria-hidden="true"></span>
        <div class="ready-main"><strong>${f.label}</strong><span class="small muted" data-field-text tabindex="-1">Checking…</span>
          <div class="meter meter--thin hidden" data-field-prog style="--p:0%"><span></span></div></div>
        <div class="ready-act" data-field-act></div></li>`).join('')}</ul>
    </section>
    <section class="block" data-account></section>
    <section class="block">
      <label class="field"><span>Theme</span><select data-theme>${[['auto', 'Match my phone'], ['light', 'Light'], ['dark', 'Dark'], ['outdoor', 'Outdoor (high contrast for bright sun)']].map(([v, l]) => `<option value="${v}" ${state.settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${state.installPrompt ? '<button class="btn btn--primary" data-install>Install app on this phone</button>' : `<p class="small muted">${matchMedia('(display-mode: standalone)').matches ? "Installed on this phone." : 'To install: open the browser menu, then Add to Home screen.'}</p>`}
      <button class="btn btn--quiet" data-welcome>Show the welcome screen</button>
    </section>
    <section class="block">
      <h2 class="h2">Send to eBird</h2>
      <p class="muted small">Download your bird sightings as an eBird Record Format file (eBird only takes birds, so other animals and plants are left out). On a computer, go to ebird.org, then Submit, then Import data, and choose "eBird Record Format (Extended)". eBird may ask you to confirm a few bird names and locations.</p>
      <button class="btn" data-ebird>Export for eBird</button>
    </section>
    <section class="block">
      <h2 class="h2">Backup</h2>
      <p class="muted small">Your sightings and photos live only on this phone${persisted ? '' : ', and clearing the browser\'s site data would erase them'}. Save a backup now and then. ${usage}</p>
      <div class="row-start"><button class="btn" data-backup>Save backup</button>
      <label class="btn">Restore backup<input type="file" accept=".json,application/json" data-restore hidden></label></div>
    </section>
    <section class="block">
      <h2 class="h2">About</h2>
      <p class="small">Photos come from Wikipedia, Wikimedia Commons and iNaturalist contributors (via the Atlas of Living Australia), each credited on its page. Each species' write-up lists the sources it is based on. Calls are from iNaturalist (via the ALA) and Wikimedia Commons. The clips saved for offline are shortened, level-matched copies of iNaturalist recordings, each credited where it plays. Maps &copy; OpenStreetMap contributors; satellite imagery &copy; Esri, Maxar and Earthstar Geographics.</p>
      <p class="small">Hotspots, seasons and rarity come from Atlas of Living Australia records for SEQ since 2016 (including eBird and BirdLife Australia data). Birds: 40,000+ records is Common, 15,000+ Fairly common, 4,000+ Uncommon, 800+ Scarce and fewer is Rare. Other animals and plants are recorded far less often than birds, so each kind is ranked against its own kind: the most-recorded fifth of that kind is Common, the next fifth Fairly common, and so on down to Rare. Seasons are also compared within each kind. Record counts lean towards easy-to-see species and popular spots, so treat rarity as a guide.</p>
      <p class="small muted">Version 3.0</p>
    </section>
    <section class="block">
      <h2 class="h2">Start over</h2>
      <button class="btn btn--danger btn--quiet" data-wipe>Delete all my sightings</button>
    </section>`;
  renderAccountSection($('[data-account]', view));
  wireField(callWho);
  view.onchange = async e => {
    if (e.target.matches('[data-colour]')) { state.settings.colourUnseen = e.target.checked; await db.kvSet('settings', state.settings); }
    if (e.target.matches('[data-theme]')) { state.settings.theme = e.target.value; applyTheme(); await db.kvSet('settings', state.settings); }
    if (e.target.matches('[data-restore]')) {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.app !== 'birddex') throw new Error();
        if (!await confirmSheet('Restore this backup?', `It replaces everything on this phone with ${plural(data.sightings.length, 'sighting')} from ${fmtDate(data.savedAt?.slice(0, 10))}.`, 'Restore')) return;
        for (const s of ['sightings', 'outings', 'patches', 'photos']) await db.clear(s);
        for (const p of data.photos) { const blob = await (await fetch(p.data)).blob(); await db.put('photos', { id: p.id, blob, at: p.at }); }
        for (const s of data.sightings) await db.put('sightings', s);
        for (const o of data.outings) await db.put('outings', o);
        for (const p of data.patches) await db.put('patches', p);
        if (data.settings) await db.kvSet('settings', data.settings);
        photoUrls.clear();
        await loadData();
        toast('Backup restored');
        location.hash = '#/dex';
      } catch (_) { toast('That file is not a BirdyDex backup.'); }
    }
  };
  view.onclick = async e => {
    if (e.target.closest('[data-install]')) promptInstall();
    if (e.target.closest('[data-welcome]')) showWelcome();
    if (e.target.closest('[data-ebird]')) {
      if (!state.sightings.some(x => byId.get(x.speciesId)?.kind === 'bird')) { toast('Log a bird first. eBird only takes birds.'); return; }
      download(`birddex-ebird-${todayStr()}.csv`, new Blob([toEbirdCsv(state.sightings, state.outings)], { type: 'text/csv' }));
    }
    if (e.target.closest('[data-backup]')) {
      const photos = [];
      for (const p of await db.all('photos')) if (p.blob) photos.push({ id: p.id, at: p.at, data: await blobToDataUrl(p.blob) });
      const data = { app: 'birddex', version: 1, savedAt: new Date().toISOString(), sightings: state.sightings, outings: state.outings, patches: state.patches, settings: state.settings, photos };
      download(`birddex-backup-${todayStr()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    }
    if (e.target.closest('[data-wipe]') && await confirmSheet('Delete all sightings?', 'Every sighting, outing, patch and photo will be erased from this phone, and from your account if you are signed in. Save a backup first if you might want them back.', 'Delete everything', true)) {
      for (const s of ['sightings', 'outings', 'patches', 'photos']) await db.clear(s);
      await db.kvSet('activeOuting', null);
      await loadData(); toast('All sightings deleted'); location.hash = '#/dex';
    }
  };
}
// ---------- ready for the field ----------
// What works on this phone with no signal. The checks only read the caches (and ask the service worker what it has
// saved), so they are quick and never start a download. 'Get it now' runs the same download as everywhere else,
// and keeps going if she leaves Settings.
const FIELD = [
  { key: 'app', label: 'The app' },
  { key: 'photos', label: 'Species photos' },
  { key: 'calls', label: 'Call clips' },
  { key: 'maps', label: 'Maps' },
  { key: 'listen', label: 'Listen' },
  { key: 'scan', label: 'Scan a photo' },
];
const rootUrl = p => new URL(`../${p}`, import.meta.url).href;
const mbText = b => `${Math.max(1, Math.round(b / 1e6))} MB`;
// 'Get it now' for photos saves each species' Wikipedia photo at two sizes and up to four gallery photos.
// Average sizes measured over the whole set in October 2026 (33 + 174 KB, and 58 KB): about 145 MB in all.
const PHOTO_WIKI = 207e3, PHOTO_GALLERY = 58e3;
// Before the photo list has been looked up, count a Wikipedia photo for every species (nearly all have one).
const photoBytes = (all = false) => SPECIES.reduce((a, s) => a + (all || photoFor(s.id) ? PHOTO_WIKI : 0) + Math.min(4, galleryFor(s.id).length) * PHOTO_GALLERY, 0);
const cacheUrls = async name => ((await caches.has(name)) ? new Set((await (await caches.open(name)).keys()).map(r => r.url)) : new Set());

// The service worker says how many of its app files are saved ('shell-fill' also fetches any that are missing).
async function askWorker(type, ms = 3000) {
  const sw = navigator.serviceWorker?.controller || (await navigator.serviceWorker?.getRegistration().catch(() => null))?.active;
  if (!sw) return null;
  return new Promise(res => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(null), ms);
    ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
    sw.postMessage({ type }, [ch.port2]);
  });
}
async function listenSaved() {
  const model = await caches.match(rootUrl('models/birdnet/model.json'));
  if (!model) return false;
  const shards = ((await model.json()).weightsManifest || []).flatMap(w => w.paths || []).map(p => `models/birdnet/${p}`);
  const files = ['vendor/tfjs/tf.min.js', 'models/birdnet/labels/en_us.txt', 'models/birdnet/labels/en_uk.txt', ...shards];
  return (await Promise.all(files.map(f => caches.match(rootUrl(f))))).every(Boolean);
}

async function checkField(key, callWho) {
  if (key === 'app') {
    if (!('serviceWorker' in navigator)) return { ok: false, text: "This browser can't keep the app for offline use." };
    const st = await askWorker('shell-status');
    if (!st) return { ok: false, text: 'Not saved for offline yet.', get: true };
    return st.saved >= st.total ? { ok: true, text: 'Saved. It opens and runs with no signal.' }
      : { ok: false, text: `${st.saved} of ${st.total} app files saved.`, get: true };
  }
  if (key === 'photos') {
    await Promise.all([cachedIndex(), loadExtras()]);
    const list = SPECIES.filter(s => photoFor(s.id));
    const size = mbText(photoBytes(!list.length));
    if (!list.length) return { ok: false, text: `Not saved yet. About ${size}.`, get: true };
    const have = await cacheUrls('birddex-images');
    const abs = u => { try { return new URL(u).href; } catch (_) { return u; } };
    const n = list.filter(s => have.has(abs(sized(s.id, 'small'))) && have.has(abs(sized(s.id, 'large')))).length;
    return n >= list.length ? { ok: true, text: `Saved for all ${list.length} species with a photo.` }
      : { ok: false, text: `Saved for ${n} of ${list.length} species. About ${size}.`, get: true };
  }
  if (key === 'calls') {
    const st = await callPackStatus();
    if (!st.total) return { ok: false, text: "Couldn't check the call clips. Open Settings again with signal." };
    return st.saved >= st.total ? { ok: true, text: `Saved: ${st.total} short clips${callWho ? ` of ${callWho}` : ''}.` }
      : { ok: false, text: `${st.saved} of ${st.total} clips saved. About ${mbText(st.bytes - st.savedBytes)}.`, get: true };
  }
  if (key === 'maps') {
    const n = (await cacheUrls('birddex-tiles')).size;
    return n ? { ok: true, text: `${n.toLocaleString('en-AU')} map squares saved from areas you've opened. Other areas need signal.` }
      : { ok: false, text: "No map areas saved yet. Open the map with signal and look over the places you'll visit.", link: '#/map', linkText: 'Open the map' };
  }
  if (key === 'listen') {
    return (await listenSaved()) ? { ok: true, text: 'Sound model saved. Listen names birds by their calls with no signal.' }
      : { ok: false, text: 'Sound model not saved yet. About 60 MB.', get: true };
  }
  const m = await import('./photoid.js');
  return (await m.isPhotoModelCached()) ? { ok: true, text: 'Photo model saved. Scan works with no signal.' }
    : { ok: false, text: `Photo model not saved yet. About ${m.PHOTO_MODEL_MB} MB.`, get: true };
}

// One download per row at a time; Settings opened again picks up the one already running.
const FIELD_GET = {
  async app(report) {
    report(null, 'Saving the app files…');
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register('sw.js');
      await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 20000))]);
    }
    const st = await askWorker('shell-fill', 180000);
    if (!st || st.saved < st.total) throw new Error('some app files did not download');
  },
  photos: report => downloadAll((d, t) => report(d / t, `Saving photos: ${d} of ${t} species`)),
  async calls(report) {
    const r = await saveCallPack((d, t) => report(d / t, `Saving calls: ${d} of ${t}`));
    if (r.failed) throw new Error(`${r.failed} clips didn't download`);
  },
  async listen(report) {
    const m = await import('./listen.js');
    await m.loadListenModel((p, t) => report(p / 100, `${t}: ${p}%`));
  },
  async scan(report) {
    const m = await import('./photoid.js');
    await m.loadPhotoModel((f, label) => report(f, `${label}: ${Math.round(f * 100)}%`));
  },
};
const fieldJobs = new Map();
function fieldJob(key) {
  if (fieldJobs.has(key)) return fieldJobs.get(key);
  const job = { last: [0, ''], subs: new Set() };
  const report = (f, t) => { job.last = [f, t]; job.subs.forEach(fn => fn(f, t)); };
  job.p = Promise.resolve().then(() => FIELD_GET[key](report)).finally(() => fieldJobs.delete(key));
  fieldJobs.set(key, job);
  return job;
}

function wireField(callWho) {
  const list = $('[data-field-list]', view), sum = $('[data-field-sum]', view);
  if (!list) return;
  const results = {};
  const row = key => $(`[data-field="${key}"]`, list);
  const label = key => FIELD.find(f => f.key === key).label;
  const summary = () => {
    if (!sum.isConnected || FIELD.some(f => !results[f.key])) return;
    const n = FIELD.filter(f => results[f.key].ok).length;
    sum.textContent = n === FIELD.length ? 'Everything here works with no signal.'
      : `${n} of ${FIELD.length} ready. ${navigator.onLine ? 'Get the rest while you have Wi-Fi.' : 'The rest needs signal to save.'}`;
  };
  const paint = (key, r) => {
    const el = row(key);
    if (!el?.isConnected) return;
    results[key] = r;
    el.classList.remove('ready-row--busy');
    el.classList.toggle('ready-row--ok', !!r.ok);
    el.classList.toggle('ready-row--todo', !r.ok);
    $('[data-field-text]', el).textContent = r.text;
    $('[data-field-act]', el).innerHTML = r.ok ? ''
      : r.get ? `<button type="button" class="btn btn--small" data-field-get="${key}" aria-label="Get it now: ${esc(label(key))}">Get it now</button>`
      : r.link ? `<a class="btn btn--small" href="${r.link}">${esc(r.linkText)}</a>` : '';
    summary();
  };
  const check = key => checkField(key, callWho).catch(() => ({ ok: false, text: "Couldn't check this one. Open Settings again to retry." })).then(r => paint(key, r));
  const follow = (key, job) => {
    const el = row(key);
    if (!el) return;
    const text = $('[data-field-text]', el), prog = $('[data-field-prog]', el), act = $('[data-field-act]', el);
    const hadFocus = el.contains(document.activeElement);
    delete results[key];
    el.classList.remove('ready-row--ok', 'ready-row--todo');
    el.classList.add('ready-row--busy');
    act.innerHTML = '';
    if (hadFocus) text.focus({ preventScroll: true });
    prog.classList.remove('hidden');
    const on = (f, t) => {
      if (f != null) prog.style.setProperty('--p', `${Math.round(f * 100)}%`);
      if (t) text.textContent = t;
    };
    job.subs.add(on);
    on(...job.last);
    job.p.then(() => {
      if (!el.isConnected) return;
      prog.classList.add('hidden');
      navigator.storage?.persist?.();
      check(key).then(() => announce(`${label(key)}: ${results[key]?.text || 'done'}`));
    }, err => {
      if (!el.isConnected) return;
      prog.classList.add('hidden');
      const msg = `Couldn't finish: ${err?.message || err}. Check the connection and try again.`;
      paint(key, { ok: false, text: msg, get: true });
      announce(`${label(key)}: ${msg}`);
    }).finally(() => job.subs.delete(on));
  };
  for (const { key } of FIELD) { if (fieldJobs.has(key)) follow(key, fieldJobs.get(key)); else check(key); }
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-field-get]');
    if (!b) return;
    const key = b.dataset.fieldGet;
    if (!navigator.onLine) { $('[data-field-text]', row(key)).textContent = "You're offline. Connect to the internet, then try again."; return; }
    follow(key, fieldJob(key));
  });
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- global search ----------
function openSearch(initial = '') {
  if ($('.search-ov')) return;
  const ov = document.createElement('div');
  ov.className = 'search-ov';
  ov.innerHTML = `<div class="search-bar">${icon.search}<input type="search" placeholder="Birds, animals, plants, places, hotspots" aria-label="Search everything" autocomplete="off"><button class="iconbtn" data-x aria-label="Close search">${icon.close}</button></div>
    <div class="search-res" aria-live="polite"><p class="muted pad">Try "kingfisher", "Oxley", "lorikeet" or "wetlands".</p></div>`;
  document.body.append(ov);
  const input = $('input', ov), res = $('.search-res', ov);
  let layer;
  const close = reason => { if (closeLayer(layer, { restore: reason !== 'nav' })) ov.remove(); };
  layer = openLayer(ov, { label: 'Search', lock: true, close });
  const seen = seenSet();
  const run = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { res.innerHTML = '<p class="muted pad">Try "kingfisher", "Oxley", "lorikeet" or "wetlands".</p>'; return; }
    const words = q.split(/\s+/);
    const hit = txt => words.every(w => txt.toLowerCase().includes(w));
    const birds = SPECIES.filter(s => hit(`${s.name} ${s.sci} ${dexNo(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one} ${s.habitats.map(h => HABITATS[h]).join(' ')}`))
      .sort((a, b) => (a.name.toLowerCase().includes(q) ? 0 : 1) - (b.name.toLowerCase().includes(q) ? 0 : 1) || a.id - b.id).slice(0, 12);
    const hs = hotspots().filter(h => hit(h.name)).slice(0, 6);
    const pats = state.patches.filter(p => hit(p.name));
    const mine = state.sightings.filter(s => hit(`${s.place || ''} ${s.notes || ''} ${byId.get(s.speciesId)?.name || ''}`))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 8);
    const sec = (title, items) => items ? `<h2 class="h2 pad-x">${title}</h2><ul class="rows pad-x">${items}</ul>` : '';
    res.innerHTML = [
      sec(kindsPresent.length > 1 ? 'Species' : 'Birds', birds.map(s => `<li><a class="row row--sp kind--${s.kind}" href="#/bird/${s.id}"><span class="row-thumb ${seen.has(s.id) ? 'row-thumb--seen' : ''}">${birdImg(s)}</span><span class="row-main"><strong>${esc(s.name)}</strong><span class="small muted">${esc(GROUPS[s.group])}</span></span>${band(s.id, seen.has(s.id))}</a></li>`).join('')),
      sec('Hotspots', hs.map(h => `<li><a class="row" href="#/map/at/${h.lat},${h.lng}"><span class="row-main"><strong>${esc(h.name)}</strong><span class="small muted">${h.rich} dex birds recorded</span></span></a></li>`).join('')),
      sec('Your patches', pats.map(p => `<li><a class="row" href="#/patch/${p.id}"><span class="row-main"><strong>${esc(p.name)}</strong></span></a></li>`).join('')),
      sec('Your sightings', mine.map(s => `<li><a class="row" href="#/bird/${s.speciesId}"><span class="row-main"><strong>${esc(byId.get(s.speciesId)?.name)}</strong><span class="small muted">${fmtDate(s.date)}${s.place ? `, ${esc(s.place)}` : ''}</span></span></a></li>`).join('')),
    ].join('') || '<p class="muted pad">Nothing found. Check the spelling, or try part of a name.</p>';
  };
  input.addEventListener('input', () => { run(); settleImages(res); });
  if (initial) { input.value = initial; run(); settleImages(res); }
  // A result link closes search through the route change, so its photo can grow into the species page.
  ov.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (e.target.closest('[data-x]') || (a && a.getAttribute('href') === location.hash)) close('button');
  });
  input.focus();
}

// ---------- Listen (BirdNET) ----------
// Frogs: BirdNET has no SEQ frogs, so Listen lists the frogs calling this month with our clips to match by ear.
const callLine = sp => {
  const parts = String(sp.notes || '').match(/[^.]+\./g) || [];
  return (parts.find(t => /\bcall|bleat|trill|chorus|cackle|"/i.test(t)) || parts[0] || '').trim();
};
function frogBoard(pack, month) {
  const frogs = ofKind('frog').filter(sp => pack[sp.id]?.length)
    .map(sp => ({ sp, r: relRate(sp.id, month) ?? 0 }))
    .filter(({ sp, r }) => r >= 0.35 || inSeason(sp, month))
    .sort((a, b) => b.r - a.r || a.sp.id - b.sp.id);
  if (!frogs.length) return '';
  return `<section class="frogboard" aria-labelledby="frogboard-h">
    <h2 class="h2" id="frogboard-h">Frogs calling in ${MONTHS[month - 1]}</h2>
    <p class="muted small">BirdNET only knows birds. Match frog calls by ear here.</p>
    <p class="small frogboard-save hidden" data-fsave>To play these with no signal, <a href="#/settings">save calls in Settings</a>.</p>
    <ul class="frogboard-list">${frogs.map(({ sp }) => {
      const clips = pack[sp.id];
      return `<li class="frog-row kind--frog" data-frog="${sp.id}">
        <a class="row-thumb" href="#/bird/${sp.id}" tabindex="-1" aria-hidden="true">${birdImg(sp)}</a>
        <div class="frog-main">
          <a class="frog-name" href="#/bird/${sp.id}">${esc(sp.name)}</a>
          <span class="frog-call small">${esc(callLine(sp))}</span>
          <div class="frog-plays">${clips.map((c, i) => `<button class="fplay" data-fplay="${sp.id}:${i}" aria-pressed="false" aria-label="${esc(sp.name)}, call ${i + 1} of ${clips.length}"><span class="fplay-ico" aria-hidden="true">${icon.play}</span><span class="fplay-eq" aria-hidden="true"><i></i><i></i><i></i></span><span aria-hidden="true">${clips.length > 1 ? `Call <b>${i + 1}</b>` : 'Play call'}</span></button>`).join('')}</div>
          <span class="frog-prog" aria-hidden="true"><span></span></span>
          <p class="frog-credit small muted" data-fcredit></p>
        </div></li>`;
    }).join('')}</ul>
    <p class="frog-sr" role="status" data-fstatus></p>
    <details class="frog-credits"><summary class="small">Recording credits</summary>
      <ul class="small muted">${frogs.flatMap(({ sp }) => pack[sp.id].map((c, i) => `<li>${esc(sp.name)}${pack[sp.id].length > 1 ? `, call ${i + 1}` : ''}: ${callCredit({ ...c, local: true })}</li>`)).join('')}</ul>
    </details>
  </section>`;
}

let listenGen = 0;
async function renderListen() {
  const L = state.listen;
  // The pack can take a few seconds on a weak signal. Only the latest render may draw, and only if Listen is still
  // open; otherwise it would cover another screen and leave its own timer running.
  const gen = ++listenGen;
  const pack = await loadCallPack();
  if (gen !== listenGen || location.hash !== '#/listen') return;
  const month = new Date().getMonth() + 1;
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
      <div><h1>Listen</h1><p class="muted small">BirdNET names birds from their calls, right on your phone.</p></div></header>
    <div class="listen pad-x">
      <canvas class="spectro" width="600" height="220" aria-label="Live sound picture"></canvas>
      <div class="listen-ctl">
        <button class="micbtn" data-mic aria-pressed="false">${icon.mic}<span>Start listening</span></button>
        <p class="small muted" data-lstatus role="status">Point your phone towards the birds and keep still. The first time, the sound model downloads (about 60 MB). After that, Listen works with no signal.</p>
        <div class="meter meter--thin hidden" data-lprog style="--p:0%"><span></span></div>
      </div>
      <div class="block-h"><h2 class="h2">Heard</h2>${L.hits.size ? '<button class="btn btn--small btn--quiet" data-clear>Clear</button>' : ''}</div>
      <ul class="rows" data-hits></ul>
      <p class="small muted">BirdNET by the K. Lisa Yang Center for Conservation Bioacoustics and Chemnitz University of Technology (model CC BY-SA 4.0). Suggestions can be wrong, so check before you log.</p>
      ${frogBoard(pack, month)}
    </div>`;
  const hitsEl = $('[data-hits]', view), status = $('[data-lstatus]', view), prog = $('[data-lprog]', view), btn = $('[data-mic]', view);
  const seen = seenSet();
  const drawHits = () => {
    const arr = [...L.hits.values()].sort((a, b) => b.last - a.last);
    hitsEl.innerHTML = arr.map(h => {
      const sp = h.dexId ? byId.get(h.dexId) : null;
      const ago = Math.round((Date.now() - h.last) / 1000);
      return `<li class="hit ${Date.now() - h.last < 4000 ? 'hit--live' : ''}">
        <span class="row-thumb">${sp ? birdImg(sp) : `<span class="img-missing"></span>`}</span>
        <span class="row-main"><strong>${esc(sp ? sp.name : h.name)}</strong>
          <span class="small muted">${Math.round(h.best * 100)}% sure, ${ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`}${sp ? (seen.has(sp.id) ? '' : '. New for your dex') : '. Not in the dex'}</span>
          <span class="meter meter--thin" style="--p:${Math.round(h.best * 100)}%"><span></span></span></span>
        ${sp ? `<button class="btn btn--small" data-loghit="${sp.id}">Log it</button>` : ''}</li>`;
    }).join('') || '<li class="muted pad">Nothing yet. Calls show up here as they are recognised.</li>';
  };
  drawHits();
  let mod = null;
  const stop = () => { mod?.stopListening(); btn.setAttribute('aria-pressed', 'false'); btn.querySelector('span').textContent = 'Start listening'; btn.classList.remove('on'); };
  const frogs = wireFrogBoard(pack, () => { if (btn.classList.contains('on')) { stop(); status.textContent = 'Stopped listening while the frog call plays, so BirdNET does not hear it.'; } });
  state.cleanup = () => { stop(); frogs.stop(); clearInterval(L.tickT); };
  L.tickT = setInterval(drawHits, 2000);
  view.onclick = async e => {
    const fp = e.target.closest('[data-fplay]');
    if (fp) { frogs.play(fp); return; }
    const lh = e.target.closest('[data-loghit]');
    if (lh) openSightingSheet({ speciesId: Number(lh.dataset.loghit), autoGps: true, notes: 'Identified by call with BirdNET.' });
    if (e.target.closest('[data-clear]')) { L.hits.clear(); drawHits(); }
    if (!e.target.closest('[data-mic]')) return;
    if (btn.classList.contains('on')) { stop(); status.textContent = 'Stopped.'; return; }
    frogs.stop();
    try {
      mod = await import('./listen.js');
      btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); btn.querySelector('span').textContent = 'Stop';
      prog.classList.remove('hidden');
      const loading = mod.loadListenModel((p, t) => { prog.style.setProperty('--p', `${p}%`); status.textContent = `${t}… ${p}%`; });
      loading.catch(() => {}); // a failed load is reported below, once startListening is done
      await mod.startListening({
        canvas: $('.spectro', view),
        onDetections: hits => {
          for (const h of hits) {
            const prev = L.hits.get(h.index);
            const isNewHit = !prev;
            L.hits.set(h.index, { ...h, best: Math.max(prev?.best || 0, h.confidence), last: Date.now() });
            if (isNewHit && h.dexId && !seen.has(h.dexId)) navigator.vibrate?.(40);
          }
          if (hits.length) drawHits();
        },
      });
      await loading;
      prog.classList.add('hidden');
      status.textContent = 'Listening. Keep still and let the birds call.';
      // Filter to birds of this area: start with Brisbane, then refine with GPS.
      mod.setLocation(state.lastPos?.lat ?? -27.47, state.lastPos?.lng ?? 153.02);
      getPosition().then(pos => { state.lastPos = { ...pos, at: Date.now() }; mod.setLocation(pos.lat, pos.lng); }).catch(() => {});
    } catch (err) {
      stop();
      status.textContent = /denied|NotAllowed/i.test(String(err?.name || err?.message)) ? 'Microphone permission was denied. Allow it in your browser settings and try again.' : `Couldn't start listening: ${err.message || err}`;
    }
  };
}

// One player for the whole frog board. The credit for the clip that is playing shows in its row.
function wireFrogBoard(pack, beforePlay) {
  const audio = new Audio();
  let cur = null; // { btn, key }
  const row = () => cur?.btn.closest('.frog-row');
  const setPlaying = on => { cur?.btn.setAttribute('aria-pressed', String(on)); row()?.classList.toggle('is-playing', on); };
  const reset = () => {
    if (!cur) return;
    setPlaying(false);
    const bar = row() && $('.frog-prog span', row());
    if (bar) bar.style.transform = 'scaleX(0)';
  };
  audio.addEventListener('timeupdate', () => {
    const bar = row() && $('.frog-prog span', row());
    if (bar && audio.duration) bar.style.transform = `scaleX(${Math.min(1, audio.currentTime / audio.duration)})`;
  });
  audio.addEventListener('ended', () => { reset(); cur = null; });
  audio.addEventListener('error', () => {
    if (!cur || !audio.getAttribute('src')) return;
    const msg = navigator.onLine ? 'That clip would not play.' : 'Not saved on this phone yet. Save calls in Settings to play it with no signal.';
    const cr = $('[data-fcredit]', row()), live = $('[data-fstatus]', view);
    if (cr) cr.textContent = msg;
    if (live) live.textContent = msg; // the row text isn't announced; this is
    reset();
    cur = null; // a second tap tries the clip again
  });
  // Say how to make the board work offline, until the pack is saved.
  callPackStatus().then(st => { if (st.saved < st.total) $('[data-fsave]', view)?.classList.remove('hidden'); }).catch(() => {});
  return {
    play(btn) {
      const [id, i] = btn.dataset.fplay.split(':').map(Number);
      const key = `${id}:${i}`;
      if (cur?.key === key) {
        if (audio.paused) { beforePlay(); audio.play().catch(() => {}); setPlaying(true); }
        else { audio.pause(); setPlaying(false); }
        return;
      }
      reset();
      const c = pack[id]?.[i];
      if (!c) return;
      cur = { btn, key };
      beforePlay();
      setPlaying(true);
      const cr = $('[data-fcredit]', row()), live = $('[data-fstatus]', view);
      if (cr) cr.innerHTML = callCredit({ ...c, local: true });
      if (live) live.textContent = '';
      localCalls(id).then(list => {
        if (cur?.key !== key) return;
        audio.src = list[i].src;
        audio.play().catch(() => {});
      });
    },
    stop() { audio.pause(); reset(); cur = null; },
  };
}

// ---------- theme, install, updates, welcome ----------
function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
async function promptInstall() {
  const p = state.installPrompt;
  if (!p) { toast('Use your browser menu, then Add to Home screen.'); return; }
  p.prompt();
  const r = await p.userChoice.catch(() => null);
  state.installPrompt = null;
  if (r?.outcome === 'accepted') toast("Installed. Find Sarah's BirdyDex on your home screen.");
  render();
}
function showUpdateBanner() {
  if ($('.update-bar')) return;
  const b = document.createElement('div');
  b.className = 'update-bar'; b.setAttribute('role', 'status');
  b.innerHTML = `<span>A new version is ready.</span><button class="btn btn--small btn--primary">Reload</button>`;
  b.querySelector('button').onclick = () => location.reload();
  document.body.append(b);
}
async function showWelcome() {
  if ($('.welcome')) return;
  const ov = document.createElement('div');
  ov.className = 'welcome';
  ov.innerHTML = `<div class="welcome-card">
    <div class="welcome-model" data-wm></div>
    <h1>Hi Sarah</h1>
    <p>This is your BirdyDex: ${BIRDS.length} South East Queensland birds to find${ANIMALS.length > BIRDS.length ? `, plus ${ANIMALS.length - BIRDS.length} other native animals` : ''}${ofKind('plant').length ? ` and ${ofKind('plant').length} native plants` : ''}, starting with this Eastern Yellow Robin.</p>
    <ul class="welcome-list">
      <li><strong>Log</strong> anything you find with the + button, or press and hold a tile in the dex.</li>
      <li><strong>Scan</strong> names any species in your dex from a photo, and <strong>Listen</strong> names birds by their calls.</li>
      <li><strong>Learn</strong> has a daily challenge and look-alike games, and <strong>badges</strong> and <strong>targets</strong> show where to go next.</li>
    </ul>
    <div class="row-center">${state.installPrompt ? '<button class="btn" data-winstall>Install app</button>' : ''}<button class="btn btn--primary" data-wgo>Start exploring</button></div>
  </div>`;
  document.body.append(ov);
  let dispose = null, layer;
  // Escape, Back and Start birding all mean the same thing: she has seen it.
  const done = reason => {
    if (!closeLayer(layer, { restore: reason !== 'nav' })) return;
    dispose?.(); ov.remove(); db.kvSet('welcomed', true);
  };
  layer = openLayer(ov, { dialog: $('.welcome-card', ov), close: done });
  ov.addEventListener('click', async e => {
    if (e.target.closest('[data-winstall]')) await promptInstall();
    if (e.target.closest('[data-wgo]')) done('button');
  });
  $('[data-wgo]', ov).focus({ preventScroll: true });
  try { const { mountBird } = await import('./model3d.js'); if (ov.isConnected) dispose = mountBird($('[data-wm]', ov), byId.get(165)); } catch (_) {}
}

// ---------- boot ----------
const ctx = {
  state, view, $, $$, esc, icon, birdImg, band, pips, toast, fmtDate, plural, GROUPS,
  seenSet, sightingsOf, openSightingSheet, getCalls, hasCalls, audioUrl,
  openSheet, closeSheet, confirmSheet, refresh: refreshFromSync,
  resizeImage, openSearch,
  // shell helpers for other screens: motion (js/motion.js), focus and layers (js/layers.js), the live region
  vt, flip, countUp, keepFocus, announce, openLayer, closeLayer,
  // the photo-first look (js/look.js): colour from a photo, one-time entrances
  applyTint, tintFrom, stagger,
};

// Data changed under us (cloud sync, sign in or out): reload, and redraw unless that would interrupt something.
async function refreshFromSync({ force = false } = {}) {
  await loadData();
  applyTheme();
  const busy = sheetOpen() || document.activeElement?.matches('input, textarea') || /^#\/(listen|scan|quiz|learn)/.test(location.hash);
  if (force ? !sheetOpen() : !busy) render();
}

// Screens whose content (not just photos) comes from the big regional files: drawn again once they arrive.
const EXTRAS_SCREENS = /^#\/(?:dex|bird\/\d+|compare\/\d+\/\d+|lists|targets|map(?:\/.*)?|learn)?$/;

async function boot() {
  initLook();
  // The first paint needs only her sightings, the species list and the saved photo index. The big regional files
  // (seq, gallery, info: about 1.4 MB) load alongside and never hold it up.
  const extras = Promise.all([loadSeq(), loadExtras()]);
  let extrasIn = false;
  extras.then(() => { extrasIn = true; });
  await Promise.all([loadData(), cachedIndex()]);
  // From the phone's own cache they are usually in within a moment, and one draw beats two.
  // A practice round is built from them, so Learn's rounds wait for them.
  if (/^#\/learn\//.test(location.hash)) await extras;
  else await Promise.race([extras, new Promise(r => setTimeout(r, 150))]);
  applyTheme();
  $('#plus').addEventListener('click', e => { e.preventDefault(); openPlusSheet(); });
  document.addEventListener('keydown', e => {
    if (onLayerKey(e)) return;
    if (e.key === '/' && !e.target.closest('input, textarea, select')) { e.preventDefault(); openSearch(); }
  });
  // Scroll is remembered per screen by the app (back returns to it), not restored by the browser mid-transition.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  document.addEventListener('click', nameTappedPhoto, true);
  window.addEventListener('hashchange', onRouteChange);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; if ((location.hash || '#/dex').startsWith('#/dex')) renderDex(); });
  render();
  // Arrived after the first paint: photos fill in wherever they show, and a screen built from this data draws once
  // more, without a transition, unless a sheet is open over it.
  if (!extrasIn) extras.then(() => {
    patchSpeciesImages(document);
    if (!sheetOpen() && EXTRAS_SCREENS.test(location.hash || '#/dex')) render();
  });
  initAccount(ctx).catch(() => {});
  // Better photos arriving are swapped in where they show; nothing is redrawn mid-use (a call keeps playing, the
  // gallery keeps its slide). A species page is redrawn only if its hero had no photo at all.
  onMediaReady(() => {
    patchSpeciesImages(document);
    if (!sheetOpen() && /^#\/(bird|compare)\//.test(location.hash) && $('.bird-hero .img-missing, .cmp-img .img-missing', view)) render();
  });
  loadIndex();
  loadCallPack();
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update();
      setInterval(() => reg.update(), 30 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
  }
  setInterval(() => { if (activeOuting()) renderOutingBar(); }, 60000);
  if (!(await db.kvGet('welcomed'))) showWelcome();
}
boot();

// exported for tests
window.__birddex = { state, SPECIES, inSeason };
