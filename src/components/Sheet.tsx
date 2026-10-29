import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, focusFirst, openLayer, type Layer } from '../lib/layers';
import { motionOK } from '../lib/motion';

const STARTING_STYLE = typeof window !== 'undefined' && 'CSSStartingStyleRule' in window;
const ms = (t: string) => { const v = parseFloat(t); return Number.isFinite(v) ? (/ms$/.test(t.trim()) ? v : v * 1000) : 0; };
// The first of each list; a timing function such as cubic-bezier(.5, 0, .75, 0) has commas of its own.
const firstEasing = (t: string, or: string) => /^\s*([a-z-]+(\([^)]*\))?)/i.exec(t)?.[1] || or;

/** How far down a transform moves a sheet, in px: an inline translateY(..px), or a computed matrix() or matrix3d(). */
export function translateYOf(t: string | null | undefined): number {
  if (!t || t === 'none') return 0;
  const nums = (m: RegExpExecArray) => m[1].split(',').map((x) => parseFloat(x));
  let m = /^matrix3d\(([^)]*)\)/.exec(t);
  if (m) return nums(m)[13] || 0;
  m = /^matrix\(([^)]*)\)/.exec(t);
  if (m) return nums(m)[5] || 0;
  m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(t);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * How fast the finger was moving down when it lifted, in px/ms, from its moves over the last 100 ms. A finger that
 * rested (no move for 80 ms before it lifted) wasn't flicking, however fast it got there.
 */
export function releaseVelocity(pts: [number, number][], upAt: number): number {
  if (pts.length < 2) return 0;
  const [tl, yl] = pts[pts.length - 1];
  if (upAt - tl > 80) return 0;
  let i = pts.findIndex(([t]) => tl - t <= 100);
  if (i < 0 || i === pts.length - 1) i = pts.length - 2;
  const [t0, y0] = pts[i];
  return (yl - y0) / Math.max(1, tl - t0);
}

/**
 * Whether a sheet let go of at `at` px below its resting place (of `h` px) closes: on a flick down (faster than
 * 0.5 px/ms), or past 30% of its height unless she flicked it back up.
 */
export function shouldClose(at: number, h: number, v: number): boolean {
  return v > 0.5 || (at > h * 0.3 && v > -0.5);
}

/** The scrim while a sheet is dragged: it clears as the sheet goes down, to a fifth at the sheet's full height. */
export const scrimAt = (at: number, h: number) => 1 - Math.min(1, Math.max(0, at) / Math.max(1, h)) * 0.8;

/**
 * The exit after a drag: from where the sheet is to off screen, starting at the finger's speed so it neither stalls
 * nor jumps as she lets go. It is shorter for less distance and a faster finger (140 to 300 ms), and leaves at no
 * less than 1.5 px/ms on average, so a sheet let go of at rest doesn't dawdle. The curve's x controls sit at thirds,
 * so it leaves at 3 * y1 times its average speed (the finger's) and ends at that average.
 */
export function exitTiming(remaining: number, v: number): { duration: number; easing: string } {
  const dist = Math.max(0, remaining);
  const speed = Math.max(0, v);
  const duration = Math.round(Math.min(300, Math.max(140, dist / Math.max(speed, 1.5))));
  const lead = dist ? Math.min(3, (speed * duration) / dist) : 0;
  return { duration, easing: `cubic-bezier(.3333, ${(lead / 3).toFixed(3)}, .6667, .6667)` };
}

// How fast each sheet closed by a drag was moving as the finger lifted, and when it lifted, for its exit to carry on
// from.
const flung = new WeakMap<HTMLElement, { v: number; at: number }>();

// Where each sheet was drawn as React took it out of the page: it may still be rising in, springing back or fading up,
// and its exit goes on from there rather than jumping back to its resting place first.
const looks = new WeakMap<HTMLElement, { transform: string; opacity: number; scrim: string }>();
function keepLook(wrap: HTMLElement) {
  const sheet = wrap.querySelector<HTMLElement>('.sheet');
  if (!sheet || !wrap.isConnected) return;
  const scrim = wrap.querySelector<HTMLElement>('.sheet-scrim');
  const cs = getComputedStyle(sheet);
  const opacity = parseFloat(cs.opacity);
  looks.set(wrap, { transform: cs.transform, opacity: Number.isFinite(opacity) ? opacity : 1, scrim: scrim ? getComputedStyle(scrim).opacity : '' });
}

/**
 * v1 closeSheet/exitSheet: a sheet she dismisses (Escape, the scrim, a button) slides back down before it goes, and
 * under reduced motion fades where it is. React has already taken the closed sheet out of the page, so its last
 * frame is put back, inert and marked data-closing, and plays out to motion.css's closing styles.
 */
function playOut(wrap: HTMLElement, scrollTop: number, reason?: string) {
  const sheet = wrap.querySelector<HTMLElement>('.sheet');
  const scrim = wrap.querySelector<HTMLElement>('.sheet-scrim');
  const look = looks.get(wrap);
  looks.delete(wrap);
  if (!sheet || typeof sheet.animate !== 'function' || !wrap.classList.contains('open')) return;
  // v1 exitSheet: hand over from wherever a drag left the sheet (under reduced motion it fades where it is), or from
  // where it was drawn when it closed, still rising in or springing back.
  const from = sheet.style.transform || look?.transform || 'none';
  const opacityFrom = look?.opacity ?? 1;
  const scrimFrom = scrim?.style.opacity || look?.scrim || '1';
  sheet.style.transition = '';
  sheet.style.transform = '';
  if (scrim) scrim.style.opacity = scrim.style.transition = '';
  wrap.classList.remove('sheet-wrap--drag');
  wrap.setAttribute('data-closing', '');
  // Only a picture of the sheet now: nothing in it can be reached, focused or read out.
  wrap.inert = true;
  wrap.setAttribute('aria-hidden', 'true');
  // A sheet opening as this one leaves may use the same ids.
  wrap.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  document.body.append(wrap);
  const fling = reason === 'drag' ? flung.get(wrap) : undefined;
  flung.delete(wrap);
  try {
    sheet.scrollTop = scrollTop;
    const to = getComputedStyle(sheet);
    let timing = { duration: ms(to.transitionDuration.split(',')[0]) || 200, easing: firstEasing(to.transitionTimingFunction, 'ease-in') };
    // Let go of after a drag, it carries on down at the finger's speed (under reduced motion it fades where it is).
    if (reason === 'drag' && motionOK()) timing = exitTiming(translateYOf(to.transform) - translateYOf(from), fling?.v ?? 0);
    const end = reason === 'drag' && !motionOK() ? from : to.transform;
    const anims = [sheet.animate([{ transform: from, opacity: opacityFrom }, { transform: end, opacity: to.opacity }], timing)];
    if (scrim) anims.push(scrim.animate([{ opacity: scrimFrom }, { opacity: getComputedStyle(scrim).opacity }], { duration: timing.duration, easing: reason === 'drag' ? 'linear' : timing.easing }));
    // It leaves from the moment the finger lifted, not from the first frame after the page has caught up with the
    // close (focus, the page behind coming back), so a busy frame shows it further on rather than stalled.
    // Never later than the frame now on screen (a start in the future would leave a frame without it).
    const now = document.timeline?.currentTime;
    if (fling && typeof now === 'number' && fling.at - now < 34 && now - fling.at < 120) anims.forEach((a) => { a.startTime = Math.min(fling.at, now); });
    void Promise.race([Promise.allSettled(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 450))]).then(() => wrap.remove());
  } catch {
    wrap.remove();
  }
}

/**
 * v1 wireSheetDrag: drag a sheet down to dismiss it, from the grip and the top 56px, or from anywhere once it is
 * scrolled to the top. It follows the finger 1:1, resists upward, and closes past 30% of its height or on a quick
 * flick; a shorter drag (or one flicked back up) springs back. The scrim, and the blur of the page under it, clear
 * with the finger. Moves only write styles, so nothing renders per move. Returns the cleanup.
 */
function wireSheetDrag(wrap: HTMLElement, sheet: HTMLElement, close: () => void) {
  const scrim = wrap.querySelector<HTMLElement>('.sheet-scrim');
  const rubber = (d: number) => 56 * (1 - 1 / (d / 140 + 1));
  // dy is where the sheet is (down from its resting place), base where it was when the finger came down, and caught
  // whether it was moving then.
  type Grab = { id: number; x: number; y: number; h: number; handle: boolean; on: boolean; dy: number; base: number; caught: boolean; pts: [number, number][] };
  let g: Grab | null = null;
  let settleT = 0;
  // Moves are followed on the window, so a mouse that leaves the sheet (dragging up past its top) still counts.
  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.on) {
      if (Math.hypot(dx, dy) < 8) return;
      // Sideways is a chip row scrolling; upward in the body is ordinary scrolling.
      if (Math.abs(dx) > Math.abs(dy) || (!g.handle && (dy < 0 || sheet.scrollTop > 0))) { letGo(); return; }
      g.on = true;
      sheet.getAnimations?.().forEach((a) => a.cancel());
      sheet.style.transition = 'none';
      // The scrim follows the finger too, not its own 320 ms fade behind it.
      if (scrim) scrim.style.transition = 'none';
      wrap.classList.add('sheet-wrap--drag');
    }
    const at = g.base + dy;
    g.dy = at;
    // It resists above its resting place, or above where she caught it if that was higher (a spring entry
    // overshooting), so the first move doesn't snap it down from there.
    const lo = Math.min(0, g.base);
    sheet.style.transform = `translateY(${at >= lo ? at : lo - rubber(lo - at)}px)`;
    if (scrim) scrim.style.opacity = String(scrimAt(at, g.h));
    g.pts.push([e.timeStamp, e.clientY]);
    if (g.pts.length > 8) g.pts.shift();
  };
  // A press that didn't become a drag: a sheet it caught moving settles where it belongs again.
  const letGo = () => {
    const caught = g?.caught;
    stop();
    if (caught) springBack();
  };
  const end = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.on) { letGo(); return; }
    const s = g;
    stop();
    // The tap that ends a drag is not a click on whatever is under the finger.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    const v = releaseVelocity(s.pts, e.timeStamp);
    if (e.type === 'pointerup' && shouldClose(s.dy, s.h, v)) {
      flung.set(wrap, { v, at: e.timeStamp });
      close();
      // A sheet whose owner keeps it open (Edit profile's species list goes back a step) settles where it belongs.
      settleT = window.setTimeout(() => { if (wrap.isConnected && !wrap.hasAttribute('data-closing')) springBack(); }, 100);
      return;
    }
    springBack();
  };
  const springBack = () => {
    flung.delete(wrap);
    wrap.classList.remove('sheet-wrap--drag');
    // A step sliding in (Edit profile back from its species list) is left to finish without a second motion.
    const stepping = typeof sheet.getAnimations === 'function' && sheet.getAnimations().length > 0;
    sheet.style.transition = motionOK() && !stepping ? 'transform var(--dur-3) var(--ease-spring)' : 'none';
    sheet.style.transform = '';
    // The scrim comes back with its own fade.
    if (scrim) scrim.style.opacity = scrim.style.transition = '';
    clearTimeout(settleT);
    settleT = window.setTimeout(() => { if (!g) sheet.style.transition = ''; }, 400);
  };
  const stop = () => {
    g = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  const down = (e: PointerEvent) => {
    if (g || e.button > 0 || wrap.hasAttribute('data-closing')) return;
    const target = e.target as Element;
    if (target.closest('input, textarea, select, [contenteditable], .leaflet-container, [data-nodrag]')) return;
    const r = sheet.getBoundingClientRect();
    const handle = e.clientY - r.top < 56;
    if (!handle && sheet.scrollTop > 0) return;
    for (let n: Element | null = target; n && n !== sheet; n = n.parentElement) {
      // A list scrolled inside the sheet (the avatar picker) scrolls back up rather than dragging the sheet away.
      if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return;
      // A surface that takes every touch for itself (touch-action: none, as the photo framing stage does) keeps the
      // gesture; the grip is the sheet's own.
      if (!n.classList.contains('sheet-grip') && getComputedStyle(n).touchAction === 'none') return;
    }
    // Caught while it moves (springing back, rising in, a step sliding up), it stops under her finger, and a drag
    // carries on from there rather than jumping to where the finger is from its resting place.
    const base = translateYOf(getComputedStyle(sheet).transform);
    const caught = Math.abs(base) > 0.5;
    if (caught) {
      sheet.getAnimations?.().forEach((a) => a.cancel());
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${base}px)`;
    }
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, h: r.height, handle, on: false, dy: base, base, caught, pts: [[e.timeStamp, e.clientY]] };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  // On touch, once the sheet is being dragged the page must not scroll or pull to refresh underneath.
  const touchmove = (e: TouchEvent) => { if (g?.on && e.cancelable) e.preventDefault(); };
  sheet.addEventListener('pointerdown', down);
  sheet.addEventListener('touchmove', touchmove, { passive: false });
  return () => {
    const dragged = !!g?.on || !!sheet.style.transform;
    stop();
    clearTimeout(settleT);
    sheet.removeEventListener('pointerdown', down);
    sheet.removeEventListener('touchmove', touchmove);
    // Still on screen (the sheet is wired again): don't leave it where a drag had it. A closed sheet keeps its
    // place for playOut to carry on from.
    if (dragged && wrap.isConnected && !wrap.hasAttribute('data-closing')) {
      wrap.classList.remove('sheet-wrap--drag');
      sheet.style.transition = sheet.style.transform = '';
      if (scrim) scrim.style.opacity = scrim.style.transition = '';
    }
  };
}

// v1 openSheet: a sheet that opens as another closes replaces it. The old one goes at once rather than sliding away
// over the new one, and the new one keeps the scrim up (sheet-wrap--swap) so the page behind doesn't flash. A sheet
// closed in a commit is noted here; one opened in the same commit takes its place.
let leaving: HTMLElement | null = null;
const replaced = new WeakSet<HTMLElement>();

/** A route change doesn't wait for a sheet that is still sliding away (v1 flushClosingSheets). */
export function flushClosingSheets() {
  document.querySelectorAll('.sheet-wrap[data-closing]').forEach((w) => w.remove());
}

/**
 * A sheet opened while another is still sliding away (she dismissed it and changed her mind) takes over from it
 * rather than rising from the bottom behind it: the leaving copy goes, and the new sheet starts where the copy was,
 * at its opacity and with its scrim, then settles with its own entry timing. Under reduced motion it fades up from
 * the copy's opacity where it rests.
 */
function takeOver(wrap: HTMLElement, card: HTMLElement) {
  const ghost = [...document.querySelectorAll<HTMLElement>('.sheet-wrap[data-closing]')].pop();
  if (!ghost) return;
  const was = ghost.querySelector<HTMLElement>('.sheet');
  const wasScrim = ghost.querySelector<HTMLElement>('.sheet-scrim');
  const top = was?.getBoundingClientRect().top;
  // A taller sheet still above where this shorter one rests (she closed the log sheet and tapped +): turning it back
  // from there would lift this one off the foot of the screen, so the tall one slides on out and this one rises in
  // front of it, as it would from nothing. (Heights and resting places are read without transforms.)
  if (motionOK() && was && top != null && was.offsetHeight > card.offsetHeight + 1
    && top < wrap.getBoundingClientRect().top + card.offsetTop - 1) return;
  const opacity = was ? Number(getComputedStyle(was).opacity) : 1;
  const scrimFrom = wasScrim && getComputedStyle(wasScrim).display !== 'none' ? getComputedStyle(wasScrim).opacity : '0';
  flushClosingSheets();
  if (!STARTING_STYLE || top == null || typeof card.animate !== 'function') return;
  const scrim = wrap.querySelector<HTMLElement>('.sheet-scrim');
  // The sheet's own entry, read before it is turned off so it can't also run from the bottom.
  const cs = getComputedStyle(card);
  const timing = { duration: ms(cs.transitionDuration.split(',')[0]) || 320, easing: firstEasing(cs.transitionTimingFunction, 'ease-out') };
  const scrimTiming = scrim ? { duration: ms(getComputedStyle(scrim).transitionDuration) || 320, easing: 'cubic-bezier(.2, .8, .2, 1)' } : null;
  card.style.transition = 'none';
  if (scrim) scrim.style.transition = 'none';
  // A copy closed as its spring entry overshot sits a little above rest; the new sheet settles down from there.
  const from = top - card.getBoundingClientRect().top;
  try {
    if (motionOK() && Math.abs(from) > 1) card.animate([{ transform: `translateY(${from}px)`, opacity }, { transform: 'none', opacity: 1 }], timing);
    else card.animate([{ opacity }, { opacity: 1 }], { duration: 200, easing: 'linear' });
    if (scrim && scrimTiming) scrim.animate([{ opacity: scrimFrom }, { opacity: 1 }], scrimTiming);
  } catch { /* drawn where it rests */ }
  // Its transitions come back once it has been drawn, for a later drag or close.
  requestAnimationFrame(() => {
    card.style.transition = '';
    if (scrim) scrim.style.transition = '';
  });
}

interface SheetProps {
  open: boolean;
  /** How it was closed: 'escape' or 'nav' from the layer stack, 'scrim' for a tap outside it. */
  onClose: (reason?: string) => void;
  children: ReactNode;
  label?: string;
  /** The id of a heading that names the sheet, when it changes with the step (the Add sheet's outing form). */
  labelledBy?: string;
  wide?: boolean;
  cls?: string;
  /** false keeps the page usable behind the sheet (e.g. the patch sheet over the map). */
  modal?: boolean;
  lock?: boolean;
  /** Change it when the sheet swaps its content for another step, so the new step's first control takes focus. */
  step?: string | number;
}

/** A bottom sheet on the shared layer stack: scrim, focus trap, Escape and inert page behind it. */
export function Sheet({ open, onClose, children, label, labelledBy, wide = false, cls = '', modal = true, lock = true, step }: SheetProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // React detaches the wrapper's ref before it takes the wrapper out of the page (unmounted, or open turned false), so
  // this is the last moment its sheet can be read where it is drawn.
  const setWrap = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    if (!el) return undefined;
    return () => {
      keepLook(el);
      wrapRef.current = null;
    };
  }, []);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 'open' is part of the rendered class, so a sheet that changes its cls (the Add sheet's outing step) keeps it.
  // Where @starting-style works the sheet is drawn open at once and the CSS gives its entry (from further down for the
  // + sheet), as v1's openSheet did; elsewhere the class arrives a frame later.
  const [shown, setShown] = useState(false);
  // How the layer stack last closed it ('escape', 'nav'...), and how far its content was scrolled.
  const reason = useRef<string | undefined>(undefined);
  const scrolled = useRef(0);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    const close = (why?: string) => { reason.current = why; closeRef.current(why); };
    const layer: Layer = openLayer(wrap, { dialog: card, label, labelledBy, modal, lock, close });
    const raf = requestAnimationFrame(() => setShown(true));
    const unwire = wireSheetDrag(wrap, card, () => close('drag'));
    return () => {
      cancelAnimationFrame(raf);
      unwire();
      setShown(false);
      closeLayer(layer);
    };
  }, [open, label, labelledBy, modal, lock]);

  // Closing (open turns false, or the owner drops the sheet) plays the exit unless a route change did it or another
  // sheet took its place: v1 removed a sheet at once for 'nav' and 'replace', and the hash has already moved when the
  // screen that held it unmounts.
  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const card = cardRef.current;
    const hash = location.hash;
    reason.current = undefined;
    if (wrap && leaving && leaving !== wrap) {
      replaced.add(leaving);
      leaving = null;
      wrap.classList.add('sheet-wrap--swap');
    } else if (wrap && card) takeOver(wrap, card);
    return () => {
      const why = reason.current;
      reason.current = undefined;
      if (!wrap || why === 'nav') return;
      const top = scrolled.current;
      leaving = wrap;
      queueMicrotask(() => {
        if (leaving === wrap) leaving = null;
        if (!replaced.has(wrap) && !wrap.isConnected && location.hash === hash) playOut(wrap, top, why);
      });
    };
  }, [open]);

  // A new step replaces the sheet's content. v1 opened a new sheet over the same scrim for it, which slid up from
  // below, so the new step does the same.
  const lastStep = useRef(step);
  useEffect(() => {
    if (!open) { lastStep.current = step; return; }
    if (lastStep.current === step) return;
    lastStep.current = step;
    const card = cardRef.current;
    if (card && motionOK() && typeof card.animate === 'function') {
      card.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }, [open, step]);

  // Take the person into the sheet, as v1's openSheet did: its first control gets focus after 50 ms.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const wrap = wrapRef.current, card = cardRef.current;
      if (wrap && card && wrap.isConnected && !wrap.hasAttribute('data-closing')) focusFirst(card);
    }, 50);
    return () => clearTimeout(t);
  }, [open, step]);

  if (!open) return null;
  return createPortal(
    <div ref={setWrap} className={`sheet-wrap ${cls}${shown || STARTING_STYLE ? ' open' : ''}`} data-closing={undefined}>
      <div className="sheet-scrim" data-close="" onClick={() => onClose('scrim')} />
      <div ref={cardRef} className={`sheet ${wide ? 'sheet--wide' : ''}`.trim()} onScroll={(e) => { scrolled.current = e.currentTarget.scrollTop; }}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
