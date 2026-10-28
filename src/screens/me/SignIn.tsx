// Sign up free / Sign in (#/me/signup, #/me/signin): v1 js/me.js openSignIn, whose sheet over Me is a page here. The
// lead is v1's, and the form is the one Settings uses (accountBits SignInForm, v1 renderSignIn): Google, then the
// emailed link or code, with v1's offline and error copy. A fresh form for "Use a different email", and focus on the
// code field once the email has gone.
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { configured, signedIn } from '../../core/profile.js';
import { SignInForm, useProfile } from './accountBits';
import './me.css';

const back = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

export default function SignIn({ mode = 'signin' }: { mode?: 'signup' | 'signin' }) {
  const up = mode === 'signup';
  const navigate = useNavigate();
  // Re-render when a saved sign-in is restored, so opening this page while signed in goes on to Me.
  useProfile();

  if (signedIn()) return <Navigate to="/me" replace />;

  const head = <header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me">{back}</Link><h1>{up ? 'Sign up free' : 'Sign in'}</h1></header>;
  if (!configured) {
    return (
      <div className="me">
        {head}
        <div className="me-msg"><p>Accounts are not set up in this copy of the app. Everything still works offline without one.</p><Link className="btn" to="/me">Back to Me</Link></div>
      </div>
    );
  }
  return (
    <>
      {head}
      <div className="me me--signin pad-x">
        <p className="muted me-signin-lead">{up ? 'Use Google or your email. There is no password to remember, and everything on this phone comes with you.' : 'Use the Google account or email you signed up with.'}</p>
        <SignInForm onDone={() => navigate('/me')} />
      </div>
    </>
  );
}
