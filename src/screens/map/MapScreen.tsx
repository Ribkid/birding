// Map screen: a port of v1 `renderMap` (legacy/js/app.js line 1433).
//
// The Leaflet instance is created and destroyed inside an effect. `MapScreen` keys the
// view on the route so moving between /map, /map/sp/:id and /map/at/:lat,:lng tears the
// old map down before a new one is built.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './map.css';

import { KINDS, SPECIES, byId, dexCode, type Species } from '../../lib/data';
import { useOutings, useSeen, useSightings, type Outing, type Sighting } from '../../lib/hooks';
import { db } from '../../core/db.js';
import { hotspots, loadSeq, pointsFor } from '../../core/seqdata.js';
import { describeArea } from '../../core/mapinfo.js';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { SpeciesImage } from '../../components/SpeciesImage';
import { SunToggle } from '../../components/SunToggle';
import { announce, toast as appToast } from '../../lib/toast';
import { localPlaceMatches, myPlaces, searchAddress } from '../../lib/places';
import { loadSpotData, nearestEbirdSpot } from '../../lib/ebird';
import type { HotspotLike } from '../../lib/spots';
import {
  boundsKey,
  buildOverpassQuery,
  PLACE_KINDS,
  PLACE_LABELS,
  placesFromElements,
  snapBounds,
  type MapPlace,
  type OverpassElement,
  type PlaceKind,
} from '../../lib/mapPlaces';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Show = 'all' | 'photos' | 'none';
type Layer = 'map' | 'sat';
type MapSighting = Sighting & { place?: string; photoId?: number | null };
type MapOuting = Outing & { lat?: number | null; lng?: number | null };

// v1 keeps these on `state` for the session, so leaving the map and coming back finds it as she left it:
// the chips (state.mapF), where the map was (state.mapView), and whether tiles failed with no signal
// (state.tilesOffline) or she hid that note (state.mapNoteHidden).
const mapF: { show: Show; hot: boolean; hotFocus: boolean; need: boolean; places: boolean } = {
  show: 'all',
  hot: true,
  hotFocus: false,
  need: false,
  places: true,
};
let mapView: { c: L.LatLng; z: number } | null = null;
let tilesOffline = false;
let mapNoteHidden = false;
let mapKeyOpen = false;
const placeCache = new Map<string, MapPlace[]>();

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

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

// The map's home view (v1 renderMap).
const SEQ_CENTER: [number, number] = [-27.47, 153.02];
const SEQ_ZOOM = 9;

/**
 * Popup options with v1's width (`want`: 260 for hotspots and spots, Leaflet's 300 for the rest), narrowed on a small
 * phone. The frame is 47 px wider than maxWidth (Leaflet's 1 px, its 1 px padding each side and v1's 20 + 24 px
 * content margins, map.css), so on a 320 px screen a 260 px popup would run off the edge and hide its close button;
 * this keeps the whole popup inside the 12 px side padding.
 *
 * Popups must not open underneath the fixed search bar and filter chips either: that hides the close button, so the
 * popup cannot be dismissed. Leaflet pans to keep the popup below the chip row (measured, so a notch's safe area
 * counts) and clear of the attribution and tab bar. A popup that already fits, such as #/map/at's, stays where v1
 * puts it.
 */
const popOpts = (map: L.Map, want = 300) => {
  const el = map.getContainer();
  const chips = el.parentElement?.querySelector('.map-ctl');
  const top = chips ? Math.round(chips.getBoundingClientRect().bottom - el.getBoundingClientRect().top) : 0;
  return {
    maxWidth: Math.max(160, Math.min(want, map.getSize().x - 24 - 47)),
    autoPanPaddingTopLeft: L.point(12, top > 0 ? top : 152),
    autoPanPaddingBottomRight: L.point(12, 96),
  };
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

// v1 icon.close.
const closeIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// v1 marks a place picked from search with Leaflet's default pin. Bundled, Leaflet cannot work out where its own
// images are, so they are given here (small enough that Vite inlines them, so the pin works offline).
const searchPinIcon = () =>
  L.icon({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41],
  });

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const PLACE_ZOOM = 15;

const PLACE_GLYPHS: Record<PlaceKind, string> = {
  hut: '<path d="m4 11 8-7 8 7M6 10v9h12v-9M10 19v-5h4v5M16 5v3"/>',
  shelter: '<path d="m3 10 9-6 9 6M5 10v9m14-9v9M4 19h16M8 13h8"/>',
  toilets: '<circle cx="8" cy="5" r="2"/><circle cx="16" cy="5" r="2"/><path d="M5 20v-6l1-5h4l1 5v6M14 20v-6l1-5h3v11M8 14v6m8-6v6"/>',
  water: '<path d="M12 3S6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  picnic: '<path d="M5 9h14M7 9l-3 10m13-10 3 10M4 14h16M8 14l3 5m5-5-3 5"/>',
  viewpoint: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  birdHide: '<path d="M4 15c4 0 7-3 7-7 3 1 5 3 5 6 3 0 5 1 6 3-3 3-7 4-11 2-4-1-6-2-7-4Z"/><path d="m16 14 4-1M8 19l-1 2m5-2 1 2"/>',
  parking: '<path d="M8 20V4h6a5 5 0 0 1 0 10H8M8 5h6"/>',
  information: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  camp: '<path d="m3 20 9-16 9 16H3ZM12 4l3 16M8 20l4-7 4 7"/>',
};

const placeIcon = (kind: PlaceKind): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PLACE_GLYPHS[kind]}</svg>`;

const placeDivIcon = (place: MapPlace) =>
  L.divIcon({
    className: 'map-place-icon',
    html: `<span class="map-place map-place--${place.kind}" aria-hidden="true">${placeIcon(place.kind)}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -18],
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

interface MapKeyProps {
  hotspotsOn: boolean;
  need: boolean;
  sightingsOn: boolean;
  patchesOn: boolean;
  focusOn: boolean;
  located: boolean;
  searchPin: boolean;
  placesOn: boolean;
}

function MapKey({ hotspotsOn, need, sightingsOn, patchesOn, focusOn, located, searchPin, placesOn }: MapKeyProps) {
  const [open, setOpen] = useState(mapKeyOpen);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    mapKeyOpen = false;
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  const toggle = () => {
    mapKeyOpen = !open;
    setOpen(mapKeyOpen);
  };

  return (
    <div className="map-key">
      {open && (
        <section ref={panelRef} id="map-key-panel" className="map-key-panel" aria-labelledby="map-key-title">
          <div className="map-key-head">
            <h2 id="map-key-title">Map key</h2>
            <button type="button" className="iconbtn" aria-label="Close map key" onClick={close}>
              {closeIcon}
            </button>
          </div>
          <ul className="map-key-list">
            {hotspotsOn && (
              <li>
                {need ? (
                  <span className="map-key-symbol map-key-hotspots--need" aria-hidden="true"><i /><i /></span>
                ) : (
                  <span className="map-key-symbol map-key-hotspot" aria-hidden="true" />
                )}
                <span>{need ? 'Hotspots. Size and gold-to-dark colour show birds you still need.' : 'Hotspots. Bigger circles mean more species.'}</span>
              </li>
            )}
            {sightingsOn && (
              <li>
                <span className="map-key-symbol map-key-sightings" aria-hidden="true">
                  {['bird', 'mammal', 'reptile', 'frog', 'butterfly', 'plant'].map((kind) => <i key={kind} className={`map-key-kind--${kind}`} />)}
                </span>
                <span>Your sightings in kind colours with white rings. Bigger dots mean more species at that place.</span>
              </li>
            )}
            {patchesOn && <li><span className="map-key-symbol map-key-patch" aria-hidden="true" /><span>Your patches.</span></li>}
            {focusOn && <li><span className="map-key-symbol map-key-square" aria-hidden="true" /><span>Reports for this species in one-kilometre squares. Darker means more records.</span></li>}
            {located && <li><span className="map-key-symbol map-key-me" aria-hidden="true" /><span>You are here.</span></li>}
            {searchPin && <li><span className="map-key-symbol"><img src={markerIcon} alt="" /></span><span>Place from your search.</span></li>}
          </ul>
          {placesOn && (
            <ul className="map-key-places" aria-label="Place icons">
              {PLACE_KINDS.map((kind) => (
                <li key={kind}>
                  <span className={`map-place map-place--${kind}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: placeIcon(kind) }} />
                  <span>{PLACE_LABELS[kind]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="map-key-button"
        aria-expanded={open}
        aria-controls="map-key-panel"
        onClick={toggle}
      >
        Key
      </button>
    </div>
  );
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

  // Filter state, v1's `state.mapF`: read from the session object, and written back with every change.
  const [show, setShowState] = useState<Show>(mapF.show);
  const [hot, setHotState] = useState(mapF.hot);
  const [hotFocus, setHotFocusState] = useState(mapF.hotFocus);
  const [need, setNeedState] = useState(mapF.need);
  // A chip redraws v1's map, which closes any open popup; a redraw for new data keeps the open hotspot (below).
  const chipTapped = () => mapRef.current?.closePopup();
  const setShow = (value: Show) => { chipTapped(); mapF.show = value; setShowState(value); };
  const toggleHot = () => { chipTapped(); mapF.hot = !mapF.hot; setHotState(mapF.hot); };
  const toggleHotFocus = () => { chipTapped(); mapF.hotFocus = !mapF.hotFocus; setHotFocusState(mapF.hotFocus); };
  const toggleNeed = () => { chipTapped(); mapF.need = !mapF.need; setNeedState(mapF.need); };
  const [placesOn, setPlacesOnState] = useState(mapF.places);
  // Overpass can take half a minute to answer, so the map says it is still looking.
  const [placesLoading, setPlacesLoading] = useState(false);
  const togglePlaces = () => { chipTapped(); mapF.places = !mapF.places; setPlacesOnState(mapF.places); };
  const [layer, setLayer] = useState<Layer>('map');
  const [zoom, setZoom] = useState(mapView?.z ?? (atLat != null && atLng != null ? PLACE_ZOOM : SEQ_ZOOM));
  const [seqTick, setSeqTick] = useState(0);
  const [ebirdSpots, setEbirdSpots] = useState<HotspotLike[] | null | undefined>(undefined);

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
  // Locate feedback, as v1: the fab dims while it waits, an error shows as a toast.
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState(false);
  const [hasSearchPin, setHasSearchPin] = useState(false);
  // v1's "No signal" note (mapNote('tiles')): tiles failed with no connection and she has not hidden it.
  const [noSignal, setNoSignal] = useState(false);
  const noSignalRef = useRef(false);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.LayerGroup | null>(null);
  const placeLayerRef = useRef<L.LayerGroup | null>(null);
  const osmRef = useRef<L.TileLayer | null>(null);
  const satRef = useRef<L.LayerGroup | null>(null);
  const hotspotMarkersRef = useRef<{ h: Hotspot; mk: L.CircleMarker }[]>([]);
  const groupMarkersRef = useRef<{ key: string; mk: L.CircleMarker }[]>([]);
  const tempMarkerRef = useRef<L.Marker | null>(null);
  const previewRef = useRef<L.Circle | null>(null);
  // Set once Sarah taps Map or Satellite. Her choice then wins over the stored layer, even
  // when the first settings read is slow and lands after the tap.
  const layerPickedRef = useRef(false);

  const focusFittedRef = useRef(false);
  const sightingsFittedRef = useRef(false);
  // v1 frames the sightings (or the species' records) only when the map has no remembered view this session.
  const viewRestoredRef = useRef(mapView != null);
  // /map/at: the nearby hotspot's popup is still to open.
  const atPendingRef = useRef(atLat != null && atLng != null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const searchOpenRef = useRef(false);
  const patchOpenRef = useRef(false);
  const seenRef = useRef(seen);

  const focus = speciesId != null ? byId.get(speciesId) : undefined;
  const hasAt = atLat != null && atLng != null;
  // Hotspot records are eBird birding sites: birds only, so a frog or a gum gets no Hotspots chip (v1).
  const noHot = focus != null && focus.kind !== 'bird';
  const hotOn = !noHot && (focus ? hotFocus : hot);

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

  // With an eBird snapshot, only a hotspot within 400 m gets a details link. ALA keeps its numeric links.
  const hotspotSpotIds = useMemo(() => {
    const links = new Map<string, string | null>();
    (hotspots() as Hotspot[]).forEach((h, i) => {
      if (!ebirdSpots) links.set(h.name, String(i));
      else links.set(h.name, nearestEbirdSpot(ebirdSpots, h)?.locId ?? null);
    });
    return links;
  }, [seqTick, ebirdSpots]);

  const focusPoints = useMemo<[number, number, number][]>(() => {
    if (!focus) return [];
    const pts = (pointsFor(focus.id) as [number, number, number][]) ?? [];
    return pts.slice().sort((a, b) => b[2] - a[2]);
  }, [focus, seqTick]);

  const places = useMemo(() => myPlaces(sightings, outings), [sightings, outings]);

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
      return [...birds, ...localPlaceMatches(trimmed, patches, places)];
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

  // v1 mapNote('tiles'): say once why parts of the map are blank, unless she hid the note this session.
  const showNoSignal = useCallback(() => {
    if (mapNoteHidden || noSignalRef.current) return;
    noSignalRef.current = true;
    setNoSignal(true);
    announce("No signal. Areas you haven't opened before stay blank.");
  }, []);

  // v1: Hide puts focus in the search box, just above where the note was.
  const hideNote = () => {
    mapNoteHidden = true;
    noSignalRef.current = false;
    setNoSignal(false);
    inputRef.current?.focus();
  };

  // A tapped spot's description (v1's map click handler). It belongs to the map instance rather than to the
  // overlays, so a data refresh while the lookup runs cannot leave the popup on "Looking up this spot…".
  const describeSpot = useCallback(
    (map: L.Map, latlng: L.LatLng) => {
      const clickLat = latlng.lat;
      const clickLng = latlng.lng;
      const key = `spot:${clickLat.toFixed(3)},${clickLng.toFixed(3)}`;
      const popup = L.popup(popOpts(map, 260))
        .setLatLng(latlng)
        .setContent('<p class="pop-src">Looking up this spot…</p>');
      // openPopup() closes whatever is already open; openOn() would stack a second popup.
      map.openPopup(popup);
      void describe(clickLat, clickLng, { seen: seenRef.current })
        .then((html) => {
          if (mapRef.current !== map) return;
          const text = String(html);
          addNote(key, text, clickLat, clickLng);
          if (map.hasLayer(popup)) {
            popup.setContent(
              `${text}<a href="${directionsUrl(clickLat, clickLng)}" target="_blank" rel="noopener">Directions</a>`,
            );
          }
        })
        .catch(() => {
          if (mapRef.current !== map) return;
          const text =
            '<p class="pop-desc">Couldn’t look this spot up. Check the internet connection.</p>';
          addNote(key, text, clickLat, clickLng);
          if (map.hasLayer(popup)) popup.setContent(text);
        });
    },
    [addNote],
  );

  // -- the Leaflet instance ------------------------------------------------

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;

    // v1: back where she left the map this session, or the SEQ home view.
    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(
      mapView?.c ?? SEQ_CENTER,
      mapView?.z ?? SEQ_ZOOM,
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
    // Offline, a map square not opened before fails to load: say why the map has gaps (again on the next visit).
    const onTileError = () => {
      if (navigator.onLine) return;
      tilesOffline = true;
      showNoSignal();
    };
    for (const tiles of [osm, ...(sat.getLayers() as L.TileLayer[])]) tiles.on('tileerror', onTileError);
    if (!navigator.onLine && tilesOffline) showNoSignal();
    map.on('moveend', () => {
      mapView = { c: map.getCenter(), z: map.getZoom() };
      setZoom(map.getZoom());
    });

    const overlay = L.layerGroup().addTo(map);
    const me = L.layerGroup().addTo(map);
    const placeLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    osmRef.current = osm;
    satRef.current = sat;
    overlayRef.current = overlay;
    meRef.current = me;
    placeLayerRef.current = placeLayer;
    // A fresh instance has not framed the data yet. Resetting here also makes the
    // effect resilient to StrictMode's mount → clean up → mount cycle.
    focusFittedRef.current = false;
    sightingsFittedRef.current = false;

    let alive = true;
    void Promise.resolve(db.kvGet('settings'))
      .then((stored: unknown) => {
        if (!alive || layerPickedRef.current) return;
        if ((stored as Settings | null)?.mapLayer === 'sat') setLayer('sat');
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

    // Tap anywhere on the map for a short description of that spot (v1).
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (searchOpenRef.current) {
        setSearchOpen(false);
        return;
      }
      if (patchOpenRef.current) return;
      describeSpot(map, event.latlng);
    });

    // /map/at/:lat,:lng (v1): centre there; the hotspot's popup opens once the hotspots are drawn.
    if (atLat != null && atLng != null) map.setView([atLat, atLng], 15);

    return () => {
      alive = false;
      el.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      observer?.disconnect();
      hotspotMarkersRef.current = [];
      groupMarkersRef.current = [];
      tempMarkerRef.current = null;
      previewRef.current = null;
      mapRef.current = null;
      overlayRef.current = null;
      meRef.current = null;
      placeLayerRef.current = null;
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

  // Places are a live OpenStreetMap overlay, not bundled data: no connection is needed to open the map.
  useEffect(() => {
    const map = mapRef.current;
    const placeLayer = placeLayerRef.current;
    if (!map || !placeLayer) return;
    let alive = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const cancel = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
      setPlacesLoading(false);
    };

    const draw = (rows: MapPlace[]) => {
      if (!alive || mapRef.current !== map) return;
      placeLayer.clearLayers();
      for (const place of rows) {
        const title = place.name || place.label;
        const html = `<span class="pop-h">${esc(title)}</span>${
          place.details ? `<p class="pop-sub">${esc(place.details)}</p>` : ''
        }<a href="${directionsUrl(place.lat, place.lng)}" target="_blank" rel="noopener">Directions</a><p class="pop-src">© OpenStreetMap contributors</p>`;
        const marker = L.marker([place.lat, place.lng], {
          icon: placeDivIcon(place),
          title,
          alt: title,
          bubblingMouseEvents: false,
        });
        marker.addTo(placeLayer).bindPopup(html, popOpts(map, 260));
        marker.on('popupopen', () => addNote(`place:${place.id}`, html, place.lat, place.lng));
      }
    };

    const load = () => {
      timer = null;
      if (!alive || !placesOn || map.getZoom() < PLACE_ZOOM || !navigator.onLine) return;
      const visible = map.getBounds();
      const box = snapBounds({
        south: visible.getSouth(),
        west: visible.getWest(),
        north: visible.getNorth(),
        east: visible.getEast(),
      });
      const key = boundsKey(box);
      const cached = placeCache.get(key);
      if (cached) {
        draw(cached);
        return;
      }

      controller?.abort();
      const request = new AbortController();
      controller = request;
      setPlacesLoading(true);
      void fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: buildOverpassQuery(box) }),
        signal: request.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error('Places unavailable');
          return response.json() as Promise<{ elements?: OverpassElement[] }>;
        })
        .then((data) => {
          if (!alive || request.signal.aborted) return;
          const rows = placesFromElements(Array.isArray(data.elements) ? data.elements : []);
          placeCache.set(key, rows);
          draw(rows);
        })
        .catch(() => {})
        .finally(() => {
          if (controller !== request) return;
          controller = null;
          setPlacesLoading(false);
        });
    };

    const update = () => {
      cancel();
      if (!placesOn || map.getZoom() < PLACE_ZOOM) {
        placeLayer.clearLayers();
        return;
      }
      if (navigator.onLine) timer = window.setTimeout(load, 600);
    };

    map.on('movestart', cancel);
    map.on('moveend', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', cancel);
    update();
    return () => {
      alive = false;
      cancel();
      map.off('movestart', cancel);
      map.off('moveend', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', cancel);
    };
  }, [placesOn, addNote]);

  // Regional data is fetched once; the tick rebuilds the hotspot layers when it lands.
  useEffect(() => {
    let alive = true;
    void loadSeq().then(() => {
      if (alive) setSeqTick((tick) => tick + 1);
    });
    void loadSpotData([]).then((result) => {
      if (alive) setEbirdSpots(result.source === 'eBird' ? result.spots : null);
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
    // A redraw for new data (her sightings, the regional data) must not close the popup she has open.
    const reopenHotspot = hotspotMarkersRef.current.find(({ mk }) => mk.isPopupOpen())?.h.name;
    const reopenGroup = groupMarkersRef.current.find(({ mk }) => mk.isPopupOpen())?.key;
    overlay.clearLayers();
    hotspotMarkersRef.current = [];
    groupMarkersRef.current = [];

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
          popOpts(map),
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
            `<strong>${esc(focus.name)}</strong><br>${count.toLocaleString(
              'en-AU',
            )} records in this 1 km square since 2016`,
            popOpts(map),
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
        const spotId = hotspotSpotIds.get(view.h.name);
        marker
          .addTo(overlay)
          .bindPopup(
            `<div data-desc><span class="pop-h">${esc(view.h.name)}</span>${
              view.h.rich
            } dex birds recorded here. You have seen ${view.got}.<p class="pop-src">Looking up this place…</p></div>
            ${
              view.need.length
                ? `Still to find (${view.needAll.length}):<ul class="pop-need">${view.need
                    .map((sp) => `<li><a href="#/bird/${sp.id}">${esc(sp.name)}</a></li>`)
                    .join('')}</ul>`
                : ''
            }
            <a href="${directionsUrl(view.h.lat, view.h.lng)}" target="_blank" rel="noopener">Directions</a>${
              spotId != null ? ` · <a href="#/spot/${spotId}">Spot details</a>` : ''
            }`,
            popOpts(map, 260),
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
      const groupMarker = L.circleMarker([group.lat, group.lng], {
        radius: Math.min(14, 6 + group.names.length),
        color: '#fff',
        weight: 2,
        fillColor: dot,
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      });
      groupMarkersRef.current.push({ key: group.key, mk: groupMarker });
      groupMarker
        .addTo(overlay)
        .bindPopup(
          `<strong>${esc(group.items[0].place || 'Sighting')}</strong><br>${group.names
            .slice(0, 12)
            .map((sp) => `<a href="#/bird/${sp.id}">${esc(sp.name)}</a>`)
            .join('<br>')}${group.names.length > 12 ? `<br>and ${group.names.length - 12} more` : ''}`,
          popOpts(map),
        );
    }

    if (reopenHotspot) hotspotMarkersRef.current.find(({ h }) => h.name === reopenHotspot)?.mk.openPopup();
    else if (reopenGroup) groupMarkersRef.current.find(({ key }) => key === reopenGroup)?.mk.openPopup();

    // /map/at/:lat,:lng (v1): once the hotspots are drawn, open the one within about 200 m of the spot.
    if (atPendingRef.current && hotspots().length) {
      atPendingRef.current = false;
      const near =
        atLat != null && atLng != null
          ? hotspotMarkersRef.current.find(
              ({ h }) => Math.abs(h.lat - atLat) < 0.002 && Math.abs(h.lng - atLng) < 0.002,
            )
          : undefined;
      if (near) {
        window.setTimeout(() => {
          if (mapRef.current !== map) return;
          hotspotMarkersRef.current.find(({ h }) => h.name === near.h.name)?.mk.openPopup();
        }, 300);
      }
    }

    return () => {
      alive = false;
    };
    // atLat/atLng are fixed for this view (MapScreen keys it on the route).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqTick, patches, groups, hotspotView, hotspotSpotIds, focus, focusPoints, hotOn, need, addNote]);

  // Initial view for each route, fitted to the data once.
  useEffect(() => {
    if (!focus || focusFittedRef.current || viewRestoredRef.current || !focusPoints.length) return;
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      focusPoints.map(([pointLat, pointLng]) => [pointLat, pointLng] as [number, number]),
      { padding: [40, 40], maxZoom: 12 },
    );
    focusFittedRef.current = true;
  }, [focus, focusPoints]);

  useEffect(() => {
    if (focus || hasAt || sightingsFittedRef.current || viewRestoredRef.current) return;
    const map = mapRef.current;
    if (!map || !groups.length) return;
    map.fitBounds(
      groups.map((group) => [group.lat, group.lng] as [number, number]),
      { padding: [40, 40], maxZoom: 14 },
    );
    sightingsFittedRef.current = true;
  }, [groups, focus, hasAt]);

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

  // v1 js/app.js:2389: Lists' "New patch" opens the map in patch mode, near her when the phone says where.
  const { state: routeState } = useLocation();
  useEffect(() => {
    if ((routeState as { mapMode?: string } | null)?.mapMode !== 'patch') return;
    navigate(pathname, { replace: true, state: null });
    let alive = true;
    const start = () => { if (alive) openPatch(); };
    if (!navigator.geolocation) { start(); return () => { alive = false; }; }
    navigator.geolocation.getCurrentPosition(
      (p) => { if (alive) mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 14); start(); },
      start,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
    return () => { alive = false; };
    // Once, on arrival from Lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      appToast(`${name} added`);
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
      // The shared place search (lib/places, v1 searchAddress): one request a second across the app. Offline it says
      // that searching places needs a connection, as the location picker does; online, that the search failed.
      const remote = await searchAddress(text);
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
    setHasSearchPin(false);
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
    const marker = L.marker([result.lat, result.lng], { icon: searchPinIcon() })
      .addTo(map)
      .bindPopup(popupHtml, popOpts(map));
    tempMarkerRef.current = marker;
    setHasSearchPin(true);
    addNote(`search:${result.lat},${result.lng}`, popupHtml, result.lat, result.lng);
    window.setTimeout(() => {
      if (mapRef.current === map && marker.getElement()) marker.openPopup();
    }, 250);
  };

  // -- locate --------------------------------------------------------------

  // v1 getPosition() and the map's [data-locate] handler, with v1's copy.
  const locate = () => {
    if (!navigator.geolocation) {
      appToast('This browser cannot share location');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const map = mapRef.current;
        const me = meRef.current;
        if (!map || !me) return;
        // v1 is silent here; a screen reader cannot see the map move, so say so.
        announce('Showing where you are.');
        map.setView([position.coords.latitude, position.coords.longitude], 15);
        // One marker for where she is, not one more on every tap (v1 stacked them).
        me.clearLayers();
        L.circleMarker([position.coords.latitude, position.coords.longitude], {
          radius: 7,
          color: '#fff',
          weight: 3,
          fillColor: cssVar('--lori'),
          fillOpacity: 1,
        }).addTo(me);
        setLocated(true);
      },
      (error) => {
        setLocating(false);
        appToast(
          error.code === 1
            ? 'Location permission was denied. Allow it in your browser settings.'
            : 'Could not get your location. Try again outside or near a window.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const pickLayer = (next: Layer) => {
    layerPickedRef.current = true;
    setLayer(next);
    void (async () => {
      // Read first: a tap before the initial settings load must not replace the whole object.
      const current = ((await db.kvGet('settings')) as Settings | null) || {};
      await db.kvSet('settings', { ...current, mapLayer: next });
    })().catch(() => {});
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
      <h1 className="sr-only">Map</h1>
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
          aria-label="Map of your sightings and SEQ birding hotspots"
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
              placeholder="Search species and places"
              aria-label="Search the map"
              aria-controls={searchVisible ? 'map-search-results' : undefined}
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
                {closeIcon}
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

        <div className="map-ctl chips" role="group" aria-label="What the map shows">
          {focus && (
            <Link
              className="chip chip--on"
              to="/map"
              aria-label={`Stop showing ${focus.name}`}
            >
              {focus.name} <span aria-hidden="true">✕</span>
            </Link>
          )}
          {/* Each chip carries the colour of its marks on the map (rest.css), as in v1. */}
          {!noHot && (
            <button
              type="button"
              className={`chip ${hotOn ? 'chip--on' : ''}`}
              data-hot=""
              aria-pressed={hotOn}
              onClick={() => {
                if (focus) toggleHotFocus();
                else toggleHot();
              }}
            >
              Hotspots
            </button>
          )}
          <button
            type="button"
            className={`chip ${placesOn ? 'chip--on' : ''}`}
            data-places=""
            aria-pressed={placesOn}
            onClick={togglePlaces}
          >
            Places
          </button>
          {!focus && (
            <button
              type="button"
              className={`chip ${need ? 'chip--on' : ''}`}
              data-need=""
              aria-pressed={need}
              onClick={toggleNeed}
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
              data-mshow={value}
              aria-pressed={show === value}
              onClick={() => setShow(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" className="btn map-patch" onClick={openPatch}>
          <span className="map-patch-ring" aria-hidden="true" />New patch here
        </button>

        <button
          type="button"
          className={`map-fab${locating ? ' map-fab--busy' : ''}`}
          aria-label="Go to where I am"
          onClick={locate}
        >
          {/* v1's crosshair (js/app.js renderMap) */}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.4" fill="currentColor" />
            <path
              d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Sun: the Outdoor theme in one tap, above locate in the right-hand stack. */}
        <SunToggle className="map-sun" />

        <div className={`map-cross ${patchOpen ? '' : 'hidden'}`} aria-hidden="true" />

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

        <MapKey
          hotspotsOn={hotOn && hotspotView.length > 0}
          need={need && !focus}
          sightingsOn={groups.length > 0}
          patchesOn={patches.length > 0}
          focusOn={Boolean(focus && focusPoints.length)}
          located={located}
          searchPin={hasSearchPin}
          placesOn={placesOn && zoom >= PLACE_ZOOM}
        />

        {(noSignal || (placesOn && (zoom < PLACE_ZOOM || placesLoading))) && (
          <div className="map-note-stack">
            {noSignal && (
              <div className="map-note map-note--tiles">
                <p>
                  <strong>No signal.</strong> Areas you haven&apos;t opened before stay blank. Hotspots and your
                  sightings still show.
                </p>
                <button type="button" className="iconbtn" aria-label="Hide this message" onClick={hideNote}>
                  {closeIcon}
                </button>
              </div>
            )}
            {placesOn && zoom < PLACE_ZOOM && (
              <div className="map-note map-note--places">
                <p>Zoom in to see huts, toilets and lookouts</p>
              </div>
            )}
            {placesOn && placesLoading && zoom >= PLACE_ZOOM && (
              <div className="map-note map-note--places" role="status">
                <p>Finding huts, toilets and lookouts…</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* v1 startPatch: openSheet(..., { modal: false, cls: 'sheet-wrap--map' }). It is a layer, so Escape closes it
          and focus goes back to "New patch here", or to the h1 when it was opened from Lists. */}
      <Sheet open={patchOpen} onClose={closePatch} cls="sheet-wrap--map" modal={false} labelledBy="new-patch-title">
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
      </Sheet>

      <MapSummary
        focus={focus}
        unknownSpecies={speciesId != null && !focus}
        focusPoints={focusPoints}
        patches={patches}
        groups={groups}
        show={show}
        hotOn={hotOn}
        hotspotView={hotspotView}
        notes={notes}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen-reader summary
// ---------------------------------------------------------------------------

/**
 * Popup HTML as plain lines of text, one per top-level block (title, subtitle, paragraphs).
 * The summary is visually hidden, so it must not hold links: a keyboard user would Tab into
 * text they cannot see.
 */
export function noteLines(html: string): string[] {
  if (typeof DOMParser === 'undefined') {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? [text] : [];
  }
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
  const lines: string[] = [];
  root?.childNodes.forEach((node) => {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  });
  return lines;
}

const nameList = (names: Species[]): string => names.map((sp) => sp.name).join(', ');

interface MapSummaryProps {
  focus?: Species;
  unknownSpecies: boolean;
  focusPoints: [number, number, number][];
  patches: Patch[];
  groups: SightingGroup[];
  show: Show;
  hotOn: boolean;
  hotspotView: HotspotView[];
  notes: Note[];
}

/**
 * What the map shows, as text for screen readers. v1 has no such list; it is kept because
 * Leaflet's markers and popups cannot be reached without a pointer. It is visually hidden
 * and holds only text (no links, buttons or disclosure widgets), so Tab goes from the map
 * controls straight to the tab bar, as in v1.
 */
export function MapSummary({
  focus,
  unknownSpecies,
  focusPoints,
  patches,
  groups,
  show,
  hotOn,
  hotspotView,
  notes,
}: MapSummaryProps) {
  return (
    <section className="map-summary" aria-labelledby="map-summary-title">
      <h2 id="map-summary-title">Map details</h2>
      <p>
        The same information as the map popups, as text. {groups.length} sighting places and{' '}
        {hotspotView.length} hotspots are shown.
      </p>

      {focus ? (
        <section aria-labelledby="map-focus-title">
          <h3 id="map-focus-title">Reported here: {focus.name}</h3>
          {focusPoints.length ? (
            <>
              <p>{focusPoints.length} one-kilometre squares across SEQ, most records first.</p>
              <ul>
                {focusPoints.map(([pointLat, pointLng, count]) => (
                  <li key={`${pointLat},${pointLng}`}>
                    {count.toLocaleString('en-AU')} records in the 1 km square at{' '}
                    {pointLat.toFixed(3)}, {pointLng.toFixed(3)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No report points for this species yet.</p>
          )}
        </section>
      ) : unknownSpecies ? (
        <p>That species isn&apos;t in the dex.</p>
      ) : null}

      <section aria-labelledby="map-patches-title">
        <h3 id="map-patches-title">Your patches ({patches.length})</h3>
        {patches.length ? (
          <ul>
            {patches.map((patch) => (
              <li key={patch.id}>
                {patch.name}, {patch.radiusKm} km radius
              </li>
            ))}
          </ul>
        ) : (
          <p>No patches yet. Use “New patch here” to save one around the map centre.</p>
        )}
      </section>

      <section aria-labelledby="map-sightings-title">
        <h3 id="map-sightings-title">Your sightings on the map ({groups.length})</h3>
        {show === 'none' ? (
          <p>Sightings are hidden.</p>
        ) : groups.length ? (
          <ul>
            {groups.map((group) => (
              <li key={group.key}>
                {group.items[0].place || 'Sighting'}: {nameList(group.names.slice(0, 12))}
                {group.names.length > 12 ? ` and ${group.names.length - 12} more` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {show === 'photos'
              ? 'No sightings with photos are on the map yet.'
              : 'No sightings with a location yet.'}
          </p>
        )}
      </section>

      <section aria-labelledby="map-hotspots-title">
        <h3 id="map-hotspots-title">Birding hotspots ({hotspotView.length})</h3>
        {!hotOn ? (
          <p>Hotspots are hidden.</p>
        ) : hotspotView.length ? (
          <ul>
            {hotspotView.map((view) => (
              <li key={view.h.name}>
                {view.h.name}: {view.h.rich} dex birds recorded here. You have seen {view.got}.
                {view.needAll.length > 0 &&
                  ` Still to find (${view.needAll.length}): ${nameList(view.need)}.`}
              </li>
            ))}
          </ul>
        ) : (
          <p>{focus ? `No SEQ hotspots record ${focus.name}.` : 'No hotspots to show.'}</p>
        )}
      </section>

      <section aria-labelledby="map-notes-title">
        <h3 id="map-notes-title">Place details</h3>
        <div aria-live="polite">
          {notes.length ? (
            notes.map((note) => (
              <div key={note.key}>
                {noteLines(note.html).map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            ))
          ) : (
            <p>Tap the map, a hotspot, or a “reported here” point to read about a place.</p>
          )}
        </div>
      </section>
    </section>
  );
}
