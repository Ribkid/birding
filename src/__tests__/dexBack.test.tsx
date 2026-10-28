// @vitest-environment jsdom
// Back from a species page to the Dex: the dex is laid out exactly as she left it (each group's remembered height),
// and when it lands where she left it, the groups that were around her are drawn first (dexMemory.ts). The router
// says where a screen being drawn will land (RouteMotion's landingScroll).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { MotionHashRouter, landingScroll } from '../components/RouteMotion';
import { drawFirst, forgetDex, groupKey, rememberLeaving, rememberedBox, rememberedContent } from '../screens/dexMemory';

describe('dexMemory', () => {
  beforeEach(() => forgetDex());

  const groups = [
    { key: 'a', top: -5200, bottom: -3000, height: 2200, padding: 16 },
    { key: 'b', top: -3000, bottom: -400, height: 2600, padding: 16 },
    { key: 'c', top: -400, bottom: 900, height: 1300, padding: 16 },
    { key: 'd', top: 900, bottom: 3200, height: 2300, padding: 16 },
    { key: 'e', top: 3200, bottom: 9000, height: 5800, padding: 16 },
  ];

  it('keeps each group heights, whole and without its padding', () => {
    rememberLeaving('k1', groups, 7829, 844);
    expect(rememberedBox('c')).toBe(1300);
    expect(rememberedContent('c')).toBe(1284);
    expect(rememberedBox('nope')).toBeUndefined();
  });

  it('draws the groups within two screens of where she was first, only when the dex lands where she left it', () => {
    rememberLeaving('k1', groups, 7829, 844);
    expect([...(drawFirst('k1', 7829) ?? [])]).toEqual(['b', 'c', 'd']);
    // Somewhere else (a tab tap starts at the top), another history entry, or no landing at all: draw everything.
    expect(drawFirst('k1', 0)).toBeNull();
    expect(drawFirst('k2', 7829)).toBeNull();
    expect(drawFirst('k1', null)).toBeNull();
  });

  it('keys a group by its layout, size and the screen width', () => {
    expect(groupKey('parrots', 'grid', 25, 390)).not.toBe(groupKey('parrots', 'list', 25, 390));
    expect(groupKey('parrots', 'grid', 25, 390)).not.toBe(groupKey('parrots', 'grid', 25, 320));
  });
});

describe('landingScroll', () => {
  let y = 0;
  beforeEach(() => {
    window.location.hash = '#/dex';
    y = 0;
    vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, top: number) => { y = top; }) as typeof window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is where the screen being drawn will land, only while it is drawn for that history entry", () => {
    const seen: (number | null)[] = [];
    function Probe({ name }: { name: string }) {
      const { key } = useLocation();
      seen.push(landingScroll(key));
      return <h1>{name}</h1>;
    }
    render(
      <MotionHashRouter>
        <main id="view">
          <Routes>
            <Route path="/dex" element={<><Probe name="Dex" /><Link to="/bird/3">Magpie Goose</Link></>} />
            <Route path="/bird/:id" element={<><Probe name="Bird" /><Link to="/dex">Back</Link></>} />
          </Routes>
        </main>
      </MotionHashRouter>,
    );
    const click = (text: string) => act(() => { [...document.querySelectorAll('a')].find((a) => a.textContent === text)!.click(); });
    expect(seen).toEqual([null]); // the first draw is not a return to anywhere
    y = 1400;
    click('Magpie Goose');
    expect(seen.at(-1)).toBe(0); // a deeper screen starts at the top
    click('Back');
    expect(document.querySelector('h1')?.textContent).toBe('Dex');
    expect(seen.at(-1)).toBe(1400); // back where she was
    expect(y).toBe(1400);
  });
});
