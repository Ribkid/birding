// v1's "Log a sighting" sheet (birding-refresh js/app.js openSightingSheet, speciesPicker, wirePicker, fitSheetToKind)
// and its "New for your dex" celebration (celebrate, card3d.js confetti), as one shared piece.
//
// - openSightingSheet({ speciesId, sighting, autoGps, photoBlob, notes }) opens the sheet over the current route, as
//   v1's did: the species page's Log buttons and history, a long press on a dex tile, the + sheet's Log one sighting
//   and the All sightings rows. With `sighting` it is the Edit sighting sheet, with Delete.
// - SightingForm is the form itself; the #/add page (deep links and the Scan hand-off) uses it too.
// - SightingSheetHost, mounted once in App, draws the sheet and the celebration.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { db } from '../core/db.js';
import { sized } from '../core/media.js';
import { resizeImage } from '../core/profile.js';
import { ANIMALS, KINDS, byId, dexCode, ofKind, type Species } from '../lib/data';
import { useMedia } from '../lib/hooks';
import { closeLayer, openLayer, topLayer, type Layer } from '../lib/layers';
import { applyTint } from '../lib/look';
import { countUp } from '../lib/motion';
import { knownPlace, myPlaces, nearestPlaceName, recentPlaces, reverseGeocode } from '../lib/places';
import { toast } from '../lib/toast';
import {
  PhotoField,
  activeOutingOf,
  announceSaved,
  buildSighting,
  canBeHeard,
  deleteSighting,
  draftFromSighting,
  emptyDraft,
  fmtDate,
  getPosition,
  matchSpecies,
  notesHint,
  onCelebrate,
  todayStr,
  useLogData,
  useObjectUrl,
  writeSighting,
  type Celebration,
  type LogData,
  type SaveOutcome,
  type SightingDraft,
  type SightingInput,
  type SightingRow,
} from '../screens/lists/shared';
import { CardOverlay, askMotion, shareCard, type CardInfo } from '../screens/BirdCard';
import { Band } from './SpeciesImage';
import { Icon } from './Icon';
import { LocationPicker, type PickedPlace } from './LocationPicker';
import { Sheet } from './Sheet';
import './sightingSheet.css';

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A species photo with an empty alt, for the chosen card and the celebration, where the name is written right on it
 * (v1 birdImg with alt ''). It fades in when it arrives; a photo that fails shows v1's striped placeholder.
 */
function SpeciesPhoto({ sp, size, className = '' }: { sp: Species; size: 'small' | 'large'; className?: string }) {
  useMedia();
  const url = sized(sp.id, size) as string | null;
  const ref = useRef<HTMLImageElement>(null);
  const [look, setLook] = useState<'' | 'in' | 'missing'>('');
  useLayoutEffect(() => {
    const el = ref.current;
    setLook(el?.complete && el.naturalWidth ? 'in' : '');
  }, [url]);
  if (!url) return <span className={`${className} img-missing`.trim()} aria-hidden="true" />;
  return (
    <img
      ref={ref}
      className={`${className} fade${look === 'in' ? ' in' : look === 'missing' ? ' img-missing' : ''}`.trim()}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setLook('in')}
      onError={() => setLook('missing')}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Species picker                                                      */
/* ------------------------------------------------------------------ */

/**
 * v1 speciesPicker and wirePicker: the chosen species as a photo card with its band and a Change button top right,
 * or a search box that lists matching species. Change keeps the species until another is picked, as in v1.
 */
function Picker({ speciesId, seen, onPick }: { speciesId: number | null; seen: Set<number>; onPick: (sp: Species) => void }) {
  const sp = speciesId != null ? byId.get(speciesId) ?? null : null;
  const [searching, setSearching] = useState(!sp);
  const [query, setQuery] = useState('');
  const queryRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  // Where focus goes once the picker has redrawn: the search box after Change, the Change button after a pick.
  const focusNext = useRef<'query' | 'change' | null>(null);
  useEffect(() => {
    const target = focusNext.current === 'query' ? queryRef.current : focusNext.current === 'change' ? changeRef.current : null;
    focusNext.current = null;
    target?.focus({ preventScroll: true });
  }, [searching]);

  const results = matchSpecies(query);
  return (
    <div className="picker" data-picker="">
      <input type="hidden" name="speciesId" value={sp ? sp.id : ''} />
      <div className={`picker-chosen${searching || !sp ? ' hidden' : ''}`}>
        {sp && (
          <div className={`chosen kind--${sp.kind}`}>
            <SpeciesPhoto sp={sp} size="large" className="chosen-img" />
            <div className="chosen-txt">
              <Band sp={sp} seen={seen.has(sp.id)} />
              <strong>{sp.name}</strong>
              <em>{sp.sci}</em>
            </div>
            <button
              type="button"
              className="btn btn--small chosen-change"
              data-picker-change=""
              aria-label="Change species"
              ref={changeRef}
              onClick={() => {
                setQuery('');
                focusNext.current = 'query';
                setSearching(true);
              }}
            >
              Change
            </button>
          </div>
        )}
      </div>
      <div className={`picker-search${searching || !sp ? '' : ' hidden'}`}>
        <label className="field">
          <span>What did you see?</span>
          <input
            ref={queryRef}
            type="search"
            data-picker-q=""
            placeholder="Type a name, e.g. kookaburra"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && resultsRef.current?.querySelector('button')) {
                event.preventDefault();
                resultsRef.current.querySelector('button')?.focus();
              }
            }}
          />
        </label>
        <ul className="picker-results" data-picker-results="" ref={resultsRef}>
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-pick={item.id}
                onClick={() => {
                  onPick(item);
                  setQuery('');
                  focusNext.current = 'change';
                  setSearching(false);
                }}
              >
                <Band sp={item} seen={seen.has(item.id)} />
                <span>{item.name}</span>
              </button>
            </li>
          ))}
          {query.trim() !== '' && results.length === 0 && <li className="muted pad">Nothing by that name in the dex.</li>}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

export interface SightingFormProps {
  data: LogData;
  /** Edit this stored sighting (v1's openSightingSheet({ sightingId })). */
  existing?: SightingRow | null;
  speciesId?: number | null;
  /** Find her as the form opens (a long press in the dex, a scan), unless the sighting goes to a running outing. */
  autoGps?: boolean;
  /** A photo to start with (the Scan hand-off). */
  photoBlob?: Blob | null;
  notes?: string;
  className?: string;
  onCancel: () => void;
  /** After the record is stored. The caller closes the sheet or leaves the page, then announces the save. */
  onSaved: (rec: SightingInput, outcome: SaveOutcome) => void;
  /** Delete was tapped on an edit: the caller asks first. */
  onDelete?: () => void;
}

const coords = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

/**
 * v1's sighting form, in v1's order: the species card, How many and Heard only, Date and Time, Add to current outing,
 * Where (Use my location, Choose on map, the status line, Place name and recent places), the photo, Notes, then
 * Cancel and Save.
 */
export function SightingForm({
  data, existing = null, speciesId = null, autoGps = false, photoBlob = null, notes = '', className = '',
  onCancel, onSaved, onDelete,
}: SightingFormProps) {
  // v1 decides once, as the sheet opens, whether a running outing is offered (new sightings only).
  const [outing] = useState(() => (existing ? null : activeOutingOf(data)));
  const [toOuting, setToOuting] = useState(!!outing);
  const [draft, setDraft] = useState<SightingDraft>(() => (existing ? draftFromSighting(existing) : emptyDraft(speciesId, notes)));
  const [status, setStatus] = useState(() =>
    existing?.lat != null && existing.lng != null ? coords(existing.lat, existing.lng) : 'No location yet');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  // The photo: the stored one (when its blob is on this phone), a new one, or a removal, applied on save.
  const [storedPhoto, setStoredPhoto] = useState<Blob | null>(null);
  const [newPhoto, setNewPhoto] = useState<Blob | null>(photoBlob);
  const [removePhoto, setRemovePhoto] = useState(false);
  const photoUrl = useObjectUrl(newPhoto ?? (removePhoto ? null : storedPhoto));
  const saving = useRef(false);
  const alive = useRef(true);
  const live = useRef({ data, place: draft.place });
  live.current = { data, place: draft.place };
  const seen = useMemo(() => new Set(data.sightings.map((s) => s.speciesId)), [data.sightings]);
  const chips = useMemo(() => recentPlaces(data.sightings), [data.sightings]);
  const update = (patch: Partial<SightingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const storedId = existing?.photoId ?? null;
  useEffect(() => {
    if (storedId == null) return;
    let on = true;
    void Promise.resolve(db.get('photos', storedId))
      .then((photo: { blob?: Blob | null } | undefined) => { if (on && photo?.blob) setStoredPhoto(photo.blob); })
      .catch(() => {});
    return () => { on = false; };
  }, [storedId]);

  // Use my location: the place name fills in from her patch, a sighting nearby, or OpenStreetMap.
  const locate = async () => {
    setStatus('Finding you…');
    try {
      const pos = await getPosition();
      if (!alive.current) return;
      update({ lat: pos.lat, lng: pos.lng, acc: pos.acc, moved: true });
      setStatus(`${coords(pos.lat, pos.lng)} (±${pos.acc} m)`);
      if (!live.current.place) {
        const { patches, sightings } = live.current.data;
        const name = nearestPlaceName(pos, patches, sightings) || await reverseGeocode(pos);
        if (alive.current && name && !live.current.place) update({ place: name });
      }
    } catch (err) {
      if (alive.current) setStatus(err instanceof Error ? err.message : 'Could not get your location.');
    }
  };

  useEffect(() => {
    if (!autoGps || outing) return;
    const t = window.setTimeout(() => void locate(), 0);
    return () => window.clearTimeout(t);
    // Once, as the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A recent place she taps brings its spot along when it names a patch or one of her places.
  const pickChip = (name: string) => {
    const known = knownPlace(name, data.patches, myPlaces(data.sightings, data.outings));
    if (known) {
      update({ place: name, lat: known.lat, lng: known.lng, acc: null, moved: true });
      setStatus(coords(known.lat, known.lng));
    } else update({ place: name });
  };
  const picked = (r: PickedPlace | null) => {
    setPicking(false);
    if (!r) return;
    update({ lat: r.lat, lng: r.lng, acc: null, moved: true, ...(r.place ? { place: r.place } : {}) });
    setStatus(coords(r.lat, r.lng));
  };

  // v1 resizes a picked photo (1600 px, JPEG 0.82) before keeping it.
  const pickPhoto = async (file: File) => {
    setError('');
    const blob = await resizeImage(file);
    if (!alive.current) return;
    if (!blob) {
      setError("That file couldn't be opened as a photo.");
      return;
    }
    setNewPhoto(blob);
    setRemovePhoto(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const base = existing ? { ...existing } : {};
    const into = outing && toOuting ? outing : null;
    const check = buildSighting(draft, base, { outing: into });
    if (!check.rec) {
      setError(check.error ?? 'That sighting is not complete.');
      return;
    }
    setError('');
    saving.current = true;
    const oldPhotoId = storedId;
    let added: number | null = null;
    try {
      let photoId: number | null | undefined;
      if (newPhoto) {
        added = Number(await db.add('photos', { blob: newPhoto, at: Date.now() }));
        photoId = added;
      } else if (removePhoto && oldPhotoId != null) photoId = null;
      const { rec } = buildSighting(draft, base, { outing: into, photoId });
      if (!rec) throw new Error('incomplete');
      const outcome = await writeSighting(rec);
      // The old photo goes only once the record no longer points at it.
      if (oldPhotoId != null && rec.photoId !== oldPhotoId) await db.del('photos', oldPhotoId).catch(() => {});
      onSaved(rec, outcome);
    } catch {
      if (added != null) await db.del('photos', added).catch(() => {});
      if (!alive.current) return;
      setError(existing ? 'The change could not be saved. Try again.' : 'The sighting could not be saved. Try again.');
      saving.current = false;
    }
  };

  return (
    <>
    <form className={`form ${className}`.trim()} onSubmit={save} noValidate>
      <Picker
        speciesId={draft.speciesId}
        seen={seen}
        onPick={(sp) => update({ speciesId: sp.id, ...(sp.kind === 'plant' ? { heard: false } : {}) })}
      />

      <div className="grid2">
        <label className="field">
          <span>How many</span>
          <div className="stepper">
            <button type="button" data-step="-1" aria-label="One fewer" onClick={() => update({ count: String(Math.max(1, (Number(draft.count) || 0) - 1)) })}>
              −
            </button>
            <input
              name="count"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.count}
              placeholder="?"
              aria-label="Count"
              onChange={(event) => update({ count: event.target.value })}
            />
            <button type="button" data-step="1" aria-label="One more" onClick={() => update({ count: String(Math.max(1, (Number(draft.count) || 0) + 1)) })}>
              +
            </button>
          </div>
        </label>
        <label className={`check${canBeHeard(draft.speciesId) ? '' : ' hidden'}`} data-heard="">
          <input type="checkbox" name="heard" checked={!!draft.heard} onChange={(event) => update({ heard: event.target.checked })} />
          <span>Heard only</span>
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Date</span>
          <input type="date" name="date" value={draft.date} max={todayStr()} onChange={(event) => update({ date: event.target.value })} />
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" name="time" value={draft.time} onChange={(event) => update({ time: event.target.value })} />
        </label>
      </div>

      {outing && (
        <label className="check check--card">
          <input type="checkbox" name="toOuting" checked={toOuting} onChange={(event) => setToOuting(event.target.checked)} />
          <span>Add to current outing at {outing.place || 'this spot'}</span>
        </label>
      )}

      <fieldset className={`loc${outing && toOuting ? ' hidden' : ''}`} data-outing-hides={outing ? '' : undefined}>
        <legend>Where</legend>
        <div className="loc-row">
          <button type="button" className="btn" data-gps="" onClick={() => void locate()}><Icon name="pin" /> Use my location</button>
          <button type="button" className="btn" data-pickmap="" onClick={() => setPicking(true)}><Icon name="search" /> Choose on map</button>
        </div>
        <span className="muted small" role="status" data-gps-status="">{status}</span>
        <label className="field">
          <span>Place name</span>
          <input name="place" value={draft.place} placeholder="e.g. Oxley Creek Common" autoComplete="off" onChange={(event) => update({ place: event.target.value })} />
        </label>
        <div className="chips chips--scroll" data-recent="">
          {chips.map((name) => (
            <button key={name} type="button" className="chip" data-place={name} onClick={() => pickChip(name)}>{name}</button>
          ))}
        </div>
      </fieldset>

      <PhotoField
        url={photoUrl}
        onPick={(file) => void pickPhoto(file)}
        onRemove={() => {
          setNewPhoto(null);
          setRemovePhoto(true);
        }}
      />

      <label className="field">
        <span>Notes</span>
        <textarea name="notes" rows={2} value={draft.notes} placeholder={notesHint(draft.speciesId)} onChange={(event) => update({ notes: event.target.value })} />
      </label>

      <p className="form-error" data-error="" role="alert">{error}</p>

      <div className="row-end">
        {existing && onDelete && (
          <>
            <button type="button" className="btn btn--danger btn--quiet" data-delete="" onClick={onDelete}>Delete</button>
            <span className="spacer" />
          </>
        )}
        <button type="button" className="btn" data-close="" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary">{existing ? 'Save changes' : 'Save sighting'}</button>
      </div>
    </form>
    {/* A layer over the sheet: Escape closes only the picker. */}
    {picking && <LocationPicker init={{ lat: draft.lat, lng: draft.lng, place: draft.place }} onDone={picked} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

export interface SightingSheetRequest {
  speciesId?: number | null;
  /** Edit this sighting instead of logging a new one. */
  sighting?: SightingRow | null;
  autoGps?: boolean;
  photoBlob?: Blob | null;
  notes?: string;
}

/** After a delete takes away the control that opened the sheet, focus goes to the page heading, as v1's redraw did. */
function headingIfLost() {
  const view = document.getElementById('view');
  if (!view) return;
  const lost = () => { const a = document.activeElement; return !a || a === document.body || !a.isConnected; };
  const fix = () => {
    if (!lost() || topLayer()) return false;
    const h = view.querySelector<HTMLElement>('h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } else view.focus({ preventScroll: true });
    return true;
  };
  const watch = new MutationObserver(() => { if (fix()) watch.disconnect(); });
  watch.observe(view, { childList: true, subtree: true });
  window.setTimeout(() => { watch.disconnect(); fix(); }, 1200);
}

function SightingSheet({ req, data, swap, onClose }: { req: SightingSheetRequest; data: LogData; swap: boolean; onClose: () => void }) {
  const existing = req.sighting ?? null;
  // v1 asks before deleting in a sheet that replaces this one; closing it, either way, closes both.
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const headingId = useId();
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  const saved = (rec: SightingInput, outcome: SaveOutcome) => {
    close();
    announceSaved(rec, outcome);
    if (existing) toast('Changes saved');
    else if (!outcome.isNew) toast(`${byId.get(rec.speciesId as number)?.name ?? 'Sighting'} saved`);
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await deleteSighting(existing);
    } catch {
      close();
      toast('The sighting could not be deleted. Try again.');
      return;
    }
    close();
    toast('Sighting deleted');
    headingIfLost();
  };

  const cls = step === 'confirm' ? 'sheet-wrap--swap' : `sheet-wrap--log${swap ? ' sheet-wrap--swap' : ''}`;
  return (
    <Sheet open onClose={close} labelledBy={headingId} cls={cls} step={step}>
      {step === 'form' ? (
        <>
          <h2 className="sheet-title" id={headingId}>{existing ? 'Edit sighting' : 'Log a sighting'}</h2>
          <SightingForm
            data={data}
            existing={existing}
            speciesId={req.speciesId ?? null}
            autoGps={!!req.autoGps}
            photoBlob={req.photoBlob ?? null}
            notes={req.notes ?? ''}
            onCancel={close}
            onSaved={saved}
            onDelete={() => setStep('confirm')}
          />
        </>
      ) : (
        <>
          <h2 className="sheet-title" id={headingId}>Delete this sighting?</h2>
          <p className="muted">It will be removed from your lists. This cannot be undone.</p>
          <div className="row-end">
            <button type="button" className="btn" data-no="" onClick={close}>Cancel</button>
            <button type="button" className="btn btn--danger" data-yes="" onClick={() => void remove()}>Delete</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* New for your dex                                                    */
/* ------------------------------------------------------------------ */

/** v1 card3d.js confetti: feathers burst from the card. Not under reduced motion. */
function confetti(colours = ['#F5C518', '#1A5FCC', '#E4531C', '#2F7D5B', '#ffffff']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  const g = c.getContext('2d');
  if (!g) return;
  document.body.append(c);
  g.scale(devicePixelRatio, devicePixelRatio);
  const parts = Array.from({ length: 70 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 11 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
    s: 6 + Math.random() * 8, c: colours[(Math.random() * colours.length) | 0], sway: Math.random() * 6,
  }));
  let t = 0;
  const step = () => {
    t++;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.25; p.vx *= 0.99; p.vy = Math.min(p.vy, 3.2);
      p.x += p.vx + Math.sin((t + p.sway * 10) / 12) * 1.2; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      // A simple feather: the vane, then the quill.
      g.fillStyle = p.c;
      g.beginPath(); g.ellipse(0, 0, p.s * 0.35, p.s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -p.s); g.lineTo(0, p.s * 1.3); g.stroke();
      g.restore();
    }
    if (t < 200 && c.isConnected) requestAnimationFrame(step); else c.remove();
  };
  step();
}

/**
 * v1 celebrate(): a big photo card springs in, the band clamps on and the count stamps up by one. Share, See card
 * and Nice; Escape, a tap outside or a route change close it, and focus goes back to whatever opened the sheet.
 */
function CelebrationCard({ c, onDone, onCard }: { c: Celebration; onDone: () => void; onCard: (sp: Species, info: CardInfo) => void }) {
  const sp = byId.get(c.speciesId) as Species;
  const [id] = useState(() => `cel-${sp.id}-${Date.now()}`);
  const [out, setOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const niceRef = useRef<HTMLButtonElement>(null);
  const nRef = useRef<HTMLElement>(null);
  const allRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<Layer | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const seen = new Set(c.sightings.map((s) => s.speciesId));
  const ofIt = ofKind(sp.kind);
  const got = ofIt.filter((x) => seen.has(x.id)).length;
  const animalsGot = ANIMALS.filter((x) => seen.has(x.id)).length;
  const verb = sp.kind === 'plant' ? 'found' : 'seen';
  // The overall animal tally only adds something once the dex holds more than birds.
  const total = sp.kind !== 'plant' && ANIMALS.length > ofIt.length;
  const hist = c.sightings.filter((s) => s.speciesId === sp.id)
    .sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`));
  const first = hist[hist.length - 1];
  const info: CardInfo = { seen: true, isNew: true, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };

  // Closing gives focus back to whatever opened the sheet. A route change removes the card at once; otherwise it
  // fades out.
  const done = (reason?: string) => {
    const layer = layerRef.current;
    if (!layer || !closeLayer(layer, { restore: reason !== 'nav' })) return false;
    layerRef.current = null;
    if (reason === 'nav') { doneRef.current(); return true; }
    // Focus is never left on the card as it fades out.
    if (wrapRef.current?.contains(document.activeElement)) {
      const h = document.querySelector<HTMLElement>('#view h1');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
    setOut(true);
    window.setTimeout(() => doneRef.current(), 220);
    return true;
  };
  const doneFn = useRef(done);
  doneFn.current = done;

  useEffect(() => {
    const wrap = wrapRef.current, card = cardRef.current;
    if (!wrap || !card) return;
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.([60, 40, 120]);
    confetti();
    // Focus goes back to what opened the sheet. When nothing holds it (the #/add page has just gone, or the outing's
    // + button was busy), it lands on the page heading, as v1 did for a control that was redrawn away.
    let back = document.activeElement;
    if (!back || back === document.body || !back.isConnected) {
      const h = document.querySelector<HTMLElement>('#view h1');
      if (h) { h.tabIndex = -1; back = h; }
    }
    const layer = openLayer(wrap, { dialog: card, labelledBy: `${id}-k ${id}-h`, returnTo: back, close: (reason) => doneFn.current(reason) });
    layerRef.current = layer;
    // While the large photo loads, show the small one she has just seen in the dex.
    const small = sized(sp.id, 'small') as string | null;
    if (frameRef.current && small) frameRef.current.style.backgroundImage = `url("${small.replace(/"/g, '%22')}")`;
    const tintFrom = small || (sized(sp.id, 'large') as string | null);
    if (tintFrom) void applyTint(card, tintFrom, getComputedStyle(card).getPropertyValue('--kc').trim() || null);
    niceRef.current?.focus({ preventScroll: true });
    // The count lands after the card has sprung in.
    void countUp(nRef.current, got - 1, got, { delay: 420 });
    if (total) void countUp(allRef.current, animalsGot - 1, animalsGot, { delay: 560 });
    return () => {
      if (layerRef.current) { closeLayer(layerRef.current, { restore: false }); layerRef.current = null; }
    };
    // Drawn once for this save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={wrapRef} className={`celebrate${out ? ' celebrate--out' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) done('button'); }}>
      <div ref={cardRef} className={`celebrate-card kind--${sp.kind}`}>
        <div ref={frameRef} className="celebrate-photo">
          <SpeciesPhoto sp={sp} size="large" />
          <div className="celebrate-over">
            <p className="celebrate-kicker" id={`${id}-k`}>New for your dex</p>
            <h2 id={`${id}-h`}>{sp.name}</h2>
          </div>
          <span className={`band band--${sp.kind} band--on band--big band--clamp`}>{dexCode(sp.id)}</span>
        </div>
        <div className="celebrate-body">
          <p className="celebrate-count">
            <b className="celebrate-n" data-count="" ref={nRef}>{got}</b> of {ofIt.length} {KINDS[sp.kind]?.label.toLowerCase()} {verb}
          </p>
          {total && (
            <p className="celebrate-total small muted"><span data-count-all="" ref={allRef}>{animalsGot}</span> of {ANIMALS.length} animals in your dex</p>
          )}
          {c.newBadges.length > 0 && (
            <p className="celebrate-badges">
              Badge earned:{' '}
              {c.newBadges.map((b, i) => <Fragment key={b.id}>{i ? ', ' : ''}<strong>{b.name}</strong></Fragment>)}
            </p>
          )}
          <div className="row-center">
            <button type="button" className="btn" data-share="" onClick={() => void shareCard(sp, info)}><ShareIcon /> Share</button>
            <button type="button" className="btn" data-card="" onClick={() => { askMotion(); if (done('button')) onCard(sp, info); }}>See card</button>
            <button type="button" className="btn btn--primary" data-dismiss="" ref={niceRef} onClick={() => done('button')}>Nice</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Opening it from anywhere                                            */
/* ------------------------------------------------------------------ */

let opener: ((req: SightingSheetRequest) => void) | null = null;

/** v1 openSightingSheet: the Log a sighting sheet (or, with `sighting`, Edit sighting) over the current route. */
export function openSightingSheet(req: SightingSheetRequest = {}) {
  opener?.(req);
}

/** Mounted once in App: the sighting sheet, the celebration after a first sighting, and the card it can open. */
export function SightingSheetHost() {
  const { pathname } = useLocation();
  // Kept loaded all the time, as v1 held its state in memory, so the sheet opens complete.
  const data = useLogData();
  const [sheet, setSheet] = useState<{ key: number; req: SightingSheetRequest; swap: boolean } | null>(null);
  const [party, setParty] = useState<(Celebration & { key: number; path: string }) | null>(null);
  const [card, setCard] = useState<{ sp: Species; info: CardInfo } | null>(null);
  const seq = useRef(0);
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    // A sheet already up (the + sheet) is replaced, and the scrim stays up as it is (v1 sheet-wrap--swap).
    opener = (req) => setSheet({ key: ++seq.current, req, swap: !!document.querySelector('.sheet-wrap') });
    const off = onCelebrate((c) => setParty({ ...c, key: ++seq.current, path: path.current }));
    return () => { opener = null; off(); };
  }, []);

  // A celebration raised by the #/add page waits for the page it returns to.
  const showParty = party && byId.has(party.speciesId) && (!party.afterNav || pathname !== party.path);
  return (
    <>
      {sheet && data && <SightingSheet key={sheet.key} req={sheet.req} data={data} swap={sheet.swap} onClose={() => setSheet(null)} />}
      {showParty && (
        <CelebrationCard
          key={party.key}
          c={party}
          onDone={() => setParty((p) => (p && p.key === party.key ? null : p))}
          onCard={(sp, info) => setCard({ sp, info })}
        />
      )}
      {card && <CardOverlay sp={card.sp} info={card.info} onClose={() => setCard(null)} />}
    </>
  );
}
