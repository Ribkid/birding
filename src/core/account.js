// Optional accounts: auth flows, account deletion and the leaderboard queries.
// Rendering of the forms and leaderboard rows lives in the React screens.
import { db, raw } from './db.js';
import {
  configured, client, startAuth, user, onAuth, sendEmailLink, verifyEmailCode, signInWithGoogle, signOut,
} from './cloud.js';
import {
  startSync, syncNow, schedule, syncStatus, onStatus, onRemoteChange, localProfile, saveProfile,
  forgetSync, pendingCount, deleteCloudPhotos,
} from './sync.js';
import { deleteAvatars } from './profile.js';
import { deleteAllOutingPhotos } from './outingPhotos.js';

export const accountsOn = () => configured;
export { user, syncStatus, onStatus, onRemoteChange, pendingCount, syncNow, schedule, client };

let started = false;
let prof = null;
let settleAuth;
export const authSettled = new Promise((resolve) => { settleAuth = resolve; });
export const getAccountProfile = () => prof;

// Called once at start: restore a saved session, start sync and subscribe to status changes.
export async function initAccount({ onChange, onStatusChange, onAuthChange } = {}) {
  if (configured) {
    onStatus(st => onStatusChange?.(st));
    onRemoteChange(async () => { prof = await localProfile(); onChange?.(); });
    let restoring = !new URLSearchParams(location.search).has('code');
    onAuth(async (u, event) => {
      const quiet = restoring;
      prof = await localProfile();
      if (u) { startSync(); syncNow(); if (event === 'SIGNED_IN' && !quiet) onAuthChange?.('Signed in'); }
      onChange?.({ force: true });
    });
    prof = await localProfile();
    const u = await startAuth().catch(() => null);
    restoring = false;
    if (u) { startSync(); syncNow(); onChange?.({ force: true }); }
  }
  started = true;
  settleAuth();
  return prof;
}
export const accountStarted = () => started;

export const friendly = e => {
  const m = e?.message || String(e || '');
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute, then try again.';
  if (/expired|invalid/i.test(m)) return "That code didn't work. It may have expired, so ask for a new email.";
  if (/fetch|network/i.test(m)) return 'Signing in needs a connection.';
  return m || 'Something went wrong. Try again.';
};

export async function sendSignInEmail(email) {
  if (!navigator.onLine) throw new Error('Signing in needs a connection.');
  await sendEmailLink(email);
}
export async function verifySignInCode(email, code) { return verifyEmailCode(email, code); }
export async function startGoogleSignIn() {
  if (!navigator.onLine) throw new Error('Signing in needs a connection.');
  return signInWithGoogle();
}

// Sign out, optionally removing this phone's copy. Caller has already asked the person.
export async function signOutAccount({ wipeLocal = false } = {}) {
  await signOut();
  await forgetSync({ wipeLocal });
  prof = await localProfile();
  return prof;
}

export async function deleteAccount() {
  if (!navigator.onLine) throw new Error('Deleting your account needs a connection.');
  const c = await client();
  const u = user();
  await deleteCloudPhotos(c, u.id);
  await deleteAvatars(c, u.id);
  await deleteAllOutingPhotos(c, u.id);
  const { error } = await c.rpc('delete_my_account');
  if (error) throw error;
  await signOut();
  await forgetSync({ wipeLocal: false });
  await raw.clear('outbox');
  await db.kvSet('sync:owner', null);
  prof = await localProfile();
  return prof;
}

// ---------- leaderboard ----------
export const LB_PERIODS = [['life', 'Life'], ['year', 'Year'], ['month', 'Month']];
export const initialBoard = () => ({ period: 'life', kind: '', group: '' });
let groupsCache = [];

export async function fetchLeaderboard({ period = 'life', kind = '', group = '' } = {}) {
  const c = await client();
  const { data, error } = await c.rpc('get_leaderboard', { p_period: period, p_kind: kind || null, p_group: group || null, p_limit: 50 });
  if (error) throw error;
  return data || [];
}

export async function loadGroups() {
  const c = await client();
  const { data, error } = await c.rpc('my_groups');
  if (error) throw error;
  groupsCache = data || [];
  return groupsCache;
}
export const groups = () => groupsCache;

export async function createGroup(name) {
  const c = await client();
  const { data, error } = await c.rpc('create_group', { p_name: name });
  if (error) throw error;
  await loadGroups();
  return data?.[0] || null;
}
export async function joinGroup(code) {
  const c = await client();
  const { data, error } = await c.rpc('join_group', { p_code: code });
  if (error) throw error;
  await loadGroups();
  return data?.[0] || null;
}
export async function leaveGroup(id) {
  const c = await client();
  const { error } = await c.rpc('leave_group', { p_group: id });
  if (error) throw error;
  await loadGroups();
}
export const groupShareText = g => `Join my BirdyDex group "${g.name}" with the code ${g.code}`;

export async function saveDisplayName(name) {
  prof = await saveProfile({ displayName: String(name || '').trim().slice(0, 40) });
  return prof;
}
