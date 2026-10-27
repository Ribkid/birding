import { SPECIES, GROUPS, HABITATS, RARITY, byId, KINDS, ANIMAL_KINDS, ANIMALS, BIRDS, ofKind, dexCode, kindsPresent } from './species.js';
import { loadExtras, galleryFor, infoFor } from './gallery.js';
import { db } from './db.js';
import { loadIndex, photoFor, sized, details, calls, audioUrl, downloadAll, onMediaReady, loadCallPack, localCalls, hasLocalCall, callPackStatus, saveCallPack } from './media.js';
import { speciesList, periodFilter, totals, yearTotals, targets, badges, inPatch, haversineKm, MONTHS, inSeason } from './stats.js';
import { toEbirdCsv } from './ebird.js';
import { loadSeq, seq, monthRates, likelihood, recordCount, spotsFor, pointsFor, hotspots, nearbyTargets } from './seqdata.js';
import { openCard, confetti, shareCard } from './card3d.js';
import { renderQuiz } from './quiz.js';
import { renderStats } from './statsview.js';
import { describeArea } from './mapinfo.js';
import { initAccount, accountChip, renderAccountSection, renderLeaderboard, leaderboardLink } from './account.js';

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
async function hydratePhotos(root = document) {
  for (const img of $$('img[data-photo]', root)) {
    const url = await photoUrl(Number(img.dataset.photo));
    if (url) img.src = url;
  }
}
async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}

// ---------- small UI pieces ----------
const band = (id, seen) => `<span class="band band--${kindOf(id)} ${seen ? 'band--on' : ''}" aria-label="Dex number ${dexNo(id)}">${dexNo(id)}</span>`;
const pips = r => `<span class="pips pips--${r}" title="${RARITY[r].label}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span>`;
// whole: show the entire photo (no cropping) over a soft blurred copy, for big views.
function birdImg(sp, size = 'small', cls = '', { whole = false } = {}) {
  const url = sized(sp.id, size);
  if (url && whole) return wholeImg(url, sp.name, cls);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(sp.name)}" loading="lazy" decoding="async" onerror="this.classList.add('img-missing')">`
    : `<span class="${cls} img-missing" role="img" aria-label="${esc(sp.name)}"></span>`;
}
const wholeImg = (url, alt, cls = '') => `<span class="whole ${cls}"><img class="whole-bg" src="${esc(url)}" alt="" aria-hidden="true" decoding="async"><img class="whole-fg" src="${esc(url)}" alt="${esc(alt)}" decoding="async" onerror="this.closest('.whole').classList.add('img-missing')"></span>`;
const icon = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.8V15M12 18.5v.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.classList.add('toast--out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

// ---------- sheets (modal) ----------
function openSheet(html, { onOpen, wide } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-scrim" data-close></div>
    <div class="sheet ${wide ? 'sheet--wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-grip" aria-hidden="true"></div>${html}</div>`;
  document.body.append(wrap);
  document.body.classList.add('has-sheet');
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  requestAnimationFrame(() => wrap.classList.add('open'));
  const first = $('input:not([type=hidden]):not([type=file]), select, textarea, button', $('.sheet', wrap));
  onOpen?.($('.sheet', wrap));
  if (first && !first.matches('[data-noautofocus]')) setTimeout(() => first.focus({ preventScroll: true }), 50);
  return $('.sheet', wrap);
}
function closeSheet() {
  const w = $('.sheet-wrap');
  if (!w) return;
  w.remove();
  document.body.classList.remove('has-sheet');
  state.onSheetClose?.(); state.onSheetClose = null;
}
function confirmSheet(title, body, okLabel, danger = false) {
  return new Promise(resolve => {
    const s = openSheet(`<h2 class="sheet-title">${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row-end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(okLabel)}</button></div>`);
    s.addEventListener('click', e => {
      if (e.target.closest('[data-yes]')) { closeSheet(); resolve(true); }
      if (e.target.closest('[data-no]')) { closeSheet(); resolve(false); }
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
    ...hotspots().filter(h => hit(h.name)).map(h => ({ name: h.name, lat: h.lat, lng: h.lng, kind: `Hotspot, ${h.rich} species` })),
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
    const close = val => { map?.remove(); ov.remove(); resolve(val); };
    let map;
    try { await loadLeaflet(); } catch (_) { toast('The map needs an internet connection the first time.'); close(null); return; }
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
    q.focus();
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

function celebrate(sp, newBadges) {
  navigator.vibrate?.([60, 40, 120]);
  confetti();
  const hist = sightingsOf(sp.id);
  const first = hist[hist.length - 1];
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="celebrate-card">
    <div class="celebrate-photo">${birdImg(sp, 'large', '', { whole: true })}<span class="band band--on band--big band--clamp">${dexNo(sp.id)}</span></div>
    <p class="celebrate-kicker">New for your dex</p>
    <h2>${esc(sp.name)}</h2>
    <p class="muted">${sp.kind === 'plant' ? `${ofKind('plant').filter(x => seenSet().has(x.id)).length} of ${ofKind('plant').length} plants found` : `${ANIMALS.filter(x => seenSet().has(x.id)).length} of ${ANIMALS.length} animals seen`}</p>
    ${newBadges.length ? `<p class="celebrate-badges">Badge earned: ${newBadges.map(b => `<strong>${esc(b.name)}</strong>`).join(', ')}</p>` : ''}
    <div class="row-center"><button class="btn" data-share>${icon.share} Share</button><button class="btn" data-card>See card</button><button class="btn btn--primary" data-dismiss>Nice</button></div></div>`;
  document.body.append(el);
  const done = () => { el.classList.add('celebrate--out'); setTimeout(() => el.remove(), 250); };
  const info = { seen: true, isNew: true, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-share]')) { shareCard(sp, info); return; }
    if (e.target.closest('[data-card]')) { done(); openCard(sp, info); return; }
    if (e.target.closest('[data-dismiss]') || e.target === el) done();
  });
  setTimeout(() => $('[data-dismiss]', el)?.focus(), 50);
}

// ---------- sighting sheet ----------
function speciesPicker(selectedId) {
  const sp = selectedId ? byId.get(selectedId) : null;
  return `<div class="picker" data-picker>
    <input type="hidden" name="speciesId" value="${sp ? sp.id : ''}">
    <div class="picker-chosen ${sp ? '' : 'hidden'}">${sp ? pickerChosen(sp) : ''}</div>
    <div class="picker-search ${sp ? 'hidden' : ''}">
      <label class="field"><span>Bird</span><input type="search" placeholder="Type a name, e.g. kookaburra" autocomplete="off" data-picker-q></label>
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
      || (q.value.trim() ? '<li class="muted pad">No bird by that name in the dex.</li>' : '');
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
        <label class="check"><input type="checkbox" name="heard" ${rec.heard ? 'checked' : ''}><span>Heard only</span></label>
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
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Behaviour, plumage, who you were with…">${esc(rec.notes)}</textarea></label>
      <p class="form-error" data-error role="alert"></p>
      <div class="row-end">
        ${existing ? '<button type="button" class="btn btn--danger btn--quiet" data-delete>Delete</button><span class="spacer"></span>' : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${existing ? 'Save changes' : 'Save sighting'}</button>
      </div>
    </form>`, { onOpen: s => wirePicker(s) });
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
    if (!id) { $('[data-error]', form).textContent = 'Choose which bird you saw.'; return; }
    if (!form.date.value) { $('[data-error]', form).textContent = 'Add the date of the sighting.'; return; }
    rec.speciesId = id;
    rec.count = form.count.value ? Math.max(1, parseInt(form.count.value, 10) || 1) : null;
    rec.heard = form.heard.checked;
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
  const s = openSheet(`<h2 class="sheet-title">Add birds</h2>
    <div class="plus-options">
      <div class="plus-id">
        <a class="plus-opt plus-opt--id" href="#/listen" data-close>${icon.mic}<strong>Listen</strong><span>Name birds by their calls</span></a>
        <a class="plus-opt plus-opt--id" href="#/scan" data-close>${icon.scan}<strong>Scan a photo</strong><span>Name a bird from a picture</span></a>
      </div>
      <button class="plus-opt" data-one><strong>Log one bird</strong><span>A single sighting with photo, place and notes.</span></button>
      ${o ? `<button class="plus-opt" data-resume><strong>Back to your outing</strong><span>${esc(o.place || 'Current outing')}, started ${o.time}</span></button>`
          : `<button class="plus-opt" data-outing><strong>Start or add an outing</strong><span>Tally every bird at one place, like an eBird checklist. Works for earlier outings too.</span></button>`}
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
    if (past) toast('Outing added. Tally the birds you saw, then tap Finish.');
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
  [/^#\/quiz$/, () => renderQuiz(ctx)],
  [/^#\/listen$/, () => renderListen()],
  [/^#\/scan$/, () => renderScan()],
];
let lastRoute = '';
function render() {
  const hash = location.hash || '#/dex';
  if (state.map && !hash.startsWith('#/map')) { state.map.remove(); state.map = null; }
  state.cleanup?.(); state.cleanup = null;
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { fn(m); break; }
  }
  const tab = hash.split('/')[1] || 'dex';
  const tabFor = { bird: 'dex', dex: 'dex', compare: 'dex', listen: 'dex', scan: 'dex', lists: 'lists', list: 'lists', patch: 'lists', targets: 'lists', outing: 'lists', log: 'lists', stats: 'lists', map: 'map', badges: 'badges', settings: 'badges', quiz: 'badges' }[tab] || 'dex';
  $$('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tabFor ? 'page' : 'false'));
  renderOutingBar();
  if (hash !== lastRoute) { if (!hash.startsWith('#/dex') || !lastRoute.startsWith('#/bird')) window.scrollTo(0, 0); lastRoute = hash; }
  hydratePhotos(view);
}

function renderOutingBar() {
  const bar = $('#outing-bar');
  const o = activeOuting();
  if (!o || location.hash === `#/outing/${o.id}`) { bar.hidden = true; return; }
  const n = state.sightings.filter(s => s.outingId === o.id).length;
  bar.hidden = false;
  bar.innerHTML = `<a href="#/outing/${o.id}"><span class="pulse" aria-hidden="true"></span><span><strong>Outing in progress</strong> ${esc(o.place || '')}</span><span class="outing-bar-n">${plural(n, 'species', 'species')}</span></a>`;
}

// Dex
const inScope = (s, scope = state.dex.kind || 'animals') => scope === 'all' ? true : scope === 'animals' ? s.kind !== 'plant' : s.kind === scope;
const scopeNoun = (scope, n) => scope === 'animals' ? (n === 1 ? 'animal' : 'animals') : scope === 'all' ? 'species' : (n === 1 ? KINDS[scope].one : KINDS[scope].label.toLowerCase());
function dexFilter(seen) {
  const f = state.dex;
  const q = f.q.trim().toLowerCase();
  const month = new Date().getMonth() + 1;
  return SPECIES.filter(s => inScope(s) &&
    (!q || `${s.name} ${s.sci} ${dexNo(s.id)} ${GROUPS[s.group]}`.toLowerCase().includes(q)) &&
    (f.show === 'all' || (f.show === 'seen') === seen.has(s.id)) &&
    (!f.group || s.group === f.group) && (!f.habitat || s.habitats.includes(f.habitat)) &&
    (!f.rarity || s.rarity === Number(f.rarity)) &&
    (!f.season || (relRate(s.id, month) ?? (inSeason(s, month) ? 1 : 0)) >= 0.35));
}
function lastSeenOf(id) { const h = sightingsOf(id); return h[0] ? h[0].date + (h[0].time || '') : ''; }

function birdOfDay(seen) {
  const now = new Date();
  const month = now.getMonth() + 1;
  let pool = targets({ seen, month, ...targetOpts() }).slice(0, 40);
  if (!pool.length) pool = BIRDS.slice();
  const key = Number(todayStr(now).replace(/-/g, ''));
  const sp = pool[(key * 2654435761 >>> 0) % pool.length];
  const spot = spotsFor(sp.id, 1)[0];
  const why = seen.has(sp.id) ? 'One of yours. Say hello again today.'
    : `${relRate(sp.id, month) >= 0.8 ? 'Often reported right now' : 'Around this month'}${spot ? `. Try ${spot.h.name}.` : '.'}`;
  return `<a class="botd" href="#/bird/${sp.id}">
    <span class="botd-img">${birdImg(sp, 'large')}</span>
    <span class="botd-txt"><span class="botd-k">Bird of the day</span><strong>${esc(sp.name)}</strong><span class="small muted">${esc(why)}</span></span></a>`;
}

function renderDex() {
  const seen = seenSet();
  const f = state.dex;
  f.kind ||= 'animals';
  const list = dexFilter(seen);
  const scopeAll = SPECIES.filter(s => inScope(s));
  const scopeSeen = scopeAll.filter(s => seen.has(s.id)).length;
  const pct = Math.round(scopeSeen / Math.max(1, scopeAll.length) * 100);
  const filtersOn = f.habitat || f.group || f.rarity || f.season || f.show !== 'all';
  const kindCount = k => { const all = ofKind(k); return `${all.filter(s => seen.has(s.id)).length}/${all.length}`; };
  const animalKinds = ANIMAL_KINDS.filter(k => kindsPresent.includes(k));
  const kindTabs = kindsPresent.length > 1 ? `<div class="kind-tabs" role="tablist" aria-label="What to show">
      <button role="tab" class="kind-tab ${f.kind === 'animals' ? 'on' : ''}" aria-selected="${f.kind === 'animals'}" data-kind="animals"><span>All animals</span><em>${ANIMALS.filter(s => seen.has(s.id)).length}/${ANIMALS.length}</em></button>
      ${animalKinds.map(k => `<button role="tab" class="kind-tab kind--${k} ${f.kind === k ? 'on' : ''}" aria-selected="${f.kind === k}" data-kind="${k}"><i aria-hidden="true"></i><span>${KINDS[k].label}</span><em>${kindCount(k)}</em></button>`).join('')}
      ${kindsPresent.includes('plant') ? `<button role="tab" class="kind-tab kind-tab--quiet kind--plant ${f.kind === 'plant' ? 'on' : ''}" aria-selected="${f.kind === 'plant'}" data-kind="plant"><i aria-hidden="true"></i><span>Plants</span><em>${kindCount('plant')}</em></button>` : ''}
    </div>` : '';
  const tile = s => `<li><a class="tile kind--${s.kind} ${seen.has(s.id) ? 'tile--seen' : ''}" href="#/bird/${s.id}" data-tile="${s.id}">
      <span class="tile-img">${birdImg(s)}</span>
      ${band(s.id, seen.has(s.id))}
      <span class="tile-name">${esc(s.name)}</span></a></li>`;
  const row = s => `<li><a class="row row--sp kind--${s.kind}" href="#/bird/${s.id}" data-tile="${s.id}"><span class="row-thumb ${seen.has(s.id) ? 'row-thumb--seen' : ''}">${birdImg(s)}</span>
      <span class="row-main"><strong>${esc(s.name)}</strong><span class="muted small">${GROUPS[s.group]}</span></span>${pips(s.rarity)} ${band(s.id, seen.has(s.id))}</a></li>`;
  const block = items => state.dex.layout === 'list' ? `<ul class="rows pad-x">${items.map(row).join('')}</ul>` : `<ul class="dex-grid">${items.map(tile).join('')}</ul>`;
  let body;
  if (!list.length) body = `<div class="empty"><p>Nothing matches those filters.</p><button class="btn" data-reset>Clear filters</button></div>`;
  else if (f.sort === 'dex') {
    const byGroup = {};
    list.forEach(s => (byGroup[s.group] ||= []).push(s));
    body = Object.keys(GROUPS).filter(g => byGroup[g]).map(g => {
      const k = SPECIES.find(s => s.group === g)?.kind || 'bird';
      const all = SPECIES.filter(s => s.group === g);
      const got = all.filter(s => seen.has(s.id)).length;
      return `<section class="dex-group kind--${k}"><h2 class="dex-group-h"><span>${GROUPS[g]}</span><span class="dex-group-n">${got}/${all.length}</span></h2>${block(byGroup[g])}</section>`;
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
        <h1 class="wordmark"><img class="logo" src="icons/logo.svg" alt="" width="52" height="52"><span class="wordmark-txt">Sarah's BirdyDex<small>South East Queensland</small></span></h1>
        <div class="head-actions">
          ${state.installPrompt ? '<button class="chip chip--install" data-install>Install</button>' : ''}
          ${accountChip()}
          <button class="iconbtn" data-search aria-label="Search everything">${icon.search}</button>
          <a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a>
        </div>
      </div>
      <div class="tally" aria-label="${scopeSeen} of ${scopeAll.length} ${scopeNoun(f.kind, scopeAll.length)} seen">
        <span class="tally-band"><b>${scopeSeen}</b><i>/${scopeAll.length}</i></span>
        <div class="tally-meta"><span>${scopeNoun(f.kind, 2)} ${f.kind === 'plant' ? 'found' : 'seen'}</span>
          <div class="meter" style="--p:${pct}%"><span></span></div></div>
      </div>
      <div class="id-buttons">
        <a class="idbtn" href="#/listen">${icon.mic}<span><strong>Listen</strong><em>ID by call</em></span></a>
        <a class="idbtn" href="#/scan">${icon.scan}<span><strong>Scan</strong><em>ID from a photo</em></span></a>
      </div>
      ${birdOfDay(seen)}
      ${kindTabs}
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
    ${f.q || filtersOn ? `<p class="list-count"><b>${list.length}</b> ${list.length === 1 ? 'bird' : 'birds'}</p>` : ''}
    <div class="dex ${state.settings.colourUnseen ? 'dex--colour' : ''}">${body}</div>
    <p class="small muted pad dex-tip">Tip: press and hold anything in the dex to log it quickly.</p>`;
  const qi = $('[data-q]', view);
  qi.addEventListener('input', () => {
    state.dex.q = qi.value;
    const pos = qi.selectionStart;
    renderDex();
    const n = $('[data-q]', view); n.focus(); n.setSelectionRange(pos, pos);
  });
  view.onclick = e => {
    if (state.suppressClick && e.target.closest('[data-tile]')) { state.suppressClick = false; e.preventDefault(); return; }
    const sh = e.target.closest('[data-show]');
    if (sh) { state.dex.show = sh.dataset.show; renderDex(); }
    if (e.target.closest('[data-season]')) { state.dex.season = !state.dex.season; renderDex(); }
    const kt = e.target.closest('[data-kind]');
    if (kt) { state.dex.kind = kt.dataset.kind; state.dex.group = ''; renderDex(); }
    if (e.target.closest('[data-layout]')) { state.dex.layout = state.dex.layout === 'list' ? 'grid' : 'list'; renderDex(); }
    if (e.target.closest('[data-reset]')) { state.dex = { ...state.dex, q: '', show: 'all', group: '', habitat: '', rarity: '', season: false }; renderDex(); }
    if (e.target.closest('[data-search]')) openSearch();
    if (e.target.closest('[data-install]')) promptInstall();
  };
  view.onchange = e => {
    if (e.target.matches('[data-habitat]')) state.dex.habitat = e.target.value;
    if (e.target.matches('[data-group]')) state.dex.group = e.target.value;
    if (e.target.matches('[data-rarity]')) state.dex.rarity = e.target.value;
    if (e.target.matches('[data-sort]')) state.dex.sort = e.target.value;
    renderDex();
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
function similarBirds(sp) {
  return SPECIES.filter(s => s.id !== sp.id && s.group === sp.group)
    .map(s => ({ s, d: s.size && sp.size ? Math.abs(Math.log(s.size / sp.size)) : 1 }))
    .sort((a, b) => a.d - b.d).slice(0, 4).map(x => x.s);
}

// Photos for the species page: the Wikipedia picture first, then the gallery (data/gallery.json).
function heroPhotos(sp) {
  const out = [];
  const wiki = photoFor(sp.id);
  if (wiki) out.push({ src: sized(sp.id, 'large'), wiki: true, credit: '', license: '', page: wiki.url });
  for (const g of galleryFor(sp.id)) if (!out.some(o => o.src === g.src)) out.push({ ...g });
  return out.slice(0, 7);
}
const creditHTML = ph => `Photo: ${ph.page ? `<a href="${esc(ph.page)}" target="_blank" rel="noopener">${esc(String(ph.credit || 'Unknown').slice(0, 60))}</a>` : esc(String(ph.credit || 'Unknown').slice(0, 60))}${ph.license ? `, ${esc(ph.license)}` : ''}${ph.from ? ` <span class="credit-from">(${esc(ph.from)})</span>` : ''}`;
function wireGallery(photos) {
  const g = $('[data-gallery]', view);
  if (!g || photos.length < 2) return;
  const dots = $$('.dots i', view), cr = $('[data-credit]', view);
  let last = 0;
  g.addEventListener('scroll', () => {
    const i = Math.round(g.scrollLeft / Math.max(1, g.clientWidth));
    if (i === last) return;
    last = i;
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
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

function renderBird(id) {
  const sp = byId.get(id);
  if (!sp) { location.hash = '#/dex'; return; }
  const hist = sightingsOf(id);
  const first = hist[hist.length - 1];
  const seen = hist.length > 0;
  const prev = [...SPECIES].reverse().find(s => s.kind === sp.kind && s.id < id), next = SPECIES.find(s => s.kind === sp.kind && s.id > id);
  const isBird = sp.kind === 'bird';
  const seasonText = sp.kind === 'plant'
    ? (sp.season === 's' ? 'Flowers mostly spring to summer' : sp.season === 'w' ? 'Flowers mostly autumn to winter' : 'Year round')
    : sp.season === 's' ? (isBird ? 'Mostly September to April' : 'Most active September to April') : sp.season === 'w' ? 'Mostly April to September' : 'All year';
  const photos = heroPhotos(sp);
  const info = infoFor(sp.id);
  const cardInfo = { seen, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };
  const sim = similarBirds(sp);
  view.innerHTML = `
    <article class="bird">
      <div class="bird-hero" data-hero-box>
        <div class="hero-photo">
          <div class="gallery" data-gallery tabindex="0" aria-label="Photos of the ${esc(sp.name)}${photos.length > 1 ? '. Swipe for more.' : ''}">
            ${photos.length ? photos.map((ph, i) => `<figure class="slide">${wholeImg(ph.src, `${sp.name}${photos.length > 1 ? `, photo ${i + 1} of ${photos.length}` : ''}`, 'bird-photo')}</figure>`).join('')
              : `<figure class="slide"><span class="bird-photo img-missing" role="img" aria-label="${esc(sp.name)}"></span></figure>`}
          </div>
          ${photos.length > 1 ? `<div class="dots" aria-hidden="true">${photos.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
          <p class="credit" data-credit>${photos[0]?.credit ? creditHTML(photos[0]) : ''}</p>
        </div>
        <div class="hero-model hidden" data-model aria-label="3D model of a ${esc(sp.name)}. Drag to turn it."></div>
        <a class="iconbtn iconbtn--float" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
        <button class="iconbtn iconbtn--float iconbtn--right" data-search aria-label="Search everything">${icon.search}</button>
        <div class="hero-tabs" role="tablist" aria-label="View">
          <button role="tab" aria-selected="true" data-hero="photo">${photos.length > 1 ? 'Photos' : 'Photo'}</button>
          ${isBird ? '<button role="tab" aria-selected="false" data-hero="model">3D model</button>' : ''}
          <button role="tab" aria-selected="false" data-hero="card">Card</button>
        </div>
      </div>
      <div class="bird-body">
        <div class="bird-id">${band(sp.id, seen)} ${kindTag(sp)} ${pips(sp.rarity)} <span class="muted small">${RARITY[sp.rarity].label} in SEQ${recordCount(sp.id) ? `: ${recordCount(sp.id).toLocaleString('en-AU')} records since 2016` : ''}</span></div>
        <h1 class="bird-name">${esc(sp.name)}</h1>
        <p class="sci">${esc(sp.sci)}</p>
        <div class="bird-actions">
          <button class="btn btn--primary btn--grow" data-log>${seen ? 'Log another sighting' : 'Log a sighting'}</button>
          ${seen ? `<button class="btn" data-sharecard aria-label="Share card">${icon.share}</button>` : ''}
        </div>
        ${seen ? `<p class="seen-line">Seen ${plural(hist.length, 'time')}. First on ${fmtDate(first.date)}${first.place ? ` at ${esc(first.place)}` : ''}.</p>` : ''}

        ${isBird || sp.kind === 'frog' ? '<section class="call" data-calls aria-live="polite"><p class="muted small">Looking for recordings…</p></section>' : ''}

        <p class="notes">${esc(sp.notes)}</p>
        <dl class="facts">
          <div><dt>${sp.kind === 'plant' ? 'Height' : sp.kind === 'butterfly' ? 'Wingspan' : 'Size'}</dt><dd>${esc(sp.sizeText || '–')}</dd></div>
          <div><dt>When</dt><dd>${seasonText}</dd></div>
          <div><dt>Group</dt><dd><a href="#/dex" data-filter-group="${esc(sp.group)}">${esc(GROUPS[sp.group])}</a></dd></div>
          <div><dt>Look in</dt><dd>${sp.habitats.map(h => HABITATS[h]).join(', ')}${sp.nocturnal ? '. Active at night.' : ''}</dd></div>
        </dl>

        ${sim.length ? `<section><h2 class="h2">Similar ${isBird ? 'birds' : 'species'}</h2><p class="small muted">Easy to mix up. Tap Compare to see them side by side.</p>
          <ul class="rows">${sim.map(s => `<li class="sim-row"><a class="row row--sp" href="#/bird/${s.id}"><span class="row-thumb">${birdImg(s)}</span><span class="row-main"><strong>${esc(s.name)}</strong><span class="muted small">${esc(s.sizeText)}</span></span></a><a class="btn btn--small" href="#/compare/${sp.id}/${s.id}">Compare</a></li>`).join('')}</ul></section>` : ''}

        ${whereSection(sp)}

        <section class="wiki" data-wiki>${info ? infoSection(info) : ''}</section>

        <section>
          <h2 class="h2">Your sightings</h2>
          ${seen ? `<ul class="hist">${hist.map(h => `<li><button class="hist-row" data-edit="${h.id}">
            ${h.photoId ? `<img class="hist-photo" data-photo="${h.photoId}" alt="">` : ''}
            <span class="hist-main"><strong>${fmtDate(h.date)}</strong>${h.time ? ` <span class="muted">${h.time}</span>` : ''}<br><span class="muted">${esc(h.place || 'No place name')}</span></span>
            <span class="hist-n">${h.count ? `×${h.count}` : 'X'}${h.heard ? '<br><span class="muted small">heard</span>' : ''}</span></button></li>`).join('')}</ul>`
          : '<p class="muted">Not seen yet. When you find one, log it here and its card fills in with colour.</p>'}
        </section>

        <nav class="more-links">
          ${isBird ? `<a href="https://xeno-canto.org/species/${sp.sci.replace(' ', '-')}" target="_blank" rel="noopener">More calls on xeno-canto</a>` : ''}
          <a href="https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}" target="_blank" rel="noopener">Atlas of Living Australia</a>
        </nav>
        <nav class="prevnext">
          ${prev ? `<a href="#/bird/${prev.id}">${icon.back}<span>${dexNo(prev.id)} ${esc(prev.name)}</span></a>` : '<span></span>'}
          ${next ? `<a href="#/bird/${next.id}" class="next"><span>${dexNo(next.id)} ${esc(next.name)}</span>${icon.back}</a>` : ''}
        </nav>
      </div>
    </article>`;
  let disposeModel = null;
  const showHero = async which => {
    $$('[data-hero]', view).forEach(b => b.setAttribute('aria-selected', String(b.dataset.hero === which)));
    if (which === 'card') { openCard(sp, cardInfo); $$('[data-hero]', view).forEach(b => b.setAttribute('aria-selected', String(b.dataset.hero === (disposeModel ? 'model' : 'photo')))); return; }
    const box = $('[data-model]', view);
    $('.hero-photo', view).classList.toggle('hidden', which !== 'photo');
    box.classList.toggle('hidden', which !== 'model');
    if (which === 'model' && !disposeModel) {
      box.innerHTML = '<p class="model-loading">Building the model…</p>';
      try {
        const { mountBird } = await import('./model3d.js');
        box.innerHTML = '<p class="model-hint">Drag to turn</p>';
        disposeModel = mountBird(box, sp);
      } catch (err) { box.innerHTML = '<p class="model-loading">3D needs a newer browser.</p>'; }
    }
  };
  const audioStops = [];
  state.cleanup = () => { disposeModel?.(); audioStops.forEach(f => f()); };
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
  };
  view.onchange = null;
  // Wikipedia text and photo credit
  wireGallery(photos);
  details(sp).then(d => {
    if (location.hash !== `#/bird/${id}`) return;
    if (d?.credit && photos[0]?.wiki) { photos[0].credit = d.credit.artist; photos[0].license = d.credit.license; photos[0].page = d.credit.page; photos[0].from = 'Wikimedia Commons'; }
    const cr = $('[data-credit]', view);
    if (cr && photos[0]?.credit && !cr.dataset.idx) cr.innerHTML = creditHTML(photos[0]);
    const w = $('[data-wiki]', view);
    if (!info && d?.extract && w) w.innerHTML = `<h2 class="h2">About</h2><p>${esc(d.extract)}</p><p class="small muted">From <a href="${esc(d.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>`;
  }).catch(() => {});
  getCalls(sp).then(list => {
    if (location.hash !== `#/bird/${id}`) return;
    const box = $('[data-calls]', view);
    if (!box) return;
    if (!list.length) {
      box.innerHTML = !navigator.onLine ? '<p class="muted small">Calls for this one need an internet connection.</p>'
        : isBird ? '<p class="muted small">No free recording found for this bird. Try the xeno-canto link below.</p>' : '';
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
    const setIcons = () => $$('[data-play]', box).forEach(b => { const on = Number(b.dataset.play) === playing && !audio.paused; b.innerHTML = on ? icon.pause : icon.play; b.setAttribute('aria-label', on ? 'Pause' : `Play recording ${Number(b.dataset.play) + 1}`); });
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
  }).catch(() => { const box = $('[data-calls]', view); if (box) box.innerHTML = '<p class="muted small">Calls need an internet connection the first time.</p>'; });
}

function renderCompare(a, b) {
  const A = byId.get(a), B = byId.get(b);
  if (!A || !B) { location.hash = '#/dex'; return; }
  const seen = seenSet();
  const col = sp => {
    const m = monthRates(sp.id);
    return `<div class="cmp-col">
      <a href="#/bird/${sp.id}" class="cmp-img">${birdImg(sp, 'large', '', { whole: true })}</a>
      <div class="cmp-id">${band(sp.id, seen.has(sp.id))}${pips(sp.rarity)}</div>
      <h2>${esc(sp.name)}</h2>
      <p class="sci small">${esc(sp.sci)}</p>
      <dl class="cmp-facts"><dt>Size</dt><dd>${sp.size} cm</dd><dt>Look in</dt><dd>${sp.habitats.map(h => HABITATS[h]).join(', ')}</dd></dl>
      ${m ? `<div class="season season--mini">${m.rel.map(v => `<i style="height:${Math.max(3, v * 100)}%"></i>`).join('')}</div><div class="season-labels">${[...'JFMAMJJASOND'].map(c => `<span>${c}</span>`).join('')}</div>` : ''}
      <p class="small">${esc(sp.notes)}</p>
      <button class="btn btn--small" data-cplay="${sp.id}">${icon.play} Call</button>
    </div>`;
  };
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/bird/${A.id}" aria-label="Back">${icon.back}</a><h1>Compare</h1></header>
    <div class="cmp">${col(A)}${col(B)}</div>`;
  let audio = null;
  view.onclick = async e => {
    const p = e.target.closest('[data-cplay]');
    if (!p) return;
    audio?.pause();
    const list = await getCalls(byId.get(Number(p.dataset.cplay)));
    if (!list.length) { toast('No recording for this bird yet.'); return; }
    audio = new Audio(await audioUrl(list[0].src)); audio.play().catch(() => toast('That recording would not play.'));
  };
  view.onchange = null;
  state.cleanup = () => audio?.pause();
}

function whereSection(sp) {
  const m = monthRates(sp.id);
  if (!m) return '';
  const now = new Date().getMonth();
  const spots = spotsFor(sp.id, 6);
  const L = 'JFMAMJJASOND';
  return `<section class="where">
    <h2 class="h2">When it's reported</h2>
    <div class="season" role="img" aria-label="Reporting rate by month, highest in ${MONTHS[m.rel.indexOf(1)]}">${m.rel.map((v, i) => `<i class="${i === now ? 'now' : ''}" style="height:${Math.max(3, Math.round(v * 100))}%"></i>`).join('')}</div>
    <div class="season-labels" aria-hidden="true">${[...L].map(c => `<span>${c}</span>`).join('')}</div>
    <p class="small muted">How often it's reported in SEQ each month, from ${recordCount(sp.id).toLocaleString('en-AU')} records since 2016 in the Atlas of Living Australia.</p>
    ${spots.length ? `<h2 class="h2">Best places in SEQ</h2>
    <ul class="spots">${spots.map(({ h, c }) => `<li><span>${esc(h.name)}</span><span class="num">${c.toLocaleString('en-AU')}</span></li>`).join('')}</ul>
    <p class="small muted">Number of records at each spot.</p>` : ''}
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
    <div class="quicklinks pad-x"><a class="btn" href="#/stats">${icon.chart} Stats</a><a class="btn" href="#/quiz">${icon.quiz} Guess the bird</a></div>
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
      <p class="muted small">A patch is a place you bird often, like your yard or a local park. Any sighting inside its circle counts automatically.</p>
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
      }).join('')}</ul>` : '<p class="empty-inline">Start an outing with the + button to tally every bird at a spot.</p>'}
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
    ${editing ? `<div class="searchbox searchbox--sticky">${icon.search}<input type="search" placeholder="Add a bird: type a name" value="${esc(q)}" data-tq aria-label="Find a bird to add"></div>
      ${q ? `<ul class="tally-list">${results.map(tallyRow).join('') || '<li class="muted pad">No bird by that name in the dex.</li>'}</ul><hr class="rule">` : ''}` : ''}
    <ul class="tally-list">${ordered.map(tallyRow).join('') || (editing ? '<li class="muted pad">Search above to add the first bird. Tap + again each time you count another.</li>' : '')}</ul>
    ${o.notes ? `<p class="pad-x">${esc(o.notes)}</p>` : ''}
    <div class="row-end pad">
      ${live ? `<button class="btn btn--danger btn--quiet" data-cancel>Discard</button><span class="spacer"></span><button class="btn btn--primary" data-finish>Finish outing</button>`
             : `<button class="btn btn--danger btn--quiet" data-cancel>Delete outing</button><span class="spacer"></span><button class="btn" data-editbirds>${editing ? 'Done editing birds' : 'Edit birds'}</button><button class="btn" data-finish>Edit details</button>`}
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
      renderOuting(id);
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
    }).join('')}</ul></section>`).join('') || '<div class="empty"><p>No sightings yet. Tap + to log your first bird.</p></div>'}`;
  view.onclick = e => { const ed = e.target.closest('[data-edit]'); if (ed) openSightingSheet({ sightingId: Number(ed.dataset.edit) }); };
  view.onchange = null;
}

// Map
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js'; s.onload = res; s.onerror = rej; document.head.append(s);
  });
}
// Map or satellite base layers, remembered on this device. Returns a control element to put in the page.
function baseLayers(map, L) {
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
        <button class="chip ${f.show === 'all' ? 'chip--on' : ''}" data-mshow="all">My sightings</button>
        <button class="chip ${f.show === 'photos' ? 'chip--on' : ''}" data-mshow="photos">With photos</button>
        <button class="chip ${f.show === 'none' ? 'chip--on' : ''}" data-mshow="none">Hide mine</button>
        <button class="chip" data-locate>${icon.pin} Me</button>
      </div>
      <button class="btn btn--primary map-patch" data-patch>New patch here</button>
      <div class="map-cross hidden" aria-hidden="true"></div>
    </div>`;
  view.onchange = null;
  try { await loadLeaflet(); } catch (_) { $('#map').innerHTML = '<p class="pad">The map needs an internet connection the first time.</p>'; return; }
  if (!location.hash.startsWith('#/map')) return;
  const L = window.L;
  const map = state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView(state.mapView?.c || [-27.47, 153.02], state.mapView?.z || 9);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  $('.mapwrap', view).append(baseLayers(map, L));
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
      mk.addTo(map).bindPopup(`<div data-desc><span class="pop-h">${esc(h.name)}</span>${h.rich} dex species recorded here. You have seen ${got}.<p class="pop-src">Looking up this place…</p></div>
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
      </form>`);
    s.closest('.sheet-wrap').classList.add('sheet-wrap--map');
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
    if ($('.sheet-wrap')) return;
    const { lat, lng } = e.latlng;
    const pop = L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent('<p class="pop-src">Looking up this spot…</p>').openOn(map);
    const html = await describeArea(lat, lng, { seen }).catch(() => '<p class="pop-desc">Couldn\'t look this spot up. Check the internet connection.</p>');
    if (map.hasLayer(pop)) pop.setContent(`${html}<a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>`);
  });
  view.onclick = async e => {
    const ri = e.target.closest('[data-ri]');
    if (ri) { goTo(results[Number(ri.dataset.ri)]); return; }
    if (e.target.closest('[data-mqx]')) { mq.value = ''; mqx.classList.add('hidden'); tempMarker?.remove(); mq.focus(); showRes(localResults('')); return; }
    if (e.target.closest('[data-need]')) { f.need = !f.need; renderMap(spId); return; }
    const ms = e.target.closest('[data-mshow]');
    if (ms) { f.show = ms.dataset.mshow; renderMap(spId); }
    if (e.target.closest('[data-hot]')) { if (focus) f.hotFocus = !f.hotFocus; else f.hot = !f.hot; renderMap(spId); }
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

// Badges
function renderBadges() {
  const list = badges(state.sightings, state.outings);
  const earned = list.filter(b => b.done).length;
  const sections = [['milestone', 'Milestones'], ['rarity', 'Rarities'], ['habit', 'Habits'], ['habitat', 'Habitats'], ['group', 'Complete a group']];
  view.innerHTML = `
    <header class="page-head"><h1>Badges</h1><div class="head-actions"><button class="iconbtn" data-search aria-label="Search everything">${icon.search}</button><a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a></div></header>
    <div class="quicklinks pad-x"><a class="btn" href="#/quiz">${icon.quiz} Guess the bird</a><a class="btn" href="#/stats">${icon.chart} Stats</a>${leaderboardLink()}</div>
    <p class="list-count"><b>${earned}</b> of ${list.length} earned</p>
    ${sections.map(([k, title]) => `<section class="block"><h2 class="h2">${title}</h2><ul class="badges">${list.filter(b => b.kind === k).map(b => `
      <li class="badge ${b.done ? 'badge--done' : ''} badge--${k}">
        <span class="medal" aria-hidden="true"><span>${b.done ? '✓' : b.need}</span></span>
        <span class="badge-txt"><strong>${esc(b.name)}</strong><span class="small muted">${esc(b.desc)}</span>
        ${b.done ? '' : `<span class="meter meter--thin" style="--p:${Math.round(b.have / b.need * 100)}%"><span></span></span><span class="small muted">${b.have} of ${b.need}</span>`}</span>
      </li>`).join('')}</ul></section>`).join('')}`;
  view.onclick = e => { if (e.target.closest('[data-search]')) openSearch(); }; view.onchange = null;
}

// Settings
async function renderSettings() {
  const pack = await loadCallPack();
  const packKinds = {};
  for (const id of Object.keys(pack)) { const k = kindOf(Number(id)); packKinds[k] = (packKinds[k] || 0) + 1; }
  const callsBlurb = Object.keys(pack).length
    ? `Short clips of the calls of ${Object.entries(packKinds).map(([k, n]) => plural(n, KINDS[k].one, KINDS[k].label.toLowerCase())).join(' and ')}, for the call quiz, the frog board on Listen and each species page. A clip is also kept once you have played it.`
    : 'The call clips could not be loaded. Check your connection and open Settings again.';
  let usage = '';
  try { const est = await navigator.storage.estimate(); usage = `${(est.usage / 1e6).toFixed(1)} MB used on this phone`; } catch (_) {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/badges" aria-label="Back">${icon.back}</a><h1>Settings</h1></header>
    <section class="block" data-account></section>
    <section class="block">
      <label class="field"><span>Theme</span><select data-theme>${[['auto', 'Match my phone'], ['light', 'Light'], ['dark', 'Dark'], ['outdoor', 'Outdoor (high contrast for bright sun)']].map(([v, l]) => `<option value="${v}" ${state.settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${state.installPrompt ? '<button class="btn btn--primary" data-install>Install app on this phone</button>' : `<p class="small muted">${matchMedia('(display-mode: standalone)').matches ? "Installed on this phone." : 'To install: open the browser menu, then Add to Home screen.'}</p>`}
      <button class="btn btn--quiet" data-welcome>Show the welcome screen</button>
    </section>
    <section class="block">
      <h2 class="h2">Use it offline</h2>
      <div class="offline-part">
        <p class="muted small">Download every photo and description so the dex works with no signal. Takes about 30 MB.</p>
        <button class="btn" data-dl>Download photos for offline</button> <span class="small muted" data-dlstatus role="status"></span>
      </div>
      <div class="offline-part" data-callpack>
        <p class="muted small">${callsBlurb}</p>
        <div class="callpack-ctl" data-callctl aria-live="polite"></div>
        <div class="meter meter--thin hidden" data-callprog style="--p:0%"><span></span></div>
        <p class="small muted" data-callstatus role="status"></p>
      </div>
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
  wireCallPack();
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
    if (e.target.closest('[data-dl]')) {
      const st = $('[data-dlstatus]', view);
      st.textContent = 'Starting…';
      await downloadAll((d, t) => { st.textContent = `${d} of ${t}`; });
      st.textContent = 'All set for offline use.';
      navigator.storage?.persist?.();
    }
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
// Settings: "Save calls for offline". The state comes from Cache Storage each time, so it survives a reload.
async function wireCallPack() {
  const ctl = $('[data-callctl]', view), status = $('[data-callstatus]', view), prog = $('[data-callprog]', view);
  if (!ctl) return;
  const mb = b => `${Math.max(1, Math.round(b / 1e6))} MB`;
  const show = async () => {
    const st = await callPackStatus();
    if (!ctl.isConnected || !st.total) return;
    if (st.saved >= st.total) {
      ctl.innerHTML = `<p class="callpack-done" tabindex="-1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Calls saved for offline: ${st.total} clips, ${(st.bytes / 1e6).toFixed(1)} MB</span></p>`;
      status.textContent = '';
      return;
    }
    const left = st.bytes - st.savedBytes;
    ctl.innerHTML = `<button class="btn" data-calls-dl>${st.saved ? `Save the rest of the calls (about ${mb(left)})` : `Save calls for offline (about ${mb(st.bytes)})`}</button>`;
    status.textContent = st.saved ? `${st.saved} of ${st.total} clips are on this phone already.` : '';
  };
  await show();
  ctl.onclick = async e => {
    const b = e.target.closest('[data-calls-dl]');
    if (!b || b.disabled) return;
    if (!navigator.onLine) { status.textContent = 'You are offline. Connect to the internet, then save the calls.'; return; }
    b.disabled = true; b.textContent = 'Saving calls…';
    prog.classList.remove('hidden');
    let last = 0;
    const res = await saveCallPack((d, t) => {
      prog.style.setProperty('--p', `${Math.round(d / t * 100)}%`);
      // Announce every 10 per cent or so, not every clip.
      if (d === t || d - last >= t / 10) { last = d; status.textContent = `Saving calls: ${d} of ${t}`; }
    }).catch(() => ({ failed: -1 }));
    prog.classList.add('hidden');
    await show();
    if (res.failed) status.textContent = res.failed > 0 ? `${res.failed} clips didn't download. Check your connection and try again.` : 'Saving calls failed. Check your connection and try again.';
    else { navigator.storage?.persist?.(); $('.callpack-done', ctl)?.focus(); }
  };
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- global search ----------
function openSearch() {
  const ov = document.createElement('div');
  ov.className = 'search-ov';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Search');
  ov.innerHTML = `<div class="search-bar">${icon.search}<input type="search" placeholder="Birds, animals, plants, places, hotspots" aria-label="Search everything" autocomplete="off"><button class="iconbtn" data-x aria-label="Close search">${icon.close}</button></div>
    <div class="search-res" aria-live="polite"><p class="muted pad">Try "kingfisher", "Oxley", "lorikeet" or "wetlands".</p></div>`;
  document.body.append(ov);
  document.body.classList.add('has-sheet');
  const input = $('input', ov), res = $('.search-res', ov);
  const close = () => { ov.remove(); document.body.classList.remove('has-sheet'); };
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
      sec('Hotspots', hs.map(h => `<li><a class="row" href="#/map/at/${h.lat},${h.lng}"><span class="row-main"><strong>${esc(h.name)}</strong><span class="small muted">${h.rich} dex species recorded</span></span></a></li>`).join('')),
      sec('Your patches', pats.map(p => `<li><a class="row" href="#/patch/${p.id}"><span class="row-main"><strong>${esc(p.name)}</strong></span></a></li>`).join('')),
      sec('Your sightings', mine.map(s => `<li><a class="row" href="#/bird/${s.speciesId}"><span class="row-main"><strong>${esc(byId.get(s.speciesId)?.name)}</strong><span class="small muted">${fmtDate(s.date)}${s.place ? `, ${esc(s.place)}` : ''}</span></span></a></li>`).join('')),
    ].join('') || '<p class="muted pad">Nothing found. Check the spelling, or try part of a name.</p>';
  };
  input.addEventListener('input', run);
  ov.addEventListener('click', e => { if (e.target.closest('[data-x]') || e.target.closest('a')) close(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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
    <details class="frog-credits"><summary class="small">Recording credits</summary>
      <ul class="small muted">${frogs.flatMap(({ sp }) => pack[sp.id].map((c, i) => `<li>${esc(sp.name)}${pack[sp.id].length > 1 ? `, call ${i + 1}` : ''}: ${callCredit({ ...c, local: true })}</li>`)).join('')}</ul>
    </details>
  </section>`;
}

async function renderListen() {
  const L = state.listen;
  const pack = await loadCallPack();
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
    const cr = $('[data-fcredit]', row());
    if (cr) cr.textContent = navigator.onLine ? 'That clip would not play.' : 'Not saved on this phone yet. Save calls in Settings to play it with no signal.';
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
      const cr = $('[data-fcredit]', row());
      if (cr) cr.innerHTML = callCredit({ ...c, local: true });
      localCalls(id).then(list => {
        if (cur?.key !== key) return;
        audio.src = list[i].src;
        audio.play().catch(() => {});
      });
    },
    stop() { audio.pause(); reset(); cur = null; },
  };
}

// ---------- Scan (photo ID) ----------
function renderScan() {
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
      <div><h1>Scan a bird</h1><p class="muted small">Take a photo or pick one, and BioCLIP suggests which dex bird it is.</p></div></header>
    <div class="scan pad-x">
      <label class="scan-drop" data-drop>
        <input type="file" accept="image/*" data-file hidden>
        <span class="scan-preview" data-pick>${icon.scan}<strong>Take or choose a photo</strong><em>Works best when the bird fills a good part of the frame</em></span>
      </label>
      <div class="crop hidden" data-cropwrap>
        <div class="crop-stage" data-stage><img alt="Your photo" data-img><span class="crop-box" data-box></span></div>
        <p class="small muted">Tap the bird so the box sits on it. A tight box gives much better answers for distant birds.</p>
        <label class="field"><span>Box size</span><input type="range" min="15" max="100" value="100" data-size></label>
        <div class="row-start"><button class="btn btn--primary" data-identify>Identify this bird</button><button class="btn" data-another>Use another photo</button></div>
      </div>
      <p class="small muted" data-sstatus></p>
      <div class="meter meter--thin hidden" data-sprog style="--p:0%"><span></span></div>
      <ul class="rows" data-results></ul>
      <p class="small muted">Photo ID uses BioCLIP (Imageomics Institute, MIT licence) running on your phone. The first scan downloads the model (about 98 MB, best on Wi-Fi), then it works offline. In testing it named the right bird first about 6 times in 10, and 8 in 10 when it was very sure, so compare with the photos before you log.</p>
    </div>`;
  let blob = null, img = null;
  const crop = { cx: 0.5, cy: 0.5, size: 1 };
  const status = $('[data-sstatus]', view), prog = $('[data-sprog]', view), out = $('[data-results]', view);
  const boxRect = () => {
    const ar = img.naturalWidth / img.naturalHeight;
    // square box measured against the short side
    const w = ar >= 1 ? crop.size / ar : crop.size, h = ar >= 1 ? crop.size : crop.size * ar;
    const x = Math.min(Math.max(crop.cx - w / 2, 0), 1 - w), y = Math.min(Math.max(crop.cy - h / 2, 0), 1 - h);
    return { x, y, w, h };
  };
  const drawBox = () => {
    const r = boxRect(), box = $('[data-box]', view);
    Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
  };
  view.onchange = async e => {
    if (e.target.matches('[data-file]')) {
      const f = e.target.files?.[0]; if (!f) return;
      blob = await resizeImage(f, 1600);
      img = $('[data-img]', view);
      img.src = URL.createObjectURL(blob);
      await img.decode().catch(() => {});
      Object.assign(crop, { cx: 0.5, cy: 0.5, size: 1 }); $('[data-size]', view).value = 100;
      $('[data-drop]', view).classList.add('hidden');
      $('[data-cropwrap]', view).classList.remove('hidden');
      out.innerHTML = ''; status.textContent = '';
      drawBox();
    }
  };
  view.oninput = e => { if (e.target.matches('[data-size]')) { crop.size = e.target.value / 100; drawBox(); } };
  view.onclick = async e => {
    const stage = e.target.closest('[data-stage]');
    if (stage && img) {
      const r = img.getBoundingClientRect();
      crop.cx = (e.clientX - r.left) / r.width; crop.cy = (e.clientY - r.top) / r.height;
      if (crop.size === 1) { crop.size = 0.5; $('[data-size]', view).value = 50; }
      drawBox();
    }
    if (e.target.closest('[data-another]')) { $('[data-file]', view).click(); }
    const l = e.target.closest('[data-logscan]');
    if (l) openSightingSheet({ speciesId: Number(l.dataset.logscan), autoGps: true, photoBlob: blob, notes: 'Identified from a photo with BioCLIP.' });
    if (!e.target.closest('[data-identify]') || !blob) return;
    out.innerHTML = '';
    try {
      const mod = await import('./photoid.js');
      if (!(await mod.isPhotoModelCached())) {
        prog.classList.remove('hidden');
        status.textContent = `Downloading the photo model (about ${mod.PHOTO_MODEL_MB} MB)…`;
      }
      await mod.loadPhotoModel(p => { const pct = Math.round(p * 100); prog.style.setProperty('--p', `${pct}%`); status.textContent = `Downloading the photo model… ${pct}%`; });
      prog.classList.add('hidden');
      status.textContent = 'Looking closely…';
      const res = await mod.identifyPhoto(blob, { crop: crop.size < 1 ? boxRect() : undefined, topK: 5 });
      const top = res[0];
      status.textContent = top.score >= 0.9 ? 'Strong match. Best guess first.' : top.score >= 0.4 ? 'Not certain. Compare the photos below.' : 'Not sure. It may not be one of the dex birds. Try a tighter box or a sharper photo.';
      const seen = seenSet();
      out.innerHTML = res.map(r => { const sp = byId.get(r.id); return `<li class="hit">
        <a class="row-thumb" href="#/bird/${sp.id}">${birdImg(sp)}</a>
        <span class="row-main"><strong>${esc(sp.name)}</strong><span class="small muted">${Math.round(r.score * 100)}% sure${seen.has(sp.id) ? '' : '. New for your dex!'}</span>
        <span class="meter meter--thin" style="--p:${Math.round(r.score * 100)}%"><span></span></span></span>
        <button class="btn btn--small" data-logscan="${sp.id}">Log it</button></li>`; }).join('');
    } catch (err) {
      prog.classList.add('hidden');
      status.textContent = `Photo ID couldn't run here: ${err.message || err}`;
    }
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
  const ov = document.createElement('div');
  ov.className = 'welcome';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Welcome');
  ov.innerHTML = `<div class="welcome-card">
    <div class="welcome-model" data-wm></div>
    <h1>Hi Sarah</h1>
    <p>This is your BirdyDex: ${BIRDS.length} South East Queensland birds to find${ANIMALS.length > BIRDS.length ? `, plus ${ANIMALS.length - BIRDS.length} other native animals` : ''}${ofKind('plant').length ? ` and ${ofKind('plant').length} native plants` : ''}, starting with this Eastern Yellow Robin.</p>
    <ul class="welcome-list">
      <li><strong>Log</strong> a bird with the + button, or press and hold any bird in the dex.</li>
      <li><strong>Listen</strong> and <strong>Scan</strong> name birds from a call or a photo.</li>
      <li><strong>Hotspots, targets and badges</strong> show where to go next.</li>
    </ul>
    <div class="row-center">${state.installPrompt ? '<button class="btn" data-winstall>Install app</button>' : ''}<button class="btn btn--primary" data-wgo>Start birding</button></div>
  </div>`;
  document.body.append(ov);
  let dispose = null;
  try { const { mountBird } = await import('./model3d.js'); dispose = mountBird($('[data-wm]', ov), byId.get(165)); } catch (_) {}
  ov.addEventListener('click', async e => {
    if (e.target.closest('[data-winstall]')) await promptInstall();
    if (e.target.closest('[data-wgo]')) { dispose?.(); ov.remove(); db.kvSet('welcomed', true); }
  });
}

// ---------- boot ----------
const ctx = {
  state, view, $, $$, esc, icon, birdImg, band, pips, toast, fmtDate, plural, GROUPS,
  seenSet, sightingsOf, openSightingSheet, getCalls, hasCalls, audioUrl,
  openSheet, closeSheet, confirmSheet, refresh: refreshFromSync,
};

// Data changed under us (cloud sync, sign in or out): reload, and redraw unless that would interrupt something.
async function refreshFromSync({ force = false } = {}) {
  await loadData();
  applyTheme();
  const busy = $('.sheet-wrap') || document.activeElement?.matches('input, textarea') || /^#\/(listen|scan|quiz)/.test(location.hash);
  if (force ? !$('.sheet-wrap') : !busy) render();
}

async function boot() {
  await Promise.all([loadData(), loadSeq(), loadExtras()]);
  applyTheme();
  $('#plus').addEventListener('click', e => { e.preventDefault(); openPlusSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === '/' && !e.target.closest('input, textarea, select')) { e.preventDefault(); openSearch(); }
  });
  window.addEventListener('hashchange', () => { closeSheet(); render(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; if ((location.hash || '#/dex').startsWith('#/dex')) renderDex(); });
  render();
  initAccount(ctx).catch(() => {});
  // Photos arriving only change the dex/list pages; don't interrupt Listen or a playing call.
  onMediaReady(() => { if (!$('.sheet-wrap') && /^(#\/?(dex)?|#\/lists?.*|#\/targets|#\/badges|#\/bird\/\d+|#\/compare\/.*)?$/.test(location.hash)) render(); });
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
