import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { configured, signedIn } from '../../core/profile.js';
import { sendSignInEmail, verifySignInCode, startGoogleSignIn, friendly } from '../../core/account.js';
import './me.css';

const googleMark = <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z" /></svg>;

export default function SignIn({ mode = 'signin' }: { mode?: 'signup' | 'signin' }) {
  const up = mode === 'signup';
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (signedIn()) return <Navigate to="/me" replace />;

  if (!configured) {
    return (
      <div className="me">
        <header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link><h1>{up ? 'Sign up free' : 'Sign in'}</h1></header>
        <div className="me-msg"><p>Accounts are not set up in this copy of the app. Everything still works offline without one.</p><Link className="btn" to="/me">Back to Me</Link></div>
      </div>
    );
  }

  const google = async () => {
    setErr(''); setBusy(true);
    try { await startGoogleSignIn(); } catch (x) { setErr(friendly(x)); } finally { setBusy(false); }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Type the email address you want to sign in with.'); return; }
    setErr(''); setBusy(true);
    try { await sendSignInEmail(email); setSent(true); }
    catch (x) { setErr(friendly(x)); }
    finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await verifySignInCode(email, code); navigate('/me'); }
    catch (x) { setErr(friendly(x)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link><h1>{up ? 'Sign up free' : 'Sign in'}</h1></header>
      <div className="me me--signin pad-x">
        <p className="muted me-signin-lead">{up ? 'Use Google or your email. There is no password to remember, and everything on this phone comes with you.' : 'Use the Google account or email you signed up with.'}</p>
        <button type="button" className="btn btn--block acct-google" disabled={busy} onClick={() => void google()}>{googleMark} Continue with Google</button>
        {!sent ? (
          <form className="form acct-email" onSubmit={send} noValidate>
            <label className="field"><span>Or sign in with your email</span><input type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="btn btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </form>
        ) : (
          <form className="form acct-code" onSubmit={verify} noValidate>
            <p className="small">Check your email. Tap the link in it, or type the 6-digit code here.</p>
            <label className="field"><span>Code from the email</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <div className="row-start"><button className="btn btn--primary" disabled={busy}>Sign in</button><button type="button" className="btn btn--quiet" onClick={() => { setSent(false); setCode(''); }}>Use a different email</button></div>
          </form>
        )}
        <p className="form-error" role="alert">{err}</p>
        <p className="small muted">By signing in you agree to the <a href="terms.html">terms</a>. See <a href="privacy.html">privacy</a> for what is kept.</p>
      </div>
    </>
  );
}
