import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../core/db.js';
import { byId, type Species } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { LocationPicker, type PickedPlace } from '../../components/LocationPicker';
import { SpeciesImage } from '../../components/SpeciesImage';
import { SunToggle } from '../../components/SunToggle';
import { announce, toast } from '../../lib/toast';
import { countOnTo, countUp, motionOK, stamp } from '../../lib/motion';
import { useScreenWake } from '../../lib/wakeLock';
import { CountKey } from './hubParts';
import { FlockChooser, useHold } from './FlockChooser';
import { buzz, forgetTally, useTally } from './useTally';
import {
  ConfirmDialog,
  celebrate,
  deleteSighting,
  fmtDate,
  hideBadgeToast,
  liferBadges,
  matchSpecies,
  plural,
  todayStr,
  useActiveOutingId,
  useOutingRows,
  useLiferBadges,
  useSettled,
  useSightingRows,
  type OutingRow,
  type SightingRow,
} from './shared';
import './lists.css';

const startOf = (outing: OutingRow): number => {
  if (outing.startedAt != null) return outing.startedAt;
  const parsed = Date.parse(`${outing.date}T${outing.time || '00:00'}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Minutes since the start, or null when the record has no usable start time. */
const minutesSinceStart = (outing: OutingRow): number | null => {
  const start = startOf(outing);
  if (!start) return null;
  return Math.max(0, Math.round((Date.now() - start) / 60000));
};

/**
 * The species new for her dex on this outing, as a row of their photos at the top of the Finish sheet, and the badges
 * they earned (this session's, which the toast said as she tapped: opening the sheet takes that toast down).
 */
function OutingLifers({ lifers, live }: { lifers: Species[]; live: boolean }) {
  useLiferBadges();
  if (!lifers.length) return null;
  const earned = [...new Map(lifers.flatMap((sp) => liferBadges(sp.id)).map((b) => [b.id, b])).values()];
  return (
    <section className="finish-lifers" aria-labelledby="finish-lifers-h">
      <p className="finish-lifers-h" id="finish-lifers-h">
        New for your dex {live ? 'today' : 'on this outing'}: <b>{lifers.length}</b>
      </p>
      <ul className="finish-lifers-row">
        {lifers.map((sp) => (
          <li key={sp.id} className={`kind--${sp.kind}`}>
            <span className="finish-lifer-ph">
              <SpeciesImage sp={sp} alt="" />
            </span>
            <span className="finish-lifer-name">{sp.name}</span>
          </li>
        ))}
      </ul>
      {earned.length > 0 && (
        <p className="finish-lifers-badges">
          Badge earned:{' '}
          {earned.map((b, i) => <Fragment key={b.id}>{i ? ', ' : ''}<strong>{b.name}</strong></Fragment>)}
        </p>
      )}
    </section>
  );
}

/** v1 openFinishOuting (js/app.js:848): the Finish outing / Outing details sheet. */
function FinishOuting({
  outing,
  sightingCount,
  lifers,
  flush,
  onClose,
  onSaved,
}: {
  outing: OutingRow;
  sightingCount: number;
  /** The species this outing added to her dex. */
  lifers: Species[];
  /** Stores the tally's last taps first, so the outing's birds below are all of them. */
  flush: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultMinutes = outing.past ? 60 : Math.max(1, minutesSinceStart(outing) ?? 60);

  const [place, setPlace] = useState(outing.place ?? '');
  const [loc, setLoc] = useState<{ lat: number | null; lng: number | null }>({ lat: outing.lat ?? null, lng: outing.lng ?? null });
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(outing.date);
  const [time, setTime] = useState(outing.time);
  const [minutes, setMinutes] = useState(String(outing.durationMin || defaultMinutes));
  const [km, setKm] = useState(outing.distanceKm != null ? String(outing.distanceKm) : '');
  const [complete, setComplete] = useState(Boolean(outing.complete || !outing.endedAt));
  const [notes, setNotes] = useState(outing.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const picked = (r: PickedPlace | null) => {
    setPicking(false);
    if (!r) return;
    setLoc({ lat: r.lat, lng: r.lng });
    if (r.place) setPlace(r.place);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    const startAt = new Date(`${date}T${time || '00:00'}`);
    setSaving(true);
    try {
      await flush();
      const updated: OutingRow = {
        ...outing,
        endedAt: outing.endedAt || Date.now(),
        durationMin: parseInt(minutes, 10) || defaultMinutes,
        distanceKm: parseFloat(km) || 0,
        complete,
        notes: notes.trim(),
        place: place.trim(),
        date: date || outing.date,
        time: time || outing.time,
        startedAt: Number.isNaN(startAt.getTime()) ? outing.startedAt : startAt.getTime(),
        lat: loc.lat,
        lng: loc.lng,
      };
      await db.put('outings', updated);

      // Keep the outing's birds in step with its place and date.
      const all = (await db.all('sightings')) as SightingRow[];
      for (const rec of all.filter((row) => row.outingId === outing.id)) {
        await db.put('sightings', {
          ...rec,
          date: updated.date,
          place: updated.place,
          lat: updated.lat ?? null,
          lng: updated.lng ?? null,
          ...(outing.past ? { time: updated.time } : {}),
        });
      }

      const active = await db.kvGet('activeOuting');
      if (Number(active) === outing.id) await db.kvSet('activeOuting', null);
      // onSaved says "Outing finished" once the page has drawn it (Outing).
      onSaved();
      onClose();
    } catch {
      setError('The outing could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet open onClose={onClose} cls="sheet-wrap--outing" labelledBy="outing-finish-h">
        <h2 className="sheet-title" id="outing-finish-h">{outing.endedAt ? 'Outing details' : 'Finish outing'}</h2>
        <p className="muted">{plural(sightingCount, 'species', 'species')} so far.</p>
        <OutingLifers lifers={lifers} live={!outing.endedAt} />
        <form className="form" data-form="" onSubmit={save} noValidate>
          <label className="field">
            <span>Place name</span>
            <input
              name="place"
              value={place}
              autoComplete="off"
              onChange={(event) => setPlace(event.target.value)}
            />
          </label>
          <div className="loc-row">
            <button type="button" className="btn btn--small" data-pickmap="" onClick={() => setPicking(true)}>
              <Icon name="search" /> {loc.lat != null ? 'Move on map' : 'Choose on map'}
            </button>
            <span className="small muted" data-gps-status="">
              {loc.lat != null && loc.lng != null ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'No location yet'}
            </span>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                name="date"
                value={date}
                max={todayStr()}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Start time</span>
              <input
                type="time"
                name="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Duration (minutes)</span>
              <input
                name="dur"
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Distance walked (km)</span>
              <input
                name="km"
                inputMode="decimal"
                placeholder="0 if you stayed put"
                value={km}
                onChange={(event) => setKm(event.target.value)}
              />
            </label>
          </div>
          <label className="check check--card">
            <input
              type="checkbox"
              name="complete"
              checked={complete}
              onChange={(event) => setComplete(event.target.checked)}
            />
            <span>
              I logged every bird I could identify. eBird calls this a complete checklist.
            </span>
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              name="notes"
              rows={2}
              placeholder="Weather, tide, company…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="row-end">
            <button type="button" className="btn" data-close="" onClick={onClose}>
              {outing.endedAt ? 'Cancel' : 'Keep going'}
            </button>
            <button type="submit" className="btn btn--primary" aria-disabled={saving || undefined}>
              {outing.endedAt ? 'Save details' : 'Finish outing'}
            </button>
          </div>
        </form>
      </Sheet>
      {picking && <LocationPicker init={{ lat: loc.lat, lng: loc.lng, place }} onDone={picked} />}
    </>
  );
}

/** Where focus should land after a + or −, as v1's keepFocus(..., { fallback: '[data-tq], #view h1' }) did. */
type Refocus = { id: number; attr: 'data-inc' | 'data-dec'; until: number; spare: HTMLElement | null };

// The lifer moment on a tally row, instead of the card that made the page inert: the gold New band clamps onto the
// photo (the celebration card's leg-band clamp) and the "New for your dex" label glows gold once, 500 ms. --sun is
// the same yellow in every theme. Under reduced motion both are simply there.
const CLAMP: Keyframe[] = [
  { transform: 'translateY(-22px) scaleX(1.5)', opacity: 0 },
  { transform: 'translateY(0) scaleX(.9)', opacity: 1, offset: 0.6 },
  { transform: 'none', opacity: 1 },
];
const GLOW: Keyframe[] = [
  { backgroundColor: 'rgba(245, 197, 24, 0)', boxShadow: '0 0 0 4px rgba(245, 197, 24, 0)', transform: 'none' },
  { backgroundColor: 'rgba(245, 197, 24, .62)', boxShadow: '0 0 0 4px rgba(245, 197, 24, .62)', color: '#2A2000', transform: 'scale(1.06)', offset: 0.2 },
  { backgroundColor: 'rgba(245, 197, 24, 0)', boxShadow: '0 0 0 4px rgba(245, 197, 24, 0)', transform: 'none' },
];
function liferMoment(row: HTMLElement) {
  if (!motionOK() || typeof row.animate !== 'function') return;
  row.querySelector<HTMLElement>('.lifer-band')?.animate(CLAMP, { duration: 500, easing: 'cubic-bezier(.2, 1.4, .4, 1)' });
  row.querySelector<HTMLElement>('.lifer')?.animate(GLOW, { duration: 500, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

// A row counted down to 0 holds its place this long, with Undo where its + was, before it folds away and its sighting
// goes. The − that took it to 0, and any quick taps after it, land on that row, never on the one that would slide up
// into its place.
export const ZERO_HOLD_MS = 4000;
type ZeroState = { zeroed: ReadonlyMap<number, number>; folding: ReadonlySet<number> };
const NO_ZERO_STATE: ZeroState = { zeroed: new Map(), folding: new Set() };

/** The row folds shut (280 ms) and the rows under it close up; no fold under reduced motion. */
function foldRow(li: HTMLElement): Promise<unknown> {
  if (!motionOK() || document.hidden || typeof li.animate !== 'function') return Promise.resolve();
  const h = li.getBoundingClientRect().height;
  const a = li.animate(
    [
      { height: `${h}px`, minHeight: '0px', opacity: 1 },
      { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px', opacity: 0 },
    ],
    { duration: 280, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' },
  );
  // Once the row has gone from the page the fill goes too, so a row that comes back (a write taken back) is whole.
  return a.finished.finally(() => requestAnimationFrame(() => a.cancel())).catch(() => {});
}

/** Focus in a row that is going moves on: to the search box for a keyboard (v1's keepFocus), else to the heading. */
function focusOffRow(li: HTMLElement) {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !li.contains(a)) return;
  let keyboard = false;
  try { keyboard = a.matches(':focus-visible'); } catch { /* an older engine */ }
  const view = document.getElementById('view') ?? document.body;
  const to = (keyboard && view.querySelector<HTMLElement>('[data-tq]')) || view.querySelector<HTMLElement>('h1');
  if (!to) return;
  if (to.matches('h1')) to.tabIndex = -1;
  to.focus({ preventScroll: true });
}

// Screen on: a phone with an open eye on its screen (awake), not lines at its sides, which read as vibrate.
const ScreenOnIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="2.5" width="12" height="19" rx="2.6" />
    <path d="M8.3 11.2c2-2.9 5.4-2.9 7.4 0-2 2.9-5.4 2.9-7.4 0z" strokeWidth="1.7" />
    <circle cx="12" cy="11.2" r="1.25" fill="currentColor" stroke="none" />
    <path d="M10.8 18.4h2.4" />
  </svg>
);

/**
 * v1 renderOuting (js/app.js:2046): an outing's tally, live or finished. Drawn afresh for each outing, so nothing
 * held for one (a row at 0, the search, Screen on) carries over to another opened from the outing bar.
 */
export default function Outing() {
  const { id } = useParams();
  return <OutingPage key={id} />;
}

function OutingPage() {
  const { id } = useParams();
  const outingId = Number(id);
  const navigate = useNavigate();
  const outings = useOutingRows();
  const sightings = useSightingRows();
  const activeOutingId = useActiveOutingId();
  const settled = useSettled();

  const outing = outings.find((row) => row.id === outingId);

  const [query, setQuery] = useState('');
  const [editingBirds, setEditingBirds] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // The buttons stay enabled (v1's do), so a tap never drops focus to <body>; every tap counts (useTally).
  const refocus = useRef<Refocus | null>(null);
  // The rows a tap changed, and what they showed before it: the new number stamps in (v1's renderOuting).
  const stamps = useRef<{ id: number; from: number | null }[]>([]);
  // What each row showed at the last draw, so a running count-up follows a change it didn't start (a rollback).
  const drawn = useRef(new Map<number, number | null>());
  // The hold chooser, keyed so a late close of an older one leaves a newer one open.
  const [flock, setFlock] = useState<{ key: number; sp: Species; anchor: HTMLButtonElement } | null>(null);
  const flockKey = useRef(0);
  // Species a + has just made new for her dex, and until when: their rows play the lifer moment once drawn.
  const moments = useRef(new Map<number, number>());
  // A New band waiting for its bird's first save before it opens the card (seeCard).
  const cardWait = useRef(false);
  // "Outing finished" waits for the page to draw the finished outing, so the toast can rest clear of its buttons
  // (scrolled to the bottom, its usual place covered them for 4.5 s).
  const foot = useRef<HTMLDivElement>(null);
  const finishedNote = useRef(false);
  const sayFinished = () => {
    if (!finishedNote.current) return;
    finishedNote.current = false;
    toast('Outing finished', undefined, { clear: foot.current });
  };
  // Rows counted down to 0 that still hold their place (species → when they fold) and those folding shut now. The −1
  // that takes the sighting off goes to the tally only as the row goes, so Undo has nothing to put back. The ref is
  // what handlers read (it is set with the state, so two taps in one frame see each other).
  const [zeroState, setZeroState] = useState<ZeroState>(NO_ZERO_STATE);
  const zeros = useRef(zeroState);
  const setZeros = (next: ZeroState) => {
    zeros.current = next;
    setZeroState(next);
  };
  const zeroStamp = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const wake = useScreenWake(!!outing && !outing.endedAt);

  const recs = useMemo(
    () => sightings.filter((row) => row.outingId === outingId),
    [sightings, outingId],
  );

  const tally = useMemo(() => {
    const bySpecies = new Map<number, SightingRow>();
    for (const rec of recs) {
      const current = bySpecies.get(rec.speciesId);
      if (
        !current ||
        (rec.createdAt ?? 0) >= (current.createdAt ?? 0) ||
        (rec.count ?? 0) > (current.count ?? 0)
      ) {
        bySpecies.set(rec.speciesId, rec);
      }
    }
    return [...bySpecies.values()].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
  }, [recs]);

  // The stored sighting per species; useTally adds the taps not stored yet, so the rows draw from it.
  const counts = useMemo(() => new Map(tally.map((rec) => [rec.speciesId, rec])), [tally]);
  const tallied = useTally(outing, counts);
  const hold = useHold((anchor, sp) => setFlock({ key: ++flockKey.current, sp, anchor }));
  const talliedNow = useRef(tallied);
  useLayoutEffect(() => { talliedNow.current = tallied; });

  /** Gives the tally the −1s that rows at 0 were holding back: their sightings go. */
  const letGo = (ids: Iterable<number>) => {
    const t = talliedNow.current;
    for (const id of ids) {
      const row = t.get(id);
      if (row) t.tap(id, -(row.count ?? 1));
    }
  };
  // Every row at 0 goes at once: Finish, Discard, Done editing, leaving the outing or the app.
  const letAllGo = (redraw = true) => {
    const { zeroed, folding } = zeros.current;
    if (!zeroed.size && !folding.size) return;
    zeros.current = NO_ZERO_STATE;
    letGo(new Set([...zeroed.keys(), ...folding]));
    if (redraw) setZeroState(NO_ZERO_STATE);
  };
  // A row's time at 0 is up: it folds shut, then its sighting goes.
  const fold = (id: number) => {
    const { zeroed, folding } = zeros.current;
    if (!zeroed.has(id) || folding.has(id)) return;
    const z = new Map(zeroed);
    z.delete(id);
    setZeros({ zeroed: z, folding: new Set(folding).add(id) });
    const li = list.current?.querySelector<HTMLElement>(`:scope > [data-sp="${id}"]`) ?? null;
    if (li) focusOffRow(li);
    void (li ? foldRow(li) : Promise.resolve()).then(() => {
      if (!zeros.current.folding.has(id)) return; // already gone with the rest (Finish, leaving)
      const f = new Set(zeros.current.folding);
      f.delete(id);
      setZeros({ ...zeros.current, folding: f });
      letGo([id]);
    });
  };

  useEffect(() => {
    if (!zeroState.zeroed.size) return;
    const next = Math.min(...zeroState.zeroed.values());
    const t = window.setTimeout(() => {
      const now = Date.now();
      for (const [id, until] of zeros.current.zeroed) if (until <= now + 20) fold(id);
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
    // fold reads only refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeroState]);

  // Leaving the page or the app lets every row at 0 go, so the sighting is never left behind by a row she took off.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') letAllGo(); };
    const pagehide = () => letAllGo();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      letAllGo(false);
    };
    // letAllGo reads only refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seenOutside = useMemo(
    () =>
      new Set(
        sightings
          .filter((row) => row.outingId !== outingId)
          .map((row) => row.speciesId),
      ),
    [sightings, outingId],
  );

  // After a + or −, the control she pressed may be redrawn away: the row found by search moves into the tally, or a
  // count reaches zero. v1's keepFocus found its twin by data-inc / data-dec (a missing − falls back to the row's +),
  // then the search box, then the heading. The tally lands a moment after the write, so the search box holds focus
  // until the twin appears.
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    if (Date.now() > want.until) { refocus.current = null; return; }
    const view = document.getElementById('view');
    if (!view) return;
    const a = document.activeElement as HTMLElement | null;
    const lost = !a || a === document.body || !a.isConnected;
    if (!lost && a !== want.spare) return;
    if (want.spare && a === want.spare && (want.spare as HTMLInputElement).value) { refocus.current = null; return; }
    const twin = view.querySelector<HTMLElement>(`[${want.attr}="${want.id}"]`) || view.querySelector<HTMLElement>(`[data-inc="${want.id}"]`);
    if (twin) {
      twin.focus({ preventScroll: true });
      refocus.current = null;
      return;
    }
    if (!lost) return;
    const spare = view.querySelector<HTMLElement>('[data-tq]') || view.querySelector<HTMLElement>('h1');
    if (!spare) return;
    if (spare.matches('h1')) spare.tabIndex = -1;
    spare.focus({ preventScroll: true });
    want.spare = spare;
  });

  // v1: "The count stamps as it changes." The new number is drawn with the tap and stamps in before it is painted:
  // a step of one pops (STAMP easing, 120 ms), a flock counts up to it. A row a tap didn't change, but whose number
  // moved (a write taken back), carries a count-up that is still running on to it. Reduced motion: no stamp.
  useLayoutEffect(() => {
    const asked = stamps.current;
    stamps.current = [];
    const view = document.getElementById('view');
    const now = new Map(tallied.rows.map((r) => [r.speciesId, r.count]));
    const els = (id: number) => (view ? [...view.querySelectorAll<HTMLElement>(`[data-n="${id}"]`)] : []);
    const done = new Set<number>();
    for (const { id, from } of asked) {
      if (done.has(id)) continue;
      done.add(id);
      const to = now.get(id);
      if (typeof to !== 'number') continue;
      for (const el of els(id)) {
        if (countOnTo(el, to)) continue;
        if (from != null && Math.abs(to - from) > 1) void countUp(el, from, to);
        else stamp(el);
      }
    }
    for (const [id, to] of now) {
      if (done.has(id) || typeof to !== 'number' || drawn.current.get(id) === to) continue;
      for (const el of els(id)) countOnTo(el, to);
    }
    drawn.current = now;
  });

  useLayoutEffect(() => {
    if (!moments.current.size) return;
    const view = document.getElementById('view');
    for (const [id, until] of [...moments.current]) {
      const row = view?.querySelector<HTMLElement>(`.tally-list:not(.tally-list--found) [data-sp="${id}"]`);
      if (!row && Date.now() < until) continue;
      moments.current.delete(id);
      if (row) liferMoment(row);
    }
  });

  useLayoutEffect(() => {
    if (finishedNote.current && outing?.endedAt) sayFinished();
  });

  // The 0 a − took a row to stamps in like any other count.
  useLayoutEffect(() => {
    const id = zeroStamp.current;
    if (id == null) return;
    zeroStamp.current = null;
    for (const el of document.querySelectorAll<HTMLElement>(`[data-n0="${id}"]`)) stamp(el);
  });

  if (!outing) {
    return (
      <>
        <header className="page-head page-head--back">
          <Link className="iconbtn" to="/lists" aria-label="Back to lists">
            <Icon name="back" />
          </Link>
          <h1>Outing</h1>
        </header>
        <div className="pad">
          {settled ? (
            <>
              <p>That outing isn&apos;t on this device.</p>
              <Link className="btn" to="/lists">
                Back to lists
              </Link>
            </>
          ) : (
            <p className="muted">Looking for that outing…</p>
          )}
        </div>
      </>
    );
  }

  const live = !outing.endedAt;
  const editing = live || editingBirds;
  const results = query.trim() ? matchSpecies(query, 12) : [];
  const mins = live ? minutesSinceStart(outing) : outing.durationMin;

  // A tap counts at once and is never dropped: the row shows it straight away and useTally's writer stores the
  // taps in turn (one write per species for however many came in meanwhile). The stamp, a short buzz and focus
  // staying on the button she pressed answer each one.
  // A species that isn't on the tally and that she has never logged anywhere else: this + makes it new for her dex.
  // It gets its moment on the row as she taps (the save after it is quiet: no card), so the taps after it all count.
  const change = (sp: Species, delta: number): boolean => {
    refocus.current = { id: sp.id, attr: delta > 0 ? 'data-inc' : 'data-dec', until: Date.now() + 1500, spare: null };
    const { zeroed } = zeros.current;
    if (zeroed.has(sp.id)) {
      // A − on a row already at 0 does nothing but keep it there a little longer, under the thumb still tapping.
      if (delta < 0) {
        setZeros({ ...zeros.current, zeroed: new Map(zeroed).set(sp.id, Date.now() + ZERO_HOLD_MS) });
        return false;
      }
      // Undo (or a flock from holding it) puts the row back as it was: nothing had been taken off yet.
      const z = new Map(zeroed);
      z.delete(sp.id);
      setZeros({ ...zeros.current, zeroed: z });
      stamps.current.push({ id: sp.id, from: 0 });
      buzz(8);
      if (query) setQuery('');
      announce(`${sp.name} put back.`);
      if (delta === 1) return false;
      delta -= 1;
    }
    const cur = tallied.get(sp.id);
    // Down to 0: the row stays where it is, at 0 with Undo, until ZERO_HOLD_MS have passed.
    if (delta < 0 && cur && (cur.count ?? 1) + delta <= 0) {
      setZeros({ ...zeros.current, zeroed: new Map(zeros.current.zeroed).set(sp.id, Date.now() + ZERO_HOLD_MS) });
      zeroStamp.current = sp.id;
      buzz(8);
      announce(`${sp.name} taken off. Undo puts it back.`);
      return false;
    }
    const lifer = delta > 0 && !cur && !seenOutside.has(sp.id);
    stamps.current.push({ id: sp.id, from: cur ? cur.count : 0 });
    tallied.tap(sp.id, delta);
    if (lifer) moments.current.set(sp.id, Date.now() + 1500);
    buzz(lifer ? [20, 30, 40] : 8);
    if (delta > 0 && query) setQuery('');
    return lifer;
  };

  const add = (sp: Species) => {
    if (change(sp, 1)) announce(`${sp.name}, new for your dex`);
  };

  // A flock from the hold chooser: the count runs up to the new total and is read out once.
  const addFlock = (sp: Species, n: number) => {
    const was = zeros.current.zeroed.has(sp.id) ? 0 : tallied.get(sp.id)?.count;
    const lifer = change(sp, n);
    announce(`${lifer ? `${sp.name}, new for your dex. ` : ''}${n} more ${sp.name}, ${(was ?? 0) + n} in all.`);
  };

  // The New band's card: the celebration she would have had, when she has a moment for it, with the badge the save
  // earned. The card says the badge, so the toast that said it goes. A band tapped before its first save has landed
  // waits for it, so the card counts the bird (and opens only if she is still on the outing).
  const seeCard = async (sp: Species, band: HTMLElement) => {
    if (cardWait.current) return;
    let all = sightings;
    if (!all.some((s) => s.speciesId === sp.id)) {
      cardWait.current = true;
      try {
        await tallied.flush();
        all = (await db.all('sightings')) as SightingRow[];
      } catch {
        return;
      } finally {
        cardWait.current = false;
      }
      if (!band.isConnected || !all.some((s) => s.speciesId === sp.id)) return;
    }
    hideBadgeToast();
    celebrate({ speciesId: sp.id, newBadges: liferBadges(sp.id), sightings: all });
  };

  const tallyRow = (sp: Species, found = false) => {
    const row = tallied.get(sp.id);
    const firstEver = !seenOutside.has(sp.id);
    const until = zeroState.zeroed.get(sp.id);
    const goes = zeroState.folding.has(sp.id);
    const zero = !!row && (until != null || goes);
    const band = firstEver && !found && !!row && !zero;
    return (
      <li
        className={`tally-row ${row ? 'tally-row--on' : ''}${band ? ' tally-row--new' : ''}${zero ? ' tally-row--zero' : ''}${goes ? ' tally-row--folding' : ''}`}
        key={sp.id}
        data-sp={sp.id}
        inert={goes || undefined}
      >
        <Link className="tally-sp" to={`/bird/${sp.id}`}>
          <span className="row-thumb">
            <SpeciesImage sp={sp} />
          </span>
          <span>
            <strong>{sp.name}</strong>
            {zero ? <span className="tally-gone">Taken off</span> : firstEver && <span className="lifer">New for your dex</span>}
          </span>
        </Link>
        {band && (
          <button
            type="button"
            className="lifer-band"
            data-lifer={sp.id}
            // Starts with the brief's words and holds the visible "New", so "tap New" works by voice too.
            aria-label={`See ${sp.name}'s card, new for your dex`}
            onClick={(e) => {
              e.currentTarget.focus({ preventScroll: true });
              void seeCard(sp, e.currentTarget);
            }}
          >
            New
          </button>
        )}
        {editing ? (
          <div className="tally-ctl">
            {row && (
              <>
                <button
                  type="button"
                  data-dec={sp.id}
                  aria-label={`One fewer ${sp.name}`}
                  aria-disabled={zero || undefined}
                  onClick={() => change(sp, -1)}
                >
                  −
                </button>
                {zero ? (
                  <span className="tally-n" data-n0={sp.id}>0</span>
                ) : (
                  <span className="tally-n" data-n={sp.id}>
                    {row.count ?? 'X'}
                  </span>
                )}
              </>
            )}
            <button
              type="button"
              data-inc={sp.id}
              className={`tally-inc${zero ? ' tally-undo' : ''}`}
              aria-label={zero ? `Undo, put ${sp.name} back` : `Add ${sp.name}`}
              {...hold.bind(sp)}
              onClick={(e) => {
                if (!hold.swallowClick(e)) add(sp);
              }}
            >
              {zero ? (
                <>
                  Undo
                  {/* The time left before the row goes, as a ring that drains; started again by each − on it. */}
                  <span className="tally-undo-ring" key={until ?? 'going'} aria-hidden="true" style={{ animationDuration: `${ZERO_HOLD_MS}ms` }} />
                </>
              ) : (
                '+'
              )}
            </button>
          </div>
        ) : (
          <span className="tally-n">{row?.count ?? 'X'}</span>
        )}
      </li>
    );
  };

  const ordered = tallied.rows.map((row) => byId.get(row.speciesId)).filter((sp): sp is Species => !!sp);
  // Rows at 0 still hold their place, but no longer count.
  const onTally = tallied.rows.filter((r) => !zeroState.zeroed.has(r.speciesId) && !zeroState.folding.has(r.speciesId)).length;
  // The sightings Discard removes: the stored ones, less those counted down to 0, plus species not stored yet.
  const sightingTotal =
    recs.length - [...counts.keys()].filter((id) => !tallied.get(id)).length + tallied.rows.filter((row) => !counts.has(row.speciesId)).length;

  return (
    <>
      <header className={`page-head page-head--back${live ? ' page-head--tools' : ''}`}>
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <div className="lists-head-text">
          <h1>{outing.place || 'Outing'}</h1>
          <p className="muted small">
            {fmtDate(outing.date)}, started {outing.time}
            {mins != null ? `, ${mins} min` : ''}
            {!live ? (outing.complete ? '. Complete checklist.' : '.') : ''}
          </p>
        </div>
        {live && (
          // Two icon-sized glass toggles for the field: keep the screen awake, and the Outdoor theme for full sun.
          <div className="outing-tools" role="group" aria-label="Outing tools">
            {wake.supported && (
              <button
                type="button"
                className="tool-tog wake-toggle"
                aria-pressed={wake.on}
                aria-label="Keep the screen on"
                title={wake.on ? 'The screen stays on' : 'Keep the screen on'}
                data-wake=""
                onClick={wake.toggle}
              >
                <ScreenOnIcon />
              </button>
            )}
            <SunToggle />
          </div>
        )}
      </header>

      <div className="tally-sum">
        <p className="list-count">
          <CountKey k={`outing/${outing.id}`} value={onTally} /> species{!live && outing.distanceKm ? `, ${outing.distanceKm} km` : ''}
        </p>
        {live && <span className="ocard-live">In progress</span>}
      </div>

      {editing && (
        <>
          <div className="searchbox tally-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Add a species: type a name"
              value={query}
              data-tq=""
              aria-label="Find a species to add"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {query.trim() !== '' && (
            <ul className="tally-list rows--card tally-list--found">
              {results.length ? results.map((sp) => tallyRow(sp, true)) : <li className="muted pad">Nothing by that name in the dex.</li>}
            </ul>
          )}
        </>
      )}

      {ordered.length ? (
        <ul ref={list} className="tally-list rows--card">{ordered.map((sp) => tallyRow(sp))}</ul>
      ) : editing ? (
        <p className="empty-inline tally-empty">Search above to add the first species. Tap + again each time you count another.</p>
      ) : (
        <p className="empty-inline tally-empty">No species were logged on this outing.</p>
      )}

      {outing.notes && <p className="pad-x">{outing.notes}</p>}

      <div ref={foot} className={`tally-foot ${live ? 'tally-foot--live' : ''}`}>
        {/* Keyed so the Finish outing button stays the same element as it becomes Edit details: closing the sheet
            hands focus back to it. v1's restoreFocus did too, but the redraw after Finish then left focus on the
            page; keeping it on the button is deliberate. */}
        <button
          key="cancel"
          type="button"
          className="btn btn--danger btn--quiet"
          data-cancel=""
          onClick={() => { letAllGo(); setConfirmDelete(true); }}
        >
          {live ? 'Discard' : 'Delete outing'}
        </button>
        <span key="spacer" className="spacer" />
        {!live && (
          <button key="editbirds" type="button" className="btn" data-editbirds="" onClick={() => { if (editingBirds) letAllGo(); setEditingBirds(!editingBirds); setQuery(''); }}>
            {editing ? 'Done editing species' : 'Edit species'}
          </button>
        )}
        <button key="finish" type="button" className={`btn${live ? ' btn--primary' : ''}`} data-finish="" onClick={() => { letAllGo(); hideBadgeToast(); setFinishOpen(true); }}>
          {live ? 'Finish outing' : 'Edit details'}
        </button>
      </div>

      {finishOpen && (
        <FinishOuting
          outing={outing}
          sightingCount={tallied.rows.length}
          lifers={ordered.filter((sp) => !seenOutside.has(sp.id))}
          flush={tallied.flush}
          onClose={() => setFinishOpen(false)}
          onSaved={() => {
            setEditingBirds(false);
            finishedNote.current = true;
            // Said within a moment even if the store is slow to draw the outing as finished.
            window.setTimeout(sayFinished, 1200);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={live ? 'Discard this outing?' : 'Delete this outing?'}
          body={`This removes the outing and its ${plural(
            sightingTotal,
            'sighting',
          )}. This cannot be undone.`}
          confirmLabel={live ? 'Discard' : 'Delete'}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (busy) return;
            setBusy(true);
            try {
              // Taps not written yet go; one being written lands first, so it is deleted with the rest. The
              // database, not the store, says which sightings are on the outing now.
              await tallied.drop();
              const onIt = (await db.byIndex('sightings', 'outingId', outing.id)) as SightingRow[];
              for (const rec of onIt) await deleteSighting(rec);
              await db.del('outings', outing.id);
              forgetTally(outing.id);
              if (activeOutingId === outing.id) await db.kvSet('activeOuting', null);
              setConfirmDelete(false);
              navigate('/lists');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {flock && editing && (
        <FlockChooser
          key={flock.key}
          sp={flock.sp}
          anchor={flock.anchor}
          onPick={(n) => addFlock(flock.sp, n)}
          onClose={() => setFlock((f) => (f && f.key === flock.key ? null : f))}
        />
      )}
    </>
  );
}
