import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { topLayer } from '../lib/layers';

const lost = () => {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
};

/** Focus the screen's h1, or the screen itself while it has none. Returns true when the h1 took focus. */
function focusHead(view: HTMLElement): boolean {
  const h = view.querySelector<HTMLElement>('h1');
  if (h) {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
    return true;
  }
  view.focus({ preventScroll: true });
  return false;
}

/** How long a new screen has to draw its heading (Learn draws a loading state first while its data comes in). */
const SETTLE_MS = 3000;

/**
 * v1 focusPageHeading (birding-refresh js/app.js:1046): after a route change, focus the new screen's heading so a
 * screen reader announces where she is. Left alone on the first draw, if she is already typing in the page, or if
 * a layer has opened meanwhile. v1 drew a screen once its data was in; a React screen may first draw a placeholder
 * or swap one heading for another a moment later. So for a short while, focus that drops with the old heading goes
 * to the new one, and focus left on the screen itself because it had no heading yet moves to the heading once it
 * is drawn (v1 stayed on the screen in that case).
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    const view = document.getElementById('view');
    if (!view) return;
    // True while focus sits on the screen itself because there was no heading to give it to.
    let parked = false;
    const watch = new MutationObserver(() => {
      if (topLayer()) return;
      if (lost() || (parked && document.activeElement === view && view.querySelector('h1'))) parked = !focusHead(view);
    });
    const id = requestAnimationFrame(() => {
      if (topLayer()) return;
      const a = document.activeElement;
      if (a && a.isConnected && view.contains(a) && a.matches('input, textarea, select')) return;
      parked = !focusHead(view);
      watch.observe(view, { childList: true, subtree: true });
    });
    const stop = window.setTimeout(() => watch.disconnect(), SETTLE_MS);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(stop);
      watch.disconnect();
    };
  }, [pathname]);
  return null;
}
