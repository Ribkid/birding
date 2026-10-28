// The account sheets (v1 js/me.js openSignIn and openEdit): Sign up free, Sign in and Edit profile open as sheets over
// whatever screen asked for them. One host, mounted once in App as <AccountSheets />, draws whichever is open; the
// #/me/signup, #/me/signin and #/me/edit links land on Me, which opens the matching sheet (Me.tsx).
import { useEffect, useState } from 'react';
import { configured, signedIn } from '../../core/profile.js';
import { SignInSheet } from './SignIn';
import { EditProfileSheet } from './EditProfile';

export type AccountSheet = 'signup' | 'signin' | 'edit';
type Open = { kind: AccountSheet; n: number } | null;

let current: Open = null;
let count = 0;
const subs = new Set<(open: Open) => void>();
const closed = new Set<(kind: AccountSheet) => void>();

function show(next: Open) {
  const was = current;
  current = next;
  subs.forEach((fn) => fn(next));
  if (was && was.n !== next?.n) closed.forEach((fn) => fn(was.kind));
}

/** v1 openSignIn: Sign up free or Sign in over the current screen. Nothing when accounts are off. */
export function openSignIn(mode: 'signup' | 'signin' = 'signin') {
  if (configured) show({ kind: mode, n: ++count });
}

/** v1 openEdit: Edit profile over the current screen; signed out, Sign in instead. */
export function openEditProfile() {
  if (!configured) return;
  if (signedIn()) show({ kind: 'edit', n: ++count });
  else openSignIn('signin');
}

export function closeAccountSheet() {
  if (current) show(null);
}

/** Runs after an account sheet closes or gives way to another, as v1's rerenderMine redrew what was behind it. */
export function onAccountSheetClosed(fn: (kind: AccountSheet) => void) {
  closed.add(fn);
  return () => { closed.delete(fn); };
}

export function AccountSheets() {
  const [open, setOpen] = useState<Open>(current);
  useEffect(() => {
    subs.add(setOpen);
    setOpen(current);
    return () => { subs.delete(setOpen); };
  }, []);
  if (!open) return null;
  if (open.kind === 'edit') return <EditProfileSheet key={open.n} onClose={closeAccountSheet} />;
  return <SignInSheet key={open.n} mode={open.kind} onClose={closeAccountSheet} />;
}
