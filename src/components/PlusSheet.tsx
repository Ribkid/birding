import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../core/db.js';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { LocationPicker, type PickedPlace } from './LocationPicker';
import { knownPlace, myPlaces, nearestPlaceName, outingPlaceChips, reverseGeocode } from '../lib/places';
import { toast } from '../lib/toast';
import {
  getPosition,
  timeStr,
  todayStr,
  useActiveOutingId,
  useOutingRows,
  usePatches,
  useSightingRows,
} from '../screens/lists/shared';

// v1's tile icons (js/app.js icon.pencil, icon.clipboard, icon.outing).
const pencil = <path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5zM13.5 7.3l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
const clipboard = <path d="M9 4.5h6v2.5H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 12l1.8 1.8 3.4-3.4M8.5 17h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
const outingIco = <><path d="M12 21s-6-5.4-6-10.2a6 6 0 0 1 12 0C18 15.6 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9.6 10.6l1.7 1.7 3.2-3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>;

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const activeId = useActiveOutingId();
  const outings = useOutingRows();
  const sightings = useSightingRows();
  const patches = usePatches();
  const active = outings.find((outing) => outing.id === activeId) || null;
  const [mode, setMode] = useState<'menu' | 'outing'>('menu');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(timeStr());
  const [place, setPlace] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState('No location yet');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  // What is in the place field now, for the auto-fill that lands after a lookup.
  const placeRef = useRef('');
  placeRef.current = place;

  useEffect(() => {
    // Back to the menu as it closes, so the next open never shows the last step first.
    if (!open) { setMode('menu'); setPicking(false); return; }
    setMode('menu');
    setDate(todayStr());
    setTime(timeStr());
    setPlace('');
    setPos(null);
    setStatus('No location yet');
    setError('');
    setBusy(false);
    setPicking(false);
    document.body.classList.add('has-sheet');
    return () => document.body.classList.remove('has-sheet');
  }, [open]);

  // v1 openStartOuting: the place name fills in from her patch, a sighting nearby, or OpenStreetMap.
  const locate = async () => {
    setStatus('Finding you…');
    try {
      const next = await getPosition();
      setPos({ lat: next.lat, lng: next.lng });
      setStatus(`${next.lat.toFixed(4)}, ${next.lng.toFixed(4)} (±${next.acc} m)`);
      if (!placeRef.current) {
        const name = nearestPlaceName(next, patches, sightings) || await reverseGeocode(next);
        if (name && !placeRef.current) setPlace(name);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not get your location.');
    }
  };
  const chips = outingPlaceChips(patches, sightings);
  const pickChip = (name: string) => {
    setPlace(name);
    const known = knownPlace(name, patches, myPlaces(sightings, outings));
    if (known) { setPos({ lat: known.lat, lng: known.lng }); setStatus(`${known.lat.toFixed(4)}, ${known.lng.toFixed(4)}`); }
  };
  const picked = (r: PickedPlace | null) => {
    setPicking(false);
    if (!r) return;
    setPos({ lat: r.lat, lng: r.lng });
    setStatus(`${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`);
    if (r.place) setPlace(r.place);
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
      if (past) toast('Outing added. Tally what you saw, then tap Finish.');
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
    <>
    <Sheet open={open} onClose={onClose} labelledBy="plus-sheet-h" cls={mode === 'menu' ? 'sheet-wrap--plus' : 'sheet-wrap--outing'} step={mode}>
      {mode === 'menu' ? (
        <>
          <h2 className="sheet-title" id="plus-sheet-h">Add a sighting</h2>
          <div className="plus-grid">
            <button type="button" className="plus-tile plus-tile--main" onClick={() => closeAnd('/add')}>
              <span className="plus-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{pencil}</svg></span>
              <strong>Log one sighting</strong><span>With photo, place and notes</span>
            </button>
            {active ? (
              <button type="button" className="plus-tile" onClick={() => closeAnd(`/outing/${active.id}`)}>
                <span className="plus-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{outingIco}</svg></span>
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
          <h2 className="sheet-title" id="plus-sheet-h">Start or add an outing</h2>
          <form className="form" onSubmit={startOuting} noValidate>
            <div className="grid2">
              <label className="field"><span>Date</span><input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="field"><span>Start time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            </div>
            <p className="small muted">For an outing earlier today or on another day, change the date and start time.</p>
            <fieldset className="loc">
              <legend>Where</legend>
              <div className="loc-row">
                <button type="button" className="btn" onClick={() => void locate()}><Icon name="pin" /> Use my location</button>
                <button type="button" className="btn" onClick={() => setPicking(true)}><Icon name="search" /> Choose on map</button>
              </div>
              <span className="muted small" role="status">{status}</span>
              <label className="field"><span>Place name</span><input name="place" value={place} placeholder="e.g. Sandy Camp Road Wetlands" autoComplete="off" onChange={(e) => setPlace(e.target.value)} /></label>
              <div className="chips chips--scroll">
                {chips.map((name) => <button key={name} type="button" className="chip" onClick={() => pickChip(name)}>{name}</button>)}
              </div>
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="row-end">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Starting…' : isPast ? 'Add outing' : 'Start outing'}</button>
            </div>
          </form>
        </>
      )}
    </Sheet>
    {open && picking && <LocationPicker init={{ lat: pos?.lat, lng: pos?.lng, place }} onDone={picked} />}
    </>
  );
}
