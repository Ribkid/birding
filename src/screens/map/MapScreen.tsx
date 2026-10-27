// Map screen: a port of v1 `renderMap` (legacy/js/app.js line 1433).
//
// The Leaflet instance is created and destroyed inside an effect. `MapScreen` keys the
// view on the route so moving between /map, /map/sp/:id and /map/at/:lat,:lng tears the
// old map down before a new one is built.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';

import { KINDS, SPECIES, byId, dexCode, type Species } from '../../lib/data';
import { useOutings, useSeen, useSightings, type Outing, type Sighting } from '../../lib/hooks';
import { db } from '../../core/db.js';
import { hotspots, loadSeq, pointsFor } from '../../core/seqdata.js';
import { describeArea } from '../../core/mapinfo.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Show = 'all' | 'photos' | 'none';
type Layer = 'map' | 'sat';
type MapSighting = Sighting & { place?: string; photoId?: number | null };
type MapOuting = Outing & { lat?: number | null; lng?: number | null };

interface Patch {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

interface Hotspot {
  name: string;
  lat: number;
  lng: number;
  rich: number;
  sp: [number, number][];
}

interface HotspotView {
  h: Hotspot;
  got: number;
  needAll: Species[];
  need: Species[];
}

interface SightingGroup {
  key: string;
  lat: number;
  lng: number;
  items: MapSighting[];
  names: Species[];
}

interface BirdResult {
  bird: number;
  name: string;
  kind: string;
}

interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  zoom?: number;
}

type SearchResult = BirdResult | PlaceResult;
type SearchStatus = 'idle' | 'pending' | 'searching' | 'empty' | 'error';

interface Note {
  key: string;
  html: string;
  lat?: number;
  lng?: number;
}

interface Settings {
  mapLayer?: string;
  [key: string]: unknown;
}

interface NominatimRow {
  name?: string;
  display_name?: string;
  lat: string;
  lon: string;
}

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

// The SEQ viewbox v1 used for address searches and for the map's home view.
const SEQ_WEST = 151.6;
const SEQ_NORTH = -25.6;
const SEQ_EAST = 153.7;
const SEQ_SOUTH = -28.5;
const SEQ_CENTER: [number, number] = [-27.47, 153.02];
const SEQ_ZOOM = 9;
const SEQ_VIEWBOX = `${SEQ_WEST},${SEQ_NORTH},${SEQ_EAST},${SEQ_SOUTH}`;

// Popups must not open underneath the fixed search bar and filter chips — that hides the close
// button, so the popup cannot be dismissed. Leaflet pans to keep the popup inside this padded
// area (top leaves room for the search bar + chips, bottom for the attribution and tab bar).
const POPUP_OPTS = {
  autoPanPaddingTopLeft: L.point(12, 152),
  autoPanPaddingBottomRight: L.point(12, 96),
};

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_REF_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const cap = (value: string): string => value.replace(/^./, (c) => c.toUpperCase());

const directionsUrl = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The core module is plain JS, so its inferred parameter types are too narrow for the
// optional hotspot/seen arguments documented above `describeArea`.
const describe = describeArea as (
  lat: number,
  lng: number,
  options?: { hotspot?: Hotspot | null; seen?: Set<number> },
) => Promise<string>;

/** v1 `matchSpecies`: every word must appear in name, scientific name or dex number. */
function matchSpecies(q: string, limit = 5): Species[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/);
  const hits: { sp: Species; score: number }[] = [];
  for (const sp of SPECIES) {
    const hay = `${sp.name} ${sp.sci} ${dexCode(sp.id)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const score = sp.name.toLowerCase().startsWith(needle) ? 0 : hay.includes(` ${needle}`) ? 1 : 2;
    hits.push({ sp, score });
  }
  return hits
    .sort((a, b) => a.score - b.score || a.sp.id - b.sp.id)
    .slice(0, limit)
    .map((hit) => hit.sp);
}

/** Places Sarah has already saved on sightings or outings. */
function namedPlaces(sightings: MapSighting[], outings: MapOuting[]): PlaceResult[] {
  const found = new Map<string, PlaceResult>();
  for (const s of sightings) {
    if (s.lat != null && s.lng != null && s.place && !found.has(s.place)) {
      found.set(s.place, { name: s.place, lat: s.lat, lng: s.lng, kind: 'Your place' });
    }
  }
  for (const o of outings) {
    if (o.lat != null && o.lng != null && o.place && !found.has(o.place)) {
      found.set(o.place, { name: o.place, lat: o.lat, lng: o.lng, kind: 'Your place' });
    }
  }
  return [...found.values()];
}

function localPlaceMatches(
  text: string,
  patches: Patch[],
  places: PlaceResult[],
  hotspotRows: Hotspot[],
  limit = 8,
): PlaceResult[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (name: string) => words.every((w) => name.toLowerCase().includes(w));
  return [
    ...patches
      .filter((p) => hit(p.name))
      .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, kind: 'Your patch' })),
    ...places.filter((p) => hit(p.name)),
    ...hotspotRows
      .filter((h) => hit(h.name))
      .map((h) => ({ name: h.name, lat: h.lat, lng: h.lng, kind: `Hotspot, ${h.rich} species` })),
  ].slice(0, limit);
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Nominatim asks for at most one request a second. The timestamp is shared across
// mounts so a quick route change cannot hammer it.
let lastGeocodeAt = 0;

async function searchAddress(q: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const wait = 1100 - (Date.now() - lastGeocodeAt);
  if (wait > 0) await abortableSleep(wait, signal);
  lastGeocodeAt = Date.now();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('countrycodes', 'au');
  url.searchParams.set('viewbox', SEQ_VIEWBOX);
  url.searchParams.set('bounded', '1');
  url.searchParams.set('q', q);

  const response = await fetch(url.toString(), {
    headers: { 'Accept-Language': 'en-AU' },
    signal,
  });
  if (!response.ok) throw new Error('Place search is busy. Try again in a moment.');

  const rows = (await response.json()) as NominatimRow[];
  return rows
    .map((row) => {
      const parts = (row.display_name ?? '').split(',');
      return {
        name: row.name || parts[0] || q,
        lat: Number(row.lat),
        lng: Number(row.lon),
        kind: parts.slice(1, 3).join(',').trim() || 'Place',
      };
    })
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
}

/** Patches, kept fresh when the database changes. There is no shared hook for these. */
function usePatches(): Patch[] {
  const [rows, setRows] = useState<Patch[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = (await db.all('patches')) as Patch[];
      if (alive) setRows(all);
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'patches') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

const tempPinIcon = () =>
  L.divIcon({
    className: 'map-temp-pin',
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface RouteTarget {
  speciesId: number | null;
  atLat: number | null;
  atLng: number | null;
}

const toNumber = (value: string | undefined): number | null => {
  if (value == null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Works out which target a map URL points at. react-router v7 no longer matches two
 * params inside one segment, so `/map/at/:lat,:lng` (the v1 URL) is also read straight
 * from the pathname. That keeps the screen working whichever pattern the route uses.
 */
function readTarget(pathname: string, params: Readonly<Record<string, string | undefined>>): RouteTarget {
  let speciesId: number | null = null;
  let atLat: number | null = null;
  let atLng: number | null = null;

  const speciesMatch = /^\/map\/sp\/([^/]+)\/?$/.exec(pathname);
  if (speciesMatch) speciesId = toNumber(speciesMatch[1]);

  const atMatch = /^\/map\/at\/([^/]+)\/?$/.exec(pathname);
  if (atMatch) {
    const [latText, lngText] = atMatch[1].split(',');
    atLat = toNumber(latText);
    atLng = toNumber(lngText);
  }

  if (speciesId == null && params.id != null) speciesId = toNumber(params.id);
  if (atLat == null && params.lat != null) {
    if (params.lng != null) {
      atLat = toNumber(params.lat);
      atLng = toNumber(params.lng);
    } else {
      const [latText, lngText] = params.lat.split(',');
      atLat = toNumber(latText);
      atLng = toNumber(lngText);
    }
  }

  return { speciesId, atLat, atLng };
}

/**
 * Keyed on the route so Leaflet is always created for one route and destroyed when the
 * route (or the selected species / coordinate) changes.
 */
export default function MapScreen() {
  const { pathname } = useLocation();
  const params = useParams();
  const target = readTarget(pathname, params);
  const routeKey =
    target.speciesId != null
      ? `sp:${target.speciesId}`
      : target.atLat != null && target.atLng != null
        ? `at:${target.atLat},${target.atLng}`
        : 'map';
  return <MapView key={routeKey} />;
}

function MapView() {
  const { pathname } = useLocation();
  const params = useParams();
  const { speciesId, atLat, atLng } = readTarget(pathname, params);
  const navigate = useNavigate();

  const sightings = useSightings() as MapSighting[];
  const outings = useOutings() as MapOuting[];
  const seen = useSeen();
  const patches = usePatches();

  // Filter state, mirroring v1's `state.mapF`.
  const [show, setShow] = useState<Show>('all');
  const [hot, setHot] = useState(true);
  const [hotFocus, setHotFocus] = useState(false);
  const [need, setNeed] = useState(false);
  const [layer, setLayer] = useState<Layer>('map');
  const [seqTick, setSeqTick] = useState(0);

  // Search state.
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchMsg, setSearchMsg] = useState('');

  // Patch sheet state.
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchName, setPatchName] = useState('');
  const [patchRadius, setPatchRadius] = useState(1);
  const [patchError, setPatchError] = useState('');
  const [patchSaving, setPatchSaving] = useState(false);

  // Text summary of everything shown in popups.
  const [notes, setNotes] = useState<Note[]>([]);
  const [locationNote, setLocationNote] = useState('');

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.LayerGroup | null>(null);
  const osmRef = useRef<L.TileLayer | null>(null);
  const satRef = useRef<L.LayerGroup | null>(null);
  const hotspotMarkersRef = useRef<{ h: Hotspot; mk: L.CircleMarker }[]>([]);
  const tempMarkerRef = useRef<L.Marker | null>(null);
  const previewRef = useRef<L.Circle | null>(null);
  const settingsRef = useRef<Settings>({});

  const focusFittedRef = useRef(false);
  const sightingsFittedRef = useRef(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const searchOpenRef = useRef(false);
  const patchOpenRef = useRef(false);
  const seenRef = useRef(seen);

  const focus = speciesId != null ? byId.get(speciesId) : undefined;
  const hasAt = atLat != null && atLng != null;
  const hotOn = focus ? hotFocus : hot;

  // -- derived data --------------------------------------------------------

  const groups = useMemo<SightingGroup[]>(() => {
    if (show === 'none') return [];
    const byPlace = new Map<string, MapSighting[]>();
    for (const s of sightings) {
      if (s.lat == null || s.lng == null) continue;
      if (show === 'photos' && !s.photoId) continue;
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      const bucket = byPlace.get(key);
      if (bucket) bucket.push(s);
      else byPlace.set(key, [s]);
    }
    return [...byPlace.entries()].map(([key, items]) => {
      const names: Species[] = [];
      const ids = new Set<number>();
      for (const item of items) {
        if (ids.has(item.speciesId)) continue;
        ids.add(item.speciesId);
        const sp = byId.get(item.speciesId);
        if (sp) names.push(sp);
      }
      return {
        key,
        lat: Number(items[0].lat),
        lng: Number(items[0].lng),
        items,
        names,
      };
    });
  }, [sightings, show]);

  const hotspotView = useMemo<HotspotView[]>(() => {
    if (!hotOn) return [];
    const rows: HotspotView[] = [];
    for (const h of hotspots() as Hotspot[]) {
      if (focus && !h.sp.some(([sid]) => sid === focus.id)) continue;
      const got = h.sp.filter(([sid]) => seen.has(sid)).length;
      const needAll = h.sp
        .filter(([sid]) => !seen.has(sid))
        .map(([sid]) => byId.get(sid))
        .filter((sp): sp is Species => Boolean(sp));
      rows.push({ h, got, needAll, need: needAll.slice(0, 6) });
    }
    return rows;
  }, [hotOn, focus, seen, seqTick]);

  const focusPoints = useMemo<[number, number, number][]>(() => {
    if (!focus) return [];
    const pts = (pointsFor(focus.id) as [number, number, number][]) ?? [];
    return pts.slice().sort((a, b) => b[2] - a[2]);
  }, [focus, seqTick]);

  const places = useMemo(() => namedPlaces(sightings, outings), [sightings, outings]);

  const localResults = useCallback(
    (text: string): SearchResult[] => {
      const trimmed = text.trim();
      const hotspotRows = hotspots() as Hotspot[];
      if (!trimmed) {
        // Nothing typed: patches, then the hotspots with the most birds still needed.
        const best = hotspotRows
          .map((h) => ({ h, count: h.sp.filter(([sid]) => !seen.has(sid)).length }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map(({ h, count }) => ({
            name: h.name,
            lat: h.lat,
            lng: h.lng,
            kind: `Hotspot: ${count} birds you still need`,
          }));
        return [
          ...patches.map((p) => ({
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            kind: 'Your patch',
            zoom: 14,
          })),
          ...best,
        ];
      }
      const birds: BirdResult[] = matchSpecies(trimmed, 5).map((sp) => ({
        bird: sp.id,
        name: sp.name,
        kind: `${cap(KINDS[sp.kind]?.one ?? 'species')}: show where it's reported`,
      }));
      return [...birds, ...localPlaceMatches(trimmed, patches, places, hotspotRows)];
    },
    [patches, places, seen, seqTick],
  );

  const localResultsRef = useRef(localResults);
  useEffect(() => {
    localResultsRef.current = localResults;
  }, [localResults]);
  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);
  useEffect(() => {
    patchOpenRef.current = patchOpen;
  }, [patchOpen]);
  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);

  const addNote = useCallback((key: string, html: string, noteLat?: number, noteLng?: number) => {
    setNotes((prev) => {
      const note: Note = { key, html, lat: noteLat, lng: noteLng };
      const at = prev.findIndex((n) => n.key === key);
      const next = at >= 0 ? prev.map((n, i) => (i === at ? note : n)) : [...prev, note];
      return next.slice(-8);
    });
  }, []);

  // Load a place description into the text summary. Map popups are not keyboard
  // reachable (Leaflet paths are not focusable), so the same copy is offered here.
  const readPlace = useCallback(
    (placeLat: number, placeLng: number, key: string, hotspot?: Hotspot) => {
      const options = hotspot ? { hotspot, seen: seenRef.current } : { seen: seenRef.current };
      void describe(placeLat, placeLng, options)
        .then((html) => addNote(key, String(html), placeLat, placeLng))
        .catch(() =>
          addNote(
            key,
            '<p class="pop-desc">Couldn\u2019t look this spot up. Check the internet connection.</p>',
            placeLat,
            placeLng,
          ),
        );
    },
    [addNote],
  );

  // -- the Leaflet instance ------------------------------------------------

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;

    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(
      SEQ_CENTER,
      SEQ_ZOOM,
    );
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const osm = L.tileLayer(OSM_URL, {
      maxZoom: 19,
      crossOrigin: true,
      attribution: OSM_ATTRIBUTION,
    });
    const sat = L.layerGroup([
      L.tileLayer(SAT_URL, {
        maxZoom: 19,
        maxNativeZoom: 19,
        crossOrigin: true,
        attribution:
          'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics and the GIS User Community',
      }),
      L.tileLayer(SAT_REF_URL, { maxZoom: 19, crossOrigin: true, opacity: 0.9 }),
    ]);
    osm.addTo(map);

    const overlay = L.layerGroup().addTo(map);
    const me = L.layerGroup().addTo(map);
    mapRef.current = map;
    osmRef.current = osm;
    satRef.current = sat;
    overlayRef.current = overlay;
    meRef.current = me;
    // A fresh instance has not framed the data yet. Resetting here also makes the
    // effect resilient to StrictMode's mount → clean up → mount cycle.
    focusFittedRef.current = false;
    sightingsFittedRef.current = false;

    let alive = true;
    void Promise.resolve(db.kvGet('settings'))
      .then((stored: unknown) => {
        if (!alive) return;
        settingsRef.current =
          stored && typeof stored === 'object' ? (stored as Settings) : ({} as Settings);
        if (settingsRef.current.mapLayer === 'sat') setLayer('sat');
      })
      .catch(() => {});

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => map.invalidateSize())
        : null;
    observer?.observe(el);
    const timer = window.setTimeout(() => {
      if (alive) map.invalidateSize();
    }, 50);

    // Escape closes an open popup, which otherwise only closes by tapping the map.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const openPopup = el.querySelector('.leaflet-popup');
      map.closePopup();
      if (openPopup) {
        event.stopPropagation();
        el.focus();
      }
    };
    el.addEventListener('keydown', onKeyDown);

    return () => {
      alive = false;
      el.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      observer?.disconnect();
      hotspotMarkersRef.current = [];
      tempMarkerRef.current = null;
      previewRef.current = null;
      mapRef.current = null;
      overlayRef.current = null;
      meRef.current = null;
      osmRef.current = null;
      satRef.current = null;
      map.remove();
    };
  }, []);

  // Keep the base layer in step with the toggle (and the stored preference).
  useEffect(() => {
    const map = mapRef.current;
    const osm = osmRef.current;
    const sat = satRef.current;
    if (!map || !osm || !sat) return;
    if (layer === 'sat') {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(sat)) sat.addTo(map);
    } else {
      if (map.hasLayer(sat)) map.removeLayer(sat);
      if (!map.hasLayer(osm)) osm.addTo(map);
    }
    map.getContainer().classList.toggle('map--sat', layer === 'sat');
  }, [layer]);

  // Regional data is fetched once; the tick rebuilds the hotspot layers when it lands.
  useEffect(() => {
    let alive = true;
    void loadSeq().then(() => {
      if (alive) setSeqTick((tick) => tick + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  // -- overlays: patches, hotspots, species points, sighting dots ----------

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;

    let alive = true;
    overlay.clearLayers();
    hotspotMarkersRef.current = [];

    const accent = cssVar('--azure');
    const ink = cssVar('--lori');
    const gold = cssVar('--gold');

    // Patches (dashed circles).
    for (const p of patches) {
      L.circle([p.lat, p.lng], {
        radius: p.radiusKm * 1000,
        color: ink,
        weight: 2,
        fillOpacity: 0.06,
        dashArray: '6 6',
        bubblingMouseEvents: false,
      })
        .addTo(overlay)
        .bindPopup(
          `<strong>${esc(p.name)}</strong><br><a href="#/patch/${p.id}">Open patch list</a>`,
          POPUP_OPTS,
        );
    }

    // Report points for the selected species.
    if (focus) {
      const max = Math.max(1, ...focusPoints.map(([, , count]) => count));
      for (const [pointLat, pointLng, count] of focusPoints) {
        const weight = Math.sqrt(count / max);
        L.circle([pointLat, pointLng], {
          bubblingMouseEvents: false,
          radius: 450 + 900 * weight,
          stroke: false,
          fillColor: ink,
          fillOpacity: 0.25 + 0.45 * weight,
        })
          .addTo(overlay)
          .bindPopup(
            `<strong>${esc(focus.name)}</strong><br>Reported here: ${count.toLocaleString(
              'en-AU',
            )} records in this 1 km square since 2016`,
            POPUP_OPTS,
          );
      }
    }

    // Hotspots.
    if (hotOn) {
      const allHotspots = hotspots() as Hotspot[];
      const maxNeed = Math.max(
        1,
        ...allHotspots.map((h) => h.sp.filter(([sid]) => !seen.has(sid)).length),
      );
      for (const view of hotspotView) {
        const proportion = view.needAll.length / maxNeed;
        const style: L.CircleMarkerOptions =
          need && !focus
            ? {
                radius: 3 + 11 * proportion,
                color: '#3A2A00',
                weight: 1.5,
                fillColor: proportion > 0.66 ? ink : gold,
                fillOpacity: 0.35 + 0.6 * proportion,
                bubblingMouseEvents: false,
              }
            : {
                radius: 4 + Math.min(6, view.h.rich / 30),
                color: '#3A2A00',
                weight: 1.5,
                fillColor: gold,
                fillOpacity: 0.9,
                bubblingMouseEvents: false,
              };
        const marker = L.circleMarker([view.h.lat, view.h.lng], style);
        hotspotMarkersRef.current.push({ h: view.h, mk: marker });
        marker
          .addTo(overlay)
          .bindPopup(
            `<div data-desc><span class="pop-h">${esc(view.h.name)}</span>${
              view.h.rich
            } dex species recorded here. You have seen ${view.got}.<p class="pop-src">Looking up this place…</p></div>
            ${
              view.need.length
                ? `Still to find (${view.needAll.length}):<ul class="pop-need">${view.need
                    .map((sp) => `<li><a href="#/bird/${sp.id}">${esc(sp.name)}</a></li>`)
                    .join('')}</ul>`
                : ''
            }
            <a href="${directionsUrl(view.h.lat, view.h.lng)}" target="_blank" rel="noopener">Directions</a>`,
            { maxWidth: 260, ...POPUP_OPTS },
          );
        marker.on('popupopen', (event) => {
          void describe(view.h.lat, view.h.lng, { hotspot: view.h, seen })
            .then((html) => {
              if (!alive || html == null) return;
              const text = String(html);
              const box = event.popup.getElement()?.querySelector('[data-desc]');
              if (box) {
                box.innerHTML = text;
                event.popup.update();
              }
              addNote(`hotspot:${view.h.name}`, text, view.h.lat, view.h.lng);
            })
            .catch(() => {});
        });
      }
    }

    // Sighting dots, grouped by rounded coordinate as v1 did.
    for (const group of groups) {
      const kinds = [...new Set(group.names.map((sp) => sp.kind))];
      const dot =
        kinds.length === 1 ? cssVar(`--k-${kinds[0]}`) || accent : accent;
      L.circleMarker([group.lat, group.lng], {
        radius: Math.min(14, 6 + group.names.length),
        color: '#fff',
        weight: 2,
        fillColor: dot,
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      })
        .addTo(overlay)
        .bindPopup(
          `<strong>${esc(group.items[0].place || 'Sighting')}</strong><br>${group.names
            .slice(0, 12)
            .map((sp) => `<a href="#/bird/${sp.id}">${esc(sp.name)}</a>`)
            .join('<br>')}${group.names.length > 12 ? `<br>and ${group.names.length - 12} more` : ''}`,
          POPUP_OPTS,
        );
    }

    // Tapping the map describes that spot (v1 map click handler).
    const onMapClick = (event: L.LeafletMouseEvent) => {
      if (searchOpenRef.current) {
        setSearchOpen(false);
        return;
      }
      if (patchOpenRef.current) return;
      const clickLat = event.latlng.lat;
      const clickLng = event.latlng.lng;
      const key = `spot:${clickLat.toFixed(3)},${clickLng.toFixed(3)}`;
      const popup = L.popup({ maxWidth: 260, ...POPUP_OPTS })
        .setLatLng(event.latlng)
        .setContent('<p class="pop-src">Looking up this spot…</p>');
      // openPopup() closes whatever is already open; openOn() would stack a second popup.
      map.openPopup(popup);
      void describe(clickLat, clickLng, { seen: seenRef.current })
        .then((html) => {
          if (!alive) return;
          const text = String(html);
          addNote(key, text, clickLat, clickLng);
          if (map.hasLayer(popup)) {
            popup.setContent(
              `${text}<a href="${directionsUrl(
                clickLat,
                clickLng,
              )}" target="_blank" rel="noopener">Directions</a>`,
            );
          }
        })
        .catch(() => {
          if (!alive) return;
          const text =
            '<p class="pop-desc">Couldn\u2019t look this spot up. Check the internet connection.</p>';
          addNote(key, text, clickLat, clickLng);
          if (map.hasLayer(popup)) popup.setContent(text);
        });
    };
    map.on('click', onMapClick);

    return () => {
      alive = false;
      map.off('click', onMapClick);
    };
  }, [seqTick, patches, groups, hotspotView, focus, focusPoints, hotOn, need, addNote]);

  // Initial view for each route, fitted to the data once.
  useEffect(() => {
    if (!focus || focusFittedRef.current || !focusPoints.length) return;
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      focusPoints.map(([pointLat, pointLng]) => [pointLat, pointLng] as [number, number]),
      { padding: [40, 40], maxZoom: 12 },
    );
    focusFittedRef.current = true;
  }, [focus, focusPoints]);

  useEffect(() => {
    if (focus || hasAt || sightingsFittedRef.current) return;
    const map = mapRef.current;
    if (!map || !groups.length) return;
    map.fitBounds(
      groups.map((group) => [group.lat, group.lng] as [number, number]),
      { padding: [40, 40], maxZoom: 14 },
    );
    sightingsFittedRef.current = true;
  }, [groups, focus, hasAt]);

  // /map/at/:lat,:lng — centre and describe the coordinate.
  useEffect(() => {
    if (atLat == null || atLng == null) return;
    const map = mapRef.current;
    if (!map) return;
    map.setView([atLat, atLng], 15);
    let alive = true;
    const key = `at:${atLat},${atLng}`;
    const popup = L.popup({ maxWidth: 280, ...POPUP_OPTS })
      .setLatLng([atLat, atLng])
      .setContent('<p class="pop-src">Looking up this spot…</p>');
    map.openPopup(popup);
    void describe(atLat, atLng, { seen })
      .then((html) => {
        if (!alive) return;
        const text = String(html);
        addNote(key, text, atLat, atLng);
        if (map.hasLayer(popup)) {
          popup.setContent(
            `${text}<a href="${directionsUrl(atLat, atLng)}" target="_blank" rel="noopener">Directions</a>`,
          );
        }
      })
      .catch(() => {
        if (!alive) return;
        const text =
          '<p class="pop-desc">Couldn\u2019t look this spot up. Check the internet connection.</p>';
        addNote(key, text, atLat, atLng);
        if (map.hasLayer(popup)) popup.setContent(text);
      });
    return () => {
      alive = false;
    };
  }, [atLat, atLng, seqTick, seen, addNote]);

  // -- patch sheet ---------------------------------------------------------

  const closePatch = useCallback(() => {
    setPatchOpen(false);
    setPatchError('');
  }, []);

  useEffect(() => {
    if (!patchOpen) return;
    const map = mapRef.current;
    if (!map) return;
    const circle = L.circle(map.getCenter(), {
      radius: patchRadius * 1000,
      color: cssVar('--lori'),
      weight: 2,
      fillOpacity: 0.1,
    }).addTo(map);
    previewRef.current = circle;
    const move = () => circle.setLatLng(map.getCenter());
    map.on('move', move);
    return () => {
      map.off('move', move);
      circle.remove();
      previewRef.current = null;
    };
    // The radius is applied by the smaller effect below, as v1 updated the live circle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchOpen]);

  useEffect(() => {
    previewRef.current?.setRadius(patchRadius * 1000);
  }, [patchRadius, patchOpen]);

  const openPatch = () => {
    setPatchName('');
    setPatchRadius(1);
    setPatchError('');
    setPatchSaving(false);
    setPatchOpen(true);
  };

  const savePatch = async () => {
    const name = patchName.trim();
    if (!name) {
      setPatchError('Give the patch a name.');
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    setPatchSaving(true);
    try {
      const key = await db.put('patches', {
        name,
        lat: centre.lat,
        lng: centre.lng,
        radiusKm: patchRadius,
      });
      setPatchOpen(false);
      const newId = Number(key);
      navigate(Number.isFinite(newId) ? `/patch/${newId}` : '/lists');
    } catch {
      setPatchError('Could not save the patch. Try again.');
    } finally {
      setPatchSaving(false);
    }
  };

  // -- search --------------------------------------------------------------

  const runRemote = useCallback(async (text: string, seq: number, controller: AbortController) => {
    setSearchStatus('searching');
    setSearchMsg('');
    try {
      const remote = await searchAddress(text, controller.signal);
      if (controller.signal.aborted || seq !== seqRef.current) return;
      const local = localResultsRef.current(text);
      setResults([...local, ...remote.map((row) => ({ ...row, zoom: 14 }))]);
      setSearchStatus(remote.length || local.length ? 'idle' : 'empty');
    } catch (error) {
      if (controller.signal.aborted || seq !== seqRef.current) return;
      setSearchStatus('error');
      setSearchMsg(error instanceof Error ? error.message : 'Place search failed.');
    }
  }, []);

  useEffect(() => {
    const text = q.trim();
    setResults(localResults(text));
    setSearchMsg('');
    if (text.length < 3) {
      setSearchStatus('idle');
      return;
    }

    const seq = ++seqRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearchStatus('pending');

    const timer = window.setTimeout(() => {
      timerRef.current = null;
      void runRemote(text, seq, controller);
    }, 700);
    timerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
      controller.abort();
    };
  }, [q, localResults, runRemote]);

  const submitSearch = () => {
    setSearchOpen(true);
    const text = q.trim();
    if (text.length < 3) return;
    const seq = ++seqRef.current;
    controllerRef.current?.abort();
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    void runRemote(text, seq, controller);
  };

  const clearSearch = () => {
    seqRef.current += 1;
    controllerRef.current?.abort();
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    tempMarkerRef.current?.remove();
    tempMarkerRef.current = null;
    setQ('');
    setSearchStatus('idle');
    setSearchMsg('');
    setSearchOpen(true);
    inputRef.current?.focus();
  };

  const goTo = (result: SearchResult) => {
    setSearchOpen(false);
    inputRef.current?.blur();
    if ('bird' in result) {
      navigate(`/map/sp/${result.bird}`);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    map.setView([result.lat, result.lng], result.zoom ?? 15);

    const hotspotMarker = hotspotMarkersRef.current.find(
      ({ h }) => Math.abs(h.lat - result.lat) < 0.0005 && Math.abs(h.lng - result.lng) < 0.0005,
    );
    if (hotspotMarker) {
      window.setTimeout(() => {
        if (mapRef.current === map) hotspotMarker.mk.openPopup();
      }, 250);
      return;
    }

    tempMarkerRef.current?.remove();
    const popupHtml = `<span class="pop-h">${esc(result.name)}</span>${esc(result.kind)}`;
    const marker = L.marker([result.lat, result.lng], { icon: tempPinIcon() })
      .addTo(map)
      .bindPopup(popupHtml, POPUP_OPTS);
    tempMarkerRef.current = marker;
    addNote(`search:${result.lat},${result.lng}`, popupHtml, result.lat, result.lng);
    window.setTimeout(() => {
      if (mapRef.current === map && marker.getElement()) marker.openPopup();
    }, 250);
  };

  // -- locate --------------------------------------------------------------

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationNote('This browser cannot share your location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = mapRef.current;
        const me = meRef.current;
        if (!map || !me) return;
        setLocationNote('Showing your location.');
        map.setView([position.coords.latitude, position.coords.longitude], 15);
        me.clearLayers();
        L.circleMarker([position.coords.latitude, position.coords.longitude], {
          radius: 7,
          color: '#fff',
          weight: 3,
          fillColor: cssVar('--lori'),
          fillOpacity: 1,
        }).addTo(me);
      },
      () => {
        // Quietly stay on SEQ: no dialog, just a line of text.
        setLocationNote('Location is off, so the map is showing South East Queensland.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const pickLayer = (next: Layer) => {
    setLayer(next);
    settingsRef.current = { ...settingsRef.current, mapLayer: next };
    void Promise.resolve(db.kvSet('settings', settingsRef.current)).catch(() => {});
  };

  // -- render --------------------------------------------------------------

  const searchVisible =
    searchOpen &&
    (results.length > 0 ||
      searchStatus === 'searching' ||
      searchStatus === 'empty' ||
      searchStatus === 'error');

  return (
    <div className="map-screen">
      <h1 className="map-sr">Map</h1>
      <p id="map-help" className="map-sr">
        Use the arrow keys to pan the map. Everything shown in map popups is listed as text in the
        Map details section after the map.
      </p>

      <div className="mapwrap mapwrap--page">
        <div
          id="map"
          ref={mapElRef}
          role="region"
          tabIndex={0}
          aria-label="Map of South East Queensland showing your patches, birding hotspots and sightings"
          aria-describedby="map-help"
        />

        <div className="map-top">
          <form
            className="search-bar search-bar--map"
            role="search"
            aria-label="Map search"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <Icon name="search" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              placeholder="Search species, hotspots, suburbs, parks"
              aria-label="Search the map"
              aria-controls="map-search-results"
              autoComplete="off"
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearchOpen(false);
                  event.currentTarget.blur();
                }
              }}
            />
            {q && (
              <button type="button" className="iconbtn" aria-label="Clear search" onClick={clearSearch}>
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </form>

          {searchVisible && (
            <ul className="rows map-res" id="map-search-results" aria-label="Map search results">
              {results.map((result, index) => {
                if ('bird' in result) {
                  const sp = byId.get(result.bird);
                  return (
                    <li key={`bird:${result.bird}`}>
                      <button type="button" className="row" onClick={() => goTo(result)}>
                        <span className="row-thumb">{sp && <SpeciesImage sp={sp} />}</span>
                        <span className="row-main">
                          <strong>{result.name}</strong>
                          <span className="small muted">{result.kind}</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`place:${result.name}:${result.lat}:${result.lng}:${index}`}>
                    <button type="button" className="row" onClick={() => goTo(result)}>
                      <span className="row-main">
                        <strong>{result.name}</strong>
                        <span className="small muted">{result.kind}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {searchStatus === 'searching' && (
                <li className="small muted pad">Searching places…</li>
              )}
              {searchStatus === 'empty' && (
                <li className="small muted pad">
                  Nothing found. Try a suburb, park or bird name.
                </li>
              )}
              {searchStatus === 'error' && <li className="small muted pad">{searchMsg}</li>}
            </ul>
          )}
          <p className="map-sr" role="status" aria-live="polite">
            {searchStatus === 'searching'
              ? 'Searching places.'
              : searchStatus === 'empty'
                ? 'No places found.'
                : searchStatus === 'error'
                  ? searchMsg
                  : searchVisible
                    ? `${results.length} search results.`
                    : ''}
          </p>
        </div>

        <div className="map-ctl chips" role="group" aria-label="Map filters">
          {focus && (
            <Link
              className="chip chip--on"
              to="/map"
              aria-label={`Stop showing ${focus.name}`}
            >
              {focus.name} <span aria-hidden="true">✕</span>
            </Link>
          )}
          <button
            type="button"
            className={`chip ${hotOn ? 'chip--on' : ''}`}
            aria-pressed={hotOn}
            onClick={() => {
              if (focus) setHotFocus((value) => !value);
              else setHot((value) => !value);
            }}
          >
            Hotspots
          </button>
          {!focus && (
            <button
              type="button"
              className={`chip ${need ? 'chip--on' : ''}`}
              aria-pressed={need}
              onClick={() => setNeed((value) => !value)}
            >
              Birds I need
            </button>
          )}
          {(
            [
              ['all', 'My sightings'],
              ['photos', 'With photos'],
              ['none', 'Hide mine'],
            ] as [Show, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip ${show === value ? 'chip--on' : ''}`}
              aria-pressed={show === value}
              onClick={() => setShow(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn--primary map-patch" onClick={openPatch}>
          <span className="map-patch-ring" aria-hidden="true" />New patch here
        </button>

        <button type="button" className="map-fab" aria-label="Go to where I am" onClick={locate}>
          <Icon name="pin" />
        </button>

        <div className="layer-toggle" role="group" aria-label="Map style">
          <button
            type="button"
            aria-pressed={layer === 'map'}
            onClick={() => pickLayer('map')}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={layer === 'sat'}
            onClick={() => pickLayer('sat')}
          >
            Satellite
          </button>
        </div>

        <div className={`map-cross ${patchOpen ? '' : 'hidden'}`} aria-hidden="true" />

        {locationNote && (
          <p className="map-location-note small" role="status" aria-live="polite">
            {locationNote}
          </p>
        )}
      </div>

      {patchOpen && (
        <div className="sheet-wrap sheet-wrap--map open">
          <div
            className="sheet"
            role="dialog"
            aria-labelledby="new-patch-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                closePatch();
              }
            }}
          >
            <div className="sheet-grip" aria-hidden="true" />
            <h2 className="sheet-title" id="new-patch-title">
              New patch
            </h2>
            <p className="muted small">
              Move the map so the circle covers your patch, then name it.
            </p>
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault();
                void savePatch();
              }}
            >
              <label className="field">
                <span>Name</span>
                <input
                  name="name"
                  placeholder="e.g. Our yard"
                  required
                  autoComplete="off"
                  autoFocus
                  value={patchName}
                  onChange={(event) => setPatchName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  Radius: <output>{patchRadius}</output> km
                </span>
                <input
                  type="range"
                  name="r"
                  min="0.1"
                  max="8"
                  step="0.1"
                  value={patchRadius}
                  onChange={(event) => setPatchRadius(Number(event.target.value))}
                />
              </label>
              {patchError && (
                <p className="form-error" role="alert">
                  {patchError}
                </p>
              )}
              <div className="row-end">
                <button type="button" className="btn" onClick={closePatch}>
                  Cancel
                </button>
                <button className="btn btn--primary" type="submit" disabled={patchSaving}>
                  Save patch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="map-summary pad" aria-labelledby="map-summary-title">
        <h2 className="h2" id="map-summary-title">
          Map details
        </h2>
        <p className="small muted">
          The same information as the map popups, as text. {groups.length} sighting places and{' '}
          {hotspotView.length} hotspots are shown.
        </p>

        {focus ? (
          <section aria-labelledby="map-focus-title">
            <h3 id="map-focus-title">Reported here: {focus.name}</h3>
            {focusPoints.length ? (
              <>
                <p className="small muted">
                  {focusPoints.length} one-kilometre squares across SEQ, most records first.
                </p>
                <ul className="map-summary-list">
                  {focusPoints.map(([pointLat, pointLng, count]) => (
                    <li key={`${pointLat},${pointLng}`}>
                      <strong>{count.toLocaleString('en-AU')} records</strong>{' '}
                      <span className="muted small">
                        in the 1 km square at {pointLat.toFixed(3)}, {pointLng.toFixed(3)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted small">No report points for this species yet.</p>
            )}
            <p>
              <Link className="btn" to={`/bird/${focus.id}`}>
                Open {focus.name} in the dex
              </Link>
            </p>
          </section>
        ) : speciesId != null ? (
          <section>
            <p>That species isn&apos;t in the dex.</p>
            <Link className="btn" to="/dex">
              Back to the dex
            </Link>
          </section>
        ) : null}

        <section aria-labelledby="map-patches-title">
          <h3 id="map-patches-title">Your patches ({patches.length})</h3>
          {patches.length ? (
            <ul className="map-summary-list">
              {patches.map((patch) => (
                <li key={patch.id}>
                  <strong>{patch.name}</strong>{' '}
                  <span className="muted small">{patch.radiusKm} km radius</span>{' '}
                  <Link to={`/patch/${patch.id}`}>Open patch list</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              No patches yet. Use “New patch here” to save one around the map centre.
            </p>
          )}
        </section>

        <section aria-labelledby="map-sightings-title">
          <h3 id="map-sightings-title">Your sightings on the map ({groups.length})</h3>
          {show === 'none' ? (
            <p className="muted small">Sightings are hidden.</p>
          ) : groups.length ? (
            <ul className="map-summary-list">
              {groups.map((group) => (
                <li key={group.key}>
                  <strong>{group.items[0].place || 'Sighting'}</strong>
                  <div className="small">
                    {group.names.slice(0, 12).map((sp, index) => (
                      <span key={sp.id}>
                        {index > 0 && ', '}
                        <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
                      </span>
                    ))}
                    {group.names.length > 12 ? ` and ${group.names.length - 12} more` : ''}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              {show === 'photos'
                ? 'No sightings with photos are on the map yet.'
                : 'No sightings with a location yet.'}
            </p>
          )}
        </section>

        <section aria-labelledby="map-hotspots-title">
          <h3 id="map-hotspots-title">Birding hotspots</h3>
          {!hotOn ? (
            <p className="muted small">Hotspots are hidden.</p>
          ) : hotspotView.length ? (
            <details className="map-summary-details">
              <summary>Hotspots shown ({hotspotView.length})</summary>
              <ul className="map-summary-list">
                {hotspotView.map((view) => (
                  <li key={view.h.name}>
                    <strong>{view.h.name}</strong>
                    <div className="small">
                      {view.h.rich} dex species recorded here. You have seen {view.got}.
                    </div>
                    {view.needAll.length > 0 && (
                      <div className="small">
                        Still to find ({view.needAll.length}):{' '}
                        {view.need.map((sp, index) => (
                          <span key={sp.id}>
                            {index > 0 && ', '}
                            <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
                          </span>
                        ))}
                      </div>
                    )}
                    <a
                      className="small"
                      href={directionsUrl(view.h.lat, view.h.lng)}
                      target="_blank"
                      rel="noopener"
                    >
                      Directions
                    </a>
                    <div>
                      <button
                        type="button"
                        className="btn btn--quiet small"
                        aria-label={`Read about ${view.h.name}`}
                        onClick={() =>
                          readPlace(
                            view.h.lat,
                            view.h.lng,
                            `hotspot:${view.h.name}`,
                            view.h,
                          )
                        }
                      >
                        Read about this place
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="muted small">
              {focus
                ? `No SEQ hotspots record ${focus.name}.`
                : 'No hotspots to show.'}
            </p>
          )}
        </section>

        <section aria-labelledby="map-notes-title">
          <h3 id="map-notes-title">Place details</h3>
          <div className="map-notes" aria-live="polite">
            {notes.length ? (
              notes.map((note) => (
                <div className="map-note" key={note.key}>
                  <div dangerouslySetInnerHTML={{ __html: note.html }} />
                  {note.lat != null && note.lng != null && (
                    <p className="small">
                      <a
                        href={directionsUrl(note.lat, note.lng)}
                        target="_blank"
                        rel="noopener"
                      >
                        Directions
                      </a>
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="muted small">
                Tap the map, a hotspot, or a “reported here” point to read about a place.
              </p>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
