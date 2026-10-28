// Sign up free / Sign in: v1 js/me.js openSignIn, a sheet over the screen that opened it (Me's join card, a signed-out
// Edit profile, or the #/me/signup and #/me/signin links, which land on Me). The lead is v1's, and the form is the one
// Settings uses (accountBits SignInForm, v1 renderSignIn): Google, then the emailed link or code, with v1's offline
// and error copy. A fresh form for "Use a different email", and focus on the code field once the email has gone.
import { Sheet } from '../../components/Sheet';
import { SignInForm } from './accountBits';
import './me.css';

export function SignInSheet({ mode, onClose }: { mode: 'signup' | 'signin'; onClose: () => void }) {
  const up = mode === 'signup';
  return (
    <Sheet open onClose={onClose} cls="me-signin">
      <h2 className="sheet-title">{up ? 'Sign up free' : 'Sign in'}</h2>
      <p className="muted me-signin-lead">{up ? 'Use Google or your email. There is no password to remember, and everything on this phone comes with you.' : 'Use the Google account or email you signed up with.'}</p>
      <div data-signin-form>
        <SignInForm onDone={onClose} />
      </div>
    </Sheet>
  );
}
