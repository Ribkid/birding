// Stats page: life list growth, months, calendar heatmap, places.
import { byId, SPECIES, KINDS, kindsPresent } from './species.js';
import { MONTHS } from './stats.js';

export function renderStats(ctx) {
  const { view, esc, icon, state, fmtDate, plural } = ctx;
  const S = state.sightings.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const now = new Date();
  const year = String(now.getFullYear());

  // cumulative life list
  const seen = new Set(); const growth = [];
  for (const s of S) { if (!seen.has(s.speciesId)) { seen.add(s.speciesId); growth.push([s.date, seen.size]); } }
  // species per month this year
  const perMonth = Array.from({ length: 12 }, () => new Set());
  S.filter(s => s.date.startsWith(year)).forEach(s => perMonth[Number(s.date.slice(5, 7)) - 1].add(s.speciesId));
  // per day
  const perDay = new Map();
  S.forEach(s => { if (!perDay.has(s.date)) perDay.set(s.date, new Set()); perDay.get(s.date).add(s.speciesId); });
  const bestDay = [...perDay.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  // places
  const places = new Map();
  S.forEach(s => { const k = (s.place || '').trim(); if (!k) return; if (!places.has(k)) places.set(k, new Set()); places.get(k).add(s.speciesId); });
  const topPlaces = [...places.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const individuals = S.reduce((n, s) => n + (Number(s.count) || 0), 0);
  // most seen
  const freq = new Map(); S.forEach(s => freq.set(s.speciesId, (freq.get(s.speciesId) || 0) + 1));
  const topBirds = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  view.innerHTML = `
    <header class="page-head page-head--back"><a class="iconbtn" href="#/lists" aria-label="Back to lists">${icon.back}</a><h1>Stats</h1></header>
    <div class="statgrid">
      <div><b>${seen.size}</b><span>species</span></div>
      <div><b>${S.length}</b><span>sightings</span></div>
      <div><b>${individuals.toLocaleString('en-AU')}</b><span>individuals counted</span></div>
      <div><b>${perDay.size}</b><span>days out</span></div>
    </div>
    ${S.length ? '' : '<p class="empty-inline pad-x">Charts appear here once there are a few sightings.</p>'}
    <section class="block"><h2 class="h2">Life list growth</h2>${growthChart(growth)}</section>
    <section class="block"><h2 class="h2">Species each month in ${year}</h2>${monthBars(perMonth.map(s => s.size), now.getMonth())}</section>
    <section class="block"><h2 class="h2">Days out</h2><p class="small muted">The last 26 weeks. Darker squares mean more species that day.</p>${heatmap(perDay, now)}
      ${bestDay ? `<p class="small">Best day: <strong>${bestDay[1].size} species</strong> on ${fmtDate(bestDay[0])}.</p>` : ''}</section>
    ${topPlaces.length ? `<section class="block"><h2 class="h2">Top places</h2><ul class="spots">${topPlaces.map(([p, set]) => `<li><span>${esc(p)}</span><span class="num">${set.size}</span></li>`).join('')}</ul></section>` : ''}
    ${topBirds.length ? `<section class="block"><h2 class="h2">Most logged</h2><ul class="spots">${topBirds.map(([id, n]) => `<li><a href="#/bird/${id}">${esc(byId.get(id)?.name)}</a><span class="num">${n}</span></li>`).join('')}</ul></section>` : ''}
    <section class="block"><h2 class="h2">Dex progress by group</h2>${groupBars(ctx, seen)}</section>`;
  view.onclick = null; view.onchange = null;
}

function growthChart(growth) {
  if (growth.length < 2) return '<p class="small muted">Needs sightings on at least two days.</p>';
  const W = 340, H = 150, P = 28;
  const t0 = Date.parse(growth[0][0]), t1 = Math.max(Date.parse(growth[growth.length - 1][0]), t0 + 864e5);
  const max = growth[growth.length - 1][1];
  const x = d => P + (Date.parse(d) - t0) / (t1 - t0) * (W - P - 8);
  const y = n => H - 20 - n / max * (H - 34);
  let d = `M${x(growth[0][0])},${y(0)}`;
  for (const [date, n] of growth) d += ` L${x(date)},${y(n)}`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Life list grew to ${max} species">
    <line x1="${P}" y1="${H - 20}" x2="${W - 8}" y2="${H - 20}" class="axis"/>
    <text x="${P - 6}" y="${y(max) + 4}" text-anchor="end" class="lbl">${max}</text>
    <text x="${P - 6}" y="${H - 16}" text-anchor="end" class="lbl">0</text>
    <path d="${d} L${x(growth[growth.length - 1][0])},${H - 20} L${x(growth[0][0])},${H - 20} Z" class="area"/>
    <path d="${d}" class="line"/>
    <text x="${P}" y="${H - 4}" class="lbl">${short(growth[0][0])}</text>
    <text x="${W - 8}" y="${H - 4}" text-anchor="end" class="lbl">${short(growth[growth.length - 1][0])}</text>
  </svg>`;
}
const short = d => { const [y, m] = d.split('-'); return `${MONTHS[Number(m) - 1].slice(0, 3)} ${y}`; };

function monthBars(vals, cur) {
  const max = Math.max(1, ...vals);
  return `<div class="season season--tall" role="img" aria-label="Species per month">${vals.map((v, i) => `<i class="${i === cur ? 'now' : ''}" style="height:${Math.max(2, v / max * 100)}%" title="${MONTHS[i]}: ${v}"><em>${v || ''}</em></i>`).join('')}</div>
    <div class="season-labels" aria-hidden="true">${[...'JFMAMJJASOND'].map(c => `<span>${c}</span>`).join('')}</div>`;
}

function heatmap(perDay, now) {
  const days = [];
  const end = new Date(now); end.setHours(12);
  const start = new Date(end); start.setDate(start.getDate() - 7 * 26 + 1 - ((end.getDay() + 6) % 7) + 6);
  const startMon = new Date(end); startMon.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 7 * 25);
  const max = Math.max(1, ...[...perDay.values()].map(s => s.size));
  for (let d = new Date(startMon); d <= end; d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = perDay.get(k)?.size || 0;
    days.push(`<i style="--v:${n ? 0.25 + 0.75 * n / max : 0}" title="${k}: ${n} species"></i>`);
  }
  return `<div class="heat" role="img" aria-label="Calendar of days out">${days.join('')}</div>`;
}

// Groups sit under their kind, each kind with its own tally, so 18 bird groups and 26 others don't run together.
function groupBars(ctx, seen) {
  const kinds = kindsPresent.length > 1;
  return kindsPresent.map(k => {
    const all = SPECIES.filter(s => s.kind === k);
    const got = all.filter(s => seen.has(s.id)).length;
    const groups = {};
    for (const s of all) { (groups[s.group] ||= { n: 0, got: 0 }); groups[s.group].n++; if (seen.has(s.id)) groups[s.group].got++; }
    return `<div class="gkind kind--${k}">
      ${kinds ? `<h3 class="gkind-h"><span>${KINDS[k].label}</span><span class="num"><span aria-hidden="true">${got}/${all.length}</span><span class="sr-only">${got} of ${all.length} seen</span></span></h3>` : ''}
      <ul class="gbars">${Object.entries(groups).map(([g, v]) => `<li><span>${ctx.esc(ctx.GROUPS[g])}</span><span class="meter meter--thin" style="--p:${Math.round(v.got / v.n * 100)}%"><span></span></span><span class="num">${v.got}/${v.n}</span></li>`).join('')}</ul></div>`;
  }).join('');
}
