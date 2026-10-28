// Imported first by main.tsx, so her records start loading from IndexedDB, and the regional data from its file,
// before the rest of the app's modules are even evaluated; by the time React is ready to draw, they are usually in.
// Her chosen theme is read alongside, so React's first frame has it too.
import { BOOT_WAIT, bootStore } from './store';
import { seqLanded } from './seq';
import { applySavedTheme } from '../screens/progress/theme';

/**
 * How long React's first draw waits for the regional data. The service worker's copy is read and parsed within a few
 * hundred ms even on a slow phone; on a first visit over a slow connection the app draws without it and fills it in
 * when it lands, so the shell does not stand in for the whole download.
 */
const REGIONAL_WAIT = 800;

const records = bootStore();
const regional = Promise.race([seqLanded(), new Promise<void>((resolve) => setTimeout(resolve, REGIONAL_WAIT))]);
void applySavedTheme().catch(() => {});

/**
 * React's first draw waits for her records and the regional data, as v1 loaded both before its first render, so the
 * Dex draws once, with her count and the day's pick (which is ranked by the regional rates) on its first frame. The
 * static shell is on screen meanwhile. Never longer than BOOT_WAIT (REGIONAL_WAIT for the regional data): whatever is
 * still on its way fills in when it lands.
 */
export const booted: Promise<void> = Promise.race([
  Promise.all([records, regional]).then(() => {}),
  new Promise<void>((resolve) => setTimeout(resolve, BOOT_WAIT)),
]);
