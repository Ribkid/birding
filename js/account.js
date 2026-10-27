// Optional accounts in the UI: the Account section in Settings, the header chip, sign in/out,
// and the leaderboard (#/leaderboard) with groups. Guest mode needs none of this.
import { SPECIES, byId, KINDS, kindsPresent } from './species.js';
import { db, raw } from './db.js';
import { configured, client, startAuth, user, onAuth, sendEmailLink, verifyEmailCode, signInWithGoogle, signOut } from './cloud.js';
import { SUPABASE_URL } from './config.js';
import { startSync, syncNow, schedule, syncStatus, onStatus, onRemoteChange, localProfile, saveProfile, forgetSync, pendingCount, deleteCloudPhotos } from './sync.js';

let ctx = null;
let prof = null;

export const accountsOn = () => configured;
const trophy = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4v3h-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
export const leaderboardLink = () => (configured ? `<a class="btn" href="#/leaderboard">${trophy} Leaderboard</a>` : '');

// ---------- start ----------
export async function initAccount(appCtx) {
  ctx = appCtx;
  if (!configured) return;
  onStatus(st => { paintStatus(st); paintBanner(st); });
  onRemoteChange(async () => { prof = await localProfile(); ctx.refresh(); });
  // Opening the app with a saved session also reports SIGNED_IN; only a real sign-in (the form, or back from
  // the email link or Google with ?code=) gets the toast.
  let restoring = !new URLSearchParams(location.search).has('code');
  onAuth(async (u, event) => {
    const quiet = restoring;
    prof = await localProfile();
    if (u) { startSync(); syncNow(); if (event === 'SIGNED_IN' && !quiet) ctx.toast('Signed in'); }
    ctx.refresh({ force: true });
  });
  prof = await localProfile();
  const u = await startAuth();
  restoring = false;
  if (u) { startSync(); syncNow(); ctx.refresh({ force: true }); }
}

// ---------- avatars: a profile photo (public 'avatars' bucket), else a species, else a letter ----------
let myPhoto = null; // the signed-in person's photo path, set by js/me.js from its cached copy of the profile row
export const setMyPhoto = path => { myPhoto = path || null; };
export const avatarUrl = path => path ? `${SUPABASE_URL}/storage/v1/object/public/avatars/${path.split('/').map(encodeURIComponent).join('/')}` : '';
export function avatarHtml({ spId = null, path = null, name = '', cls = 'acct-av', size = 'small' } = {}) {
  const sp = byId.get(spId);
  const inner = path ? `<img src="${ctx.esc(avatarUrl(path))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
    : sp ? ctx.birdImg(sp, size) : `<span class="acct-av-letter">${ctx.esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
  return `<span class="${cls}${path ? ' acct-av--photo' : ''}" aria-hidden="true">${inner}</span>`; // the name always sits beside it
}
// ---------- dex header chip ----------
const shownName = () => prof?.displayName || user()?.name || (user()?.email || '').split('@')[0] || 'You';
export const myName = shownName;
const avatar = (spId, cls = 'acct-av', path = null, name = shownName()) => avatarHtml({ spId, path, name, cls });
export function accountChip() {
  if (!configured || !user()) return '';
  const st = syncStatus().state;
  return `<a class="acct-chip" href="#/me" aria-label="Your profile: ${ctx.esc(shownName())}">${avatar(prof?.avatarSpeciesId, 'acct-av', myPhoto)}<span class="acct-chip-name">${ctx.esc(shownName())}</span><i class="acct-dot acct-dot--${st}" aria-hidden="true"></i></a>`;
}

// ---------- status bits ----------
function paintStatus(st = syncStatus()) {
  for (const el of document.querySelectorAll('[data-sync-status]')) {
    el.textContent = st.text || '';
    el.dataset.state = st.state;
  }
  for (const el of document.querySelectorAll('.acct-dot')) el.className = `acct-dot acct-dot--${st.state}`;
}
function paintBanner(st) {
  let b = document.querySelector('.sync-banner');
  if (st.state !== 'migrating') { b?.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.className = 'sync-banner'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
    document.body.append(b);
  }
  b.textContent = st.text;
}

// ---------- Settings: Account section ----------
export async function renderAccountSection(el) {
  if (!configured || !el) return;
  const { esc } = ctx;
  const u = user();
  if (!u) {
    el.innerHTML = `<h2 class="h2">Account</h2>
      <p class="muted small">Optional. Sign in to back up your sightings and photos, have them on your other devices, and join the leaderboard. Without an account everything still works, offline too.</p>
      <div data-signin></div>`;
    el.onclick = null;
    renderSignIn(el.querySelector('[data-signin]'));
    return;
  }

  prof = await localProfile();
  const pending = await pendingCount();
  el.innerHTML = `<h2 class="h2">Account</h2>
    <div class="acct-card">
      ${avatar(prof.avatarSpeciesId, 'acct-av acct-av--big', myPhoto)}
      <div class="acct-who"><strong>${esc(shownName())}</strong><span class="small muted">${esc(u.email)}</span>
        <span class="small acct-status" data-sync-status></span></div>
    </div>
    <label class="field"><span>Display name (shown on the leaderboard)</span><input name="displayName" maxlength="40" value="${esc(prof.displayName || '')}" placeholder="${esc(shownName())}" data-name></label>
    <div class="acct-row"><span class="small muted">Photo, name and who sees your profile</span><a class="btn btn--small" href="#/me/edit">Edit profile</a></div>
    <label class="check check--card me-check"><input type="checkbox" data-lb ${prof.showOnLeaderboard !== false ? 'checked' : ''}><span><strong>Show me on the leaderboard</strong><span class="small muted">Only your name, picture and counts are shown, never your sightings, places, notes or photos. Groups you join always show you to their members.</span></span></label>
    <div class="row-start"><a class="btn" href="#/leaderboard">${trophy} Leaderboard</a><button class="btn" data-syncnow>Sync now</button><button class="btn" data-signout>Sign out</button></div>
    ${pending ? `<p class="small muted">${pending} change${pending === 1 ? '' : 's'} waiting to sync.</p>` : ''}
    <button class="btn btn--danger btn--quiet" data-delete-account>Delete my account and cloud data</button>`;
  paintStatus();
  const nameInput = el.querySelector('[data-name]');
  nameInput.onchange = async () => { prof = await saveProfile({ displayName: nameInput.value.trim().slice(0, 40) }); ctx.toast('Name saved'); };
  el.querySelector('[data-lb]').onchange = async e => { prof = await saveProfile({ showOnLeaderboard: e.target.checked }); };
  el.onclick = async e => {
    if (e.target.closest('[data-syncnow]')) {
      if (!navigator.onLine) { ctx.toast('Offline, will sync when you are back online'); return; }
      await syncNow();
    }
    if (e.target.closest('[data-signout]')) startSignOut();
    if (e.target.closest('[data-delete-account]')) startDeleteAccount();
  };
}

// Google and email-code sign-in (also the Me tab's sign-up sheet). onDone runs once the emailed code is accepted.
export function renderSignIn(el, { onDone } = {}) {
  el.innerHTML = `<button class="btn btn--block acct-google" data-google>${googleMark} Continue with Google</button>
      <form class="form acct-email" data-email-form novalidate>
        <label class="field"><span>Or sign in with your email</span><input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></label>
        <button class="btn btn--primary">Email me a sign-in link</button>
      </form>
      <form class="form acct-code hidden" data-code-form novalidate>
        <p class="small">Check your email. Tap the link in it, or type the 6-digit code here.</p>
        <label class="field"><span>Code from the email</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
        <div class="row-start"><button class="btn btn--primary">Sign in</button><button type="button" class="btn btn--quiet" data-restart>Use a different email</button></div>
      </form>
      <p class="form-error" data-acct-error role="alert"></p>
      <p class="small muted">By signing in you agree to the <a href="terms.html">terms</a>. See <a href="privacy.html">privacy</a> for what is kept.</p>`;
  let email = '';
  const err = el.querySelector('[data-acct-error]');
  const fail = e => { err.textContent = friendly(e); };
  el.onclick = async e => {
    if (e.target.closest('[data-google]')) {
      if (!navigator.onLine) { err.textContent = 'Signing in needs a connection.'; return; }
      try { await signInWithGoogle(); } catch (x) { fail(x); }
    }
    if (e.target.closest('[data-restart]')) renderSignIn(el, { onDone });
  };
  el.querySelector('[data-email-form]').onsubmit = async e => {
    e.preventDefault();
    email = e.target.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Type the email address you want to sign in with.'; return; }
    if (!navigator.onLine) { err.textContent = 'Signing in needs a connection.'; return; }
    err.textContent = '';
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await sendEmailLink(email);
      e.target.classList.add('hidden');
      el.querySelector('[data-code-form]').classList.remove('hidden');
      el.querySelector('[name=code]').focus();
    } catch (x) { fail(x); btn.disabled = false; btn.textContent = 'Email me a sign-in link'; }
  };
  el.querySelector('[data-code-form]').onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    try { await verifyEmailCode(email, e.target.code.value); onDone?.(); } catch (x) { fail(x); }
  };
}

const googleMark = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z"/></svg>';

function friendly(e) {
  const m = e?.message || String(e || '');
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute, then try again.';
  if (/expired|invalid/i.test(m)) return 'That code didn\'t work. It may have expired, so ask for a new email.';
  if (/fetch|network/i.test(m)) return 'Signing in needs a connection.';
  return m || 'Something went wrong. Try again.';
}

export function pickAvatar() {
  const { esc, openSheet, closeSheet, state } = ctx;
  const seen = new Set(state.sightings.map(s => s.speciesId));
  return new Promise(resolve => {
    const list = q => {
      const t = q.trim().toLowerCase();
      const all = SPECIES.filter(s => !t || s.name.toLowerCase().includes(t));
      all.sort((a, b) => (seen.has(b.id) - seen.has(a.id)) || a.id - b.id);
      return all.slice(0, 60).map(s => `<li><button class="row row--sp" data-pick="${s.id}"><span class="row-thumb">${ctx.birdImg(s)}</span><span class="row-main"><strong>${esc(s.name)}</strong>${seen.has(s.id) ? '<span class="small muted">In your dex</span>' : ''}</span></button></li>`).join('');
    };
    const s = openSheet(`<h2 class="sheet-title">Choose an avatar</h2>
      <div class="searchbox">${ctx.icon.search}<input type="search" placeholder="Search species" data-avq aria-label="Search species"></div>
      <ul class="rows acct-picklist" data-avlist>${list('')}</ul>`, { wide: true });
    s.querySelector('[data-avq]').oninput = e => { s.querySelector('[data-avlist]').innerHTML = list(e.target.value); };
    s.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      // Answer before closing: closing fires onSheetClose, which would answer null first.
      if (b) { state.onSheetClose = null; resolve(Number(b.dataset.pick)); closeSheet(); }
    });
    state.onSheetClose = () => resolve(null);
  });
}

async function startSignOut() {
  const { openSheet, closeSheet, toast, state } = ctx;
  const pending = await pendingCount();
  const s = openSheet(`<h2 class="sheet-title">Sign out</h2>
    <p class="muted">Keep a copy of your sightings, outings, patches and photos on this device? Your account keeps them either way.</p>
    ${pending ? `<p class="form-error">${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached the cloud yet. Keep the copy, or sync first, so ${pending === 1 ? 'it isn\'t' : 'they aren\'t'} lost.</p>` : ''}
    <div class="acct-choices">
      <button class="btn btn--primary btn--block" data-keep>Keep a copy on this device</button>
      <button class="btn btn--block ${pending ? 'btn--danger' : ''}" data-wipe>Remove it from this device</button>
      <button class="btn btn--quiet btn--block" data-close>Cancel</button>
    </div>`);
  s.addEventListener('click', async e => {
    const keep = e.target.closest('[data-keep]'), wipe = e.target.closest('[data-wipe]');
    if (!keep && !wipe) return;
    closeSheet();
    await signOut();
    await forgetSync({ wipeLocal: !!wipe });
    prof = await localProfile();
    state.activeOutingId = null;
    toast(wipe ? 'Signed out and removed from this device' : 'Signed out. Your data stays on this device.');
    ctx.refresh({ force: true, reload: true });
  });
}

async function startDeleteAccount() {
  const { confirmSheet, toast } = ctx;
  if (!navigator.onLine) { toast('Deleting your account needs a connection.'); return; }
  if (!await confirmSheet('Delete your account?', 'This permanently deletes your account, your cloud copy of every sighting, outing, patch and photo, and your place on the leaderboard and in groups. What is on this device stays here, as a guest.', 'Delete my account', true)) return;
  try {
    const c = await client();
    const u = user();
    toast('Deleting your account…');
    await deleteCloudPhotos(c, u.id);
    await deleteAvatars(c, u.id);
    const { error } = await c.rpc('delete_my_account');
    if (error) throw error;
    await signOut();
    await forgetSync({ wipeLocal: false });
    await raw.clear('outbox');
    await db.kvSet('sync:owner', null);
    prof = await localProfile();
    toast('Account deleted. Your sightings are still on this device.');
    ctx.refresh({ force: true, reload: true });
  } catch (e) { toast(`Couldn't delete the account: ${e?.message || e}`); }
}

// Profile photos: everything in avatars/<uid>/ except `keep`.
export async function deleteAvatars(c, userId, keep = null) {
  const { data, error } = await c.storage.from('avatars').list(userId, { limit: 100 });
  if (error) throw error;
  const gone = (data || []).map(f => `${userId}/${f.name}`).filter(p => p !== keep);
  if (gone.length) { const { error: e2 } = await c.storage.from('avatars').remove(gone); if (e2) throw e2; }
}

// ---------- leaderboard ----------
const lb = { period: 'life', kind: '', group: '' };
let groupsCache = [];

export async function renderLeaderboard() {
  const { view, esc, icon } = ctx;
  const head = `<header class="page-head page-head--back"><a class="iconbtn" href="#/me" aria-label="Back to Me">${icon.back}</a><h1>Leaderboard</h1></header>`;
  if (!configured) { location.hash = '#/me'; return; }
  if (!user()) {
    view.innerHTML = `${head}<div class="empty"><p>Sign in to see how your dex compares with other birders and with your family.</p><a class="btn btn--primary" href="#/me/signin">Sign in</a></div>`;
    view.onclick = null; view.onchange = null;
    return;
  }
  const kinds = kindsPresent.length > 1 ? kindsPresent : [];
  const scopeOpts = [['', 'Everyone'], ...groupsCache.map(g => [g.id, g.name])];
  view.innerHTML = `${head}
    <div class="pad-x lb-controls">
      <select class="chip chip--select ${lb.group ? 'chip--on' : ''}" data-scope aria-label="Whose leaderboard">${scopeOpts.map(([v, l]) => `<option value="${esc(v)}" ${lb.group === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <div class="seg" role="tablist" aria-label="Period">${[['life', 'Life'], ['year', 'Year'], ['month', 'Month']].map(([v, l]) => `<button role="tab" class="seg-btn ${lb.period === v ? 'seg-btn--on' : ''}" aria-selected="${lb.period === v}" data-period="${v}">${l}</button>`).join('')}</div>
    </div>
    ${kinds.length ? `<div class="chips chips--scroll lb-kinds">${[['', 'All'], ...kinds.map(k => [k, KINDS[k].label])].map(([v, l]) => `<button class="chip ${lb.kind === v ? 'chip--on' : ''}" data-kind="${v}">${esc(l)}</button>`).join('')}</div>` : ''}
    <section class="block"><ol class="rows lb-list" data-lb><li class="muted small lb-msg">Loading…</li></ol></section>
    <section class="block" data-groups></section>`;
  view.onchange = e => {
    if (e.target.matches('[data-scope]')) { lb.group = e.target.value; renderLeaderboard(); }
  };
  view.onclick = async e => {
    const p = e.target.closest('[data-period]'), k = e.target.closest('[data-kind]');
    if (p) { lb.period = p.dataset.period; renderLeaderboard(); return; }
    if (k) { lb.kind = k.dataset.kind; renderLeaderboard(); return; }
    const leave = e.target.closest('[data-leave]');
    if (leave && await ctx.confirmSheet('Leave this group?', 'You can join again with its code.', 'Leave group')) {
      try {
        const c = await client();
        const { error } = await c.rpc('leave_group', { p_group: leave.dataset.leave });
        if (error) throw error;
        if (lb.group === leave.dataset.leave) lb.group = '';
        await loadGroups(); renderLeaderboard();
      } catch (x) { ctx.toast(friendly(x)); }
    }
    const share = e.target.closest('[data-share]');
    if (share) {
      const code = share.dataset.share, text = `Join my BirdyDex group "${share.dataset.name}" with the code ${code}`;
      try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(code); ctx.toast('Code copied'); } } catch (_) {}
    }
  };
  if (!navigator.onLine) { view.querySelector('[data-lb]').innerHTML = '<li class="muted small lb-msg">The leaderboard needs a connection. Your dex works offline as usual.</li>'; renderGroups(); return; }
  schedule(0); // send any waiting sightings first so your own row is current
  loadGroups().then(renderGroups).catch(() => renderGroups());
  try {
    const c = await client();
    const { data, error } = await c.rpc('get_leaderboard', { p_period: lb.period, p_kind: lb.kind || null, p_group: lb.group || null, p_limit: 50 });
    if (error) throw error;
    if (location.hash !== '#/leaderboard') return;
    paintBoard(data || []);
  } catch (x) {
    const el = view.querySelector('[data-lb]');
    if (el) el.innerHTML = `<li class="form-error lb-msg">${esc(friendly(x))}</li>`;
  }
}

function paintBoard(rows) {
  const { view, esc, plural } = ctx;
  const el = view.querySelector('[data-lb]');
  if (!el) return;
  const what = lb.kind ? KINDS[lb.kind].label.toLowerCase() : 'species';
  if (!rows.length) { el.innerHTML = `<li class="muted small lb-msg">No one has logged any ${what} ${lb.period === 'life' ? 'yet' : lb.period === 'year' ? 'this year' : 'this month'}.</li>`; return; }
  const top = rows.filter(r => r.rank <= 50 || !r.is_me);
  const me = rows.find(r => r.is_me && r.rank > 50);
  // Each row opens that person's profile (#/u/<public id>).
  const row = r => `<li class="lb-row ${r.is_me ? 'lb-row--me' : ''}" ${r.is_me ? 'aria-current="true"' : ''}><${r.public_id ? `a href="#/u/${esc(r.public_id)}"` : 'span'} class="lb-link">
      <span class="lb-rank">${r.rank}</span>
      ${avatar(r.avatar_species_id, 'acct-av', r.avatar_path, r.display_name)}
      <span class="row-main"><strong>${esc(r.display_name)}${r.is_me ? ' <span class="lb-you">You</span>' : ''}</strong>
        <span class="small muted">${plural(r.outings, 'outing')}, ${plural(r.badges, 'badge')}</span>${kindLine(r)}</span>
      <span class="row-n" aria-label="${r.species} ${what}">${r.species}</span></${r.public_id ? 'a' : 'span'}></li>`;
  el.innerHTML = top.map(row).join('') + (me ? `<li class="lb-gap" aria-hidden="true">⋯</li>${row(me)}` : '');
  if (!rows.some(r => r.is_me) && !lb.group) {
    el.insertAdjacentHTML('afterend', '<p class="small muted">You are hidden from the Everyone board. Turn on "Show me on the leaderboard" in <a href="#/me/edit">Edit profile</a> to appear.</p>');
  }
}
function kindLine(r) {
  if (lb.kind || kindsPresent.length < 2) return '';
  const word = k => (r[k] === 1 ? KINDS[k].one : KINDS[k].label.toLowerCase());
  const parts = kindsPresent.filter(k => r[k] > 0 && k !== 'bird').map(k => `${r[k]} ${word(k)}`);
  return parts.length ? `<span class="small muted">${r.bird} ${word('bird')}, ${parts.join(', ')}</span>` : '';
}

async function loadGroups() {
  const c = await client();
  const { data, error } = await c.rpc('my_groups');
  if (error) throw error;
  const before = groupsCache.map(g => g.id).join();
  groupsCache = data || [];
  if (lb.group && !groupsCache.some(g => g.id === lb.group)) lb.group = '';
  // the scope menu was drawn before the groups arrived
  if (before !== groupsCache.map(g => g.id).join()) {
    const sel = ctx.view.querySelector('[data-scope]');
    if (sel) sel.innerHTML = [['', 'Everyone'], ...groupsCache.map(g => [g.id, g.name])].map(([v, l]) => `<option value="${ctx.esc(v)}" ${lb.group === v ? 'selected' : ''}>${ctx.esc(l)}</option>`).join('');
  }
}

// The Me tab's Groups button: the leaderboard, scrolled to its groups.
export function openGroups() { lb.toGroups = true; if (location.hash === '#/leaderboard') renderLeaderboard(); else location.hash = '#/leaderboard'; }

function renderGroups() {
  const { view, esc } = ctx;
  const el = view.querySelector('[data-groups]');
  if (!el) return;
  if (lb.toGroups) { lb.toGroups = false; requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })); }
  el.innerHTML = `<h2 class="h2">Groups</h2>
    <p class="muted small">Make a group for family or friends. Share its code; anyone with it can join and see the group's board.</p>
    ${groupsCache.length ? `<ul class="rows">${groupsCache.map(g => `<li class="row lb-group"><span class="row-main"><strong>${esc(g.name)}</strong><span class="small muted">Code <b class="lb-code">${esc(g.code)}</b> · ${g.members} member${g.members === 1 ? '' : 's'}</span></span>
      <button class="btn btn--small" data-share="${esc(g.code)}" data-name="${esc(g.name)}">Share</button><button class="btn btn--small btn--quiet" data-leave="${esc(g.id)}">Leave</button></li>`).join('')}</ul>` : ''}
    <form class="form lb-form" data-create><label class="field"><span>New group</span><input name="name" maxlength="40" placeholder="e.g. Family" required></label><button class="btn">Create</button></form>
    <form class="form lb-form" data-join><label class="field"><span>Join with a code</span><input name="code" maxlength="8" placeholder="6 letters and numbers" autocapitalize="characters" autocomplete="off" required></label><button class="btn">Join</button></form>
    <p class="form-error" data-gerr role="alert"></p>`;
  const err = el.querySelector('[data-gerr]');
  const run = async (fn, args, done) => {
    if (!navigator.onLine) { err.textContent = 'Groups need a connection.'; return; }
    try {
      const c = await client();
      const { data, error } = await c.rpc(fn, args);
      if (error) throw error;
      const g = data?.[0];
      await loadGroups();
      if (g) lb.group = g.id;
      done(g);
      renderLeaderboard();
    } catch (x) { err.textContent = friendly(x); }
  };
  el.querySelector('[data-create]').onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    run('create_group', { p_name: name }, g => ctx.toast(`${g.name} made. Its code is ${g.code}`));
  };
  el.querySelector('[data-join]').onsubmit = e => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (!code) return;
    run('join_group', { p_code: code }, g => ctx.toast(`You joined ${g.name}`));
  };
}
