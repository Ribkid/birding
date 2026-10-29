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
// The running transition's new screen is drawn (its update has run), and it has finished and been cleared up.
let drawn: Promise<void> = Promise.resolve();
let cleared: Promise<void> = Promise.resolve();
let endedAt = -Infinity;
export const transitioning = () => !!running;
/** How long ago the last transition ended (0 while one runs). */
export const sinceTransition = () => (running ? 0 : performance.now() - endedAt);

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
  let onDrawn = noop;
  const isDrawn = new Promise<void>((r) => { onDrawn = r; });
  try { t = (document as any).startViewTransition(() => { try { return update(); } finally { onDrawn(); } }); } catch (_) { delete root.dataset.nav; return direct(); }
  running = t;
  drawn = isDrawn;
  t.ready.catch(noop);
  t.updateCallbackDone.catch(report);
  const done = t.finished.then(noop, noop).finally(() => {
    if (running === t) { running = null; endedAt = performance.now(); }
    if (!running) delete root.dataset.nav;
    clearNames();
  });
  cleared = done;
  return done;
}

/**
 * Ends the running transition at once. While a view transition runs, the page under it can't be hit (a tap lands on
 * <html>), so a tap that comes then asks for it to finish: `drawn` resolves once the new screen is in the page and can
 * be hit, `cleared` once the transition has let go of it, so the next change can run its own.
 */
export function cutShort(): { drawn: Promise<void>; cleared: Promise<void> } {
  if (running) running.skipTransition();
  return { drawn, cleared };
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
// so the number never ends on the value it was first drawn with. A screen that only has a newer number for the
// same count can instead send the running count on to it (countOnTo), so it stays one count.
const counting = new WeakMap<HTMLElement, (to: number) => void>();
export function countUp(el: HTMLElement | null, from: number, to: number, { delay = 0, duration, format = (n: number) => String(n) }: {
  delay?: number; duration?: number; format?: (n: number) => string;
} = {}) {
  if (!el) return Promise.resolve();
  from = Number(from) || 0; to = Number(to) || 0;
  if (!motionOK() || document.hidden || from === to) { counting.delete(el); el.textContent = format(to); return Promise.resolve(); }
  const timeFor = (a: number, b: number) => duration ?? Math.min(900, 240 + Math.abs(b - a) * 40);
  let dur = timeFor(from, to), shown = from, start: number | null = null, wait = delay, moving = false;
  el.textContent = format(from);
  return new Promise<void>(resolve => {
    // A newer number for this count. Before the count has moved, it heads for the new number after the usual
    // pause, as if the number had been drawn with it (v1 draws a screen once its data is in, then counts). Once
    // it is moving, it carries on from the number on screen. Either way it never jumps back or starts again.
    const onTo = (next: number) => {
      if (moving) { from = shown; wait = 0; }
      start = null;
      to = next;
      dur = timeFor(from, to);
      el.textContent = format(shown);
    };
    counting.set(el, onTo);
    const step = (now: number) => {
      if (counting.get(el) !== onTo) { resolve(); return; }
      start ??= now + wait;
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      if (t > 0) moving = true;
      shown = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
      el.textContent = format(shown);
      if (t < 1 && el.isConnected) { requestAnimationFrame(step); return; }
      counting.delete(el);
      el.textContent = format(to);
      el.animate?.([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 360, easing: STAMP });
      resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Sends the count still running on `el` on to `to`, as one count. False when nothing is counting there. */
export function countOnTo(el: HTMLElement | null, to: number) {
  const onTo = el && counting.get(el);
  if (!onTo) return false;
  onTo(Number(to) || 0);
  return true;
}

// ---------- a stamped tap ----------
// A number that has just changed by one (a tap on the outing tally) is already drawn; it pops in with countUp's stamp
// easing, quick enough that a fast thumb sees every tap. Each tap starts it again. Nothing under reduced motion.
const stamping = new WeakMap<HTMLElement, Animation>();
export function stamp(el: HTMLElement | null, { duration = 120, scale = 1.3 }: { duration?: number; scale?: number } = {}) {
  if (!el || !motionOK() || document.hidden || typeof el.animate !== 'function') return;
  stamping.get(el)?.cancel();
  stamping.set(el, el.animate([{ transform: `scale(${scale})` }, { transform: 'none' }], { duration, easing: STAMP }));
}
