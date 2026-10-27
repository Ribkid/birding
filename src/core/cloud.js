// Optional accounts: Supabase client, sign-in and session. Guests never load supabase-js.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const STORAGE_KEY = 'birddex-auth';
export const configured = !!(SUPABASE_URL && SUPABASE_KEY);
let clientP = null;
let session = null;
const listeners = new Set();

// Back here after the email link or Google, as a plain URL (the code arrives in ?code=).
export const redirectUrl = () => location.origin + location.pathname;

export function client() {
  if (!configured) return Promise.reject(new Error('Accounts are not set up'));
  clientP ||= import('../vendor/supabase/supabase.js').then(({ createClient }) => {
    const c = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: STORAGE_KEY },
    });
    c.auth.onAuthStateChange((event, s) => {
      const before = session?.user?.id;
      session = s;
      if (before !== s?.user?.id || event === 'USER_UPDATED') for (const fn of listeners) fn(user(), event);
    });
    return c;
  });
  return clientP;
}

// Load the client at start only for someone who has signed in before, or is coming back from a sign-in link.
export async function startAuth() {
  if (!configured) return null;
  const returning = new URLSearchParams(location.search).has('code');
  let stored = false;
  try { stored = !!localStorage.getItem(STORAGE_KEY); } catch (_) {}
  if (!stored && !returning) return null;
  try {
    const c = await client();
    const { data } = await c.auth.getSession(); // also swaps ?code= for a session
    session = data.session;
  } catch (_) {
    // offline with a stored session: keep the person signed in from what's on the phone
    try { session = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { session = null; }
  }
  if (returning || /[?&](error|error_description)=/.test(location.search)) history.replaceState(null, '', redirectUrl() + location.hash);
  return user();
}

export const user = () => session?.user ? { id: session.user.id, email: session.user.email || '', name: session.user.user_metadata?.full_name || '' } : null;
export const onAuth = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export async function sendEmailLink(email) {
  const c = await client();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } });
  if (error) throw error;
}
export async function verifyEmailCode(email, token) {
  const c = await client();
  const { error } = await c.auth.verifyOtp({ email, token: token.replace(/\s/g, ''), type: 'email' });
  if (error) throw error;
}
export async function signInWithGoogle() {
  const c = await client();
  const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
  if (error) throw error;
}
export async function signOut() {
  const c = await client();
  await c.auth.signOut({ scope: 'local' });
  session = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  for (const fn of listeners) fn(null, 'SIGNED_OUT');
}
