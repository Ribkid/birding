// Export sightings in eBird Record Format (19 columns, no header), for upload at
// https://ebird.org/import/upload.form  (choose "eBird Record Format (Extended)").
import { byId } from './species.js';

const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const usDate = d => { const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };

export function toEbirdCsv(sightings, outings) {
  const outingById = new Map(outings.map(o => [o.id, o]));
  const rows = [];
  for (const s of sightings.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const sp = byId.get(s.speciesId);
    if (!sp || sp.kind !== 'bird') continue; // eBird only takes birds
    const [genus, ...rest] = sp.sci.split(' ');
    const o = s.outingId ? outingById.get(s.outingId) : null;
    const lat = o?.lat ?? s.lat, lng = o?.lng ?? s.lng;
    const place = o?.place || s.place || (lat != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Unknown location');
    let protocol = 'Incidental', duration = '', complete = 'N', miles = '';
    if (o) {
      const km = Number(o.distanceKm) || 0;
      protocol = km > 0 ? 'Traveling' : 'Stationary';
      duration = o.durationMin || '';
      complete = o.complete ? 'Y' : 'N';
      miles = km > 0 ? (km * 0.621371).toFixed(2) : '';
    }
    const comments = [s.heard ? 'Heard only.' : '', s.notes || ''].filter(Boolean).join(' ');
    rows.push([
      sp.name, genus, rest.join(' '), s.count ? s.count : 'X', comments,
      place, lat != null ? lat.toFixed(6) : '', lng != null ? lng.toFixed(6) : '',
      usDate(o?.date || s.date), o?.time || s.time || '', 'QLD', 'AU',
      protocol, 1, duration, complete, miles, '', o?.notes || '',
    ].map(esc).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
