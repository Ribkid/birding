// Sun: one tap to the Outdoor theme (white paper, near-black ink, firm edges for full sun) and one tap back to the
// theme she had, from the live outing and the map. The theme is written only through progress/theme.ts saveTheme,
// which merges it into the stored settings. The theme she had is remembered in this browser (SUN_PREV_KEY, which
// applyTheme also sets when Outdoor is picked in Settings and clears when any other theme is).
//
// The outdoor theme spreads from the button in a circle (a view transition); under reduced motion, without the API
// or while a page transition is running, it switches at once.
import { useSyncExternalStore, type MouseEvent } from 'react';
import { motionOK, transitioning } from '../lib/motion';
import { SUN_PREV_KEY, THEMES, saveTheme, type Theme } from '../screens/progress/theme';
import './sunToggle.css';

export { SUN_PREV_KEY };
const isTheme = (t: unknown): t is Theme => THEMES.some(([k]) => k === t);

/** The theme on screen now: the data-theme on <html>, or 'auto' when it follows the phone. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const t = root.dataset.theme;
  return isTheme(t) ? t : 'auto';
}

/** Where a tap on Sun goes from `current`, and what to remember (null: forget it). */
export function sunStep(current: Theme, remembered: string | null): { to: Theme; remember: Theme | null } {
  if (current !== 'outdoor') return { to: 'outdoor', remember: current };
  return { to: isTheme(remembered) && remembered !== 'outdoor' ? remembered : 'auto', remember: null };
}

function readPrev(): string | null {
  try { return localStorage.getItem(SUN_PREV_KEY); } catch { return null; }
}
function writePrev(t: Theme | null) {
  try {
    if (t) localStorage.setItem(SUN_PREV_KEY, t);
    else localStorage.removeItem(SUN_PREV_KEY);
  } catch { /* private mode: the second tap goes back to Match my phone */ }
}

type VT = { ready: Promise<void>; finished: Promise<void>; skipTransition?: () => void };
/** The reveal on screen now, and the theme a tap is on its way to before the reveal has put it on the page. */
let reveal: VT | null = null;
let heading: Theme | null = null;

// What a tap hands on to when the browser aims it at <html>: the control under the pointer, or failing that the
// element itself (an svg inside a button goes to the button).
const TAPPABLE = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [tabindex]';

/**
 * While the reveal runs, the page is one picture and the browser aims every tap at <html>, so it would be lost: the
 * second tap on Sun, or a + tapped straight after it. Only the colours change under that picture, so a press there ends
 * the reveal at once and the tap goes to what is under her finger: a touch the browser then aims at it itself; a mouse
 * click, which it still aims at <html>, is handed on.
 */
function passTaps(t: VT): void {
  const root = document.documentElement;
  let pressed = false;
  let ended = false;
  let late = 0;
  const off = () => {
    removeEventListener('pointerdown', down, true);
    removeEventListener('click', click, true);
    clearTimeout(late);
  };
  const down = (e: PointerEvent) => {
    if (ended || e.target !== root) return;
    pressed = true;
    try { t.skipTransition?.(); } catch { /* already over */ }
  };
  const click = (e: globalThis.MouseEvent) => {
    if (!pressed) return;
    pressed = false;
    if (ended) off();
    if (e.target !== root) return;
    const under = document.elementFromPoint?.(e.clientX, e.clientY) ?? null;
    let el: Element | null = under?.closest(TAPPABLE) ?? under;
    while (el && !(el instanceof HTMLElement)) el = el.parentElement;
    if (!el || el === root) return;
    e.stopImmediatePropagation();
    if (el.matches(TAPPABLE)) el.focus({ preventScroll: true });
    el.click();
  };
  addEventListener('pointerdown', down, true);
  addEventListener('click', click, true);
  void t.finished.catch(() => {}).finally(() => {
    ended = true;
    // A press that began in the reveal still has its click to come.
    if (pressed) late = window.setTimeout(off, 1000);
    else off();
  });
}

/** Switches Sun on or off, with the circular reveal from (x, y) when motion is on. Resolves once it is stored. */
export async function toggleSun(at?: { x: number; y: number }): Promise<Theme> {
  const { to, remember } = sunStep(heading ?? currentTheme(), readPrev());
  writePrev(remember);
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: (cb: () => unknown) => VT }).startViewTransition;
  // Under a reveal the theme is put on the page and stored only once the transition calls apply, so this settles then.
  let stored: (p: Promise<unknown>) => void = () => {};
  const saved = new Promise<unknown>((resolve) => { stored = resolve; });
  const apply = () => {
    if (heading === to) heading = null;
    stored(saveTheme(to));
  };
  if (!at || typeof start !== 'function' || !motionOK() || document.hidden || transitioning()) {
    heading = null;
    apply();
  } else {
    root.dataset.nav = 'sun';
    heading = to;
    try {
      const t = start.call(document, apply);
      reveal = t;
      passTaps(t);
      const r = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y));
      t.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${at.x}px ${at.y}px)`, `circle(${Math.ceil(r)}px at ${at.x}px ${at.y}px)`] },
          { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => {});
      // A second tap's reveal takes over from this one: only the last one to finish lets go of data-nav.
      void t.finished.catch(() => {}).finally(() => {
        if (reveal !== t) return;
        reveal = null;
        if (root.dataset.nav === 'sun') delete root.dataset.nav;
      });
    } catch {
      if (!reveal && root.dataset.nav === 'sun') delete root.dataset.nav;
      heading = null;
      apply();
    }
  }
  await saved;
  return to;
}

// The button follows the theme wherever it changes (Settings, the other Sun, a restored backup).
function subscribe(fn: () => void) {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
const isOutdoor = () => currentTheme() === 'outdoor';

const SunIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.35 5.35l1.6 1.6M17.05 17.05l1.6 1.6M5.35 18.65l1.6-1.6M17.05 6.95l1.6-1.6" />
  </svg>
);

/** The Sun toggle: an icon-sized glass button, pressed while the Outdoor theme is on. */
export function SunToggle({ className = '' }: { className?: string }) {
  const on = useSyncExternalStore(subscribe, isOutdoor, () => false);
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    void toggleSun({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <button
      type="button"
      className={`tool-tog sun-toggle ${className}`.trim()}
      aria-pressed={on}
      aria-label="Outdoor theme for bright sun"
      title={on ? 'Back to your theme' : 'Outdoor theme for bright sun'}
      data-sun=""
      onClick={click}
    >
      <SunIcon />
    </button>
  );
}
