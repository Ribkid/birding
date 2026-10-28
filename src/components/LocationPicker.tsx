import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../core/db.js';
import { getLastPos } from '../lib/lastPos';
import { closeLayer, openLayer, type Layer } from '../lib/layers';
import { localPlaceMatches, myPlaces, nearestPlaceName, reverseGeocode, searchAddress, type PlaceHit } from '../lib/places';
import { ensureSeq } from '../lib/seq';
import { useOutingRows, usePatches, useSightingRows } from '../screens/lists/shared';
import { Icon } from './Icon';

export interface PickedPlace { lat: number; lng: number; place: string }

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_REF_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const close = <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />;

/**
 * v1's openLocationPicker (js/app.js:399): a full-screen map to pick a spot by searching or moving the map under a
 * fixed pin. It is a layer over the sheet that opened it, so Escape closes only the picker. onDone gets
 * {lat, lng, place}, or null when she cancels.
 */
export function LocationPicker({ init, onDone }: { init: { lat?: number | null; lng?: number | null; place?: string }; onDone: (r: PickedPlace | null) => void }) {
  const ovRef = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<Layer | null>(null);
  const closedRef = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const patches = usePatches();
  const sightings = useSightingRows();
  const outings = useOutingRows();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PlaceHit[]>([]);
  const [more, setMore] = useState('');
  const [name, setName] = useState(init.place || '');
  const [nameTouched, setNameTouched] = useState(!!init.place);
  const [layer, setLayer] = useState<'map' | 'sat'>('map');
  const [lift, setLift] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  // Bumped by every query and by picking a result, so a search still in flight cannot reopen the list.
  const seq = useRef(0);
  const live = useRef({ patches, sightings, outings });
  live.current = { patches, sightings, outings };

  const finish = (val: PickedPlace | null, reason?: string) => {
    if (closedRef.current) return;
    closedRef.current = true;
    const l = layerRef.current;
    layerRef.current = null;
    if (l) closeLayer(l, { restore: reason !== 'nav' });
    doneRef.current(val);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // The layer and the map.
  useEffect(() => {
    const ov = ovRef.current, el = mapEl.current;
    if (!ov || !el) return;
    closedRef.current = false;
    const l = openLayer(ov, { label: 'Choose a place', close: (reason) => finishRef.current(null, reason) });
    layerRef.current = l;
    ov.focus({ preventScroll: true });
    ensureSeq();
    // With no spot yet, it starts where she last was found (Targets' Near me, Listen), as v1's state.lastPos did.
    const had = init.lat != null && init.lng != null;
    const last = had ? null : getLastPos();
    const start: L.LatLngTuple = had ? [init.lat as number, init.lng as number] : last ? [last.lat, last.lng] : [-27.47, 153.02];
    const map = L.map(el, { zoomControl: false }).setView(start, had || last ? 15 : 10);
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const t = window.setTimeout(() => map.invalidateSize(), 50);
    // The pin lifts while the map moves under it and drops onto the spot when it stops.
    map.on('movestart', () => setLift(true));
    map.on('moveend', () => setLift(false));
    // On a phone the main path is dragging the map, so don't pop the keyboard over it.
    if (!matchMedia('(pointer: coarse)').matches && (document.activeElement === ov || document.activeElement === document.body)) qRef.current?.focus();
    return () => {
      clearTimeout(t);
      clearTimeout(timer.current);
      map.remove();
      mapRef.current = null;
      if (layerRef.current === l) { closeLayer(l, { restore: false }); layerRef.current = null; }
    };
    // init is read once, as v1 did when the picker opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map or satellite, shared with the Map screen through settings.mapLayer.
  const tiles = useRef<{ osm: L.TileLayer; sat: L.LayerGroup } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!tiles.current) {
      tiles.current = {
        osm: L.tileLayer(OSM_URL, { maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
        sat: L.layerGroup([
          L.tileLayer(SAT_URL, { maxZoom: 19, maxNativeZoom: 19, crossOrigin: true, attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics and the GIS User Community' }),
          L.tileLayer(SAT_REF_URL, { maxZoom: 19, crossOrigin: true, opacity: 0.9 }),
        ]),
      };
    }
    const { osm, sat } = tiles.current;
    if (layer === 'sat') { map.removeLayer(osm); sat.addTo(map); } else { map.removeLayer(sat); osm.addTo(map); }
    map.getContainer().classList.toggle('map--sat', layer === 'sat');
  }, [layer]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(db.kvGet('settings')).then((s: unknown) => {
      if (alive && (s as { mapLayer?: string } | null)?.mapLayer === 'sat') setLayer('sat');
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const pickLayer = (next: 'map' | 'sat') => {
    setLayer(next);
    void (async () => {
      const current = ((await db.kvGet('settings')) as Record<string, unknown> | null) || {};
      await db.kvSet('settings', { ...current, mapLayer: next });
    })().catch(() => {});
  };

  const local = (text: string) => {
    const { patches: p, sightings: s, outings: o } = live.current;
    return localPlaceMatches(text, p, myPlaces(s, o));
  };
  const show = (list: PlaceHit[], note = '') => { setFound(list); setMore(note); };
  const run = async (text: string) => {
    const n = seq.current;
    const mine = local(text);
    if (text.length < 3) { show(mine); return; }
    show(mine, 'Searching places…');
    try {
      const remote = await searchAddress(text);
      if (seq.current !== n || qRef.current?.value.trim() !== text) return;
      show([...mine, ...remote], remote.length || mine.length ? '' : 'No places found. Try a suburb or park name.');
    } catch (err) {
      if (seq.current !== n) return;
      show(mine, err instanceof Error ? err.message : 'Place search is busy. Try again in a moment.');
    }
  };
  const onQuery = (value: string) => {
    setQ(value);
    seq.current++;
    clearTimeout(timer.current);
    show(local(value.trim()));
    timer.current = window.setTimeout(() => void run(value.trim()), 700);
  };
  const choose = (p: PlaceHit) => {
    seq.current++;
    clearTimeout(timer.current);
    mapRef.current?.setView([p.lat, p.lng], 16);
    setName(p.name); setNameTouched(true);
    show([]);
    qRef.current?.blur();
  };
  const use = async () => {
    const map = mapRef.current;
    if (!map || busy) return;
    const c = map.getCenter();
    let place = name.trim();
    if (!place || !nameTouched) {
      setBusy(true);
      const { patches: p, sightings: s } = live.current;
      place = nearestPlaceName({ lat: c.lat, lng: c.lng }, p, s) || await reverseGeocode({ lat: c.lat, lng: c.lng }) || place;
    }
    finish({ lat: c.lat, lng: c.lng, place });
  };

  const open = found.length > 0 || !!more;
  return createPortal(
    <div ref={ovRef} className="locpick">
      <div className="locpick-top">
        <div className="search-bar search-bar--map">
          <Icon name="search" />
          <input ref={qRef} type="search" placeholder="Search a park, suburb or address" aria-label="Search for a place" autoComplete="off" data-lq="" value={q}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer.current); seq.current++; void run(q.trim()); } }} />
          <button type="button" className="iconbtn" data-lclose="" aria-label="Cancel" onClick={() => finish(null)}><svg viewBox="0 0 24 24" aria-hidden="true">{close}</svg></button>
        </div>
        <ul className={`rows locpick-res${open ? '' : ' hidden'}`} data-lres="">
          {found.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button type="button" className="row" data-placeidx={i} onClick={() => choose(p)}>
                <span className="row-main"><strong>{p.name}</strong><span className="small muted">{p.kind}</span></span>
              </button>
            </li>
          ))}
          {more && <li className="small muted pad">{more}</li>}
        </ul>
      </div>
      <div className="locpick-mapwrap">
        <div ref={mapEl} className="locpick-map" data-lmap="" />
        <div className="locpick-dot" aria-hidden="true" />
        <div className={`locpick-pin${lift ? ' locpick-pin--lift' : ''}`} aria-hidden="true"><Icon name="pin" /></div>
        <div className="layer-toggle" role="group" aria-label="Map style">
          <button type="button" data-layer="map" aria-pressed={layer === 'map'} onClick={() => pickLayer('map')}>Map</button>
          <button type="button" data-layer="sat" aria-pressed={layer === 'sat'} onClick={() => pickLayer('sat')}>Satellite</button>
        </div>
      </div>
      <div className="locpick-bottom">
        <p className="small muted">Move the map so the pin sits on the spot, or search above.</p>
        <label className="field"><span>Place name</span>
          <input data-lname="" value={name} placeholder="e.g. Oxley Creek Common" autoComplete="off" onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
        </label>
        <div className="row-end">
          <button type="button" className="btn" data-lclose="" onClick={() => finish(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" data-luse="" onClick={() => void use()}>Use this place</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
