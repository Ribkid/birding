// Offline smoke test for the production build.
//   node scripts/offline-check.mjs warm     # load once, wait for the service worker
//   node scripts/offline-check.mjs offline  # same profile, server expected to be DOWN
//   add --region=<code> to warm that region (saved before the app boots); the default is the one the profile has.
//   A region not yet launched (melb) can only be picked in a dev build, so a production check stays on SEQ.
//
// Uses the Playwright Chromium that is already installed on this machine.
import { chromium } from 'file:///C:/Users/Rhys/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/Rhys/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
const PROFILE = 'C:/Users/Rhys/AppData/Local/Temp/opencode/birdy-offline-profile';
const URL = 'http://localhost:5173/#/stats';
const mode = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || 'warm';
const region = process.argv.find((arg) => arg.startsWith('--region='))?.slice('--region='.length) || null;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EXE,
  headless: true,
  args: ['--no-first-run', '--disable-extensions'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
// src/regions/index.js reads the region before anything renders, so it is saved before any page script runs.
if (region) await page.addInitScript((code) => localStorage.setItem('birddex-region', code), region);
const errors = [];
const failed = [];
const warns = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') warns.push(m.text().slice(0, 200));
});
page.on('requestfailed', (r) => failed.push(r.url().replace('http://localhost:5173', '') + ' ' + (r.failure()?.errorText || '')));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

  if (mode === 'warm') {
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const keys = await caches.keys();
      const shell = keys.find((k) => k.startsWith('birdydex-shell-'));
      const n = shell ? (await (await caches.open(shell)).keys()).length : 0;
      // The region's files live in the runtime cache, saved when the app asks for them at boot (src/lib/sw.ts).
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const code = localStorage.getItem('birddex-region') || 'seq';
      const runtime = await caches.open('birdydex-runtime-v3');
      const regionFiles = (await runtime.keys()).map((req) => new URL(req.url).pathname).filter((path) => path.startsWith(`/data/regions/${code}/`));
      return { sw: reg?.active?.state ?? 'none', shellFiles: n, region: code, regionFiles, keys };
    });
    console.log(JSON.stringify({ mode, ...state, errors, warns, failed }, null, 2));
  } else {
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({
      controlled: !!navigator.serviceWorker?.controller,
      root: (document.getElementById('root')?.innerHTML || '').slice(0, 160),
      body: document.body.innerHTML.slice(0, 200),
      view: (document.querySelector('#view')?.innerText || '').trim().slice(0, 120),
      scripts: [...document.scripts].map((s) => s.src),
    }));
    console.log(
      JSON.stringify(
        { mode, ...info, rendered: info.view.length > 30, errors, warns, failed },
        null,
        2,
      ),
    );
  }
} finally {
  await ctx.close();
}
