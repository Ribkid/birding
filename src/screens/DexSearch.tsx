// Search everything (v1 js/app.js openSearch): species, hotspots, her patches and her sightings, in a full-screen
// layer. There is one overlay for the whole app, mounted once in App as <SearchHost />. openSearch() opens it from the
// dex's round button and empty state, the species page's hero and Scan's 'Search the dex', and '/' opens it on every
// screen, as v1's boot wired it. A result link closes it through the route change.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { GROUPS, HABITATS, KINDS, SPECIES, byId, dexCode, kindsPresent } from '../lib/data';
import { useMedia, useSightings } from '../lib/hooks';
import { closeLayer, openLayer, topLayer, type Layer } from '../lib/layers';
import { db } from '../core/db.js';
import { hotspots } from '../core/seqdata.js';
import { Band } from '../components/SpeciesImage';
import { ICON, Photo, fmtDate } from './dexParts';

interface SightingLike {
  id: number;
  speciesId: number;
  date: string;
  time?: string;
  place?: string;
  notes?: string;
}
interface Hotspot { name: string; lat: number; lng: number; rich: number }
interface PatchRow { id: number; name: string }

const IDEAS = ['kingfisher', 'koala', 'Oxley', 'wetlands', 'tree frog', 'gum'];

// The mounted host's opener. Before it mounts (and in tests that render a screen alone) opening does nothing.
let opener: ((initial: string) => void) | null = null;
/** Open Search everything, with `initial` already typed (v1 openSearch(initial)). It is ignored while it is open. */
export function openSearch(initial = '') {
  opener?.(initial);
}

// Her patches, kept current like her sightings, so the overlay draws whole the moment it opens (v1 held both in
// memory).
function usePatchRows(): PatchRow[] {
  const [rows, setRows] = useState<PatchRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void (db.all('patches') as Promise<PatchRow[]>).then((r) => { if (alive) setRows(r); }).catch(() => {}); };
    load();
    const off = db.onChange((name: string) => { if (name === 'patches') load(); });
    return () => { alive = false; off(); };
  }, []);
  return rows;
}

/** The app's one search overlay and its '/' key. Render it once, inside the router. */
export function SearchHost() {
  const [initial, setInitial] = useState<string | null>(null);
  const sightings = useSightings() as SightingLike[];
  const patches = usePatchRows();
  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);

  useEffect(() => {
    opener = (q) => setInitial((open) => open ?? q);
    // '/' opens it from any screen, as in v1, but not while she types in a field, and not over a sheet or the
    // welcome card (v1 would stack it on top of them).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || topLayer()) return;
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      setInitial((open) => open ?? '');
    };
    document.addEventListener('keydown', onKey);
    return () => { opener = null; document.removeEventListener('keydown', onKey); };
  }, []);

  if (initial == null) return null;
  return <DexSearch initial={initial} sightings={sightings} patches={patches} seen={seen} onClose={() => setInitial(null)} />;
}

function DexSearch({ initial, sightings, patches, seen, onClose }: {
  initial: string;
  sightings: SightingLike[];
  patches: PatchRow[];
  seen: Set<number>;
  onClose: () => void;
}) {
  useMedia();
  const ovRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [q, setQ] = useState(initial);

  useEffect(() => {
    const el = ovRef.current;
    if (!el) return;
    const hash = location.hash;
    const layer: Layer = openLayer(el, { label: 'Search', lock: true, close: () => closeRef.current() });
    // Escape and Tab come from the one layer-key listener in lib/layers.ts.
    inputRef.current?.focus();
    // Closed by a result link (the route changed): focus belongs to the new screen, not the search button.
    return () => {
      closeLayer(layer, { restore: location.hash === hash });
    };
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const words = needle.split(/\s+/);
    const hit = (txt: string) => words.every((w) => txt.toLowerCase().includes(w));
    const birds = SPECIES.filter((s) => hit(`${s.name} ${s.sci} ${dexCode(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one} ${s.habitats.map((h) => HABITATS[h]).join(' ')}`))
      .sort((a, b) => (a.name.toLowerCase().includes(needle) ? 0 : 1) - (b.name.toLowerCase().includes(needle) ? 0 : 1) || a.id - b.id)
      .slice(0, 12);
    const hs = (hotspots() as Hotspot[]).filter((h) => hit(h.name)).slice(0, 6);
    const pats = patches.filter((p) => hit(p.name));
    const mine = sightings.filter((s) => hit(`${s.place || ''} ${s.notes || ''} ${byId.get(s.speciesId)?.name || ''}`))
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))
      .slice(0, 8);
    return { birds, hs, pats, mine };
  }, [q, patches, sightings]);

  const sec = (title: string, items: React.ReactNode[]) => items.length ? (
    <>
      <h2 className="h2 pad-x">{title}</h2>
      <ul className="rows pad-x">{items}</ul>
    </>
  ) : null;

  let body: React.ReactNode;
  if (!results) {
    body = (
      <div className="search-try">
        <p className="small muted">Try one of these, or type any name, place or habitat.</p>
        <div className="chips">
          {IDEAS.map((t) => (
            <button key={t} type="button" className="chip" data-try={t} onClick={() => { setQ(t); inputRef.current?.focus(); }}>{t}</button>
          ))}
        </div>
      </div>
    );
  } else if (!results.birds.length && !results.hs.length && !results.pats.length && !results.mine.length) {
    body = <p className="muted pad">Nothing found. Check the spelling, or try part of a name.</p>;
  } else {
    body = (
      <>
        {sec(kindsPresent.length > 1 ? 'Species' : 'Birds', results.birds.map((s) => (
          <li key={s.id}>
            <Link className={`row row--sp kind--${s.kind}`} to={`/bird/${s.id}`}>
              <span className={`row-thumb ${seen.has(s.id) ? 'row-thumb--seen' : ''}`}><Photo sp={s} /></span>
              <span className="row-main"><strong>{s.name}</strong><span className="small muted">{GROUPS[s.group]}</span></span>
              <Band sp={s} seen={seen.has(s.id)} />
            </Link>
          </li>
        )))}
        {sec('Hotspots', results.hs.map((h) => (
          <li key={`${h.lat},${h.lng}`}>
            <Link className="row" to={`/map/at/${h.lat},${h.lng}`}>
              <span className="row-ic" aria-hidden="true">{ICON.pin}</span>
              <span className="row-main"><strong>{h.name}</strong><span className="small muted">{h.rich} dex birds recorded</span></span>
            </Link>
          </li>
        )))}
        {sec('Your patches', results.pats.map((p) => (
          <li key={p.id}>
            <Link className="row" to={`/patch/${p.id}`}>
              <span className="row-ic" aria-hidden="true">{ICON.outing}</span>
              <span className="row-main"><strong>{p.name}</strong></span>
            </Link>
          </li>
        )))}
        {sec('Your sightings', results.mine.map((s) => {
          const sp = byId.get(s.speciesId);
          return (
            <li key={s.id}>
              <Link className="row" to={`/bird/${s.speciesId}`}>
                {sp && <span className="row-thumb"><Photo sp={sp} /></span>}
                <span className="row-main">
                  <strong>{sp?.name}</strong>
                  <span className="small muted">{fmtDate(s.date)}{s.place ? `, ${s.place}` : ''}</span>
                </span>
              </Link>
            </li>
          );
        }))}
      </>
    );
  }

  return createPortal(
    <div
      ref={ovRef}
      className="search-ov"
      onClick={(e) => {
        const a = (e.target as Element).closest('a');
        if (a && a.getAttribute('href') === location.hash) onClose();
      }}
    >
      <div className="search-bar">
        {ICON.search}
        <input
          ref={inputRef}
          type="search"
          placeholder="Birds, animals, plants, places, hotspots"
          aria-label="Search everything"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="iconbtn" data-x="" aria-label="Close search" onClick={onClose}>{ICON.close}</button>
      </div>
      <div className="search-res" aria-live="polite">{body}</div>
    </div>,
    document.body,
  );
}
