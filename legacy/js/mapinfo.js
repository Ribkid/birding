// A short description of a place on the map: what it is, a line from Wikipedia when there's a
// matching article nearby, and what birds are recorded there (Atlas of Living Australia data).
import { byId, GROUPS, RARITY } from './species.js';
import { hotspots } from './seqdata.js';
import { haversineKm } from './stats.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cache = new Map();
const STOP = new Set(['the', 'and', 'park', 'reserve', 'road', 'rd', 'lane', 'track', 'creek', 'conservation', 'area', 'national', 'section', 'wetlands', 'wetland', 'lake', 'some', 'areas', 'restricted', 'access', 'of', 'at', 'point', 'north', 'south', 'east', 'west', 'mount', 'mt']);
const words = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);

// OpenStreetMap: what kind of place this is and which suburb (one request, about 1 a second at most).
let last = 0;
async function osm(lat, lng) {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&extratags=1&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en-AU' } });
  if (!r.ok) return null;
  const j = await r.json();
  const a = j.address || {};
  const kind = ({ nature_reserve: 'Nature reserve', park: 'Park', wetland: 'Wetland', wood: 'Woodland', forest: 'Forest', beach: 'Beach', water: 'Water body', reservoir: 'Reservoir', golf_course: 'Golf course', recreation_ground: 'Sports ground', protected_area: 'Protected area', national_park: 'National park', scrub: 'Bushland', grassland: 'Grassland', heath: 'Heath', mangrove: 'Mangroves', bay: 'Bay', cemetery: 'Cemetery', residential: 'Suburban streets', farmland: 'Farmland', meadow: 'Paddocks' })[j.type] || null;
  return {
    name: j.name || a.park || a.nature_reserve || a.leisure || a.natural || null,
    kind,
    area: a.suburb || a.town || a.village || a.city_district || a.city || a.county || '',
    osm: j.osm_type && j.osm_id ? `https://www.openstreetmap.org/${j.osm_type}/${j.osm_id}` : null,
  };
}

// Wikipedia: the first sentence of a nearby article whose title matches the place name.
async function wiki(lat, lng, name) {
  const want = words(name).filter(w => !STOP.has(w));
  if (!want.length) return null;
  const g = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&list=geosearch&gscoord=${lat}|${lng}&gsradius=2000&gslimit=15`).then(r => r.json()).catch(() => null);
  const hit = (g?.query?.geosearch || []).find(p => { const t = words(p.title); return want.some(w => t.includes(w)); });
  if (!hit) return null;
  const e = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exsentences=2&pageids=${hit.pageid}`).then(r => r.json()).catch(() => null);
  const pg = e?.query?.pages?.[0];
  if (!pg?.extract) return null;
  const text = pg.extract.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return { text: text.length > 260 ? text.slice(0, 257).replace(/\s\S*$/, '') + '…' : text, url: pg.fullurl, title: pg.title };
}

// What the birding is like, from the hotspot's records.
function birding(h, seen) {
  const ids = h.sp.map(([id]) => id);
  // Which groups are best represented here, relative to how many SEQ species each group has.
  const byGroup = {}, groupSize = {};
  for (const sp of byId.values()) groupSize[sp.group] = (groupSize[sp.group] || 0) + 1;
  ids.forEach(id => { const g = byId.get(id)?.group; if (g) byGroup[g] = (byGroup[g] || 0) + 1; });
  const groups = Object.entries(byGroup).filter(([g, n]) => groupSize[g] >= 5 && n >= 4)
    .sort((a, b) => b[1] / groupSize[b[0]] - a[1] / groupSize[a[0]]).slice(0, 2).map(([g]) => GROUPS[g].toLowerCase());
  const special = ids.map(id => byId.get(id)).filter(sp => sp && sp.rarity >= 4).slice(0, 2);
  const need = ids.filter(id => !seen.has(id)).length;
  return `${h.rich} bird species recorded${groups.length ? `, especially ${groups.join(' and ')}` : ''}.`
    + (special.length ? ` Look out for ${special.map(sp => `the <a href="#/bird/${sp.id}">${esc(sp.name)}</a> (${RARITY[sp.rarity].label.toLowerCase()})`).join(' and ')}.` : '')
    + ` ${need ? `${need} would be new for you.` : 'You have seen them all!'}`;
}

// HTML for a place. `hotspot` is optional (a tapped hotspot marker).
export async function describeArea(lat, lng, { hotspot = null, seen = new Set() } = {}) {
  const key = hotspot ? `h:${hotspot.name}` : `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const place = await osm(lat, lng).catch(() => null);
    const name = hotspot?.name || place?.name || '';
    const w = await wiki(lat, lng, name).catch(() => null);
    return { place, w };
  })());
  const { place, w } = await cache.get(key);
  const near = hotspot ? null : hotspots().map(h => ({ h, d: haversineKm({ lat, lng }, h) })).sort((a, b) => a.d - b.d)[0];
  const inHotspot = near && near.d < 0.6 ? near.h : hotspot;
  const title = hotspot?.name || place?.name || place?.area || 'This spot';
  const sub = [place?.kind, place?.area && place.area !== title ? place.area : null].filter(Boolean).join(', ');
  let html = `<span class="pop-h">${esc(title)}</span>${sub ? `<span class="pop-sub">${esc(sub)}</span>` : ''}`;
  if (w) html += `<p class="pop-desc">${esc(w.text)} <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a></p>`;
  if (inHotspot) html += `<p class="pop-desc">${!hotspot && inHotspot.name !== title ? `Part of the <strong>${esc(inHotspot.name)}</strong> birding hotspot. ` : ''}${birding(inHotspot, seen)}</p>`;
  else if (near) html += `<p class="pop-desc">Nearest birding hotspot: <strong>${esc(near.h.name)}</strong>, ${near.d < 10 ? near.d.toFixed(1) : Math.round(near.d)} km away (${near.h.rich} species).</p>`;
  if (!w && !inHotspot && !near) html += '<p class="pop-desc">No details for this spot yet.</p>';
  html += `<p class="pop-src">Place details © OpenStreetMap contributors${inHotspot ? '; bird records from the Atlas of Living Australia' : ''}.</p>`;
  return html;
}
