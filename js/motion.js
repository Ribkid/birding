// Motion helpers, no dependencies. Each one explains a change (where a page came from, where a tile went) and each
// falls back to the plain update when motion is off: reduced motion, a hidden tab, or a browser without the API.

const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const motionOK = () => !reduce.matches;
const noop = () => {};
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const STAMP = 'cubic-bezier(.2, 1.4, .4, 1)';

// Wait for a promise, but never longer than ms (used so a slow screen can't hold a transition open).
export const settle = (p, ms) => Promise.race([Promise.resolve(p).catch(noop), new Promise(r => setTimeout(r, ms))]);
// A screen that throws while it draws must still show up in the console as an uncaught error, not vanish inside
// the transition's promises.
export const report = e => { if (typeof reportError === 'function') reportError(e); else setTimeout(() => { throw e; }); };

// ---------- view transitions ----------
// Temporary view-transition names. A name may sit on one element only, or the browser drops the whole transition.
const named = new Set();
export function nameFor(el, name) {
  if (!el) return;
  for (const o of named) if (o.style.viewTransitionName === name) { o.style.viewTransitionName = ''; named.delete(o); }
  el.style.viewTransitionName = name;
  named.add(el);
}
export function clearNames() {
  for (const el of named) el.style.viewTransitionName = '';
  named.clear();
}

let running = null;
export const transitioning = () => !!running;

// Run update() inside a same-document view transition. nav ('forward' | 'back' | 'swap') is set on <html> as
// data-nav for the CSS to pick the animation (the {types} form of startViewTransition throws in Chrome 111-124).
// update() must change the DOM synchronously; it may return a promise, which the browser waits for.
// Resolves when the transition (or the plain update) is done, never rejects; an error in update() is reported.
export function vt(update, { nav = 'swap' } = {}) {
  const root = document.documentElement;
  const plain = () => { try { return update(); } finally { clearNames(); } };
  const direct = () => { try { return Promise.resolve(plain()).then(noop, report); } catch (e) { report(e); return Promise.resolve(); } };
  if (running) {
    // A new change while one is still animating: jump the old one to its end and apply this one straight away.
    const prev = running;
    prev.skipTransition();
    return prev.updateCallbackDone.then(direct, direct);
  }
  if (!document.startViewTransition || document.hidden || reduce.matches) return direct();
  root.dataset.nav = nav;
  let t;
  try { t = document.startViewTransition(update); } catch (_) { delete root.dataset.nav; return direct(); }
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
// Animate elements in or near the viewport from where they were to where update() put them, matched by key.
// Newcomers fade in. Transform and opacity only; skipped under reduced motion or when too much moves.
export function flip(update, { selector = '[data-tile]', key = el => el.dataset.tile, max = 36, root = document } = {}) {
  if (!motionOK() || document.hidden || typeof Element.prototype.animate !== 'function') return update();
  const vh = innerHeight, margin = 200;
  const near = r => r.width > 0 && r.bottom > -margin && r.top < vh + margin;
  const measure = fn => {
    for (const el of root.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.top > vh + margin) break; // document order follows the page, so the rest are further down
      if (near(r)) fn(el, r);
    }
  };
  const before = new Map();
  measure((el, r) => before.set(key(el), r));
  const out = update();
  const moved = [], fresh = [];
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
// Count a number up (or down) and land it with a small stamp. The element should be inline-block for the stamp
// and use tabular figures so the width holds still. Reduced motion just shows the final number.
export function countUp(el, from, to, { delay = 0, duration, format = n => String(n) } = {}) {
  if (!el) return Promise.resolve();
  from = Number(from) || 0; to = Number(to) || 0;
  if (!motionOK() || document.hidden || from === to) { el.textContent = format(to); return Promise.resolve(); }
  const dur = duration ?? Math.min(900, 240 + Math.abs(to - from) * 40);
  el.textContent = format(from);
  return new Promise(resolve => {
    let start = null;
    const step = now => {
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
