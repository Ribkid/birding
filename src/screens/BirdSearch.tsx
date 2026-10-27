// Search everything, opened from the species page's round search button: v1's openSearch (birding-refresh
// js/app.js:2760). Species, hotspots, her patches and her sightings, in a full-screen layer. A result link closes it
// through the route change. The CSS is v1's (.search-ov in screens.css and app.css).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { GROUPS, HABITATS, KINDS, SPECIES, byId, dexCode, kindsPresent, type Species } from '../lib/data';
import { useMedia } from '../lib/hooks';
import { closeLayer, onLayerKey, openLayer, type Layer } from '../lib/layers';
import { hotspots } from '../core/seqdata.js';
import { sized } from '../core/media.js';
import { Band } from '../components/SpeciesImage';
import { Icon } from '../components/Icon';
import { fmtDate, usePatches, type SightingRow } from './lists/shared';

interface Hotspot { name: string; lat: number; lng: number; rich: number }

const IDEAS = ['kingfisher', 'koala', 'Oxley', 'wetlands', 'tree frog', 'gum'];
const CloseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const OutingIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.4-6-10.2a6 6 0 0 1 12 0C18 15.6 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9.6 10.6l1.7 1.7 3.2-3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// The name is written next to each photo, so the photo itself isn't read out again.
function Thumb({ sp }: { sp: Species }) {
  const url = sized(sp.id, 'small') as string | null;
  if (!url) return <span className="img-missing" aria-hidden="true" />;
  return <img src={url} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.classList.add('img-missing')} />;
}

export function BirdSearch({ sightings, seen, onClose }: { sightings: SightingRow[]; seen: Set<number>; onClose: () => void }) {
  useMedia();
  const patches = usePatches();
  const ovRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [q, setQ] = useState('');

  useEffect(() => {
    const el = ovRef.current;
    if (!el) return;
    const hash = location.hash;
    const layer: Layer = openLayer(el, { label: 'Search', lock: true, close: () => closeRef.current() });
    // A keydown another listener has already handled (the shared one, where the app wires it) is left alone.
    const key = (e: KeyboardEvent) => { if (!e.defaultPrevented) onLayerKey(e); };
    document.addEventListener('keydown', key);
    inputRef.current?.focus();
    // Closed by a result link (the route changed): focus belongs to the new screen, not the search button.
    return () => {
      document.removeEventListener('keydown', key);
      closeLayer(layer, { restore: location.hash === hash });
    };
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const words = needle.split(/\s+/);
    const hit = (txt: string) => words.every((w) => txt.toLowerCase().includes(w));
    const birds = SPECIES.filter((s) => hit(`${s.name} ${s.sci} ${dexCode(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one} ${s.habitats.map((h) => HABITATS[h]).join(' ')}`))
      .sort((a, b) => (a.name.toLowerCase().includes(needle) ? 0 : 1) - (b.name.toLowerCase().includes(needle) ? 0 : 1) || a.id - b.id).slice(0, 12);
    const hs = (hotspots() as Hotspot[]).filter((h) => hit(h.name)).slice(0, 6);
    const pats = patches.filter((p) => hit(p.name));
    const mine = sightings.filter((s) => hit(`${s.place || ''} ${s.notes || ''} ${byId.get(s.speciesId)?.name || ''}`))
      .sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`)).slice(0, 8);
    return { birds, hs, pats, mine };
  }, [q, patches, sightings]);

  const sec = (title: string, items: ReactNode[]) => (items.length ? <><h2 className="h2 pad-x">{title}</h2><ul className="rows pad-x">{items}</ul></> : null);
  let body: ReactNode;
  if (!results) {
    // Before she types: a few ideas to tap, so the empty screen is a starting point.
    body = (
      <div className="search-try">
        <p className="small muted">Try one of these, or type any name, place or habitat.</p>
        <div className="chips">
          {IDEAS.map((t) => <button key={t} type="button" className="chip" data-try={t} onClick={() => { setQ(t); inputRef.current?.focus(); }}>{t}</button>)}
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
              <span className={`row-thumb ${seen.has(s.id) ? 'row-thumb--seen' : ''}`}><Thumb sp={s} /></span>
              <span className="row-main"><strong>{s.name}</strong><span className="small muted">{GROUPS[s.group]}</span></span>
              <Band sp={s} seen={seen.has(s.id)} />
            </Link>
          </li>
        )))}
        {sec('Hotspots', results.hs.map((h) => (
          <li key={`${h.lat},${h.lng},${h.name}`}>
            <Link className="row" to={`/map/at/${h.lat},${h.lng}`}>
              <span className="row-ic" aria-hidden="true"><Icon name="pin" /></span>
              <span className="row-main"><strong>{h.name}</strong><span className="small muted">{h.rich} dex birds recorded</span></span>
            </Link>
          </li>
        )))}
        {sec('Your patches', results.pats.map((p) => (
          <li key={p.id}>
            <Link className="row" to={`/patch/${p.id}`}>
              <span className="row-ic" aria-hidden="true"><OutingIcon /></span>
              <span className="row-main"><strong>{p.name}</strong></span>
            </Link>
          </li>
        )))}
        {sec('Your sightings', results.mine.map((s) => {
          const sp = byId.get(s.speciesId);
          return (
            <li key={s.id}>
              <Link className="row" to={`/bird/${s.speciesId}`}>
                {sp && <span className="row-thumb"><Thumb sp={sp} /></span>}
                <span className="row-main"><strong>{sp?.name}</strong><span className="small muted">{fmtDate(s.date)}{s.place ? `, ${s.place}` : ''}</span></span>
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
        // A result for the page she is already on changes no route, so it closes the search itself.
        const a = (e.target as Element).closest('a');
        if (a && a.getAttribute('href') === location.hash) onClose();
      }}
    >
      <div className="search-bar">
        <Icon name="search" />
        <input ref={inputRef} type="search" placeholder="Birds, animals, plants, places, hotspots" aria-label="Search everything" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="iconbtn" data-x="" aria-label="Close search" onClick={onClose}><CloseIcon /></button>
      </div>
      <div className="search-res" aria-live="polite">{body}</div>
    </div>,
    document.body,
  );
}
