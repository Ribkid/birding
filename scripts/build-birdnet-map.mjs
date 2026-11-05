// node scripts/build-birdnet-map.mjs [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { formatJSON } from './build-gallery.mjs';

const ROOT = new URL('../', import.meta.url);
const normalize = s => s.toLowerCase().replace(/grey/g, 'gray').replace(/[\s\-'’ʼ‐‑–]/gu, '');
const GENERA = [
  ['Chalcites', 'Chrysococcyx'], ['Tachyspiza', 'Accipiter'], ['Zapornia', 'Porzana'],
  ['Poodytes', 'Megalurus'], ['Ptilotula', 'Lichenostomus'], ['Nesoptilotis', 'Lichenostomus'],
  ['Gavicalis', 'Lichenostomus'], ['Spatula', 'Anas'], ['Heteroscenes', 'Cacomantis'],
  ['Parvipsitta', 'Glossopsitta'], ['Thinornis', 'Charadrius'], ['Antigone', 'Grus'],
  ['Zanda', 'Calyptorhynchus'],
];
// Gender agreement changes along with these genera.
const ALIASES = {
  'Tachyspiza fasciata': ['Accipiter fasciatus'],
  'Tachyspiza cirrocephala': ['Accipiter cirrocephalus'],
  'Zanda funerea': ['Calyptorhynchus funereus'],
};

function scientificNames(name) {
  const [genus, ...rest] = name.split(/\s+/);
  return [name, ...(ALIASES[name] || []), ...Object.entries(ALIASES).filter(([, names]) => names.includes(name)).map(([n]) => n),
    ...GENERA.filter(pair => pair.includes(genus)).flatMap(pair => pair.filter(g => g !== genus).map(g => `${g} ${rest.join(' ')}`))];
}

export function extendMap(existing, lines, birds) {
  const map = { ...existing }, covered = new Set(Object.values(existing).map(Number));
  const labels = lines.map((line, index) => {
    const split = line.indexOf('_');
    return split < 0 ? null : { index, sci: normalize(line.slice(0, split)), name: normalize(line.slice(split + 1).trim()) };
  }).filter(Boolean);
  const added = [], unmatched = [];
  for (const bird of birds) {
    if (covered.has(bird.id)) continue;
    const names = scientificNames(bird.sci).map(normalize);
    // Exact science first; aliases next; common name last. Never claim an occupied index.
    let match;
    for (const name of names) {
      match = labels.find(l => l.sci === name && !Object.hasOwn(map, l.index));
      if (match) break;
    }
    match ||= labels.find(l => l.name === normalize(bird.name) && !Object.hasOwn(map, l.index));
    if (!match) { unmatched.push(bird); continue; }
    map[match.index] = bird.id;
    covered.add(bird.id);
    added.push({ bird, index: match.index });
  }
  return { map, added, unmatched };
}

export async function build(args = process.argv.slice(2)) {
  if (args.some(a => a !== '--dry-run')) throw new Error('Usage: node scripts/build-birdnet-map.mjs [--dry-run]');
  const dryRun = args.includes('--dry-run');
  const file = new URL('public/data/birdnet-map.json', ROOT);
  const original = await readFile(file, 'utf8');
  const labels = (await readFile(new URL('public/models/birdnet/labels/en_us.txt', ROOT), 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/);
  const { ALL_BIRDS } = await import('../src/core/species.js');
  const existing = JSON.parse(original);
  const result = extendMap(existing, labels, ALL_BIRDS);
  for (const { bird, index } of result.added) console.log(`${dryRun ? 'Would add' : 'Add'} ${index} -> ${bird.id} ${bird.name}`);
  console.log(`Kept ${Object.keys(existing).length}; added ${result.added.length}; total ${Object.keys(result.map).length}; unmatched ${result.unmatched.length}`);
  for (const b of result.unmatched) console.log(`Unmatched: ${b.id} ${b.name} (${b.sci})`);
  if (!dryRun && result.added.length) await writeFile(file, formatJSON(result.map, original));
  if (dryRun) console.log('DRY RUN: no files written');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().catch(error => { console.error(`Stopped: ${error.message}`); process.exitCode = 1; });
