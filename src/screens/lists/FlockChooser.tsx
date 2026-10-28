// Hold + for a flock: pressing and holding a tally row's + for 450 ms opens a small glass chooser that grows out of
// the button with 5, 10, 20 and 50. A pick counts through the same queue as a tap. A right click, or the keyboard's
// context menu key (Shift+F10) on a focused +, opens it too.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Species } from '../../lib/data';
import { motionOK } from '../../lib/motion';
import { buzz } from './useTally';

export const FLOCKS = [5, 10, 20, 50] as const;
/** The top layer where the browser has it; elsewhere the chooser is a fixed layer like any other. */
const POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
export const HOLD_MS = 450;
/** A press that moves further than this is a scroll, not a hold. */
const SLOP = 10;

/** How long after the held finger lifts its mousedown and click can still arrive. */
const RELEASE_TAIL = 800;

/**
 * After a hold has opened the chooser, lifting the finger still sends the + a mousedown (which would pull focus out
 * of the chooser) and often a click (one more bird), however long she kept it down. Both are dropped while they land
 * on that +, from the hold until a moment after the finger lifts, or until she next presses anything. Taps on the
 * chooser, and a click from the keyboard, go through. (Dex's long press does the same.) `until` hears when the drops
 * end: Infinity while the finger is down, a moment after it lifts, then 0.
 */
function dropRelease(anchor: HTMLElement, until: (at: number) => void) {
  const opts = { capture: true } as const;
  let tail = 0;
  let cap = 0;
  const drop = (e: Event) => {
    if (!(e.target instanceof Node && anchor.contains(e.target))) return;
    if (e.type === 'click' && (e as MouseEvent).detail === 0) return; // Enter or Space on the +
    e.preventDefault();
    e.stopPropagation();
  };
  const off = () => {
    clearTimeout(tail);
    clearTimeout(cap);
    document.removeEventListener('mousedown', drop, opts);
    document.removeEventListener('click', drop, opts);
    document.removeEventListener('pointerdown', off, opts);
    document.removeEventListener('pointerup', lifted, opts);
    document.removeEventListener('pointercancel', lifted, opts);
    until(0);
  };
  function lifted() {
    document.removeEventListener('pointerup', lifted, opts);
    document.removeEventListener('pointercancel', lifted, opts);
    until(Date.now() + RELEASE_TAIL);
    tail = window.setTimeout(off, RELEASE_TAIL);
  }
  until(Infinity);
  document.addEventListener('mousedown', drop, opts);
  document.addEventListener('click', drop, opts);
  document.addEventListener('pointerdown', off, opts);
  document.addEventListener('pointerup', lifted, opts);
  document.addEventListener('pointercancel', lifted, opts);
  // A press whose end never comes through still lets go in the end.
  cap = window.setTimeout(off, 15000);
}

/**
 * The press-and-hold on a + button. `bind(sp)` gives the button its pointer and context-menu handlers;
 * `swallowClick(e)` is true for a click that lifting the held finger makes, should one get past dropRelease.
 */
export function useHold(open: (anchor: HTMLButtonElement, sp: Species) => void) {
  const s = useRef({ timer: 0, x: 0, y: 0, el: null as HTMLButtonElement | null, dropUntil: 0 });
  const openRef = useRef(open);
  openRef.current = open;

  const cancel = () => {
    const st = s.current;
    clearTimeout(st.timer);
    st.timer = 0;
    st.el?.classList.remove('is-holding');
    st.el = null;
  };
  useEffect(() => cancel, []);

  // The hold: the press has lasted HOLD_MS, or the browser has called it a long press first (Chrome on Android sends
  // a long press's context menu at about 400 ms, with the finger still down).
  const fire = (el: HTMLButtonElement, sp: Species) => {
    cancel();
    dropRelease(el, (at) => { s.current.dropUntil = at; });
    buzz(15);
    openRef.current(el, sp);
  };

  return {
    bind: (sp: Species) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        const st = s.current;
        st.dropUntil = 0;
        if (e.button !== 0 || !e.isPrimary) return;
        cancel();
        const el = e.currentTarget;
        st.el = el;
        st.x = e.clientX;
        st.y = e.clientY;
        el.classList.add('is-holding');
        st.timer = window.setTimeout(() => fire(el, sp), HOLD_MS);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
        const st = s.current;
        if (st.timer && Math.hypot(e.clientX - st.x, e.clientY - st.y) > SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // A right click or the context menu key opens it at once. A long press's own context menu is the hold: during
      // the press it opens the chooser as the hold would; once the hold has opened it, it changes nothing.
      onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const st = s.current;
        if (Date.now() < st.dropUntil) return;
        if (st.timer && st.el === e.currentTarget) {
          fire(e.currentTarget, sp);
          return;
        }
        cancel();
        openRef.current(e.currentTarget, sp);
      },
    }),
    swallowClick: (e?: { detail: number }) => {
      const st = s.current;
      if (e?.detail === 0 || Date.now() >= st.dropUntil) return false;
      st.dropUntil = 0;
      return true;
    },
  };
}

interface ChooserProps {
  sp: Species;
  /** The + she held: the chooser grows out of it and hands focus back to it. */
  anchor: HTMLButtonElement;
  onPick: (n: number) => void;
  onClose: () => void;
}

/**
 * The chooser itself: a glass capsule in the top layer (popover="manual", so lifting the finger that opened it
 * doesn't light-dismiss it), above the + or below it when there's no room. Focus goes to +5. A pick, Escape or Tab
 * closes it and focus goes back to the +; a tap anywhere else closes it and leaves focus be. While the page scrolls
 * (a flick still settling, the address bar sliding away) it stays with the +, and once the + has left the screen it
 * closes, handing focus back to the + if it held it.
 */
export function FlockChooser({ sp, anchor, onPick, onClose }: ChooserProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const closeRef = useRef<(back: boolean) => void>(() => {});
  const side = useRef<'above' | 'below' | null>(null);

  // Against the +: above it, or below it when there's no room, keeping the side it opened on while that still fits.
  // When following a scroll, false once the + is gone or off the screen.
  const place = (follow: boolean) => {
    const el = ref.current;
    if (!el || !anchor.isConnected) return false;
    const r = anchor.getBoundingClientRect();
    const vh = window.innerHeight;
    if (follow && (r.bottom <= 0 || r.top >= vh)) return false;
    const vw = document.documentElement.clientWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const edge = 8;
    const gap = 10;
    const left = Math.round(Math.min(Math.max(edge, r.right + 6 - w), vw - edge - w));
    const up = Math.round(r.top - gap - h);
    const down = Math.round(r.bottom + gap);
    const roomAbove = up >= edge + 40;
    const above = side.current === 'below' ? down + h > vh - edge && roomAbove : roomAbove;
    const top = above ? up : down;
    side.current = above ? 'above' : 'below';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.setProperty('--ox', `${Math.round(r.left + r.width / 2 - left)}px`);
    el.style.setProperty('--oy', `${Math.round(r.top + r.height / 2 - top)}px`);
    el.dataset.side = side.current;
    return true;
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  const close = (back: boolean) => {
    if (closing.current) return;
    closing.current = true;
    if (back && anchor.isConnected) anchor.focus({ preventScroll: true });
    const el = ref.current;
    const done = () => {
      try { if (POPOVER && el?.matches(':popover-open')) el.hidePopover(); } catch { /* already gone */ }
      onClose();
    };
    if (!el || !motionOK() || typeof el.animate !== 'function') { done(); return; }
    el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.86)' }],
      { duration: 120, easing: 'cubic-bezier(.5, 0, .75, 0)', fill: 'forwards' },
    ).finished.then(done, done);
  };
  closeRef.current = close;

  // Into the top layer, placed against the +, with focus on the first choice.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (POPOVER) {
      try { el.showPopover(); } catch { /* shown as a fixed layer instead */ }
    }
    placeRef.current(false);
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const away = (e: Event) => {
      if (!el.contains(e.target as Node)) closeRef.current(false);
    };
    // Once a frame at most while the page moves.
    let frame = 0;
    const moved = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (closing.current || placeRef.current(true)) return;
        closeRef.current(el.contains(document.activeElement));
      });
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', moved, { capture: true, passive: true });
    window.addEventListener('resize', moved);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', moved, { capture: true });
      window.removeEventListener('resize', moved);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      buttons[e.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="tally-chooser"
      popover={POPOVER ? 'manual' : undefined}
      role="group"
      aria-labelledby={`flock-${sp.id}-k`}
      onKeyDown={onKeyDown}
    >
      <p className="tally-chooser-k" id={`flock-${sp.id}-k`}>
        Add a flock{' '}<span className="sr-only">of {sp.name}</span>
      </p>
      <div className="tally-chooser-row">
        {FLOCKS.map((n, i) => (
          <button
            key={n}
            type="button"
            style={{ '--i': i } as CSSProperties}
            aria-label={`Add ${n} ${sp.name}`}
            onClick={() => {
              if (closing.current) return;
              onPick(n);
              close(true);
            }}
          >
            <span aria-hidden="true">+</span>{n}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
