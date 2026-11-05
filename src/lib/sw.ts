// The offline shell's service worker (dist/sw.js, built from scripts/sw-template.js), registered as v1 boot() does
// (birding-refresh js/app.js:3119-3126): checked for a new release at start and every 30 minutes, and when a new
// release takes over a page that an earlier one was running, "A new version is ready." with Reload (v1 app.js:3009).
import { regionFile } from './region';

const CHECK_EVERY = 30 * 60 * 1000;

/** This region's own data files. The service worker doesn't precache them (scripts/build-sw.mjs), so the page names them. */
export const REGION_FILES = ['rates.json', 'ebird.json', 'spot-access.json', 'spot-access-ebird.json'].map((name) => regionFile(name));

/** Asks for the region's files once the worker controls the page, so they are saved for offline on the first run. */
export function warmRegionFiles(sw: ServiceWorkerContainer = navigator.serviceWorker, get: typeof fetch = fetch): void {
  const warm = () => { for (const url of REGION_FILES) void get(url).catch(() => {}); };
  if (sw.controller) warm();
  else sw.addEventListener('controllerchange', warm, { once: true });
}

// v1 showUpdateBanner: one bar, a status region, appended to the body outside the screens, so it stays over
// whatever is open until she reloads. lib/layers.ts leaves it out of the background a sheet makes inert.
export function showUpdateBanner(): void {
  if (document.querySelector('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'A new version is ready.';
  const reload = document.createElement('button');
  reload.className = 'btn btn--small btn--primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  bar.append(text, reload);
  document.body.append(bar);
}

export function registerServiceWorker(sw: ServiceWorkerContainer = navigator.serviceWorker): void {
  // Only a page an earlier release was already running is told; the first install claims the page without a word.
  const hadController = !!sw.controller;
  sw.register('/sw.js').then((reg) => {
    warmRegionFiles(sw);
    void reg.update().catch(() => {});
    setInterval(() => { void reg.update().catch(() => {}); }, CHECK_EVERY);
  }).catch(() => {
    // Registers on the next visit; the app still works online without it.
  });
  sw.addEventListener('controllerchange', () => {
    if (hadController) showUpdateBanner();
  });
}
