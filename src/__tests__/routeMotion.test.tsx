// @vitest-environment jsdom
// v1 onRouteChange: every change of address is one navigation, its motion picked by how deep the screens sit; open
// layers close before the new screen draws, and going back to a shallower screen returns to where she was. Back and
// Forward return to the place she left that history entry at, held to a tile, and give focus back to what she opened.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Route, Routes } from 'react-router-dom';
import { MotionHashRouter, anchorOf, forgetPlaces, navKind } from '../components/RouteMotion';
import { RouteFocus } from '../components/RouteFocus';
import { closeAllLayers, closeLayer, layers, openLayer } from '../lib/layers';

describe('navKind (v1 DEPTH)', () => {
  it('swaps between the tabs, which share one depth', () => {
    expect(navKind('/dex', '/learn')).toBe('swap');
    expect(navKind('/map', '/me')).toBe('swap');
    expect(navKind('/learn/play/birds', '/learn')).toBe('swap');
  });
  it('goes forward into a deeper screen and back out of it', () => {
    expect(navKind('/dex', '/bird/3')).toBe('forward');
    expect(navKind('/me', '/lists')).toBe('forward');
    expect(navKind('/lists', '/outing/2')).toBe('forward');
    expect(navKind('/bird/3', '/dex')).toBe('back');
    expect(navKind('/list/life', '/lists')).toBe('back');
  });
  it('treats screens at the same depth, and unknown ones, as one level down', () => {
    expect(navKind('/lists', '/stats')).toBe('swap');
    expect(navKind('/dex', '/nope-page')).toBe('forward');
  });
});

describe('MotionHashRouter', () => {
  let y = 0;
  beforeEach(() => {
    window.location.hash = '#/dex';
    y = 0;
    vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, top: number) => { y = top; }) as typeof window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  });
  afterEach(() => {
    cleanup();
    closeAllLayers('test');
    vi.restoreAllMocks();
  });

  const app = () => render(
    <MotionHashRouter>
      <main id="view">
        <Routes>
          <Route path="/dex" element={<><h1>Dex</h1><Link to="/bird/3">Magpie Goose</Link></>} />
          <Route path="/bird/:id" element={<><h1>Bird</h1><Link to="/dex">Back</Link><Link to="/compare/3/4">Compare</Link></>} />
          <Route path="/compare/:a/:b" element={<><h1>Compare</h1><Link to="/bird/3">Back</Link></>} />
        </Routes>
      </main>
    </MotionHashRouter>,
  );
  const click = (text: string) => act(() => { [...document.querySelectorAll('a')].find((a) => a.textContent === text)!.click(); });

  it('draws the new screen and closes open layers on the way', () => {
    const { container } = app();
    const close = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    const layer = openLayer(el, { close: (why) => { close(why); el.remove(); closeLayer(layer, { restore: false }); } });
    click('Magpie Goose');
    expect(container.querySelector('h1')?.textContent).toBe('Bird');
    expect(close).toHaveBeenCalledWith('nav');
    expect(layers()).toHaveLength(0);
  });

  it('starts a deeper screen at the top and returns to where she was going back', () => {
    app();
    y = 1400;
    click('Magpie Goose');
    expect(y).toBe(0);
    y = 300;
    click('Compare');
    expect(y).toBe(0);
    click('Back');
    expect(document.querySelector('h1')?.textContent).toBe('Bird');
    expect(y).toBe(300);
    click('Back');
    expect(document.querySelector('h1')?.textContent).toBe('Dex');
    expect(y).toBe(1400);
  });
});

describe('Back and Forward', () => {
  let y = 0;
  // Where each tile sits on screen: [top, bottom], or nothing for a tile off screen.
  let at: Record<string, [number, number]> = {};
  beforeEach(() => {
    forgetPlaces();
    // jsdom has no CSS.escape (layers.ts findByKey uses it); the keys here need no escaping.
    if (!globalThis.CSS?.escape) vi.stubGlobal('CSS', { escape: (s: string) => s });
    Element.prototype.scrollIntoView = vi.fn();
    window.location.hash = '#/lists';
    y = 0;
    at = {};
    vi.spyOn(window, 'scrollTo').mockImplementation(((a: number | ScrollToOptions, b?: number) => {
      y = typeof a === 'object' ? a.top ?? y : b ?? 0;
    }) as typeof window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const r = at[this.getAttribute('data-tile') || ''];
      return (r ? { top: r[0], bottom: r[1], left: 0, right: 100, width: 100, height: r[1] - r[0], x: 0, y: r[0] }
        : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const app = () => render(
    <MotionHashRouter>
      <RouteFocus />
      <main id="view">
        <Routes>
          <Route path="/dex" element={<><h1>Dex</h1>{[1, 2, 3].map((id) => <Link key={id} to={`/bird/${id}`} data-tile={id}>{`Tile ${id}`}</Link>)}</>} />
          <Route path="/lists" element={<><h1>Lists</h1><Link to="/bird/2">Row 2</Link></>} />
          <Route path="/bird/:id" element={<><h1>Bird</h1><Link to="/dex">Dex</Link></>} />
        </Routes>
      </main>
    </MotionHashRouter>,
  );
  const click = (text: string) => act(() => { [...document.querySelectorAll('a')].find((a) => a.textContent === text)!.click(); });
  const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));
  const back = async () => { await act(async () => { window.history.back(); }); await settle(); };
  const forward = async () => { await act(async () => { window.history.forward(); }); await settle(); };
  const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const h1 = () => document.querySelector('h1')?.textContent;

  it('returns to where she left each history entry, beside it as well as up', async () => {
    app();
    y = 900;
    click('Row 2');
    expect(h1()).toBe('Bird');
    expect(y).toBe(0);
    y = 300;
    // Lists and a species page sit at the same depth: going back by depth alone would start Lists at the top.
    await back();
    expect(h1()).toBe('Lists');
    expect(y).toBe(900);
    await forward();
    expect(h1()).toBe('Bird');
    expect(y).toBe(300);
  });

  it('gives focus back to the tile she opened when it is on screen, and to the heading when it is not', async () => {
    window.location.hash = '#/dex';
    app();
    at = { 2: [300, 420] };
    click('Tile 2');
    expect(h1()).toBe('Bird');
    await frame();
    expect(document.activeElement?.textContent).toBe('Bird');
    await back();
    await frame();
    expect(h1()).toBe('Dex');
    expect(document.activeElement?.getAttribute('data-tile')).toBe('2');
    // Opened again, then the dex lands where the tile is off screen: the heading takes focus, as on any screen.
    click('Tile 2');
    await frame();
    at = {};
    await back();
    await frame();
    expect(document.activeElement?.textContent).toBe('Dex');
    // That return also brought the tile she opened into sight.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('holds the return to the tile that was at the top of the screen', async () => {
    window.location.hash = '#/dex';
    app();
    y = 2400;
    at = { 1: [-40, 80], 2: [96, 216], 3: [232, 352] };
    // The middle of the screen, top down: tile 1 is partly above the screen, so tile 2 is the first wholly on it.
    (document as { elementFromPoint?: unknown }).elementFromPoint = (_x: number, py: number) =>
      document.querySelector(`[data-tile="${py < 80 ? 1 : py < 216 ? 2 : 3}"]`);
    expect(anchorOf(document.getElementById('view')!)).toEqual({ tile: '2', top: 96 });
    click('Tile 3');
    expect(y).toBe(0);
    // The groups above drew 50 px taller this time: tile 2 is 50 px lower at the remembered scroll.
    at = { 2: [146, 266], 3: [282, 402] };
    click('Dex');
    expect(h1()).toBe('Dex');
    expect(y).toBe(2450);
  });
});
