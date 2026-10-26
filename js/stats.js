// Lists, patches, targets and badges — all computed from sightings.
import { SPECIES, GROUPS, HABITATS, byId } from './species.js';

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function haversineKm(a, b) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const inPatch = (s, p) => s.lat != null && s.lng != null && haversineKm(s, p) <= p.radiusKm;

// species list (first record per species) for a set of sightings
export function speciesList(sightings) {
  const first = new Map();
  const sorted = sightings.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  for (const s of sorted) {
    if (!first.has(s.speciesId)) first.set(s.speciesId, { first: s, count: 0, total: 0 });
    const e = first.get(s.speciesId);
    e.count++;
    e.total += Number(s.count) || 0;
    e.last = s;
  }
  return first; // Map speciesId -> { first, last, count, total }
}

export function periodFilter(period, now = new Date()) {
  const y = String(now.getFullYear());
  const ym = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (period === 'year') return s => s.date.startsWith(y);
  if (period === 'month') return s => s.date.startsWith(ym);
  if (/^\d{4}$/.test(period)) return s => s.date.startsWith(period);
  return () => true;
}

export function totals(sightings, now = new Date()) {
  return {
    life: speciesList(sightings).size,
    year: speciesList(sightings.filter(periodFilter('year', now))).size,
    month: speciesList(sightings.filter(periodFilter('month', now))).size,
  };
}

export function yearTotals(sightings) {
  const byYear = {};
  for (const s of sightings) (byYear[s.date.slice(0, 4)] ||= []).push(s);
  return Object.entries(byYear).map(([y, list]) => ({ year: y, count: speciesList(list).size }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

// Is a species likely around in a given month (1-12)?
export function inSeason(sp, month) {
  if (sp.season === 's') return month >= 9 || month <= 4;   // Sep–Apr
  if (sp.season === 'w') return month >= 4 && month <= 9;   // Apr–Sep
  return true;
}

// Targets: unseen birds most likely to be found this month, optionally in one habitat.
// With regional data, `score(id, month)` ranks by how often the bird is reported that month.
export function targets({ seen, month, habitat, score, rel }) {
  return SPECIES
    .filter(sp => !seen.has(sp.id) && (!habitat || sp.habitats.includes(habitat)))
    .filter(sp => rel ? (rel(sp.id, month) ?? (inSeason(sp, month) ? 1 : 0)) >= 0.2 : inSeason(sp, month))
    .sort((a, b) => score
      ? (score(b.id, month) - score(a.id, month)) || a.rarity - b.rarity
      : a.rarity - b.rarity || (b.season ? 1 : 0) - (a.season ? 1 : 0) || a.id - b.id);
}

// ---------- Badges ----------
const placeKey = s => s.lat != null ? `${s.lat.toFixed(2)},${s.lng.toFixed(2)}` : (s.place || '').trim().toLowerCase();

export function badges(sightings, outings) {
  const life = speciesList(sightings);
  const seen = new Set(life.keys());
  const seenSp = [...seen].map(id => byId.get(id)).filter(Boolean);
  const n = seen.size;
  const days = new Set(sightings.map(s => s.date));
  const places = new Set(sightings.map(placeKey).filter(Boolean));
  const photoSpecies = new Set(sightings.filter(s => s.photoId).map(s => s.speciesId));
  const perDay = {};
  sightings.forEach(s => (perDay[s.date] ||= new Set()).add(s.speciesId));
  const bestDay = Math.max(0, ...Object.values(perDay).map(x => x.size));
  const perYear = {};
  sightings.forEach(s => (perYear[s.date.slice(0, 4)] ||= new Set()).add(s.speciesId));
  const bestYear = Math.max(0, ...Object.values(perYear).map(x => x.size));
  const count = fn => seenSp.filter(fn).length;
  const early = sightings.some(s => s.time && s.time < '06:00');
  const completeOutings = outings.filter(o => o.endedAt).length;

  const list = [];
  const add = (id, name, desc, have, need, kind = 'milestone') =>
    list.push({ id, name, desc, have: Math.min(have, need), need, done: have >= need, kind });

  // Species milestones
  add('first', 'First tick', 'Log your first bird', n, 1);
  add('n10', 'Ten up', 'See 10 species', n, 10);
  add('n25', 'Quarter century', 'See 25 species', n, 25);
  add('n50', 'Half century', 'See 50 species', n, 50);
  add('n100', 'The ton', 'See 100 species', n, 100);
  add('nall', 'Full dex', `See all ${SPECIES.length} species`, n, SPECIES.length);
  add('bigyear', 'Big year', 'See 100 species in one calendar year', bestYear, 100);
  add('bigday', 'Big day', 'See 20 species in a single day', bestDay, 20);
  add('bigday40', 'Monster day', 'See 40 species in a single day', bestDay, 40);

  // Rarity
  add('scarce', 'Lucky find', 'See a scarce species', count(s => s.rarity >= 4), 1, 'rarity');
  add('rare', 'Rare bird', 'See a rare species', count(s => s.rarity === 5), 1, 'rarity');
  add('hunter', 'Rarity hunter', 'See 10 scarce or rare species', count(s => s.rarity >= 4), 10, 'rarity');

  // Habits
  add('photo', 'Snapshot', 'Add a photo to a sighting', photoSpecies.size, 1, 'habit');
  add('photo25', 'Portfolio', 'Photograph 25 different species', photoSpecies.size, 25, 'habit');
  add('days7', 'Regular', 'Go birding on 7 different days', days.size, 7, 'habit');
  add('days30', 'Devoted', 'Go birding on 30 different days', days.size, 30, 'habit');
  add('places5', 'Wanderer', 'Log birds at 5 different places', places.size, 5, 'habit');
  add('places20', 'Explorer', 'Log birds at 20 different places', places.size, 20, 'habit');
  add('outings10', 'Checklist habit', 'Finish 10 outings', completeOutings, 10, 'habit');
  add('early', 'Dawn chorus', 'Log a bird before 6 am', early ? 1 : 0, 1, 'habit');
  add('night', 'Night shift', 'See a bird that is active at night', count(s => s.nocturnal), 1, 'habit');
  add('night5', 'Night owl', 'See 5 night-active species', count(s => s.nocturnal), 5, 'habit');
  add('migrants', 'Summer arrivals', 'See 10 spring–summer visitors', count(s => s.season === 's'), 10, 'habit');

  // Habitats
  for (const [code, label] of Object.entries(HABITATS)) {
    add(`hab-${code}`, label, `See 10 species of ${label.toLowerCase()}`, count(s => s.habitats.includes(code)), 10, 'habitat');
  }

  // Groups: see every species in a group
  for (const [g, label] of Object.entries(GROUPS)) {
    const total = SPECIES.filter(s => s.group === g).length;
    add(`grp-${g}`, label, `See all ${total} ${label.toLowerCase()}`, count(s => s.group === g), total, 'group');
  }
  return list;
}
