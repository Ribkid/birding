// @vitest-environment jsdom
// A tap that lands while the screen changes: during a view transition Chromium sends every tap to <html>, so a quick
// second tap on a tab or a tile was lost. It now ends the transition and goes to the tab or tile under her finger on
// the screen arriving; a fumbled double tap on one spot, and a tap on where she already is, are left alone.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Route, Routes } from 'react-router-dom';
import { MotionHashRouter, forgetPlaces, secondTapTarget } from '../components/RouteMotion';

describe('secondTapTarget', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const dom = () => {
    document.body.innerHTML = `
      <nav class="tabbar"><a href="#/dex" aria-current="page"><span id="dex-ico"></span></a><a href="#/learn"><span id="learn-ico"></span></a><a id="plus" href="#/add"></a></nav>
      <main id="view"><a href="#/bird/3" data-tile="3"><span class="tile-img"><img id="pic"></span></a><button id="btn">Log</button>
      <a href="#/bird/9" id="text-link">Rock Dove</a><div inert><a href="#/bird/4" id="under"></a></div><a href="#/settings" id="settings">Settings</a>
      <div class="bird-hero"><a class="iconbtn iconbtn--float" href="#/dex" id="sp-back"><svg id="sp-back-ico"></svg></a><a class="iconbtn iconbtn--float iconbtn--right" href="#/dex?q=" id="sp-search"></a></div>
      <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" id="head-back"></a><button class="iconbtn" id="head-btn"></button></header></main>`;
  };
  const $ = (id: string) => document.getElementById(id);

  it('goes to a tab, the + or a tile or link to a species under the finger', () => {
    dom();
    expect(secondTapTarget($('learn-ico'), '#/dex')?.getAttribute('href')).toBe('#/learn');
    expect(secondTapTarget($('plus'), '#/dex')?.id).toBe('plus');
    expect(secondTapTarget($('pic'), '#/dex')?.getAttribute('data-tile')).toBe('3');
    expect(secondTapTarget($('text-link'), '#/dex')?.id).toBe('text-link');
  });

  it("goes to the arriving screen's own Back link: a species page's, or a page head's", () => {
    dom();
    expect(secondTapTarget($('sp-back-ico'), '#/bird/3')?.id).toBe('sp-back');
    expect(secondTapTarget($('head-back'), '#/log')?.id).toBe('head-back');
    // Search on the hero, and a page head's button (it may do more than go back), are left alone.
    expect(secondTapTarget($('sp-search'), '#/bird/3')).toBeNull();
    expect(secondTapTarget($('head-btn'), '#/add')).toBeNull();
  });

  it('leaves alone the tab or species she is on, anything else, and a page under a layer', () => {
    dom();
    expect(secondTapTarget($('dex-ico'), '#/learn')).toBeNull(); // aria-current: the tab she is on
    expect(secondTapTarget($('learn-ico'), '#/learn')).toBeNull();
    expect(secondTapTarget($('pic'), '#/bird/3')).toBeNull();
    expect(secondTapTarget($('btn'), '#/dex')).toBeNull();
    expect(secondTapTarget($('settings'), '#/dex')).toBeNull();
    expect(secondTapTarget($('under'), '#/dex')).toBeNull();
    expect(secondTapTarget(null, '#/dex')).toBeNull();
    expect(secondTapTarget(document.documentElement, '#/dex')).toBeNull();
  });
});

describe('a tap during a transition', () => {
  // A view transition that runs until it is skipped (or for a long while), as a real one does while she taps.
  const started: string[] = [];
  const skipped: string[] = [];
  function slowTransitions() {
    started.length = 0;
    skipped.length = 0;
    (document as { startViewTransition?: unknown }).startViewTransition = (update: () => unknown) => {
      const at = window.location.hash;
      started.push(at);
      let ran: Promise<unknown> | null = null;
      const run = () => (ran ??= Promise.resolve().then(update));
      let skip = () => {};
      const cut = new Promise<void>((r) => { skip = r; });
      const updateCallbackDone = new Promise((res, rej) => { setTimeout(() => { run().then(res, rej); }, 5); });
      const finished = Promise.race([cut, new Promise((r) => setTimeout(r, 300))]).then(() => updateCallbackDone);
      return { ready: updateCallbackDone, updateCallbackDone, finished, skipTransition: () => { skipped.push(at); void run(); skip(); } };
    };
  }
  const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
  const h1 = () => document.querySelector('h1')?.textContent;
  const link = (href: string) => document.querySelector<HTMLElement>(`a[href="${href}"]`)!;
  // A tap on a control, or one that lands on <html>, at a point on the screen.
  const tapOn = (el: Element, x: number, y: number) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  let under: () => Element | null = () => null;

  beforeEach(async () => {
    forgetPlaces();
    window.location.hash = '#/dex';
    await new Promise((r) => setTimeout(r, 30));
    vi.spyOn(window, 'scrollTo').mockImplementation((() => {}) as typeof window.scrollTo);
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => under();
    slowTransitions();
    render(
      <MotionHashRouter>
        <nav className="tabbar"><Link to="/dex">Dex</Link><Link to="/learn">Learn</Link><Link to="/map">Map</Link></nav>
        <main id="view">
          <Routes>
            <Route path="/dex" element={<><h1>Dex</h1><a href="#/bird/3" data-tile="3">Magpie Goose</a></>} />
            <Route path="/learn" element={<h1>Learn</h1>} />
            <Route path="/map" element={<h1>Map</h1>} />
            <Route path="/bird/:id" element={<h1>Bird</h1>} />
          </Routes>
        </main>
      </MotionHashRouter>,
    );
  });
  afterEach(async () => {
    // Let every transition of this test run out (and the moment after one ends pass), so the next starts with none.
    await wait(800);
    cleanup();
    vi.restoreAllMocks();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('a second tab, tapped as the first one changes the screen, is not lost', async () => {
    tapOn(link('#/learn'), 120, 800);
    await waitFor(() => expect(h1()).toBe('Learn'));
    // The finger lands on Map while the swap to Learn is still running: the tap goes to <html>.
    under = () => link('#/map');
    tapOn(document.documentElement, 200, 800);
    await waitFor(() => expect(h1()).toBe('Map'));
    expect(skipped).toEqual(['#/learn']);
    expect(window.location.hash).toBe('#/map');
    // Map has its own transition: the tap answers with motion, once the first has let go.
    expect(started).toEqual(['#/learn', '#/map']);
  });

  it('a tile on the screen arriving, tapped as it arrives, opens its species', async () => {
    tapOn(link('#/learn'), 120, 800);
    await waitFor(() => expect(h1()).toBe('Learn'));
    tapOn(link('#/dex'), 40, 800);
    await waitFor(() => expect(h1()).toBe('Dex'));
    under = () => document.querySelector('[data-tile="3"]');
    tapOn(document.documentElement, 150, 300);
    await waitFor(() => expect(h1()).toBe('Bird'));
    expect(window.location.hash).toBe('#/bird/3');
  });

  it('a fumbled double tap on one spot opens one screen, and the transition runs on', async () => {
    tapOn(link('#/learn'), 120, 800);
    await waitFor(() => expect(h1()).toBe('Learn'));
    under = () => link('#/map');
    tapOn(document.documentElement, 124, 803);
    await wait(150);
    expect(skipped).toEqual([]);
    expect(h1()).toBe('Learn');
    expect(started).toEqual(['#/learn']);
  });

  it('a second tap on the tab she has just gone to does nothing more', async () => {
    tapOn(link('#/learn'), 120, 800);
    await waitFor(() => expect(h1()).toBe('Learn'));
    under = () => link('#/learn');
    tapOn(document.documentElement, 180, 790);
    await wait(150);
    expect(h1()).toBe('Learn');
    expect(started).toEqual(['#/learn']);
  });

  it('a tap on <html> with no transition running or just ended is not a lost tap', async () => {
    under = () => link('#/map');
    tapOn(document.documentElement, 200, 800);
    await wait(150);
    expect(h1()).toBe('Dex');
    expect(started).toEqual([]);
  });
});

describe('a fumbled double tap with no transition (reduced motion)', () => {
  const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
  const h1 = () => document.querySelector('h1')?.textContent;
  const tapOn = (el: Element, x: number, y: number) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  const viewer = vi.fn();

  beforeEach(async () => {
    forgetPlaces();
    viewer.mockClear();
    window.location.hash = '#/dex';
    await new Promise((r) => setTimeout(r, 30));
    vi.spyOn(window, 'scrollTo').mockImplementation((() => {}) as typeof window.scrollTo);
    render(
      <MotionHashRouter>
        <main id="view">
          <Routes>
            <Route path="/dex" element={<><h1>Dex</h1><a href="#/bird/3" data-tile="3">Magpie Goose</a></>} />
            {/* The species page's photo is a button that opens the viewer, where the tile was. */}
            <Route path="/bird/:id" element={<><h1>Bird</h1><button id="hero" type="button" onClick={viewer}>Photo</button></>} />
          </Routes>
        </main>
      </MotionHashRouter>,
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the species page and nothing on it: the second tap on the same spot goes nowhere', async () => {
    tapOn(document.querySelector('[data-tile="3"]')!, 150, 300);
    await waitFor(() => expect(h1()).toBe('Bird'));
    await wait(120);
    tapOn(document.getElementById('hero')!, 153, 303);
    expect(viewer).not.toHaveBeenCalled();
  });

  it('a tap on the new page a moment later, or somewhere else on it, still counts', async () => {
    tapOn(document.querySelector('[data-tile="3"]')!, 150, 300);
    await waitFor(() => expect(h1()).toBe('Bird'));
    await wait(120);
    tapOn(document.getElementById('hero')!, 150, 380); // well away from the first tap
    expect(viewer).toHaveBeenCalledTimes(1);
    await wait(400);
    tapOn(document.getElementById('hero')!, 151, 301); // the same spot, but not a double tap any more
    expect(viewer).toHaveBeenCalledTimes(2);
    tapOn(document.getElementById('hero')!, 151, 301); // a double tap on a page that didn't change: both count
    expect(viewer).toHaveBeenCalledTimes(3);
  });

  it('a keyboard press is never taken for a double tap', async () => {
    tapOn(document.querySelector('[data-tile="3"]')!, 150, 300);
    await waitFor(() => expect(h1()).toBe('Bird'));
    tapOn(document.getElementById('hero')!, 0, 0);
    expect(viewer).toHaveBeenCalledTimes(1);
  });
});
