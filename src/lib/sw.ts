// The offline shell's service worker (dist/sw.js, built from scripts/sw-template.js), registered as v1 boot() does
// (birding-refresh js/app.js:3119-3126): checked for a new release at start and every 30 minutes, and when a new
// release takes over a page that an earlier one was running, "A new version is ready." with Reload (v1 app.js:3009).

const CHECK_EVERY = 30 * 60 * 1000;

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
    void reg.update().catch(() => {});
    setInterval(() => { void reg.update().catch(() => {}); }, CHECK_EVERY);
  }).catch(() => {
    // Registers on the next visit; the app still works online without it.
  });
  sw.addEventListener('controllerchange', () => {
    if (hadController) showUpdateBanner();
  });
}
