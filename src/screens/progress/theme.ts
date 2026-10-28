// The theme setting (v1 js/app.js:2996 applyTheme, run at start and from Settings). Stored in kv 'settings', merged
// with whatever else is kept there (the map layer, colourUnseen), never replacing it.
import { db } from '../../core/db.js';

export type Theme = 'auto' | 'light' | 'dark' | 'outdoor';
export const THEMES: [Theme, string][] = [
  ['auto', 'Match my phone'],
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['outdoor', 'Outdoor (high contrast for bright sun)'],
];

/** A copy of the theme kept in this browser, which index.html reads before the first paint (the setting itself is
 *  in IndexedDB, which answers too late for that), so a chosen theme never opens in the phone's scheme first. */
export const THEME_KEY = 'birddex-theme';

export function applyTheme(theme?: string | null) {
  const root = document.documentElement;
  const t = theme || 'auto';
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: the first frame follows the phone */ }
}

export async function storedSettings(): Promise<Record<string, unknown>> {
  try { return ((await db.kvGet('settings')) as Record<string, unknown> | null) || {}; } catch { return {}; }
}

/**
 * Called once at start, so the chosen theme shows before Settings is ever opened. It follows later changes to
 * the stored settings too (a restored backup, or settings arriving from the account on another phone).
 */
let watching = false;
export async function applySavedTheme() {
  if (!watching) {
    watching = true;
    db.onChange((name: string) => { if (name === 'kv:settings') void applySavedTheme(); });
  }
  applyTheme((await storedSettings()).theme as string | undefined);
}

export async function saveTheme(theme: Theme) {
  applyTheme(theme);
  const next = { ...(await storedSettings()), theme };
  await db.kvSet('settings', next);
  return next;
}
