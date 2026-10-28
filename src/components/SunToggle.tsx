// Sun: one tap to the Outdoor theme (white paper, near-black ink, firm edges for full sun) and one tap back to the
// theme she had, from the live outing and the map. The theme is written only through progress/theme.ts saveTheme,
// which merges it into the stored settings. The theme she had is remembered in this browser (SUN_PREV_KEY).
//
// The outdoor theme spreads from the button in a circle (a view transition); under reduced motion, without the API
// or while a page transition is running, it switches at once.
import { useSyncExternalStore, type MouseEvent } from 'react';
import { motionOK, transitioning } from '../lib/motion';
import { THEMES, saveTheme, type Theme } from '../screens/progress/theme';
import './sunToggle.css';

export const SUN_PREV_KEY = 'birdydex:sunPrev';
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

/** Switches Sun on or off, with the circular reveal from (x, y) when motion is on. Resolves once it is stored. */
export async function toggleSun(at?: { x: number; y: number }): Promise<Theme> {
  const { to, remember } = sunStep(currentTheme(), readPrev());
  writePrev(remember);
  const root = document.documentElement;
  type VT = { ready: Promise<void>; finished: Promise<void> };
  const start = (document as Document & { startViewTransition?: (cb: () => unknown) => VT }).startViewTransition;
  let saved: Promise<unknown> = Promise.resolve();
  const apply = () => { saved = saveTheme(to); };
  if (!at || typeof start !== 'function' || !motionOK() || document.hidden || transitioning()) {
    apply();
  } else {
    root.dataset.nav = 'sun';
    try {
      const t = start.call(document, apply);
      const r = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y));
      t.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${at.x}px ${at.y}px)`, `circle(${Math.ceil(r)}px at ${at.x}px ${at.y}px)`] },
          { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => {});
      void t.finished.catch(() => {}).finally(() => { if (root.dataset.nav === 'sun') delete root.dataset.nav; });
    } catch {
      if (root.dataset.nav === 'sun') delete root.dataset.nav;
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
