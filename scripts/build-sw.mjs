// Writes dist/sw.js from scripts/sw-template.js, with the build time as its version and the list of
// files to precache at install (the shell).
//
// The shell is every built file with a SHELL_EXT extension outside /data/, /models/, /vendor/ and
// /photos/ (the page, the hashed /assets/, /js/, fonts, icons, privacy and terms), plus EXTRA_SHELL:
// the /data/ files the app needs on a cold start offline, the photo model's manifest and the Supabase
// client. Everything else is saved on first use (scripts/sw-template.js has the full map):
//   - the photo model's .bin parts bypass the service worker; src/core/photoid.js joins them into
//     'birddex-models'
//   - BirdNET files and the other /vendor libraries go to 'birddex-models'
//   - call clips (/data/calls/) go to 'birddex-calls' when played or saved from Settings
//   - /photos/ and other same-origin images go to 'birdydex-photos-v3'
//   - Wikimedia photos go to 'birddex-images', map tiles to 'birddex-tiles'
//   - Commons recordings bypass the service worker; src/core/media.js keeps them in 'birddex-audio'
//
// Run after `vite build` (npm run build does). No dependencies.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, extname, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHELL_EXT = new Set(['.html', '.js', '.css', '.woff2', '.svg', '.png', '.webmanifest']);

/** Folders kept at runtime rather than at install, apart from the EXTRA_SHELL files in them. */
const RUNTIME_ONLY = ['vendor/', 'photos/'];

/**
 * Files precached although their folder or type is not part of the shell: the data the app needs on
 * a cold start offline, the photo model's manifest and the Supabase client. Call clips stay on the
 * calls route.
 */
const EXTRA_SHELL = new Set([
  '/data/species-new.json', '/data/tiers.json', '/data/info.json', '/data/gallery.json',
  '/data/seq.json', '/data/birdnet-map.json', '/data/lookalikes.json', '/data/calls.json',
  '/data/photoid.json', '/data/photoid.bin', '/data/spot-access.json',
  '/models/bioclip/manifest.json',
  // Saved with each release, as in v1, so a signed-in phone still loads it offline after an update.
  '/vendor/supabase/supabase.js',
]);
// The 93 MB int4 vision model (the two .bin parts) is deliberately NOT precached: src/core/photoid.js
// downloads it on demand with progress and stores the joined model in 'birddex-models'. Precaching it
// here too would download it before first use and keep a second 93 MB copy on the phone.

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = await walk(DIST);
const shell = [];
let bytes = 0;

for (const file of files) {
  const rel = relative(DIST, file).split(sep).join('/');
  const url = '/' + rel;
  if (rel === 'sw.js') continue;
  if (RUNTIME_ONLY.some((prefix) => rel.startsWith(prefix)) && !EXTRA_SHELL.has(url)) continue;
  if ((rel.startsWith('data/') || rel.startsWith('models/')) && !EXTRA_SHELL.has(url)) continue;
  if (!SHELL_EXT.has(extname(rel)) && !EXTRA_SHELL.has(url)) continue;
  shell.push(url);
  bytes += (await stat(file)).size;
}

// sw-template.js saves this one under the address src/core/listen.js asks for (with its query).
if (!shell.includes('/js/birdnet-worker.js')) console.warn('build-sw: /js/birdnet-worker.js is missing, so Listen will not start offline');

const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8');
const sw = template
  .replace('__VERSION__', JSON.stringify(new Date().toISOString()))
  .replace('__PRECACHE__', JSON.stringify(shell, null, 2));

await writeFile(join(DIST, 'sw.js'), sw);
console.log(`sw.js: ${shell.length} shell files precached (${(bytes / 1024).toFixed(0)} KB)`);
