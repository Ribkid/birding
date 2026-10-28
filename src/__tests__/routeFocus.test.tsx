// @vitest-environment jsdom
// v1 focusPageHeading: after an in-app navigation focus goes to the new screen's h1, including one drawn late.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { RouteFocus } from '../components/RouteFocus';

afterEach(cleanup);
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Draws a loading state first, then its heading, like Learn waiting for its data. */
function Late({ ms }: { ms: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), ms); return () => clearTimeout(t); }, [ms]);
  return ready ? <h1>Learn</h1> : <div aria-busy="true" />;
}

function Shell() {
  return (
    <>
      <RouteFocus />
      <main id="view" tabIndex={-1}><Outlet /></main>
      <nav><a href="#/learn">Learn</a></nav>
    </>
  );
}

const setup = (late = 50) => {
  const router = createMemoryRouter([
    { path: '/', element: <Shell />, children: [
      { path: 'dex', element: <><h1 className="wordmark">Dex</h1><input aria-label="Search" /></> },
      { path: 'stats', element: <h1>Stats</h1> },
      { path: 'learn', element: <Late ms={late} /> },
    ] },
  ], { initialEntries: ['/dex'] });
  render(<RouterProvider router={router} />);
  return router;
};

describe('RouteFocus', () => {
  it('leaves the first draw alone, then focuses each new screen\'s h1', async () => {
    const router = setup();
    await act(frame);
    expect(document.activeElement).toBe(document.body);
    (document.querySelector('nav a') as HTMLElement).focus();
    await act(() => router.navigate('/stats'));
    await act(frame);
    expect(document.activeElement?.textContent).toBe('Stats');
    await act(() => router.navigate('/dex'));
    await act(frame);
    expect(document.activeElement?.className).toBe('wordmark');
  });

  it('moves focus from the screen to its heading when the heading is drawn late', async () => {
    const router = setup(80);
    await act(() => router.navigate('/learn'));
    await act(frame);
    expect(document.activeElement?.id).toBe('view');
    await act(() => wait(150));
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Learn');
  });
});
