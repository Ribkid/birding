import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../core/db.js';
import { byId, type Species } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import {
  ConfirmDialog,
  Modal,
  deleteSighting,
  fmtDate,
  matchSpecies,
  plural,
  saveSighting,
  timeStr,
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
  const defaultMinutes = outing.past ? 60 : (minutesSinceStart(outing) ?? 60);

  const [place, setPlace] = useState(outing.place ?? '');
  const [date, setDate] = useState(outing.date);
  const [time, setTime] = useState(outing.time);
  const [minutes, setMinutes] = useState(String(outing.durationMin ?? defaultMinutes));
  const [km, setKm] = useState(outing.distanceKm != null ? String(outing.distanceKm) : '');
  const [complete, setComplete] = useState(Boolean(outing.complete || !outing.endedAt));
  const [notes, setNotes] = useState(outing.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!date) {
      setError('Add the date of the outing.');
      return;
    }
    const startAt = new Date(`${date}T${time || '00:00'}`);
    setSaving(true);
    try {
      const updated: OutingRow = {
        ...outing,
        endedAt: outing.endedAt ?? Date.now(),
        durationMin: parseInt(minutes, 10) || defaultMinutes,
        distanceKm: parseFloat(km) || 0,
        complete,
        notes: notes.trim(),
        place: place.trim(),
        date: date || outing.date,
        time: time || outing.time,
        startedAt: Number.isNaN(startAt.getTime()) ? outing.startedAt : startAt.getTime(),
      };
      await db.put('outings', updated);

      // Keep the outing's birds in step with its place, date and time.
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
    } catch {
      setError('The outing could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={outing.endedAt ? 'Outing details' : 'Finish outing'} onClose={onClose}>
      <p className="muted">{plural(sightingCount, 'species')} so far.</p>
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
        <div className="grid2">
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              name="date"
              value={date}
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
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            {outing.endedAt ? 'Cancel' : 'Keep going'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : outing.endedAt ? 'Save details' : 'Finish outing'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

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

  const addOne = async (sp: Species) => {
    setBusy(true);
    try {
      const current = counts.get(sp.id);
      if (current) {
        await db.put('sightings', { ...current, count: (current.count ?? 1) + 1 });
      } else {
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
      if (live) await db.kvSet('activeOuting', outing.id);
      setQuery('');
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (sp: Species) => {
    const current = counts.get(sp.id);
    if (!current) return;
    setBusy(true);
    try {
      const next = (current.count ?? 1) - 1;
      if (next <= 0) await deleteSighting(current);
      else await db.put('sightings', { ...current, count: next });
    } finally {
      setBusy(false);
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
                  aria-label={`One fewer ${sp.name}`}
                  disabled={busy}
                  onClick={() => void removeOne(sp)}
                >
                  −
                </button>
                <span className="tally-n" aria-live="polite">
                  {rec.count ?? 'X'}
                </span>
              </>
            )}
            <button
              type="button"
              className="tally-inc"
              aria-label={`Add ${sp.name}`}
              disabled={busy}
              onClick={() => void addOne(sp)}
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

      <p className="list-count">
        <b>{tally.length}</b> {plural(tally.length, 'species')}
        {!live && outing.distanceKm ? `, ${outing.distanceKm} km` : ''}
      </p>

      {editing && (
        <>
          <div className="searchbox searchbox--sticky">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Add a bird: type a name"
              value={query}
              aria-label="Find a bird to add"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
            />
          </div>
          {query.trim() !== '' && (
            <>
              <ul className="tally-list">
                {results.map(tallyRow)}
                {results.length === 0 && (
                  <li className="muted pad">No species by that name in the dex.</li>
                )}
              </ul>
              <hr className="rule" />
            </>
          )}
        </>
      )}

      <ul className="tally-list">
        {tally.map((rec) => {
          const sp = byId.get(rec.speciesId);
          return sp ? tallyRow(sp) : null;
        })}
        {tally.length === 0 &&
          (editing ? (
            <li className="muted pad">
              Search above to add the first bird. Tap + again each time you count another.
            </li>
          ) : (
            <li className="muted pad">No species were logged on this outing.</li>
          ))}
      </ul>

      {outing.notes && <p className="pad-x">{outing.notes}</p>}

      <div className="row-end pad">
        {live ? (
          <>
            <button
              type="button"
              className="btn btn--danger btn--quiet"
              onClick={() => setConfirmDelete(true)}
            >
              Discard
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn--primary" onClick={() => setFinishOpen(true)}>
              Finish outing
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--danger btn--quiet"
              onClick={() => setConfirmDelete(true)}
            >
              Delete outing
            </button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setEditingBirds(!editingBirds)}>
              {editingBirds ? 'Done editing birds' : 'Edit birds'}
            </button>
            <button type="button" className="btn" onClick={() => setFinishOpen(true)}>
              Edit details
            </button>
          </>
        )}
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
