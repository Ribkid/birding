// Motion helpers, no dependencies. Each one explains a change (where a page came from, where a tile went) and each
// falls back to the plain update when motion is off: reduced motion, a hidden tab, or a browser without the API.

const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const motionOK = () => !reduce.matches;
const noop = () => {};
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const STAMP = 'cubic-bezier(.2, 1.4, .4, 1)';

export const settle = (p: Promise<unknown>, ms: number) => Promise.race([Promise.resolve(p).catch(noop), new Promise(r => setTimeout(r, ms))]);
export const report = (e: unknown) => { if (typeof reportError === 'function') reportError(e); else setTimeout(() => { throw e; }); };

// ---------- view transitions ----------
const named = new Set<HTMLElement>();
export function nameFor(el: HTMLElement | null, name: string) {
  if (!el) return;
  for (const o of named) if (o.style.viewTransitionName === name) { o.style.viewTransitionName = ''; named.delete(o); }
  el.style.viewTransitionName = name;
  named.add(el);
}
export function clearNames() {
  for (const el of named) el.style.viewTransitionName = '';
  named.clear();
}

let running: any = null;
export const transitioning = () => !!running;

// Run update() inside a same-document view transition. nav ('forward' | 'back' | 'swap') is set on <html> as
// data-nav for the CSS to pick the animation.
export function vt(update: () => unknown, { nav = 'swap' }: { nav?: 'forward' | 'back' | 'swap' } = {}) {
  const root = document.documentElement;
  const plain = () => { try { return update(); } finally { clearNames(); } };
  const direct = () => {
    try { return Promise.resolve(plain()).then(noop, report); }
    catch (e) { report(e); return Promise.resolve(); }
  };
  if (running) {
    const prev = running;
    prev.skipTransition();
    return prev.updateCallbackDone.then(direct, direct);
  }
  if (!(document as any).startViewTransition || document.hidden || reduce.matches) return direct();
  root.dataset.nav = nav;
  let t: any;
  try { t = (document as any).startViewTransition(update); } catch (_) { delete root.dataset.nav; return direct(); }
  running = t;
  t.ready.catch(noop);
  t.updateCallbackDone.catch(report);
  return t.finished.then(noop, noop).finally(() => {
    if (running === t) running = null;
    if (!running) delete root.dataset.nav;
    clearNames();
  });
}

// ---------- FLIP ----------
export function flip(update: () => unknown, { selector = '[data-tile]', key = (el: HTMLElement) => el.dataset.tile, max = 36, root = document }: {
  selector?: string; key?: (el: HTMLElement) => string | undefined; max?: number; root?: ParentNode;
} = {}) {
  if (!motionOK() || document.hidden || typeof Element.prototype.animate !== 'function') return update();
  const vh = innerHeight, margin = 200;
  const near = (r: DOMRect) => r.width > 0 && r.bottom > -margin && r.top < vh + margin;
  const measure = (fn: (el: HTMLElement, r: DOMRect) => void) => {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.top > vh + margin) break;
      if (near(r)) fn(el, r);
    }
  };
  const before = new Map<string | undefined, DOMRect>();
  measure((el, r) => before.set(key(el), r));
  const out = update();
  const moved: { el: HTMLElement; dx: number; dy: number; d: number }[] = [], fresh: HTMLElement[] = [];
  measure((el, r) => {
    const b = before.get(key(el));
    if (!b) { fresh.push(el); return; }
    const dx = b.left - r.left, dy = b.top - r.top;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) moved.push({ el, dx, dy, d: Math.abs(r.top + r.height / 2 - vh / 2) });
  });
  if (moved.length > 150) return out;
  moved.sort((a, b) => a.d - b.d).slice(0, max).forEach(({ el, dx, dy }) =>
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: EASE_OUT }));
  fresh.slice(0, max).forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT }));
  return out;
}

// ---------- stamped numbers ----------
// v1 draws a count once; a React screen can draw it again while it is still counting (Targets' "to find" goes
// 177 then 180 when the regional data arrives). The newest count on an element wins: an older one stops writing,
// so the number never ends on the value it was first drawn with.
const counting = new WeakMap<HTMLElement, number>();
export function countUp(el: HTMLElement | null, from: number, to: number, { delay = 0, duration, format = (n: number) => String(n) }: {
  delay?: number; duration?: number; format?: (n: number) => string;
} = {}) {
  if (!el) return Promise.resolve();
  const run = (counting.get(el) || 0) + 1;
  counting.set(el, run);
  from = Number(from) || 0; to = Number(to) || 0;
  if (!motionOK() || document.hidden || from === to) { el.textContent = format(to); return Promise.resolve(); }
  const dur = duration ?? Math.min(900, 240 + Math.abs(to - from) * 40);
  el.textContent = format(from);
  return new Promise<void>(resolve => {
    let start: number | null = null;
    const step = (now: number) => {
      if (counting.get(el) !== run) { resolve(); return; }
      start ??= now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      el.textContent = format(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1 && el.isConnected) { requestAnimationFrame(step); return; }
      el.textContent = format(to);
      el.animate?.([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 360, easing: STAMP });
      resolve();
    };
    requestAnimationFrame(step);
  });
}
