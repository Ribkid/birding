// Generates dist/sw.js with a precache list of the built shell.
//
// The shell is small (HTML, JS, CSS, fonts, icons); everything heavy is cached at runtime:
//   - the BioCLIP / BirdNET model files are managed by the app itself (js cache 'birddex-models')
//   - /data/*.json and gallery photos are cached on first use
//
// Run after `vite build`. No dependencies.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, extname, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHELL_EXT = new Set(['.html', '.js', '.css', '.woff2', '.svg', '.png', '.webmanifest']);

/** Directories that are cached on demand rather than at install time. */
const RUNTIME_ONLY = ['vendor/', 'photos/'];

/** Data and model files the app needs on a cold start offline. Call clips stay on the calls route. */
const EXTRA_SHELL = new Set([
  '/data/species-new.json', '/data/tiers.json', '/data/info.json', '/data/gallery.json',
  '/data/seq.json', '/data/birdnet-map.json', '/data/lookalikes.json', '/data/calls.json',
  '/data/photoid.json', '/data/photoid.bin',
  '/models/bioclip/manifest.json', '/models/bioclip/vision-int4.part1.bin', '/models/bioclip/vision-int4.part2.bin',
]);

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
  if (RUNTIME_ONLY.some((prefix) => rel.startsWith(prefix))) continue;
  if ((rel.startsWith('data/') || rel.startsWith('models/')) && !EXTRA_SHELL.has(url)) continue;
  if (!SHELL_EXT.has(extname(rel)) && !EXTRA_SHELL.has(url)) continue;
  shell.push(url);
  bytes += (await stat(file)).size;
}

const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8');
const sw = template
  .replace('__VERSION__', JSON.stringify(new Date().toISOString()))
  .replace('__PRECACHE__', JSON.stringify(shell, null, 2));

await writeFile(join(DIST, 'sw.js'), sw);
console.log(`sw.js: ${shell.length} shell files precached (${(bytes / 1024).toFixed(0)} KB)`);
