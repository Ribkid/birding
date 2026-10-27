import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../core/db.js';
import { inPatch, totals, yearTotals } from '../../core/stats.js';
import { HABITATS, RARITY } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Band, SpeciesImage } from '../../components/SpeciesImage';
import {
  fmtDate,
  getPosition,
  Modal,
  MONTH_NAMES,
  suggestTargets,
  targetOptions,
  useActiveOutingId,
  useOutingRows,
  usePatches,
  useSeqVersion,
  useSightingRows,
} from './shared';
import './lists.css';

interface Totals {
  life: number;
  year: number;
  month: number;
}

const outingStart = (outing: { startedAt?: number; date: string; time: string }): number => {
  if (outing.startedAt != null) return outing.startedAt;
  const parsed = Date.parse(`${outing.date}T${outing.time || '00:00'}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export default function Lists() {
  const sightings = useSightingRows();
  const outings = useOutingRows();
  const patches = usePatches();
  const activeOutingId = useActiveOutingId();
  const seqVersion = useSeqVersion();
  const navigate = useNavigate();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = String(now.getFullYear());

  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
  const t = totals(sightings, now) as Totals;
  const options = useMemo(() => targetOptions(), [seqVersion]);
  const suggestions = useMemo(
    () => suggestTargets({ seen, month, ...options }).slice(0, 5),
    [seen, month, options],
  );

  const sortedOutings = useMemo(
    () => outings.slice().sort((a, b) => outingStart(b) - outingStart(a)),
    [outings],
  );

  const pastYears = useMemo(
    () =>
      (yearTotals(sightings) as { year: string; count: number }[]).filter((y) => y.year !== year),
    [sightings, year],
  );

  const patchStats = useMemo(
    () =>
      patches.map((patch) => {
        const inside = sightings.filter((s) => inPatch(s, patch));
        return { patch, totals: totals(inside, now) as Totals };
      }),
    [patches, sightings, now],
  );

  const speciesPerOuting = useMemo(() => {
    const counts = new Map<number, Set<number>>();
    for (const s of sightings) {
      if (s.outingId == null) continue;
      const set = counts.get(s.outingId) ?? new Set<number>();
      set.add(s.speciesId);
      counts.set(s.outingId, set);
    }
    return counts;
  }, [sightings]);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(1);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [patchStatus, setPatchStatus] = useState('No location yet');
  const [locating, setLocating] = useState(false);
  const [patchError, setPatchError] = useState('');
  const [saving, setSaving] = useState(false);

  const closePatch = () => {
    setCreating(false);
    setPatchError('');
  };

  const locate = async () => {
    setLocating(true);
    setPatchStatus('Finding you…');
    try {
      const pos = await getPosition();
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
      setPatchStatus(`${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`);
    } catch (err) {
      setPatchStatus(err instanceof Error ? err.message : 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  };

  const savePatch = async (event: FormEvent) => {
    event.preventDefault();
    setPatchError('');
    if (!name.trim()) {
      setPatchError('Give the patch a name.');
      return;
    }
    const latValue = Number(lat);
    const lngValue = Number(lng);
    if (!lat.trim() || !lng.trim() || !Number.isFinite(latValue) || !Number.isFinite(lngValue)) {
      setPatchError('Add the centre coordinates, or use your location.');
      return;
    }
    if (latValue < -90 || latValue > 90 || lngValue < -180 || lngValue > 180) {
      setPatchError('Those coordinates are outside the map.');
      return;
    }
    setSaving(true);
    try {
      const id = Number(
        await db.put('patches', {
          name: name.trim(),
          lat: latValue,
          lng: lngValue,
          radiusKm: radius,
          createdAt: Date.now(),
        }),
      );
      closePatch();
      setName('');
      setRadius(1);
      setLat('');
      setLng('');
      setPatchStatus('No location yet');
      navigate(`/patch/${id}`);
    } catch {
      setPatchError('The patch could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>Lists</h1>
        <div className="head-actions">
          <Link className="iconbtn" to="/add" aria-label="Log a sighting">
            <Icon name="cam" />
          </Link>
          <Link className="iconbtn" to="/stats" aria-label="Stats">
            <Icon name="chart" />
          </Link>
        </div>
      </header>

      <div className="quicklinks pad-x">
        <Link className="btn" to="/stats">
          <Icon name="chart" /> Stats
        </Link>
        <Link className="btn" to="/quiz">
          <Icon name="quiz" /> Guess the bird
        </Link>
      </div>

      <div className="totals">
        <Link to="/list/life">
          <b>{t.life}</b>
          <span>Life list</span>
        </Link>
        <Link to="/list/year">
          <b>{t.year}</b>
          <span>{year} list</span>
        </Link>
        <Link to="/list/month">
          <b>{t.month}</b>
          <span>{MONTH_NAMES[now.getMonth()]}</span>
        </Link>
      </div>

      <section className="block">
        <div className="block-h">
          <h2 className="h2">Targets for {MONTH_NAMES[now.getMonth()]}</h2>
          <Link to="/targets">See all</Link>
        </div>
        <p className="muted small">
          Species you haven&apos;t seen that are most often reported in South East Queensland this
          month.
        </p>
        <Link className="btn btn--block near-btn" to="/targets?near=1">
          <Icon name="pin" /> Find targets near me
        </Link>
        <ul className="rows">
          {suggestions.map((sp) => (
            <li key={sp.id}>
              <Link className="row row--sp" to={`/bird/${sp.id}`}>
                <span className="row-thumb">
                  <SpeciesImage sp={sp} />
                </span>
                <span className="row-main">
                  <strong>{sp.name}</strong>
                  <span className="muted small">
                    {`${RARITY[sp.rarity]?.label}. `}
                    {sp.habitats
                      .map((h) => HABITATS[h])
                      .slice(0, 2)
                      .join(', ')}
                  </span>
                </span>
                <Band sp={sp} seen={false} />
              </Link>
            </li>
          ))}
          {suggestions.length === 0 && (
            <li className="muted pad">
              {sightings.length === 0
                ? 'Log a sighting first and the monthly targets will appear here.'
                : 'You have seen every likely species for this month. Impressive.'}
            </li>
          )}
        </ul>
      </section>

      <section className="block">
        <div className="block-h">
          <h2 className="h2">Patches</h2>
          <button type="button" className="lists-linkbtn" onClick={() => setCreating(true)}>
            New patch
          </button>
        </div>
        <p className="muted small">
          A patch is a place you bird often, like your yard or a local park. Any sighting inside its
          circle counts automatically.
        </p>
        {patchStats.length > 0 ? (
          <ul className="patches">
            {patchStats.map(({ patch, totals: pt }) => (
              <li key={patch.id}>
                <Link to={`/patch/${patch.id}`}>
                  <strong>{patch.name}</strong>
                  <span className="muted small">{patch.radiusKm} km radius</span>
                  <span className="patch-nums">
                    <span>
                      <b>{pt.life}</b> life
                    </span>
                    <span>
                      <b>{pt.year}</b> {year}
                    </span>
                    <span>
                      <b>{pt.month}</b> {MONTH_NAMES[now.getMonth()].slice(0, 3)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-inline">
            No patches yet. Add your yard first: it is the most fun list to grow.
          </p>
        )}
      </section>

      <section className="block">
        <div className="block-h">
          <h2 className="h2">Outings</h2>
          <Link to="/log">All sightings</Link>
        </div>
        {sortedOutings.length > 0 ? (
          <ul className="rows">
            {sortedOutings.slice(0, 12).map((outing) => {
              const count = speciesPerOuting.get(outing.id)?.size ?? 0;
              const live = !outing.endedAt;
              return (
                <li key={outing.id}>
                  <Link className="row" to={`/outing/${outing.id}`}>
                    <span className="row-main">
                      <strong>
                        {outing.place || 'Unnamed place'}
                        {live && outing.id === activeOutingId && (
                          <span className="lists-live">In progress</span>
                        )}
                      </strong>
                      <span className="muted small">
                        {fmtDate(outing.date)}, {outing.time}
                        {outing.endedAt
                          ? outing.durationMin
                            ? `, ${outing.durationMin} min`
                            : ''
                          : ', in progress'}
                      </span>
                    </span>
                    <span className="row-n">{count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-inline">
            Start an outing with the + button to tally every bird at a spot.
          </p>
        )}
      </section>

      {pastYears.length > 0 && (
        <section className="block">
          <h2 className="h2">Past years</h2>
          <ul className="rows">
            {pastYears.map((y) => (
              <li key={y.year}>
                <Link className="row" to={`/list/${y.year}`}>
                  <span className="row-main">
                    <strong>{y.year}</strong>
                  </span>
                  <span className="row-n">{y.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {creating && (
        <Modal title="New patch" onClose={closePatch}>
          <p className="muted small">
            Move the map in the Map tab to choose a spot, or use your location here. Name it, then
            every sighting inside the circle joins the patch list.
          </p>
          <form className="form" onSubmit={savePatch} noValidate>
            <label className="field">
              <span>Name</span>
              <input
                name="name"
                value={name}
                placeholder="e.g. Our yard"
                autoComplete="off"
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Radius: {radius.toFixed(1)} km</span>
              <input
                type="range"
                name="radius"
                min={0.1}
                max={8}
                step={0.1}
                value={radius}
                onChange={(event) => setRadius(Number(event.target.value))}
              />
            </label>
            <fieldset className="loc">
              <legend>Centre</legend>
              <div className="loc-row">
                <button type="button" className="btn" onClick={locate} disabled={locating}>
                  <Icon name="pin" /> {locating ? 'Finding you…' : 'Use my location'}
                </button>
                <span className="muted small">{patchStatus}</span>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>Latitude</span>
                  <input
                    name="lat"
                    inputMode="decimal"
                    value={lat}
                    placeholder="e.g. -27.5210"
                    required
                    onChange={(event) => setLat(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Longitude</span>
                  <input
                    name="lng"
                    inputMode="decimal"
                    value={lng}
                    placeholder="e.g. 153.0200"
                    required
                    onChange={(event) => setLng(event.target.value)}
                  />
                </label>
              </div>
            </fieldset>
            <p className="form-error" role="alert">
              {patchError}
            </p>
            <div className="row-end">
              <button type="button" className="btn" onClick={closePatch}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save patch'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
