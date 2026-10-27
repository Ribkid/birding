import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../core/db.js';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import {
  getPosition,
  timeStr,
  todayStr,
  useActiveOutingId,
  useOutingRows,
} from '../screens/lists/shared';

const pencil = <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />;
const clipboard = <path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v13A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 5H16M9 3h6v4H9zM8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const activeId = useActiveOutingId();
  const outings = useOutingRows();
  const active = outings.find((outing) => outing.id === activeId) || null;
  const [mode, setMode] = useState<'menu' | 'outing'>('menu');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(timeStr());
  const [place, setPlace] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [status, setStatus] = useState('No location yet');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('menu');
    setDate(todayStr());
    setTime(timeStr());
    setPlace('');
    setPos(null);
    setStatus('No location yet');
    setError('');
    setBusy(false);
    document.body.classList.add('has-sheet');
    return () => document.body.classList.remove('has-sheet');
  }, [open]);

  const locate = async () => {
    setStatus('Finding you…');
    try {
      const next = await getPosition();
      setPos(next);
      setStatus(`${next.lat.toFixed(4)}, ${next.lng.toFixed(4)} (±${next.acc} m)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not get your location.');
    }
  };

  const closeAnd = (to: string) => {
    onClose();
    navigate(to);
  };

  const startOuting = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!date) { setError('Add the date of the outing.'); return; }
    const startAt = new Date(`${date}T${time || '00:00'}`);
    if (Number.isNaN(startAt.getTime())) { setError('Add the date of the outing.'); return; }
    if (startAt.getTime() > Date.now() + 5 * 60 * 1000) {
      setError('The start time is in the future. Pick a time that has already happened.');
      return;
    }
    const past = Date.now() - startAt.getTime() > 20 * 60 * 1000;
    setBusy(true);
    try {
      const outing = {
        date,
        time: time || '00:00',
        startedAt: startAt.getTime(),
        past,
        place: place.trim(),
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        endedAt: null,
        complete: false,
        distanceKm: null,
        durationMin: null,
        notes: '',
      };
      const id = Number(await db.add('outings', outing));
      await db.kvSet('activeOuting', id);
      onClose();
      navigate(`/outing/${id}`);
    } catch {
      setError('The outing could not be started. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const isPast = (() => {
    const at = new Date(`${date}T${time || '00:00'}`).getTime();
    return !Number.isNaN(at) && Date.now() - at > 20 * 60 * 1000;
  })();

  return (
    <Sheet open={open} onClose={onClose} label="Add a sighting" cls="sheet-wrap--plus" step={mode}>
      {mode === 'menu' ? (
        <>
          <h2 className="sheet-title">Add a sighting</h2>
          <div className="plus-grid">
            <button type="button" className="plus-tile plus-tile--main" onClick={() => closeAnd('/add')}>
              <span className="plus-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{pencil}</svg></span>
              <strong>Log one sighting</strong><span>With photo, place and notes</span>
            </button>
            {active ? (
              <button type="button" className="plus-tile" onClick={() => closeAnd(`/outing/${active.id}`)}>
                <span className="plus-ic"><Icon name="list" /></span>
                <strong>Back to your outing</strong><span>{active.place || 'Current outing'}, started {active.time}</span>
              </button>
            ) : (
              <button type="button" className="plus-tile" onClick={() => setMode('outing')}>
                <span className="plus-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{clipboard}</svg></span>
                <strong>Start an outing</strong><span>Tally everything at one place, like an eBird checklist</span>
              </button>
            )}
            <Link className="plus-tile" to="/listen" onClick={onClose}>
              <span className="plus-ic"><Icon name="mic" /></span>
              <strong>Listen</strong><span>Name birds by their calls</span>
            </Link>
            <Link className="plus-tile" to="/scan" onClick={onClose}>
              <span className="plus-ic"><Icon name="scan" /></span>
              <strong>Scan a photo</strong><span>Name an animal or plant from a photo</span>
            </Link>
          </div>
          {!active && <p className="plus-more small muted">Earlier outings can be added too: start one and change its date.</p>}
        </>
      ) : (
        <>
          <h2 className="sheet-title">Start or add an outing</h2>
          <form className="form" onSubmit={startOuting} noValidate>
            <div className="grid2">
              <label className="field"><span>Date</span><input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="field"><span>Start time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            </div>
            <p className="small muted">For an outing earlier today or on another day, change the date and start time.</p>
            <fieldset className="loc">
              <legend>Where</legend>
              <div className="loc-row"><button type="button" className="btn" onClick={() => void locate()}><Icon name="pin" /> Use my location</button></div>
              <span className="muted small" role="status">{status}</span>
              <label className="field"><span>Place name</span><input value={place} placeholder="e.g. Sandy Camp Road Wetlands" autoComplete="off" onChange={(e) => setPlace(e.target.value)} /></label>
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setMode('menu')}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Starting…' : isPast ? 'Add outing' : 'Start outing'}</button>
            </div>
          </form>
        </>
      )}
    </Sheet>
  );
}
