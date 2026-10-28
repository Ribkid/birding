// Account pieces shared by Settings, Me, the leaderboard and public profiles (v1 js/account.js and js/me.js):
// the avatar (avatarHtml), the Google mark, the Google and email-code sign-in (renderSignIn) and the small
// "Sign up free / Sign in" pair (accountCta).
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { avatarUrl, configured, getProfile, initProfile, signedIn } from '../../core/profile.js';
import { friendly, sendSignInEmail, startGoogleSignIn, verifySignInCode } from '../../core/account.js';
import { SpeciesImage } from '../../components/SpeciesImage';

// profile.js keeps every onChange it is given, so screens share one hook-up and subscribe here instead.
const profileSubs = new Set<() => void>();
let profileHooked = false;
/** The local profile (name, avatar species), re-rendering when it or the cached cloud row changes. */
export function useProfile() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    profileSubs.add(force);
    if (!profileHooked) {
      profileHooked = true;
      void initProfile(() => profileSubs.forEach((fn) => fn()));
    } else void initProfile();
    return () => { profileSubs.delete(force); };
  }, []);
  return getProfile();
}

export const googleMark = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
    <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" />
    <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z" />
  </svg>
);

export const trophyIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4v3h-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

/**
 * A profile photo (public 'avatars' bucket), else a species, else a letter. Hidden from screen readers: the name
 * always sits beside it. A photo that fails to load falls back to the species or letter.
 */
export function AccountAvatar({ spId = null, path = null, name = '', cls = 'acct-av', size = 'small' }: {
  spId?: number | null; path?: string | null; name?: string; cls?: string; size?: 'small' | 'large';
}) {
  const [failed, setFailed] = useState('');
  const photo = path && failed !== path ? path : null;
  const sp = spId != null ? byId.get(Number(spId)) : undefined;
  return (
    <span className={`${cls}${photo ? ' acct-av--photo' : ''}`} aria-hidden="true">
      {photo ? (
        <img src={avatarUrl(photo)} alt="" loading="lazy" decoding="async" onError={() => setFailed(photo)} />
      ) : sp ? (
        <SpeciesImage sp={sp} size={size} />
      ) : (
        <span className="acct-av-letter">{(name || '?').slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

/** "Sign up free" and "Sign in" for other screens; nothing when accounts are off or she is signed in. */
export function AccountCta() {
  if (!configured || signedIn()) return null;
  return (
    <div className="me-cta">
      <Link className="btn btn--primary btn--small" to="/me/signup">Sign up free</Link>
      <Link className="btn btn--small" to="/me/signin">Sign in</Link>
    </div>
  );
}

/** Google and email-code sign-in (v1 renderSignIn). onDone runs once the emailed code is accepted. */
export function SignInForm({ onDone }: { onDone?: () => void }) {
  const [round, setRound] = useState(0); // "Use a different email" starts a fresh form, as v1 redraws it
  return <SignInRound key={round} onDone={onDone} restart={() => setRound((n) => n + 1)} />;
}

function SignInRound({ onDone, restart }: { onDone?: () => void; restart: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (sent) codeRef.current?.focus(); }, [sent]);

  const google = async () => {
    if (!navigator.onLine) { setErr('Signing in needs a connection.'); return; }
    try { await startGoogleSignIn(); } catch (x) { setErr(friendly(x)); }
  };
  const send = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) { setErr('Type the email address you want to sign in with.'); return; }
    if (!navigator.onLine) { setErr('Signing in needs a connection.'); return; }
    setErr('');
    setSending(true);
    try {
      await sendSignInEmail(value);
      setEmail(value);
      setSent(true);
    } catch (x) {
      setErr(friendly(x));
    } finally {
      setSending(false);
    }
  };
  const verify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr('');
    try { await verifySignInCode(email, code); onDone?.(); } catch (x) { setErr(friendly(x)); }
  };

  return (
    <>
      <button type="button" className="btn btn--block acct-google" onClick={() => void google()}>{googleMark} Continue with Google</button>
      {!sent ? (
        <form className="form acct-email" onSubmit={send} noValidate>
          <label className="field">
            <span>Or sign in with your email</span>
            <input type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn--primary" disabled={sending}>{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      ) : (
        <form className="form acct-code" onSubmit={verify} noValidate>
          <p className="small">Check your email. Tap the link in it, or type the 6-digit code here.</p>
          <label className="field">
            <span>Code from the email</span>
            <input ref={codeRef} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="row-start">
            <button className="btn btn--primary">Sign in</button>
            <button type="button" className="btn btn--quiet" onClick={restart}>Use a different email</button>
          </div>
        </form>
      )}
      <p className="form-error" role="alert">{err}</p>
      <p className="small muted">By signing in you agree to the <a href="terms.html">terms</a>. See <a href="privacy.html">privacy</a> for what is kept.</p>
    </>
  );
}
