// @vitest-environment jsdom
// Tab memory: going back to a tab's own screen through the tab bar puts her where she was on it, for the session, and
// tapping the tab she is on, on its own screen, glides to the top without changing the address
// (components/RouteMotion.tsx, components/TabBar.tsx).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../lib/data', () => ({ byId: new Map() }));
vi.mock('../core/db.js', () => ({ db: { kvGet: async () => null, onChange: () => () => {} } }));
vi.mock('../core/cloud.js', () => ({ onAuth: () => () => {} }));
vi.mock('../core/profile.js', () => ({
  configured: false,
  signedIn: () => false,
  getMyCloud: () => null,
  getProfile: () => ({ avatarSpeciesId: null }),
  initProfile: () => () => {},
  myName: () => '',
  avatarUrl: () => '',
}));
vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => null }));
vi.mock('../components/PlusSheet', () => ({ PlusSheet: () => null }));

import { TabBar } from '../components/TabBar';
import { MotionHashRouter, forgetPlaces } from '../components/RouteMotion';

let y = 0;
const scrolls: unknown[] = [];
beforeEach(() => {
  forgetPlaces();
  window.location.hash = '#/dex';
  y = 0;
  scrolls.length = 0;
  vi.spyOn(window, 'scrollTo').mockImplementation(((a: number | ScrollToOptions, b?: number) => {
    scrolls.push(a);
    y = typeof a === 'object' ? a.top ?? y : b ?? 0;
  }) as typeof window.scrollTo);
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let entry = '';
function Where() {
  entry = useLocation().key;
  return null;
}

const app = () => render(
  <MotionHashRouter>
    <Where />
    <main id="view">
      <Routes>
        <Route path="/dex" element={<h1>Dex</h1>} />
        <Route path="/learn" element={<><h1>Learn</h1><Link to="/dex">Open the dex</Link></>} />
        <Route path="/map" element={<h1>Map</h1>} />
        <Route path="/me" element={<><h1>Me</h1><Link to="/lists">Lists</Link></>} />
        <Route path="/lists" element={<h1>Lists</h1>} />
      </Routes>
    </main>
    <TabBar />
  </MotionHashRouter>,
);
const tab = (k: string) => act(() => { document.querySelector<HTMLAnchorElement>(`.tabbar a[data-tab="${k}"]`)!.click(); });
const link = (text: string) => act(() => { [...document.querySelectorAll('#view a')].find((a) => a.textContent === text)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
const h1 = () => document.querySelector('h1')?.textContent;

describe('tab memory', () => {
  it("returns to where she was on each tab's screen through the tab bar", () => {
    app();
    y = 2400;
    tab('learn');
    expect(h1()).toBe('Learn');
    expect(y).toBe(0);
    y = 500;
    tab('dex');
    expect(h1()).toBe('Dex');
    expect(y).toBe(2400);
    tab('learn');
    expect(y).toBe(500);
  });

  it('starts a tab screen reached any other way at the top', () => {
    app();
    y = 2400;
    tab('learn');
    link('Open the dex');
    expect(h1()).toBe('Dex');
    expect(y).toBe(0);
  });

  it("goes back to the tab's own screen, not the deeper one she left it for", () => {
    app();
    tab('me');
    y = 700;
    link('Lists');
    expect(h1()).toBe('Lists');
    tab('dex');
    tab('me');
    expect(h1()).toBe('Me');
    expect(y).toBe(700);
  });

  it('glides to the top when she taps the tab she is on, without a new address', () => {
    app();
    const before = entry;
    y = 2400;
    tab('dex');
    expect(h1()).toBe('Dex');
    expect(entry).toBe(before);
    expect(scrolls.at(-1)).toEqual({ top: 0, behavior: 'smooth' });
    expect(y).toBe(0);
  });

  it("opens the tab's own screen from a deeper screen it owns (Lists under Me)", () => {
    window.location.hash = '#/lists';
    app();
    tab('me');
    expect(h1()).toBe('Me');
  });
});
