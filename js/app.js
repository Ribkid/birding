import { SPECIES, GROUPS, HABITATS, RARITY, byId } from './species.js';
import { db } from './db.js';
import { loadIndex, photoFor, sized, details, calls, audioUrl, downloadAll, onMediaReady } from './media.js';
import { speciesList, periodFilter, totals, yearTotals, targets, badges, inPatch, haversineKm, MONTHS, inSeason } from './stats.js';
import { toEbirdCsv } from './ebird.js';
import { loadSeq, seq, monthRates, likelihood, recordCount, spotsFor, pointsFor, hotspots, nearbyTargets } from './seqdata.js';

const relRate = (id, month) => { const m = monthRates(id); return m ? m.rel[month - 1] : null; };
const targetOpts = () => seq()?.hotspots?.length ? { score: likelihood, rel: relRate } : {};

// ---------- state ----------
const state = {
  sightings: [], outings: [], patches: [],
  settings: { colourUnseen: false },
  activeOutingId: null,
  dex: { q: '', show: 'all', group: '', habitat: '' },
  listSort: 'dex',
};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dexNo = id => String(id).padStart(3, '0');
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
  if (!rec) return null;
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
const band = (id, seen) => `<span class="band ${seen ? 'band--on' : ''}" aria-label="Dex number ${id}">${dexNo(id)}</span>`;
const pips = r => `<span class="pips pips--${r}" title="${RARITY[r].label}">${[1, 2, 3, 4].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span>`;
function birdImg(sp, size = 'small', cls = '') {
  const url = sized(sp.id, size);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(sp.name)}" loading="lazy" decoding="async" onerror="this.classList.add('img-missing')">`
    : `<span class="${cls} img-missing" role="img" aria-label="${esc(sp.name)}"></span>`;
}
const icon = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
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
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="celebrate-card">
    <div class="celebrate-photo">${birdImg(sp, 'large')}<span class="band band--on band--big band--clamp">${dexNo(sp.id)}</span></div>
    <p class="celebrate-kicker">New for your dex</p>
    <h2>${esc(sp.name)}</h2>
    <p class="muted">${seenSet().size} of ${SPECIES.length} species seen</p>
    ${newBadges.length ? `<p class="celebrate-badges">Badge earned: ${newBadges.map(b => `<strong>${esc(b.name)}</strong>`).join(', ')}</p>` : ''}
    <button class="btn btn--primary" data-dismiss>Nice</button></div>`;
  document.body.append(el);
  const done = () => { el.classList.add('celebrate--out'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', done);
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

async function openSightingSheet({ speciesId = null, sightingId = null } = {}) {
  const existing = sightingId ? state.sightings.find(s => s.id === sightingId) : null;
  const rec = existing ? { ...existing } : {
    speciesId, count: 1, heard: false, date: todayStr(), time: timeStr(),
    lat: null, lng: null, acc: null, place: '', notes: '', photoId: null, outingId: null,
  };
  const outing = !existing && activeOuting();
  let newPhoto = null, removePhoto = false;
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
        <div class="loc-row"><button type="button" class="btn" data-gps>${icon.pin} Use my location</button><span class="muted small" data-gps-status>${rec.lat != null ? `${rec.lat.toFixed(4)}, ${rec.lng.toFixed(4)}` : 'Not set'}</span></div>
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

  sheet.addEventListener('click', async e => {
    const step = e.target.closest('[data-step]');
    if (step) { const inp = form.count; inp.value = Math.max(1, (Number(inp.value) || 0) + Number(step.dataset.step)); }
    const pl = e.target.closest('[data-place]');
    if (pl) form.place.value = pl.dataset.place;
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
      <button class="plus-opt" data-one><strong>Log one bird</strong><span>A single sighting with photo, place and notes.</span></button>
      ${o ? `<button class="plus-opt" data-resume><strong>Back to your outing</strong><span>${esc(o.place || 'Current outing')}, started ${o.time}</span></button>`
          : `<button class="plus-opt" data-outing><strong>Start an outing</strong><span>Tally every bird at one place, like an eBird checklist.</span></button>`}
    </div>`);
  s.addEventListener('click', e => {
    if (e.target.closest('[data-one]')) openSightingSheet();
    if (e.target.closest('[data-outing]')) openStartOuting();
    if (e.target.closest('[data-resume]')) { closeSheet(); location.hash = `#/outing/${o.id}`; }
  });
}
function openStartOuting() {
  const pos = {};
  const s = openSheet(`<h2 class="sheet-title">Start an outing</h2>
    <form class="form" data-form>
      <div class="loc-row"><button type="button" class="btn" data-gps>${icon.pin} Use my location</button><span class="muted small" data-gps-status>Not set</span></div>
      <label class="field"><span>Place name</span><input name="place" placeholder="e.g. Sandy Camp Road Wetlands" autocomplete="off"></label>
      <div class="chips chips--scroll">${[...new Set([...state.patches.map(p => p.name), ...recentPlaces()])].slice(0, 8).map(p => `<button type="button" class="chip" data-place="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn--primary">Start outing</button></div>
    </form>`);
  const form = $('[data-form]', s), status = $('[data-gps-status]', s);
  const locate = async () => {
    status.textContent = 'Finding you…';
    try {
      Object.assign(pos, await getPosition());
      status.textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`;
      if (!form.place.value) form.place.value = nearestPlaceName(pos) || await reverseGeocode(pos);
    } catch (err) { status.textContent = err.message; }
  };
  locate();
  s.addEventListener('click', e => {
    if (e.target.closest('[data-gps]')) locate();
    const pl = e.target.closest('[data-place]');
    if (pl) {
      form.place.value = pl.dataset.place;
      const patch = state.patches.find(p => p.name === pl.dataset.place);
      if (patch && pos.lat == null) Object.assign(pos, { lat: patch.lat, lng: patch.lng });
    }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const now = new Date();
    const o = { date: todayStr(now), time: timeStr(now), startedAt: now.getTime(), place: form.place.value.trim(),
      lat: pos.lat ?? null, lng: pos.lng ?? null, endedAt: null, complete: false, distanceKm: null, durationMin: null, notes: '' };
    o.id = await db.add('outings', o);
    state.outings.push(o);
    state.activeOutingId = o.id;
    await db.kvSet('activeOuting', o.id);
    closeSheet();
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
    await saveSighting({ speciesId, count: 1, heard: false, date: outing.date, time: timeStr(), lat: outing.lat, lng: outing.lng,
      acc: null, place: outing.place, notes: '', photoId: null, outingId: outing.id });
  }
}
function openFinishOuting(o) {
  const mins = Math.max(1, Math.round((Date.now() - o.startedAt) / 60000));
  const n = state.sightings.filter(s => s.outingId === o.id).length;
  const s = openSheet(`<h2 class="sheet-title">Finish outing</h2>
    <p class="muted">${plural(n, 'species', 'species')} at ${esc(o.place || 'this spot')}.</p>
    <form class="form" data-form>
      <div class="grid2">
        <label class="field"><span>Duration (minutes)</span><input name="dur" inputmode="numeric" value="${o.durationMin || mins}"></label>
        <label class="field"><span>Distance walked (km)</span><input name="km" inputmode="decimal" placeholder="0 if you stayed put" value="${o.distanceKm ?? ''}"></label>
      </div>
      <label class="check check--card"><input type="checkbox" name="complete" ${o.complete || !o.endedAt ? 'checked' : ''}><span>I logged every bird I could identify. eBird calls this a complete checklist.</span></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Weather, tide, company…">${esc(o.notes)}</textarea></label>
      <div class="row-end"><button type="button" class="btn" data-close>Keep going</button><button class="btn btn--primary">Finish outing</button></div>
    </form>`);
  $('[data-form]', s).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    Object.assign(o, { endedAt: o.endedAt || Date.now(), durationMin: parseInt(f.dur.value, 10) || mins,
      distanceKm: parseFloat(f.km.value) || 0, complete: f.complete.checked, notes: f.notes.value.trim() });
    await db.put('outings', o);
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
  [/^#\/settings$/, () => renderSettings()],
];
let lastRoute = '';
function render() {
  const hash = location.hash || '#/dex';
  if (state.map && !hash.startsWith('#/map')) { state.map.remove(); state.map = null; }
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { fn(m); break; }
  }
  const tab = hash.split('/')[1] || 'dex';
  const tabFor = { bird: 'dex', dex: 'dex', lists: 'lists', list: 'lists', patch: 'lists', targets: 'lists', outing: 'lists', log: 'lists', map: 'map', badges: 'badges', settings: 'badges' }[tab] || 'dex';
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
function renderDex() {
  const seen = seenSet();
  const f = state.dex;
  const q = f.q.trim().toLowerCase();
  const list = SPECIES.filter(s =>
    (!q || `${s.name} ${s.sci} ${dexNo(s.id)}`.toLowerCase().includes(q)) &&
    (f.show === 'all' || (f.show === 'seen') === seen.has(s.id)) &&
    (!f.group || s.group === f.group) && (!f.habitat || s.habitats.includes(f.habitat)));
  const byGroup = {};
  list.forEach(s => (byGroup[s.group] ||= []).push(s));
  const pct = Math.round(seen.size / SPECIES.length * 100);
  view.innerHTML = `
    <header class="dex-head">
      <div class="dex-head-top">
        <h1 class="wordmark">Birddex <span>South East Queensland</span></h1>
        <a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a>
      </div>
      <div class="tally" aria-label="${seen.size} of ${SPECIES.length} species seen">
        <span class="tally-band"><b>${seen.size}</b><i>/${SPECIES.length}</i></span>
        <div class="tally-meta"><span>species seen</span>
          <div class="meter" style="--p:${pct}%"><span></span></div></div>
      </div>
      <div class="searchbox">${icon.search}<input type="search" placeholder="Search ${SPECIES.length} birds" value="${esc(f.q)}" data-q aria-label="Search birds"></div>
      <div class="chips chips--scroll" role="group" aria-label="Filter">
        ${[['all', 'All'], ['seen', 'Seen'], ['unseen', 'Not seen yet']].map(([v, l]) => `<button class="chip ${f.show === v ? 'chip--on' : ''}" data-show="${v}" aria-pressed="${f.show === v}">${l}</button>`).join('')}
        <select class="chip chip--select ${f.habitat ? 'chip--on' : ''}" data-habitat aria-label="Habitat">
          <option value="">Any habitat</option>${Object.entries(HABITATS).map(([k, v]) => `<option value="${k}" ${f.habitat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select class="chip chip--select ${f.group ? 'chip--on' : ''}" data-group aria-label="Bird group">
          <option value="">All groups</option>${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${f.group === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
    </header>
    <div class="dex ${state.settings.colourUnseen ? 'dex--colour' : ''}">
      ${Object.keys(GROUPS).filter(g => byGroup[g]).map(g => {
        const all = SPECIES.filter(s => s.group === g);
        const got = all.filter(s => seen.has(s.id)).length;
        return `<section class="dex-group">
          <h2 class="dex-group-h"><span>${GROUPS[g]}</span><span class="dex-group-n">${got}/${all.length}</span></h2>
          <ul class="dex-grid">${byGroup[g].map(s => `<li><a class="tile ${seen.has(s.id) ? 'tile--seen' : ''}" href="#/bird/${s.id}">
            <span class="tile-img">${birdImg(s)}</span>
            ${band(s.id, seen.has(s.id))}
            <span class="tile-name">${esc(s.name)}</span></a></li>`).join('')}</ul>
        </section>`;
      }).join('') || `<div class="empty"><p>No birds match those filters.</p><button class="btn" data-reset>Clear filters</button></div>`}
    </div>`;
  const qi = $('[data-q]', view);
  qi.addEventListener('input', () => {
    state.dex.q = qi.value;
    const pos = qi.selectionStart;
    renderDex();
    const n = $('[data-q]', view); n.focus(); n.setSelectionRange(pos, pos);
  });
  view.onclick = e => {
    const sh = e.target.closest('[data-show]');
    if (sh) { state.dex.show = sh.dataset.show; renderDex(); }
    if (e.target.closest('[data-reset]')) { state.dex = { q: '', show: 'all', group: '', habitat: '' }; renderDex(); }
  };
  view.onchange = e => {
    if (e.target.matches('[data-habitat]')) { state.dex.habitat = e.target.value; renderDex(); }
    if (e.target.matches('[data-group]')) { state.dex.group = e.target.value; renderDex(); }
  };
}

// Species detail
function renderBird(id) {
  const sp = byId.get(id);
  if (!sp) { location.hash = '#/dex'; return; }
  const hist = sightingsOf(id);
  const first = hist[hist.length - 1];
  const seen = hist.length > 0;
  const prev = byId.get(id - 1), next = byId.get(id + 1);
  const seasonText = sp.season === 's' ? 'Mostly September to April' : sp.season === 'w' ? 'Mostly April to September' : 'All year';
  view.innerHTML = `
    <article class="bird">
      <div class="bird-hero">
        ${birdImg(sp, 'large', 'bird-photo')}
        <a class="iconbtn iconbtn--float" href="#/dex" data-back aria-label="Back to the dex">${icon.back}</a>
        <p class="credit" data-credit></p>
      </div>
      <div class="bird-body">
        <div class="bird-id">${band(sp.id, seen)} ${pips(sp.rarity)} <span class="muted small">${RARITY[sp.rarity].label} in SEQ</span></div>
        <h1 class="bird-name">${esc(sp.name)}</h1>
        <p class="sci">${esc(sp.sci)}</p>
        <button class="btn btn--primary btn--block" data-log>${seen ? 'Log another sighting' : 'Log a sighting'}</button>
        ${seen ? `<p class="seen-line">Seen ${plural(hist.length, 'time')}. First on ${fmtDate(first.date)}${first.place ? ` at ${esc(first.place)}` : ''}.</p>` : ''}

        <section class="call" data-calls aria-live="polite"><p class="muted small">Looking for recordings…</p></section>

        <p class="notes">${esc(sp.notes)}</p>
        <dl class="facts">
          <div><dt>Size</dt><dd>${sp.size} cm</dd></div>
          <div><dt>When</dt><dd>${seasonText}</dd></div>
          <div><dt>Group</dt><dd><a href="#/dex" data-filter-group="${sp.group}">${GROUPS[sp.group]}</a></dd></div>
          <div><dt>Look in</dt><dd>${sp.habitats.map(h => HABITATS[h]).join(', ')}${sp.nocturnal ? '. Active at night.' : ''}</dd></div>
        </dl>

        ${whereSection(sp)}

        <section class="wiki" data-wiki></section>

        <section>
          <h2 class="h2">Your sightings</h2>
          ${seen ? `<ul class="hist">${hist.map(h => `<li><button class="hist-row" data-edit="${h.id}">
            ${h.photoId ? `<img class="hist-photo" data-photo="${h.photoId}" alt="">` : ''}
            <span class="hist-main"><strong>${fmtDate(h.date)}</strong>${h.time ? ` <span class="muted">${h.time}</span>` : ''}<br><span class="muted">${esc(h.place || 'No place name')}</span></span>
            <span class="hist-n">${h.count ? `×${h.count}` : 'X'}${h.heard ? '<br><span class="muted small">heard</span>' : ''}</span></button></li>`).join('')}</ul>`
          : '<p class="muted">Not seen yet. When you find one, log it here and its card fills in with colour.</p>'}
        </section>

        <nav class="more-links">
          <a href="https://xeno-canto.org/species/${sp.sci.replace(' ', '-')}" target="_blank" rel="noopener">More calls on xeno-canto</a>
          <a href="https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}" target="_blank" rel="noopener">Atlas of Living Australia</a>
        </nav>
        <nav class="prevnext">
          ${prev ? `<a href="#/bird/${prev.id}">${icon.back}<span>${dexNo(prev.id)} ${esc(prev.name)}</span></a>` : '<span></span>'}
          ${next ? `<a href="#/bird/${next.id}" class="next"><span>${dexNo(next.id)} ${esc(next.name)}</span>${icon.back}</a>` : ''}
        </nav>
      </div>
    </article>`;
  view.onclick = e => {
    if (e.target.closest('[data-log]')) openSightingSheet({ speciesId: id });
    const ed = e.target.closest('[data-edit]');
    if (ed) openSightingSheet({ sightingId: Number(ed.dataset.edit) });
    const fg = e.target.closest('[data-filter-group]');
    if (fg) { state.dex = { q: '', show: 'all', group: fg.dataset.filterGroup, habitat: '' }; }
    if (e.target.closest('[data-back]') && history.length > 1 && document.referrer !== '' ) { /* default link is fine */ }
  };
  view.onchange = null;
  // Wikipedia text and photo credit
  details(sp).then(d => {
    if (location.hash !== `#/bird/${id}`) return;
    const cr = $('[data-credit]', view);
    if (d?.credit && cr) cr.innerHTML = `Photo: <a href="${esc(d.credit.page)}" target="_blank" rel="noopener">${esc(d.credit.artist.slice(0, 60))}</a>${d.credit.license ? `, ${esc(d.credit.license)}` : ''}`;
    const w = $('[data-wiki]', view);
    if (d?.extract && w) w.innerHTML = `<h2 class="h2">About</h2><p>${esc(d.extract)}</p><p class="small muted">From <a href="${esc(d.url)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>`;
  }).catch(() => {});
  calls(sp).then(list => {
    if (location.hash !== `#/bird/${id}`) return;
    const box = $('[data-calls]', view);
    if (!box) return;
    if (!list.length) { box.innerHTML = `<p class="muted small">No free recording found for this bird. Try the xeno-canto link below.</p>`; return; }
    box.innerHTML = `<h2 class="h2">Calls</h2>` + list.map((c, i) => `<div class="call-row">
      <button class="playbtn" data-play="${i}" aria-label="Play recording ${i + 1}">${icon.play}</button>
      <div class="call-meta"><span class="call-title">${esc(c.title.slice(0, 70))}</span>
      <span class="small muted">Recording by <a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.artist.slice(0, 50))}</a>${c.license ? `, ${esc(c.license)}` : ''}</span>
      <span class="call-progress"><span></span></span></div></div>`).join('');
    const audio = new Audio();
    let playing = -1;
    const setIcons = () => $$('[data-play]', box).forEach(b => { const on = Number(b.dataset.play) === playing && !audio.paused; b.innerHTML = on ? icon.pause : icon.play; b.setAttribute('aria-label', on ? 'Pause' : `Play recording ${Number(b.dataset.play) + 1}`); });
    audio.addEventListener('timeupdate', () => {
      const bar = $$('.call-progress span', box)[playing];
      if (bar && audio.duration) bar.style.width = `${audio.currentTime / audio.duration * 100}%`;
    });
    ['play', 'pause', 'ended'].forEach(ev => audio.addEventListener(ev, setIcons));
    audio.addEventListener('error', () => toast('That recording would not play. Try another.'));
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-play]');
      if (!b) return;
      const i = Number(b.dataset.play);
      if (i === playing) { audio.paused ? audio.play() : audio.pause(); return; }
      playing = i; b.classList.add('loading');
      audio.src = await audioUrl(list[i].src);
      b.classList.remove('loading');
      audio.play().catch(() => {});
    });
    window.addEventListener('hashchange', () => { audio.pause(); audio.src = ''; }, { once: true });
  }).catch(() => { const box = $('[data-calls]', view); if (box) box.innerHTML = '<p class="muted small">Calls need an internet connection the first time.</p>'; });
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
    <header class="page-head"><h1>Lists</h1></header>
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
    if (e.target.closest('[data-newpatch]')) state.mapMode = 'patch';
    if (e.target.closest('[data-near]')) { (state.targetF ||= { month: now.getMonth() + 1, habitat: '', scope: 'life' }).scope = 'near'; }
  };
  view.onchange = null;
}

function rowSpecies(s, sub, right = '') {
  const seen = seenSet().has(s.id);
  return `<li><a class="row row--sp" href="#/bird/${s.id}"><span class="row-thumb ${seen ? '' : 'row-thumb--dim'}">${birdImg(s)}</span>
    <span class="row-main"><strong>${esc(s.name)}</strong><span class="muted small">${sub}</span></span>${right || band(s.id, seen)}</a></li>`;
}

function renderList(period, patchId = null) {
  const now = new Date();
  const patch = patchId ? state.patches.find(p => p.id === patchId) : null;
  if (patchId && !patch) { location.hash = '#/lists'; return; }
  let src = state.sightings;
  if (patch) src = src.filter(s => inPatch(s, patch));
  const map = speciesList(src.filter(periodFilter(period, now)));
  let entries = [...map.entries()].map(([id, e]) => ({ sp: byId.get(id), ...e })).filter(e => e.sp);
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
    <p class="list-count"><b>${entries.length}</b> ${entries.length === 1 ? 'species' : 'species'}</p>
    <ul class="rows">${entries.map(e => rowSpecies(e.sp, `First ${fmtDate(e.first.date)}${e.count > 1 ? `, seen ${e.count} times` : ''}`)).join('') || '<li class="muted pad">Nothing on this list yet.</li>'}</ul>
    ${patch ? `<div class="row-end pad"><button class="btn btn--danger btn--quiet" data-delpatch>Delete patch</button></div>` : ''}`;
  view.onclick = async e => {
    if (e.target.closest('[data-sort]')) { state.listSort = state.listSort === 'dex' ? 'date' : 'dex'; renderList(period, patchId); }
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
  const lifeSeen = seenSet();
  const seen = f.scope === 'year' ? new Set(state.sightings.filter(periodFilter('year', now)).map(s => s.speciesId)) : lifeSeen;
  const head = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a><h1>Targets</h1></header>
    <div class="chips">
      <button class="chip ${f.scope === 'near' ? 'chip--on' : ''}" data-scope="near">${icon.pin} Near me</button>
      <button class="chip ${f.scope === 'life' ? 'chip--on' : ''}" data-scope="life">Life list</button>
      <button class="chip ${f.scope === 'year' ? 'chip--on' : ''}" data-scope="year">${now.getFullYear()} list</button>
      ${f.scope !== 'near' ? `<select class="chip chip--select" data-month aria-label="Month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${f.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>` : ''}
      <select class="chip chip--select ${f.habitat ? 'chip--on' : ''}" data-habitat aria-label="Habitat"><option value="">Any habitat</option>${Object.entries(HABITATS).map(([k, v]) => `<option value="${k}" ${f.habitat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>`;
  view.onclick = e => { const sc = e.target.closest('[data-scope]'); if (sc) { f.scope = sc.dataset.scope; renderTargets(); } };
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
  const list = targets({ seen, month: f.month, habitat: f.habitat, ...targetOpts() });
  view.innerHTML = head + `
    <p class="muted small pad-x">Birds you still need that are reported in SEQ in ${MONTHS[f.month - 1]}. The most often reported come first.</p>
    <p class="list-count"><b>${list.length}</b> to find</p>
    <ul class="rows pad-x">${list.map(s => rowSpecies(s, `${RARITY[s.rarity].label}. ${s.habitats.map(h => HABITATS[h]).join(', ')}`, pips(s.rarity))).join('')}</ul>`;
}

function renderOuting(id) {
  const o = state.outings.find(x => x.id === id);
  if (!o) { location.hash = '#/lists'; return; }
  const live = !o.endedAt;
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
      ${live ? `<div class="tally-ctl">${r ? `<button data-dec="${sp.id}" aria-label="One fewer ${esc(sp.name)}">−</button><span class="tally-n">${r.count ?? 'X'}</span>` : ''}<button data-inc="${sp.id}" class="tally-inc" aria-label="Add ${esc(sp.name)}">+</button></div>`
        : `<span class="tally-n">${r?.count ?? 'X'}</span>`}</li>`;
  };
  const seenSetCache = new Set(state.sightings.filter(s => s.outingId !== id).map(s => s.speciesId));
  const isFirstEver = r => !seenSetCache.has(r.speciesId);
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a>
      <div><h1>${esc(o.place || 'Outing')}</h1><p class="muted small">${fmtDate(o.date)}, started ${o.time}${mins != null ? `, ${mins} min` : ''}${!live ? (o.complete ? '. Complete checklist.' : '.') : ''}</p></div></header>
    <p class="list-count"><b>${recs.length}</b> species${!live && o.distanceKm ? `, ${o.distanceKm} km` : ''}</p>
    ${live ? `<div class="searchbox searchbox--sticky">${icon.search}<input type="search" placeholder="Add a bird: type a name" value="${esc(q)}" data-tq aria-label="Find a bird to add"></div>
      ${q ? `<ul class="tally-list">${results.map(tallyRow).join('') || '<li class="muted pad">No bird by that name in the dex.</li>'}</ul><hr class="rule">` : ''}` : ''}
    <ul class="tally-list">${ordered.map(tallyRow).join('') || (live ? '<li class="muted pad">Search above to add the first bird. Tap + again each time you count another.</li>' : '')}</ul>
    ${o.notes ? `<p class="pad-x">${esc(o.notes)}</p>` : ''}
    <div class="row-end pad">
      ${live ? `<button class="btn btn--danger btn--quiet" data-cancel>Discard</button><span class="spacer"></span><button class="btn btn--primary" data-finish>Finish outing</button>`
             : `<button class="btn btn--danger btn--quiet" data-cancel>Delete outing</button><span class="spacer"></span><button class="btn" data-finish>Edit details</button>`}
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
async function renderMap(spId = null) {
  const mode = state.mapMode; state.mapMode = null;
  const f = state.mapF ||= { show: 'all', hot: true, hotFocus: false };
  const focus = spId ? byId.get(spId) : null;
  const hotOn = focus ? f.hotFocus : f.hot;
  if (state.map) { state.map.remove(); state.map = null; }
  view.innerHTML = `
    <div class="mapwrap">
      <div id="map" aria-label="Map of your sightings and SEQ birding hotspots"></div>
      <div class="map-ctl chips">
        ${focus ? `<a class="chip chip--on" href="#/map" aria-label="Stop showing ${esc(focus.name)}">${esc(focus.name)} ✕</a>` : ''}
        <button class="chip ${hotOn ? 'chip--on' : ''}" data-hot aria-pressed="${hotOn}">Hotspots</button>
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  map.on('moveend', () => { state.mapView = { c: map.getCenter(), z: map.getZoom() }; });
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--azure').trim(), ink = css.getPropertyValue('--lori').trim();
  for (const p of state.patches) {
    L.circle([p.lat, p.lng], { radius: p.radiusKm * 1000, color: ink, weight: 2, fillOpacity: 0.06, dashArray: '6 6' })
      .addTo(map).bindPopup(`<strong>${esc(p.name)}</strong><br><a href="#/patch/${p.id}">Open patch list</a>`);
  }
  const seen = seenSet();
  if (focus) {
    const pts = pointsFor(focus.id);
    const max = Math.max(1, ...pts.map(p => p[2]));
    pts.forEach(([la, ln, c]) => L.circle([la, ln], { radius: 450 + 900 * Math.sqrt(c / max), stroke: false, fillColor: ink, fillOpacity: 0.25 + 0.45 * Math.sqrt(c / max) })
      .addTo(map).bindPopup(`<strong>${esc(focus.name)}</strong><br>${c.toLocaleString('en-AU')} records in this 1 km square since 2016`));
    if (pts.length && !state.mapView) map.fitBounds(pts.map(p => [p[0], p[1]]), { padding: [40, 40], maxZoom: 12 });
  }
  if (hotOn) {
    const gold = css.getPropertyValue('--gold').trim();
    for (const h of hotspots()) {
      const has = focus ? h.sp.find(([id]) => id === focus.id) : true;
      if (focus && !has) continue;
      const got = h.sp.filter(([id]) => seen.has(id)).length;
      const need = h.sp.filter(([id]) => !seen.has(id)).slice(0, 6).map(([id]) => byId.get(id)).filter(Boolean);
      L.circleMarker([h.lat, h.lng], { radius: 4 + Math.min(6, h.rich / 30), color: '#3A2A00', weight: 1.5, fillColor: gold, fillOpacity: 0.9 })
        .addTo(map).bindPopup(`<span class="pop-h">${esc(h.name)}</span>${h.rich} dex species recorded here. You have seen ${got}.
          ${need.length ? `<br>Still to find:<ul class="pop-need">${need.map(sp => `<li><a href="#/bird/${sp.id}">${esc(sp.name)}</a></li>`).join('')}</ul>` : ''}
          <a href="https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}" target="_blank" rel="noopener">Directions</a>`);
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
    const names = [...new Set(items.map(s => s.speciesId))].map(id => byId.get(id));
    L.circleMarker([s0.lat, s0.lng], { radius: Math.min(14, 6 + names.length), color: '#fff', weight: 2, fillColor: accent, fillOpacity: 0.95 })
      .addTo(map).bindPopup(`<strong>${esc(s0.place || 'Sighting')}</strong><br>${names.slice(0, 12).map(sp => `<a href="#/bird/${sp.id}">${esc(sp.name)}</a>`).join('<br>')}${names.length > 12 ? `<br>and ${names.length - 12} more` : ''}`);
  }
  if (!state.mapView && !focus && pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
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
  view.onclick = async e => {
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
    <header class="page-head"><h1>Badges</h1><a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a></header>
    <p class="list-count"><b>${earned}</b> of ${list.length} earned</p>
    ${sections.map(([k, title]) => `<section class="block"><h2 class="h2">${title}</h2><ul class="badges">${list.filter(b => b.kind === k).map(b => `
      <li class="badge ${b.done ? 'badge--done' : ''} badge--${k}">
        <span class="medal" aria-hidden="true"><span>${b.done ? '✓' : b.need}</span></span>
        <span class="badge-txt"><strong>${esc(b.name)}</strong><span class="small muted">${esc(b.desc)}</span>
        ${b.done ? '' : `<span class="meter meter--thin" style="--p:${Math.round(b.have / b.need * 100)}%"><span></span></span><span class="small muted">${b.have} of ${b.need}</span>`}</span>
      </li>`).join('')}</ul></section>`).join('')}`;
  view.onclick = null; view.onchange = null;
}

// Settings
async function renderSettings() {
  let usage = '';
  try { const est = await navigator.storage.estimate(); usage = `${(est.usage / 1e6).toFixed(1)} MB used on this phone`; } catch (_) {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/badges" aria-label="Back">${icon.back}</a><h1>Settings</h1></header>
    <section class="block">
      <label class="check check--card"><input type="checkbox" data-colour ${state.settings.colourUnseen ? 'checked' : ''}><span>Show unseen birds in colour in the dex</span></label>
    </section>
    <section class="block">
      <h2 class="h2">Use it offline</h2>
      <p class="muted small">Download every bird photo and description so the dex works with no signal. Takes about 30 MB. Calls are saved each time you play one.</p>
      <button class="btn" data-dl>Download for offline</button> <span class="small muted" data-dlstatus></span>
    </section>
    <section class="block">
      <h2 class="h2">Send to eBird</h2>
      <p class="muted small">Download your sightings as an eBird Record Format file. On a computer, go to ebird.org, then Submit, then Import data, and choose "eBird Record Format (Extended)". eBird may ask you to confirm a few bird names and locations.</p>
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
      <p class="small">Bird photos and descriptions come from Wikipedia and Wikimedia Commons, and calls from Wikimedia Commons. Each is credited on the bird's page. Maps &copy; OpenStreetMap contributors. Rarity and season labels are a rough guide for SEQ, not official records.</p>
      <p class="small muted">Version 1.0</p>
    </section>
    <section class="block">
      <h2 class="h2">Start over</h2>
      <button class="btn btn--danger btn--quiet" data-wipe>Delete all my sightings</button>
    </section>`;
  view.onchange = async e => {
    if (e.target.matches('[data-colour]')) { state.settings.colourUnseen = e.target.checked; await db.kvSet('settings', state.settings); }
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
      } catch (_) { toast('That file is not a Birddex backup.'); }
    }
  };
  view.onclick = async e => {
    if (e.target.closest('[data-dl]')) {
      const st = $('[data-dlstatus]', view);
      st.textContent = 'Starting…';
      await downloadAll((d, t) => { st.textContent = `${d} of ${t}`; });
      st.textContent = 'All set for offline use.';
      navigator.storage?.persist?.();
    }
    if (e.target.closest('[data-ebird]')) {
      if (!state.sightings.length) { toast('Log a sighting first.'); return; }
      download(`birddex-ebird-${todayStr()}.csv`, new Blob([toEbirdCsv(state.sightings, state.outings)], { type: 'text/csv' }));
    }
    if (e.target.closest('[data-backup]')) {
      const photos = [];
      for (const p of await db.all('photos')) photos.push({ id: p.id, at: p.at, data: await blobToDataUrl(p.blob) });
      const data = { app: 'birddex', version: 1, savedAt: new Date().toISOString(), sightings: state.sightings, outings: state.outings, patches: state.patches, settings: state.settings, photos };
      download(`birddex-backup-${todayStr()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    }
    if (e.target.closest('[data-wipe]') && await confirmSheet('Delete all sightings?', 'Every sighting, outing, patch and photo will be erased from this phone. Save a backup first if you might want them back.', 'Delete everything', true)) {
      for (const s of ['sightings', 'outings', 'patches', 'photos']) await db.clear(s);
      await db.kvSet('activeOuting', null);
      await loadData(); toast('All sightings deleted'); location.hash = '#/dex';
    }
  };
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- boot ----------
async function boot() {
  await Promise.all([loadData(), loadSeq()]);
  $('#plus').addEventListener('click', e => { e.preventDefault(); openPlusSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', () => { closeSheet(); render(); });
  render();
  onMediaReady(() => { if (!$('.sheet-wrap')) render(); });
  loadIndex();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  setInterval(() => { if (activeOuting()) renderOutingBar(); }, 60000);
}
boot();

// exported for tests
window.__birddex = { state, SPECIES, inSeason };
