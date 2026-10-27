// The Me tab (#/me): who you are in BirdyDex, signing up, your lists, badges and settings; public profiles
// (#/u/<public id>), profile photos, and the gentle sign-up nudge. Accounts stay optional: a guest gets the same hub
// built from what is on the phone, with an invitation to back it up.
import { SPECIES, BIRDS, byId, KINDS, kindsPresent, ofKind } from './species.js';
import { db } from './db.js';
import { configured, client, user, onAuth } from './cloud.js';
import { localProfile, saveProfile, syncNow, syncStatus, onRemoteChange } from './sync.js';
import { totals, badges, MONTHS } from './stats.js';
import { learnStats } from './learn.js';
import { renderSignIn, avatarHtml, setMyPhoto, myName, pickAvatar, deleteAvatars, openGroups } from './account.js';

let ctx = null;
let prof = { displayName: '', avatarSpeciesId: null, showOnLeaderboard: true };
let cloud = null;          // cached profile row bits: { uid, publicId, avatarPath, showDex, memberSince }
let notNow = false;        // chose "Not now" on the Me tab's invitation
let cloudAt = 0;
const counted = new Set(); // numbers that have already counted up this session
const others = new Map();  // public id -> last get_profile row, so going back to a profile draws at once

const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>',
  edit: svg('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  eye: svg('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'),
  trophy: svg('M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4v3h-4z'),
  people: svg('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8'),
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  outing: svg('M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8v4.5l3 2'),
  list: svg('M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1'),
  chart: svg('M4 20V10M10 20V4M16 20v-7M21 20H3'),
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/></svg>',
  chev: svg('M9.5 6l6 6-6 6'),
  back: svg('M15 5l-7 7 7 7'),
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  leaf: svg('M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7'),
  cloud: svg('M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5a4.5 4.5 0 0 0 1 9zM12 15.5v-5M9.5 12.5L12 10l2.5 2.5'),
  tick: svg('M5 12.5l4.5 4.5L19 7.5'),
};

const esc = s => ctx.esc(s);
const mine = () => (cloud && configured && user() && cloud.uid === user().id) ? cloud : null;
const signedIn = () => configured && !!user();
const onMe = () => /^#\/me(\/|$)/.test(location.hash);

// ---------- start ----------
// Called before the first draw (binds the app) and again once the account has started (paints the tab, fetches the row).
let bound = false;
export async function initMe(appCtx) {
  ctx = appCtx;
  if (!bound) {
    bound = true;
    onAuth(async () => { prof = await localProfile(); applyMine(); paintTab(); if (user()) fetchCloud(true).then(() => { if (onMe() && !sheetUp()) ctx.redraw(); }); });
    onRemoteChange(async () => { prof = await localProfile(); paintTab(); });
  }
  [prof, cloud, notNow] = await Promise.all([localProfile(), db.kvGet('me:cloud'), db.kvGet('me:notnow')]);
  applyMine();
  paintTab();
  if (signedIn()) fetchCloud();
}
const sheetUp = () => !!document.querySelector('.sheet-wrap:not([data-closing])');

function applyMine() { setMyPhoto(mine()?.avatarPath); }

// The signed-in person's own profile row: public id, photo, found-species choice and join date.
async function fetchCloud(force = false) {
  const u = configured && user();
  if (!u || !navigator.onLine || (!force && Date.now() - cloudAt < 60000)) return mine();
  cloudAt = Date.now();
  try {
    const c = await client();
    const { data, error } = await c.from('profiles').select('public_id, avatar_path, show_dex, created_at').eq('user_id', u.id).maybeSingle();
    if (error) throw error;
    if (data) await storeCloud(u.id, data);
  } catch (_) { /* offline or not synced yet: keep the cached copy */ }
  return mine();
}
async function storeCloud(uid, d) {
  cloud = { uid, publicId: d.public_id, avatarPath: d.avatar_path || null, showDex: !!d.show_dex, memberSince: d.created_at || null };
  others.delete(cloud.publicId); // your own public page shows the change next time
  await db.kvSet('me:cloud', cloud);
  applyMine();
  paintTab();
}
// Change the cloud-only columns (photo, found species). A brand-new account may not have its row yet: the profile
// is sent first, then the change is tried again.
async function setCloud(patch) {
  const c = await client();
  const u = user();
  const go = () => c.from('profiles').update(patch).eq('user_id', u.id).select('public_id, avatar_path, show_dex, created_at');
  let { data, error } = await go();
  if (error) throw error;
  if (!data?.length) {
    await saveProfile({});
    await syncNow();
    ({ data, error } = await go());
    if (error) throw error;
    if (!data?.length) throw new Error('Your profile has not reached the cloud yet. Try again in a minute.');
  }
  await storeCloud(u.id, data[0]);
}

// ---------- the Me tab icon ----------
let tabHtml = '';
export function paintTab() {
  const a = document.getElementById('me-tab');
  if (!a || !ctx) return;
  const u = signedIn();
  const dot = configured && !u && !notNow;
  const html = (u ? avatarHtml({ spId: prof.avatarSpeciesId, path: mine()?.avatarPath, name: myName(), cls: 'acct-av tab-av' }) : I.person)
    + (dot ? '<i class="tab-dot" aria-hidden="true"></i>' : '');
  if (html !== tabHtml) { a.querySelector('.tab-ico').innerHTML = html; tabHtml = html; }
  if (dot) a.setAttribute('aria-label', 'Me, not signed in'); else a.removeAttribute('aria-label');
}

// ---------- shared pieces ----------
// Small "Sign up / Sign in" for other screens (the welcome card, Learn results...).
export function accountCta() {
  if (!configured || user()) return '';
  return `<div class="me-cta"><a class="btn btn--primary btn--small" href="#/me/signup">Sign up free</a><a class="btn btn--small" href="#/me/signin">Sign in</a></div>`;
}

// The "Your profile" row at the top of Settings.
export function profileRow() {
  if (!ctx) return '';
  const u = signedIn();
  const av = u ? avatarHtml({ spId: prof.avatarSpeciesId, path: mine()?.avatarPath, name: myName(), cls: 'acct-av me-row-av' })
    : `<span class="acct-av me-row-av me-row-av--guest">${I.person}</span>`;
  const sub = !configured ? 'Your lists, badges and stats' : u ? 'Photo, name, leaderboard and groups' : 'Sign up free to back up your dex';
  return `<a class="me-row-link" href="#/me">${av}<span class="me-row-main"><strong>${u ? esc(myName()) : 'Your profile'}</strong><span class="small muted">${sub}</span></span><span class="me-chev">${I.chev}</span></a>`;
}

const memberSince = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `Member since ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

// A cover photo for a hero: the latest species found, else the chosen avatar species, else one for today.
function coverSpecies(sightings = ctx.state.sightings) {
  const first = new Map();
  for (const s of sightings) {
    const k = `${s.date || ''}${s.time || ''}`;
    if (!first.has(s.speciesId) || k < first.get(s.speciesId)) first.set(s.speciesId, k);
  }
  let best = null, bk = '';
  for (const [id, k] of first) if (byId.get(id) && k >= bk) { best = id; bk = k; }
  return byId.get(best) || byId.get(prof.avatarSpeciesId) || dayPick();
}
const dayPick = (salt = 0) => {
  const n = Math.floor(Date.now() / 864e5) + salt;
  return BIRDS[(n * 2654435761 >>> 0) % BIRDS.length];
};

function hero({ cover, av, name, sub = '', top = '', back = '' }) {
  return `<section class="me-hero" data-hero-zone>
    <div class="me-cover" data-hero-frame>${cover ? ctx.birdImg(cover, 'large') : ''}</div>
    <div class="me-scrim" aria-hidden="true"></div>
    ${back}${top}
    <div class="me-id">
      <span class="me-av-ring">${av}</span>
      <div class="me-id-txt"><h1 class="me-name">${esc(name)}</h1>${sub}</div>
    </div>
  </section>`;
}

function rings(counts) {
  return `<ul class="me-rings" role="list">${kindsPresent.map(k => {
    const total = ofKind(k).length, n = counts[k] || 0;
    const p = total ? Math.max(n ? 0.03 : 0, n / total) : 0;
    return `<li class="me-ring-item kind--${k}"><span class="sr-only">${n} of ${total} ${esc(KINDS[k].label.toLowerCase())}</span>
      <span class="me-ring" style="--p:${p.toFixed(4)}" aria-hidden="true"><svg viewBox="0 0 48 48"><circle class="me-ring-track" cx="24" cy="24" r="20"/><circle class="me-ring-fill" cx="24" cy="24" r="20" pathLength="100"/></svg><b class="me-ring-n" data-count="${n}">${n}</b></span>
      <span class="me-ring-l" aria-hidden="true">${esc(KINDS[k].label)}</span><span class="me-ring-of" aria-hidden="true">of ${total}</span></li>`;
  }).join('')}</ul>`;
}
const statStrip = items => `<dl class="me-stats">${items.map(([label, n]) => `<div><dt>${esc(label)}</dt><dd data-count="${n}">${n}</dd></div>`).join('')}</dl>`;
const kindCounts = ids => {
  const c = {};
  for (const id of ids) { const k = byId.get(id)?.kind; if (k) c[k] = (c[k] || 0) + 1; }
  return c;
};

// Rings fill and numbers count up the first time they come into view.
function animateIn(root, key) {
  const ringsEl = root.querySelectorAll('.me-rings, .me-medals');
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(ents => {
    for (const en of ents) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }, { threshold: 0.25 }) : null;
  ringsEl.forEach(el => io ? io.observe(el) : el.classList.add('is-in'));
  [...root.querySelectorAll('[data-count]')].forEach((el, i) => {
    const id = `${key}:${i}`;
    if (counted.has(id)) return;
    counted.add(id);
    ctx.countUp(el, 0, Number(el.dataset.count), { delay: 120 });
  });
}

// ---------- #/me ----------
export async function renderMe(sub) {
  const { view, state } = ctx;
  prof = await localProfile();
  if (!onMe()) return;
  const u = signedIn() ? user() : null;
  const m = mine();
  const seen = new Set(state.sightings.map(s => s.speciesId));
  const t = totals(state.sightings, new Date());
  const now = new Date();
  const counts = kindCounts(seen);
  let learning = {};
  try { learning = learnStats() || {}; } catch (_) {}
  const list = badges(state.sightings, state.outings, learning);
  const earned = list.filter(b => b.done);

  const top = `<div class="me-hero-top"><a class="me-glassbtn glass" href="#/settings" aria-label="Settings">${I.gear}</a></div>`;
  const head = u
    ? hero({
      cover: coverSpecies(), name: myName(), top,
      av: avatarHtml({ spId: prof.avatarSpeciesId, path: m?.avatarPath, name: myName(), cls: 'acct-av me-av', size: 'large' }),
      sub: `${m?.memberSince ? `<p class="me-sub">${esc(memberSince(m.memberSince))}</p>` : ''}<p class="me-sub me-sync" data-sync-status data-state="${syncStatus().state}" role="status">${esc(syncStatus().text || '')}</p>`,
    })
    : `<header class="page-head me-head"><h1>Me</h1><a class="iconbtn" href="#/settings" aria-label="Settings">${I.gear}</a></header>${configured ? joinCard(seen) : ''}`;

  const acts = u ? `<nav class="me-acts" aria-label="Your profile">
      <button type="button" class="me-act me-act--primary" data-edit>${I.edit}<span>Edit profile</span></button>
      <a class="me-act" ${m?.publicId ? `href="#/u/${esc(m.publicId)}"` : 'href="#/me" data-public'}>${I.eye}<span>View my public profile</span></a>
      <a class="me-act" href="#/leaderboard">${I.trophy}<span>Leaderboard</span></a>
      <button type="button" class="me-act" data-groups>${I.people}<span>Groups</span></button>
    </nav>` : '';

  const nOut = state.outings.length, nPatch = state.patches?.length || 0;
  const lastOut = state.outings.slice().sort((a, b) => b.startedAt - a.startedAt)[0];
  const medals = medalShelf(list, earned);
  view.innerHTML = `<div class="me ${u ? 'me--in' : 'me--guest'}">
    ${head}
    <div class="me-sheet">
      <section class="me-card me-dex" data-ckey="dex" aria-labelledby="me-dex-h">
        <h2 class="me-card-h" id="me-dex-h">${u ? 'Found so far' : 'Your dex on this phone'}</h2>
        ${rings(counts)}
        ${statStrip([['Species', seen.size], ['Badges', earned.length], ['Outings', nOut]])}
      </section>
      ${acts}
      <section class="me-sec" data-ckey="lists" aria-labelledby="me-lists-h">
        <div class="me-sec-h"><h2 id="me-lists-h">My lists</h2><a href="#/lists">Open lists</a></div>
        <div class="me-totals">
          <a href="#/list/life"><b data-count="${t.life}">${t.life}</b><span>Life list</span></a>
          <a href="#/list/year"><b data-count="${t.year}">${t.year}</b><span>${now.getFullYear()} list</span></a>
          <a href="#/list/month"><b data-count="${t.month}">${t.month}</b><span>${MONTHS[now.getMonth()]}</span></a>
        </div>
        <ul class="me-links">
          ${link('#/targets', I.target, 'Targets', `Likely in ${MONTHS[now.getMonth()]} and not in your dex yet`)}
          ${link('#/lists', I.pin, 'Patches', nPatch ? ctx.plural(nPatch, 'patch', 'patches') : 'Your yard or a local park, with its own list')}
          ${link('#/lists', I.outing, 'Outings', lastOut ? `${ctx.plural(nOut, 'outing')}, latest at ${lastOut.place || 'an unnamed place'}` : 'Tally everything at one spot with the + button')}
          ${link('#/log', I.list, 'All sightings', ctx.plural(state.sightings.length, 'sighting'))}
        </ul>
      </section>
      <section class="me-sec" aria-labelledby="me-badges-h">
        <div class="me-sec-h"><h2 id="me-badges-h">Badges</h2><a href="#/badges">See all</a></div>
        <p class="me-sec-sub">${earned.length ? `${earned.length} of ${list.length} earned` : 'Closest to earning'}</p>
        ${medals}
      </section>
      <section class="me-sec" aria-label="More">
        <ul class="me-links">
          ${link('#/stats', I.chart, 'Stats', 'Your months, places and best days')}
          ${link('#/settings', I.gear, 'Settings', u ? 'Theme, offline, backup and account' : 'Theme, offline and backup')}
        </ul>
      </section>
    </div>
  </div>`;

  view.onclick = async e => {
    if (e.target.closest('[data-edit]')) { openEdit(); return; }
    if (e.target.closest('[data-groups]')) { openGroups(); return; }
    if (e.target.closest('[data-signup]')) { openSignIn('signup'); return; }
    if (e.target.closest('[data-signin]')) { openSignIn('signin'); return; }
    if (e.target.closest('[data-notnow]')) { notNow = true; await db.kvSet('me:notnow', true); paintTab(); ctx.redraw(); return; }
    if (e.target.closest('[data-public]')) { e.preventDefault(); openMyProfile(); }
  };
  view.onchange = null;
  animateIn(view, u ? 'in' : 'guest');
  ctx.stagger(view, '.me-sheet > *', { key: 'me-hub', max: 8 });
  const join = view.querySelector('.me-join');
  if (join) {
    ctx.applyTint(join, join.querySelector('.me-fan-card:nth-child(2) img')?.src || '');
    if (!counted.has('fan')) { counted.add('fan'); join.classList.add('me-join--play'); }
  }
  paintTab();

  if (sub) {
    history.replaceState(null, '', '#/me'); // closing the sheet must not leave a route that reopens it
    if (sub === 'edit') { if (u) openEdit(); else openSignIn('signin'); }
    else if (!u && configured) openSignIn(sub);
  }
  if (u) {
    const before = JSON.stringify(mine());
    fetchCloud().then(() => { if (JSON.stringify(mine()) !== before && location.hash === '#/me' && !sheetUp()) ctx.redraw(); });
  }
}

const link = (href, ico, title, sub) => `<li><a href="${href}"><span class="me-li-ico" aria-hidden="true">${ico}</span><span class="me-li-main"><strong>${esc(title)}</strong><span>${esc(sub)}</span></span><span class="me-chev">${I.chev}</span></a></li>`;

// Earned medals, hardest first; with none yet, the three closest to earning.
function medalShelf(list, earned) {
  const show = earned.length ? earned.slice().sort((a, b) => b.need - a.need).slice(0, 6)
    : list.filter(b => b.have > 0).sort((a, b) => b.have / b.need - a.have / a.need).slice(0, 3);
  const pick = show.length ? show : list.slice(0, 3);
  return `<ul class="me-medals" role="list">${pick.map(b => {
    const p = b.done ? 1 : b.have / b.need;
    return `<li class="me-medal ${b.done ? 'me-medal--done' : ''}"><a href="#/badges">
      <span class="me-medal-disc" style="--p:${p.toFixed(3)}" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="me-ring-track" cx="32" cy="32" r="29"/><circle class="me-ring-fill" cx="32" cy="32" r="29" pathLength="100"/></svg><span class="me-medal-face">${b.done ? I.tick : `<b>${b.have}<small>/${b.need}</small></b>`}</span></span>
      <strong>${esc(b.name)}</strong><span class="sr-only">${b.done ? 'Earned' : `${b.have} of ${b.need}`}. ${esc(b.desc)}</span></a></li>`;
  }).join('')}</ul>`;
}

// The invitation for guests: three of her own finds (or today's species) fanned out, and what an account gives her.
function joinCard(seen) {
  const mineSp = [...seen].map(id => byId.get(id)).filter(Boolean).slice(-3).reverse();
  const fan = mineSp.length >= 3 ? mineSp : [...mineSp, dayPick(0), dayPick(7), dayPick(19)].slice(0, 3);
  const n = seen.size;
  if (notNow) {
    return `<section class="me-join me-join--slim" aria-labelledby="me-join-h">
      <div class="me-fan me-fan--mini" aria-hidden="true">${fan.map(sp => `<span class="me-fan-card">${ctx.birdImg(sp)}</span>`).join('')}</div>
      <div class="me-join-body"><h2 class="me-join-h" id="me-join-h">Back up your dex</h2>
        <p>${n ? `${ctx.plural(n, 'species', 'species')} saved on this phone only.` : 'Sign up free, use it on any phone.'}</p></div>
      <button type="button" class="btn btn--small me-join-go" data-signup>Sign up</button>
    </section>`;
  }
  return `<section class="me-join" aria-labelledby="me-join-h">
    <div class="me-fan" aria-hidden="true">${fan.map(sp => `<span class="me-fan-card">${ctx.birdImg(sp)}</span>`).join('')}</div>
    <div class="me-join-body">
      <h2 class="me-join-h" id="me-join-h">Keep your dex safe</h2>
      <p class="me-join-p">Sign up free to back up your dex, use it on any phone, join the leaderboard and see friends' profiles.</p>
      ${n ? `<p class="me-join-note">${I.cloud}<span>${ctx.plural(n, 'species', 'species')} ${n === 1 ? 'is' : 'are'} saved on this phone only.</span></p>` : ''}
      <div class="me-join-acts"><button type="button" class="btn me-join-go" data-signup>Sign up free</button><button type="button" class="btn me-join-in" data-signin>Sign in</button></div>
      <button type="button" class="btn btn--quiet me-join-later" data-notnow>Not now</button>
    </div>
  </section>`;
}

function openSignIn(mode) {
  if (!configured) return;
  const up = mode === 'signup';
  const s = ctx.openSheet(`<h2 class="sheet-title">${up ? 'Sign up free' : 'Sign in'}</h2>
    <p class="muted me-signin-lead">${up ? 'Use Google or your email. There is no password to remember, and everything on this phone comes with you.' : 'Use the Google account or email you signed up with.'}</p>
    <div data-signin-form></div>`, { cls: 'me-signin' });
  renderSignIn(s.querySelector('[data-signin-form]'), {
    onDone: () => { ctx.closeSheet(); setTimeout(() => ctx.refresh({ force: true }), 30); },
  });
}

async function openMyProfile() {
  if (!navigator.onLine) { ctx.toast('Your public profile needs a connection.'); return; }
  let m = await fetchCloud(true);
  if (!m?.publicId) { await saveProfile({}); await syncNow(); m = await fetchCloud(true); }
  if (m?.publicId) location.hash = `#/u/${m.publicId}`;
  else ctx.toast("Your profile hasn't reached the cloud yet. Try again in a minute.");
}

// ---------- Edit profile ----------
async function openEdit({ msg = '' } = {}) {
  if (!signedIn()) { openSignIn('signin'); return; }
  prof = await localProfile();
  const m = mine();
  const s = ctx.openSheet(`<h2 class="sheet-title">Edit profile</h2>
    <div class="me-edit-av">
      <span class="me-edit-pic">${avatarHtml({ spId: prof.avatarSpeciesId, path: m?.avatarPath, name: myName(), cls: 'acct-av me-av-xl', size: 'large' })}</span>
      <div class="me-edit-picks">
        <button type="button" class="btn btn--small" data-upload>${I.cam} ${m?.avatarPath ? 'New photo' : 'Upload a photo'}</button>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/*" data-file hidden>
        <button type="button" class="btn btn--small" data-species>${I.leaf} Choose a species</button>
        ${m?.avatarPath ? '<button type="button" class="btn btn--small btn--quiet btn--danger" data-rmphoto>Remove photo</button>' : ''}
      </div>
    </div>
    <p class="small me-edit-msg" data-msg role="status" aria-live="polite">${esc(msg)}</p>
    <label class="field"><span>Display name</span><input name="displayName" maxlength="40" autocomplete="nickname" value="${esc(prof.displayName || '')}" placeholder="${esc(myName())}" data-name></label>
    <label class="check check--card me-check"><input type="checkbox" data-lb ${prof.showOnLeaderboard !== false ? 'checked' : ''}><span><strong>Show me on the leaderboard</strong><span class="small muted">Only your name, picture and counts are shown, never your sightings, places, notes or photos. Groups you join always show you to their members.</span></span></label>
    <label class="check check--card me-check"><input type="checkbox" data-showdex ${m?.showDex ? 'checked' : ''}><span><strong>Show the species I've found on my profile</strong><span class="small muted">People who can open your profile see which species you have found. Never where or when, your notes or your photos.</span></span></label>
    <div class="row-end"><button type="button" class="btn btn--primary" data-close>Done</button></div>`, { cls: 'me-edit' });
  const say = t => { s.querySelector('[data-msg]').textContent = t; };
  const name = s.querySelector('[data-name]');
  const saveName = async () => {
    const v = name.value.trim().slice(0, 40);
    if (v === (prof.displayName || '')) return;
    prof = await saveProfile({ displayName: v });
    say('Name saved.'); paintTab();
  };
  name.onchange = saveName;
  name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } };
  ctx.state.onSheetClose = () => { saveName(); rerenderMine(); };
  s.addEventListener('change', async e => {
    if (e.target.matches('[data-lb]')) { prof = await saveProfile({ showOnLeaderboard: e.target.checked }); say(e.target.checked ? 'You show on the leaderboard.' : 'You are hidden from the Everyone board.'); }
    if (e.target.matches('[data-showdex]')) {
      const on = e.target.checked;
      if (!navigator.onLine) { e.target.checked = !on; say('Changing this needs a connection.'); return; }
      e.target.disabled = true;
      try { await setCloud({ show_dex: on }); say(on ? 'Your found species show on your profile.' : 'Your found species are hidden.'); }
      catch (x) { e.target.checked = !on; say(problem(x)); }
      e.target.disabled = false;
    }
    if (e.target.matches('[data-file]')) {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) openCrop(f);
    }
  });
  s.addEventListener('click', async e => {
    if (e.target.closest('[data-upload]')) {
      if (!navigator.onLine) { say('Uploading a photo needs signal. Your species picture works offline.'); return; }
      s.querySelector('[data-file]').click();
    }
    if (e.target.closest('[data-species]')) {
      await saveName();
      const id = await pickAvatar();
      if (!id) { openEdit(); return; }
      prof = await saveProfile({ avatarSpeciesId: id });
      let note = `${byId.get(id)?.name || 'Species'} is your picture.`;
      // A photo would keep showing over the species, so it goes.
      if (mine()?.avatarPath) {
        if (navigator.onLine) { try { await removePhoto(); } catch (x) { note = problem(x); } }
        else note = 'Saved. Your photo shows until you are back online and remove it.';
      }
      paintTab();
      openEdit({ msg: note });
    }
    if (e.target.closest('[data-rmphoto]')) {
      if (!navigator.onLine) { say('Removing your photo needs a connection.'); return; }
      const b = e.target.closest('[data-rmphoto]'); b.disabled = true;
      try { await removePhoto(); openEdit({ msg: 'Photo removed.' }); } catch (x) { b.disabled = false; say(problem(x)); }
    }
  });
}
function rerenderMine() {
  if (location.hash === '#/me' || (mine()?.publicId && location.hash === `#/u/${mine().publicId}`)) ctx.redraw();
}
async function removePhoto() {
  const c = await client();
  await setCloud({ avatar_path: null });
  await deleteAvatars(c, user().id).catch(() => {});
}
const problem = x => {
  const m = x?.message || String(x || '');
  if (/fetch|network|Failed/i.test(m)) return 'That needs a connection. Try again when you have signal.';
  if (/size|large|413/i.test(m)) return 'That photo is too big. Try another one.';
  return m || 'Something went wrong. Try again.';
};

// ---------- photo: frame it in a square, then upload 320 x 320 ----------
async function openCrop(file) {
  let blob;
  try { blob = await ctx.resizeImage(file, 1400); } catch (_) { blob = null; }
  if (!blob) { openEdit({ msg: "That file couldn't be opened as a photo." }); return; }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (_) { URL.revokeObjectURL(url); openEdit({ msg: "That file couldn't be opened as a photo." }); return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  const s = ctx.openSheet(`<h2 class="sheet-title">Frame your photo</h2>
    <p class="small muted">Drag to move it. Pinch or use the slider to zoom.</p>
    <div class="me-crop" data-stage tabindex="0" role="group" aria-label="Photo framing. Arrow keys move the photo; plus and minus zoom.">
      <img src="${url}" alt="" draggable="false" data-img>
      <span class="me-crop-mask" aria-hidden="true"></span>
    </div>
    <label class="field me-zoom"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value="1" data-zoom></label>
    <p class="form-error" data-err role="alert"></p>
    <div class="row-end"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn btn--primary" data-use>Use this photo</button></div>`, { cls: 'me-crop-sheet' });
  const stage = s.querySelector('[data-stage]'), pic = s.querySelector('[data-img]'), zoomIn = s.querySelector('[data-zoom]');
  let S = 0, z = 1, tx = 0, ty = 0;
  const base = () => S / Math.min(W, H);
  const clamp = () => {
    const sc = base() * z;
    tx = Math.min(0, Math.max(S - W * sc, tx));
    ty = Math.min(0, Math.max(S - H * sc, ty));
  };
  const draw = () => { clamp(); pic.style.transform = `translate(${tx}px, ${ty}px) scale(${base() * z})`; };
  const zoomTo = (nz, cx = S / 2, cy = S / 2) => {
    nz = Math.min(4, Math.max(1, nz));
    const k = nz / z;
    tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k; z = nz;
    zoomIn.value = String(z);
    draw();
  };
  const size = () => {
    const old = S; S = stage.clientWidth;
    if (!old) { tx = (S - W * base()) / 2; ty = (S - H * base()) / 2; } else { tx *= S / old; ty *= S / old; }
    draw();
  };
  requestAnimationFrame(size);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => S && size()) : null;
  ro?.observe(stage);
  // Pointers: one drags, two pinch around their midpoint.
  const pts = new Map();
  let last = null;
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  stage.addEventListener('pointerdown', e => {
    e.stopPropagation(); // not a sheet drag
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = pts.size === 2 ? mid() : { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect();
    if (pts.size >= 2) {
      const m2 = mid();
      tx += m2.x - last.x; ty += m2.y - last.y;
      if (last.d) zoomTo(z * (m2.d / last.d), m2.x - r.left, m2.y - r.top); else draw();
      last = m2;
    } else {
      tx += e.clientX - last.x; ty += e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      draw();
    }
  });
  const up = e => { pts.delete(e.pointerId); last = pts.size === 2 ? mid() : pts.size === 1 ? [...pts.values()][0] : null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomTo(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  stage.addEventListener('keydown', e => {
    const step = e.shiftKey ? 40 : 12;
    const mv = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (mv) { e.preventDefault(); tx += mv[0]; ty += mv[1]; draw(); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(z * 1.1); }
    if (e.key === '-') { e.preventDefault(); zoomTo(z / 1.1); }
  });
  zoomIn.oninput = () => zoomTo(Number(zoomIn.value));
  const done = () => { ro?.disconnect(); URL.revokeObjectURL(url); };
  ctx.state.onSheetClose = done;
  s.addEventListener('click', async e => {
    if (e.target.closest('[data-cancel]')) { ctx.state.onSheetClose = null; done(); openEdit(); return; }
    const use = e.target.closest('[data-use]');
    if (!use) return;
    const err = s.querySelector('[data-err]');
    if (!navigator.onLine) { err.textContent = 'Uploading needs signal. Try again when you have some.'; return; }
    use.disabled = true; use.textContent = 'Uploading…';
    try {
      const sc = base() * z;
      const out = await squareJpeg(img, -tx / sc, -ty / sc, S / sc);
      await uploadPhoto(out);
      ctx.state.onSheetClose = null; done();
      paintTab();
      openEdit({ msg: 'Photo saved. It shows on your profile and the leaderboard.' });
    } catch (x) { err.textContent = problem(x); use.disabled = false; use.textContent = 'Use this photo'; }
  });
}
// 320 x 320 JPEG, stepping the quality down until it is comfortably under the bucket's 400 KB limit.
async function squareJpeg(img, sx, sy, side) {
  const c = document.createElement('canvas');
  c.width = c.height = 320;
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 320, 320);
  cx.drawImage(img, sx, sy, side, side, 0, 0, 320, 320);
  for (const q of [0.85, 0.75, 0.6]) {
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size < 380 * 1024) return b;
  }
  throw new Error('That photo is too large. Try another one.');
}
async function uploadPhoto(blob) {
  const c = await client();
  const u = user();
  const path = `${u.id}/avatar-${Date.now()}.jpg`;
  const { error } = await c.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw error;
  await setCloud({ avatar_path: path });
  await deleteAvatars(c, u.id, path).catch(() => {}); // older photos; a leftover is harmless
}

// ---------- #/u/<public id> ----------
export async function renderProfile(id) {
  const { view, state } = ctx;
  const route = location.hash;
  const m = mine();
  const isMe = m?.publicId === id;
  const backHref = isMe ? '#/me' : '#/leaderboard';
  const back = `<div class="page-head--back me-back"><a class="iconbtn me-glassbtn glass" href="${backHref}" aria-label="${isMe ? 'Back to Me' : 'Back to the leaderboard'}">${I.back}</a></div>`;
  const plain = (title, body) => {
    view.innerHTML = `<div class="me me--msg"><header class="page-head page-head--back"><a class="iconbtn" href="${backHref}" aria-label="Back">${ctx.icon.back}</a><h1>${esc(title)}</h1></header>
      <div class="me-msg">${body}</div></div>`;
    view.onclick = null;
  };
  if (!configured) { plain('Profile', '<p>Profiles need accounts, which are not set up in this copy of the app.</p>'); return; }
  if (!user()) {
    plain('Profile', `<p>Sign in to see other people's profiles. It's free, and your dex comes with you.</p>${accountCta()}`);
    return;
  }
  let row = others.get(id);
  if (row) paintProfile(row, back);
  else {
    if (!navigator.onLine) { plain('Profile', '<p>Profiles need a connection. Your own dex works offline as usual.</p>'); return; }
    view.innerHTML = `<div class="me me--loading">${hero({ cover: null, av: '<span class="acct-av me-av"></span>', name: 'Loading profile', back })}<div class="me-sheet"><p class="muted me-msg" role="status">Loading…</p></div></div>`;
    view.onclick = null;
  }
  if (!navigator.onLine) return;
  try {
    const c = await client();
    const { data, error } = await c.rpc('get_profile', { p_public_id: id });
    if (error) throw error;
    if (location.hash !== route) return;
    if (!data?.[0]) throw new Error('Profile not found');
    const fresh = data[0];
    if (JSON.stringify(fresh) === JSON.stringify(row)) return;
    others.set(id, fresh);
    paintProfile(fresh, back);
  } catch (x) {
    if (location.hash !== route) return;
    if (row) return; // keep what we had
    if (/not found/i.test(x?.message || '')) plain('Profile', '<p>This profile isn\'t available. It may be private, or the link may be wrong.</p>');
    else plain('Profile', `<p>${esc(problem(x))}</p>`);
  }

  function paintProfile(r, backHtml) {
    const seen = new Set(state.sightings.map(s => s.speciesId));
    const dex = (r.dex || []).map(n => byId.get(n)).filter(Boolean);
    const both = dex.filter(sp => seen.has(sp.id)).length;
    const counts = Object.fromEntries(kindsPresent.map(k => [k, r[k] || 0]));
    const cover = byId.get(r.avatar_species_id) || dex[dex.length - 1] || dayPick(r.display_name?.length || 0);
    const first = r.is_me ? 'You' : (r.display_name || 'They').split(' ')[0];
    view.innerHTML = `<div class="me me--profile">
      ${hero({
        cover, name: r.display_name || 'Birder', back: backHtml,
        av: avatarHtml({ spId: r.avatar_species_id, path: r.avatar_path, name: r.display_name, cls: 'acct-av me-av', size: 'large' }),
        sub: `${r.member_since ? `<p class="me-sub">${esc(memberSince(r.member_since))}</p>` : ''}${r.is_me ? '<p class="me-sub me-you">This is how other people see you</p>' : ''}`,
      })}
      <div class="me-sheet">
        <section class="me-card me-dex" data-ckey="p-${esc(id)}" aria-label="Found so far">
          ${rings(counts)}
          ${statStrip([['Species', r.species || 0], ['Badges', r.badges || 0], ['Outings', r.outings || 0]])}
        </section>
        ${r.is_me ? '<div class="me-acts me-acts--one"><button type="button" class="me-act me-act--primary" data-edit>' + I.edit + '<span>Edit profile</span></button></div>' : ''}
        <section class="me-sec" aria-labelledby="me-found-h">
          <div class="me-sec-h"><h2 id="me-found-h">${r.is_me ? "Species you've found" : `Species ${esc(first)} has found`}</h2></div>
          ${dex.length ? `<p class="me-sec-sub">${ctx.plural(dex.length, 'species', 'species')}${r.is_me ? '' : `. You have both found ${both}.`}${r.is_me && !r.show_dex ? ' Only you can see this list. Turn on "Show the species I\'ve found" in Edit profile to share it.' : ''}</p>
            <ul class="me-grid" role="list">${dex.map(sp => tile(sp, !r.is_me && seen.has(sp.id))).join('')}</ul>`
            : `<p class="me-empty">${r.is_me ? (r.dex ? 'Nothing found yet. Your first sighting starts the list.' : 'Your list shows here once your sightings have synced.') : `${esc(first)} keeps the species they've found private.`}</p>`}
        </section>
      </div>
    </div>`;
    view.onclick = e => { if (e.target.closest('[data-edit]')) openEdit(); };
    animateIn(view, `p-${id}`);
    ctx.stagger(view, '.me-grid > li', { key: `me-u-${id}`, max: 15 });
  }
}

const tile = (sp, both) => `<li><a class="me-tile kind--${sp.kind}" href="#/bird/${sp.id}" data-tile="${sp.id}">
  <span class="tile-img">${ctx.birdImg(sp)}${both ? `<span class="me-both">${I.tick}<span>You too</span></span>` : ''}</span>
  <span class="me-tile-name">${esc(sp.name)}</span>${both ? '<span class="sr-only">Seen by you too</span>' : ''}</a></li>`;

// ---------- the sign-up nudge ----------
// After the third saved sighting, a guest gets one glass banner offering a backup. Shown once, never blocking.
let nudging = false;
export async function nudgeAfterSave(n) {
  if (!configured || !ctx || user() || n < 3 || nudging) return;
  if (await db.kvGet('me:nudged')) return;
  nudging = true;
  // Wait for the celebration and any sheet to finish first; if she stays busy, try again after a later save.
  const t0 = Date.now(), busy = () => document.querySelector('.sheet-wrap, .celebrate');
  while (busy() && Date.now() - t0 < 90000) await new Promise(r => setTimeout(r, 700));
  await new Promise(r => setTimeout(r, 600));
  nudging = false;
  if (user() || busy() || document.querySelector('.me-nudge')) return;
  await db.kvSet('me:nudged', true);
  const b = document.createElement('div');
  b.className = 'me-nudge glass';
  b.setAttribute('role', 'region');
  b.setAttribute('aria-label', 'Back up your sightings');
  b.innerHTML = `<span class="me-nudge-ico" aria-hidden="true">${I.cloud}</span>
    <p class="me-nudge-txt"><strong>Back up your sightings: sign up free</strong><span>So they're safe if something happens to this phone.</span></p>
    <div class="me-nudge-acts"><button type="button" class="btn btn--small btn--primary" data-nsign>Sign up</button><button type="button" class="btn btn--small btn--quiet" data-nno>Not now</button></div>`;
  document.body.append(b);
  ctx.announce?.('Back up your sightings: sign up free. Sign up or Not now, above the tab bar.');
  const close = () => { b.classList.add('me-nudge--out'); setTimeout(() => b.remove(), 300); };
  const t = setTimeout(close, 20000);
  b.addEventListener('click', e => {
    if (e.target.closest('[data-nsign]')) { clearTimeout(t); b.remove(); location.hash = '#/me/signup'; }
    if (e.target.closest('[data-nno]')) { clearTimeout(t); close(); }
  });
}
