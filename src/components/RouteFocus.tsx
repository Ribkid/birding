import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { topLayer } from '../lib/layers';

const lost = () => {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
};

function focusHead(view: HTMLElement) {
  const h = view.querySelector<HTMLElement>('h1');
  if (h) {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  } else view.focus({ preventScroll: true });
}

/**
 * v1 focusPageHeading (birding-refresh js/app.js:1043): after a route change, focus the new screen's heading so a
 * screen reader announces where she is. Left alone on the first draw, if she is already typing in the page, or if
 * a layer has opened meanwhile. v1 drew a screen once its data was in; a React screen may swap a placeholder for
 * the real page a moment later, so for a short while focus that drops with the old heading goes to the new one.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    const view = document.getElementById('view');
    if (!view) return;
    const watch = new MutationObserver(() => {
      if (lost() && !topLayer()) focusHead(view);
    });
    const id = requestAnimationFrame(() => {
      if (topLayer()) return;
      const a = document.activeElement;
      if (a && a.isConnected && view.contains(a) && a.matches('input, textarea, select')) return;
      focusHead(view);
      watch.observe(view, { childList: true, subtree: true });
    });
    const stop = window.setTimeout(() => watch.disconnect(), 1500);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(stop);
      watch.disconnect();
    };
  }, [pathname]);
  return null;
}
