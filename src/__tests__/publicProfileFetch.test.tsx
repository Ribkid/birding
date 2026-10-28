// @vitest-environment jsdom
// v1 renderProfile asks for a profile once per visit. React's page asked twice when she was already signed in,
// because the sign-in check settling re-ran the fetch. It now asks again only for an auth change, a new id or a
// closed Edit profile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => ({
  in: true,
  load: vi.fn(() => new Promise(() => {})),
  authListeners: new Set<() => void>(),
}));
vi.mock('../core/profile.js', () => ({
  configured: true,
  signedIn: () => h.in,
  initProfile: () => Object.assign(() => {}, { ready: Promise.resolve({}) }),
  loadPublicProfile: h.load,
  memberSince: () => '',
  dayPick: () => null,
  getPublicProfileCache: () => null,
  problem: (x: Error) => x.message,
}));
vi.mock('../core/cloud.js', () => ({
  onAuth: (fn: () => void) => { h.authListeners.add(fn); return () => h.authListeners.delete(fn); },
}));
vi.mock('../core/account.js', () => ({ authSettled: Promise.resolve() }));
vi.mock('../lib/hooks', () => ({ useSeen: () => new Set<number>(), useMedia: () => null }));
vi.mock('../screens/me/AccountSheets', () => ({ onAccountSheetClosed: () => () => {}, openEditProfile: () => {} }));

const { default: PublicProfile } = await import('../screens/me/PublicProfile');
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const draw = () => render(
  <MemoryRouter initialEntries={[`/u/${ID}`]}>
    <Routes><Route path="/u/:publicId" element={<PublicProfile />} /></Routes>
  </MemoryRouter>,
);
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

afterEach(() => { cleanup(); h.load.mockClear(); h.authListeners.clear(); h.in = true; });

describe('public profile fetch', () => {
  it('asks once when she is already signed in and the sign-in check settles', async () => {
    draw();
    await settle();
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('asks once the saved sign-in is restored on a cold load, and not again when the check settles', async () => {
    h.in = false;
    draw();
    expect(h.load).toHaveBeenCalledTimes(0);
    h.in = true;
    act(() => { for (const fn of h.authListeners) fn(); });
    await settle();
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('asks again after an auth change', async () => {
    draw();
    await settle();
    act(() => { for (const fn of h.authListeners) fn(); });
    await settle();
    expect(h.load).toHaveBeenCalledTimes(2);
  });
});
