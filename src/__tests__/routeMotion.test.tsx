// @vitest-environment jsdom
// v1 onRouteChange: every change of address is one navigation, its motion picked by how deep the screens sit; open
// layers close before the new screen draws, and going back to a shallower screen returns to where she was.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Route, Routes } from 'react-router-dom';
import { MotionHashRouter, navKind } from '../components/RouteMotion';
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
