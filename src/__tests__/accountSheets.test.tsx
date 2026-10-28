// @vitest-environment jsdom
// v1 js/me.js openSignIn and openEdit: Sign up free, Sign in and Edit profile are sheets over the screen that opened
// them, named by their heading, with Escape giving focus back. The #/me/signup, #/me/signin and #/me/edit links land
// on Me with the address put back to #/me, and the sheet opens once the saved sign-in has been checked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const acct = vi.hoisted(() => ({ in: false }));
const none = vi.hoisted(() => [] as never[]);
vi.mock('../core/profile.js', () => {
  const prof = { displayName: '', avatarSpeciesId: null, showOnLeaderboard: true };
  const initProfile = () => Object.assign(() => {}, { ready: Promise.resolve(prof) });
  return {
    configured: true,
    signedIn: () => acct.in,
    getProfile: () => prof,
    getMyCloud: () => (acct.in ? { uid: 'u1', publicId: null, avatarPath: null, showDex: false, memberSince: null } : null),
    myName: () => 'Test Person',
    initProfile,
    saveMyProfile: async (patch: object) => Object.assign(prof, patch),
    setCloud: async () => ({}),
    uploadAvatarPhoto: async () => {},
    removeAvatarPhoto: async () => {},
    problem: (x: Error) => x.message,
    resizeImage: async () => null,
    squareJpeg: async () => new Blob(),
    avatarUrl: () => '',
    memberSince: () => '',
    coverSpecies: () => null,
    kindCounts: () => ({}),
    dayPick: () => null,
    myPublicId: async () => '',
  };
});
vi.mock('../core/account.js', () => ({
  authSettled: Promise.resolve(),
  onStatus: () => () => {},
  syncStatus: () => ({ state: 'idle', text: '' }),
  friendly: (x: Error) => x.message,
  sendSignInEmail: async () => {},
  startGoogleSignIn: async () => {},
  verifySignInCode: async () => {},
}));
vi.mock('../core/cloud.js', () => ({ configured: true, client: async () => ({}), onAuth: () => () => {}, startAuth: async () => null, user: () => null }));
vi.mock('../core/sync.js', () => ({ schedule: () => {} }));
vi.mock('../core/db.js', () => ({ db: { all: async () => [], kvGet: async () => null, kvSet: async () => {}, onChange: () => () => {} } }));
vi.mock('../core/learn.js', () => ({ learnReady: () => Promise.resolve(), learnStats: () => ({}) }));
vi.mock('../lib/hooks', () => ({ useSightings: () => none, useOutings: () => none, useSeen: () => new Set(), useMedia: () => {} }));
vi.mock('../screens/lists/shared', () => ({ usePatches: () => none }));
vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => null }));
vi.mock('../components/Motion', () => ({ CountUp: ({ value }: { value: number }) => <>{value}</>, useStagger: () => ({ current: null }) }));
vi.mock('../lib/look', () => ({ applyTint: async () => {} }));

import Me from '../screens/me/Me';
import { AccountSheets, onAccountSheetClosed, openEditProfile, openSignIn, closeAccountSheet } from '../screens/me/AccountSheets';
import { closeAllLayers } from '../lib/layers';

let path = '';
function Where() { path = useLocation().pathname; return null; }

const dialog = () => document.querySelector<HTMLElement>('.sheet-wrap:not([data-closing]) [role="dialog"]');
const nameOf = (d: HTMLElement | null) => (d ? document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent : null);

afterEach(() => {
  act(() => { closeAccountSheet(); });
  cleanup();
  closeAllLayers('test');
  document.body.innerHTML = '';
  acct.in = false;
});

describe('account sheets', () => {
  it('opens Sign up free over the page, named by its heading, and Escape gives focus back', async () => {
    render(<MemoryRouter><button type="button" id="opener">Sign up free</button><AccountSheets /></MemoryRouter>);
    const opener = document.getElementById('opener')!;
    opener.focus();
    act(() => { openSignIn('signup'); });
    const d = dialog();
    expect(nameOf(d)).toBe('Sign up free');
    expect(d!.textContent).toContain('There is no password to remember');
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Continue with Google'));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps v1's hidden code step in the form until the email has gone, then swaps the steps", async () => {
    render(<MemoryRouter><AccountSheets /></MemoryRouter>);
    act(() => { openSignIn('signin'); });
    const d = dialog()!;
    const emailForm = d.querySelector<HTMLFormElement>('form[data-email-form]')!;
    const codeForm = d.querySelector<HTMLFormElement>('form[data-code-form]')!;
    expect(emailForm.className).toBe('form acct-email');
    expect(codeForm.className).toBe('form acct-code hidden');
    expect(codeForm.querySelector('input[name="code"]')!.getAttribute('autocomplete')).toBe('one-time-code');
    expect([...codeForm.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Sign in', 'Use a different email']);
    expect(d.querySelector('[data-google]')?.textContent).toContain('Continue with Google');
    expect(d.querySelector('[data-acct-error]')?.getAttribute('role')).toBe('alert');
    fireEvent.change(emailForm.querySelector('input[name="email"]')!, { target: { value: 'sarah@example.com' } });
    await act(async () => { fireEvent.submit(emailForm); });
    await waitFor(() => expect(codeForm.className).toBe('form acct-code'));
    expect(emailForm.className).toBe('form acct-email hidden');
    expect(document.activeElement).toBe(codeForm.querySelector('input[name="code"]'));
  });

  it('offers Sign in for Edit profile while signed out', () => {
    render(<MemoryRouter><AccountSheets /></MemoryRouter>);
    act(() => { openEditProfile(); });
    expect(nameOf(dialog())).toBe('Sign in');
  });

  it("swaps Edit profile for the species list and back, as v1 reopened it, then says it closed", async () => {
    acct.in = true;
    const closed: string[] = [];
    const off = onAccountSheetClosed((k) => closed.push(k));
    render(<MemoryRouter><AccountSheets /></MemoryRouter>);
    act(() => { openEditProfile(); });
    expect(nameOf(dialog())).toBe('Edit profile');
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Upload a photo'));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Choose a species/ })); });
    await waitFor(() => expect(nameOf(dialog())).toBe('Choose an avatar'));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(nameOf(dialog())).toBe('Edit profile');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(dialog()).toBeNull();
    expect(closed).toEqual(['edit']);
    off();
  });
});

describe("Me's sign-in and Edit profile links", () => {
  const mount = (at: string) => render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/me" element={<Me />} />
        <Route path="/me/edit" element={<Me sub="edit" />} />
        <Route path="/me/signup" element={<Me sub="signup" />} />
        <Route path="/me/signin" element={<Me sub="signin" />} />
      </Routes>
      <Where />
      <AccountSheets />
    </MemoryRouter>,
  );

  it('#/me/signup lands on Me with Sign up free open and the address back at /me', async () => {
    mount('/me/signup');
    await waitFor(() => expect(nameOf(dialog())).toBe('Sign up free'));
    expect(path).toBe('/me');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Me');
  });

  it('#/me/edit signed out offers Sign in; signed in it opens Edit profile', async () => {
    mount('/me/edit');
    await waitFor(() => expect(nameOf(dialog())).toBe('Sign in'));
    expect(path).toBe('/me');
    act(() => { closeAccountSheet(); });
    cleanup();
    acct.in = true;
    mount('/me/edit');
    await waitFor(() => expect(nameOf(dialog())).toBe('Edit profile'));
    expect(path).toBe('/me');
  });

  it('#/me/signin while signed in is just Me', async () => {
    acct.in = true;
    mount('/me/signin');
    await waitFor(() => expect(path).toBe('/me'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(dialog()).toBeNull();
  });

  it("the join card's buttons open the sheets in place", async () => {
    mount('/me');
    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    act(() => { fireEvent.click(signIn); });
    expect(nameOf(dialog())).toBe('Sign in');
    expect(path).toBe('/me');
  });
});
