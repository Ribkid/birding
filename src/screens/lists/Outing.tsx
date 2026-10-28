import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../core/db.js';
import { byId, type Species } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { LocationPicker, type PickedPlace } from '../../components/LocationPicker';
import { SpeciesImage } from '../../components/SpeciesImage';
import { toast } from '../../lib/toast';
import { CountKey } from './hubParts';
import {
  ConfirmDialog,
  deleteSighting,
  fmtDate,
  matchSpecies,
  plural,
  saveSighting,
  timeStr,
  todayStr,
  useActiveOutingId,
  useOutingRows,
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

/** v1 openFinishOuting (js/app.js:848): the Finish outing / Outing details sheet. */
function FinishOuting({
  outing,
  sightingCount,
  onClose,
  onSaved,
}: {
  outing: OutingRow;
  sightingCount: number;
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
      onSaved();
      onClose();
      toast('Outing finished');
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
        <form className="form" onSubmit={save} noValidate>
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
            <button type="button" className="btn btn--small" onClick={() => setPicking(true)}>
              <Icon name="search" /> {loc.lat != null ? 'Move on map' : 'Choose on map'}
            </button>
            <span className="small muted">
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
            <button type="button" className="btn" onClick={onClose}>
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

/** v1 renderOuting (js/app.js:2046): an outing's tally, live or finished. */
export default function Outing() {
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
  // One tally change at a time. The buttons stay enabled (v1's do), so a tap never drops focus to <body>.
  const working = useRef(false);
  const refocus = useRef<Refocus | null>(null);

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

  const counts = useMemo(() => new Map(tally.map((rec) => [rec.speciesId, rec])), [tally]);

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

  const change = async (sp: Species, delta: 1 | -1) => {
    if (working.current) return;
    working.current = true;
    refocus.current = { id: sp.id, attr: delta > 0 ? 'data-inc' : 'data-dec', until: Date.now() + 1500, spare: null };
    try {
      const current = counts.get(sp.id);
      if (current) {
        const next = (current.count ?? 1) + delta;
        if (next <= 0) await deleteSighting(current);
        else await db.put('sightings', { ...current, count: next });
      } else if (delta > 0) {
        await saveSighting({
          speciesId: sp.id,
          count: 1,
          heard: false,
          date: outing.date,
          time: outing.past || outing.endedAt ? outing.time : timeStr(),
          lat: outing.lat ?? null,
          lng: outing.lng ?? null,
          acc: null,
          place: outing.place ?? '',
          notes: '',
          photoId: null,
          outingId: outing.id,
          createdAt: Date.now(),
        });
      }
      if (delta > 0 && live) await db.kvSet('activeOuting', outing.id);
      if (delta > 0 && query) setQuery('');
    } finally {
      working.current = false;
    }
  };

  const tallyRow = (sp: Species) => {
    const rec = counts.get(sp.id);
    const firstEver = !seenOutside.has(sp.id);
    return (
      <li className={`tally-row ${rec ? 'tally-row--on' : ''}`} key={sp.id}>
        <Link className="tally-sp" to={`/bird/${sp.id}`}>
          <span className="row-thumb">
            <SpeciesImage sp={sp} />
          </span>
          <span>
            <strong>{sp.name}</strong>
            {firstEver && <span className="lifer">New for your dex</span>}
          </span>
        </Link>
        {editing ? (
          <div className="tally-ctl">
            {rec && (
              <>
                <button
                  type="button"
                  data-dec={sp.id}
                  aria-label={`One fewer ${sp.name}`}
                  onClick={() => void change(sp, -1)}
                >
                  −
                </button>
                <span className="tally-n" data-n={sp.id} aria-live="polite">
                  {rec.count ?? 'X'}
                </span>
              </>
            )}
            <button
              type="button"
              data-inc={sp.id}
              className="tally-inc"
              aria-label={`Add ${sp.name}`}
              onClick={() => void change(sp, 1)}
            >
              +
            </button>
          </div>
        ) : (
          <span className="tally-n">{rec?.count ?? 'X'}</span>
        )}
      </li>
    );
  };

  const ordered = tally.map((rec) => byId.get(rec.speciesId)).filter((sp): sp is Species => !!sp);

  return (
    <>
      <header className="page-head page-head--back">
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
      </header>

      <div className="tally-sum">
        <p className="list-count">
          <CountKey k={`outing/${outing.id}`} value={tally.length} /> species{!live && outing.distanceKm ? `, ${outing.distanceKm} km` : ''}
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
              {results.length ? results.map(tallyRow) : <li className="muted pad">Nothing by that name in the dex.</li>}
            </ul>
          )}
        </>
      )}

      {ordered.length ? (
        <ul className="tally-list rows--card">{ordered.map(tallyRow)}</ul>
      ) : editing ? (
        <p className="empty-inline tally-empty">Search above to add the first species. Tap + again each time you count another.</p>
      ) : (
        <p className="empty-inline tally-empty">No species were logged on this outing.</p>
      )}

      {outing.notes && <p className="pad-x">{outing.notes}</p>}

      <div className={`tally-foot ${live ? 'tally-foot--live' : ''}`}>
        {/* Keyed so the Finish outing button stays the same element as it becomes Edit details: closing the sheet
            hands focus back to it, as v1's restoreFocus found [data-finish] again. */}
        <button
          key="cancel"
          type="button"
          className="btn btn--danger btn--quiet"
          data-cancel=""
          onClick={() => setConfirmDelete(true)}
        >
          {live ? 'Discard' : 'Delete outing'}
        </button>
        <span key="spacer" className="spacer" />
        {!live && (
          <button key="editbirds" type="button" className="btn" data-editbirds="" onClick={() => { setEditingBirds(!editingBirds); setQuery(''); }}>
            {editing ? 'Done editing species' : 'Edit species'}
          </button>
        )}
        <button key="finish" type="button" className={`btn${live ? ' btn--primary' : ''}`} data-finish="" onClick={() => setFinishOpen(true)}>
          {live ? 'Finish outing' : 'Edit details'}
        </button>
      </div>

      {finishOpen && (
        <FinishOuting
          outing={outing}
          sightingCount={tally.length}
          onClose={() => setFinishOpen(false)}
          onSaved={() => setEditingBirds(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={live ? 'Discard this outing?' : 'Delete this outing?'}
          body={`This removes the outing and its ${plural(
            recs.length,
            'sighting',
          )}. This cannot be undone.`}
          confirmLabel={live ? 'Discard' : 'Delete'}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (busy) return;
            setBusy(true);
            try {
              for (const rec of recs) await deleteSighting(rec);
              await db.del('outings', outing.id);
              if (activeOutingId === outing.id) await db.kvSet('activeOuting', null);
              setConfirmDelete(false);
              navigate('/lists');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
