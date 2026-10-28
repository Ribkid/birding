import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { topLayer } from '../lib/layers';

const lost = () => {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
};

/** The screen's h1, or the screen itself while it has none. */
const headOf = (view: HTMLElement): HTMLElement => {
  const h = view.querySelector<HTMLElement>('h1');
  if (!h) return view;
  h.tabIndex = -1;
  return h;
};

/** How long a new screen has to draw its heading (Learn draws a loading state first while its data comes in). */
const SETTLE_MS = 3000;

/**
 * v1 focusPageHeading (birding-refresh js/app.js:1046): after a route change, focus the new screen's heading so a
 * screen reader announces where she is. Left alone on the first draw, if she is already typing in the page, or if
 * a layer has opened meanwhile. v1 drew a screen once its data was in; a React screen may first draw a placeholder
 * or swap one heading for another a moment later. So for a short while, focus that drops with the old heading goes
 * to the new one, and focus left on the screen itself because it had no heading yet moves to the heading once it
 * is drawn (v1 stayed on the screen in that case). As soon as focus goes anywhere else (she tabs or taps, a sheet
 * opens, the screen focuses something itself) the screen is hers again and this stops watching.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    const view = document.getElementById('view');
    if (!view) return;
    // The element this put focus on: the heading, or the screen while it had no heading.
    let mine: HTMLElement | null = null;
    const take = () => {
      mine = headOf(view);
      mine.focus({ preventScroll: true });
    };
    const watch = new MutationObserver(() => {
      if (topLayer()) return;
      const parked = mine === view && document.activeElement === view && !!view.querySelector('h1');
      if (lost() || parked) take();
    });
    const done = () => {
      watch.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
    };
    function onFocusIn(e: FocusEvent) {
      if (e.target !== mine) done();
    }
    const id = requestAnimationFrame(() => {
      if (topLayer()) return;
      const a = document.activeElement;
      if (a && a.isConnected && view.contains(a) && a.matches('input, textarea, select')) return;
      take();
      watch.observe(view, { childList: true, subtree: true });
      document.addEventListener('focusin', onFocusIn, true);
    });
    const stop = window.setTimeout(done, SETTLE_MS);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(stop);
      done();
    };
  }, [pathname]);
  return null;
}
