import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hotspots } from '../../core/seqdata.js';
import { haversineKm } from '../../core/stats.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { byId, type Species } from '../../lib/data';
import { useSeen, useSightings, type Sighting } from '../../lib/hooks';
import { getLastPos } from '../../lib/lastPos';
import { useSeqReady } from '../../lib/seq';
import {
  distanceLabel,
  loadSpotAccess,
  spotAccess,
  type HotspotLike,
  type SpotAccess,
} from '../../lib/spots';
import { AccessBlock } from './parts';
import './spots.css';

const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

interface NearSighting extends Sighting {
  km: number;
  place?: string;
}

export default function SpotDetail() {
  const { idx } = useParams();
  const index = Number(idx);
  const seqReady = useSeqReady();
  const seen = useSeen();
  const sightings = useSightings();
  const [access, setAccess] = useState<Record<string, SpotAccess>>(() => spotAccess());
  const [notSeenOnly, setNotSeenOnly] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSpotAccess().then((records) => {
      if (alive) setAccess(records);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  const all = useMemo(() => hotspots() as HotspotLike[], [seqReady]);
  const spot = Number.isInteger(index) && index >= 0 ? all[index] : undefined;
  const accessRecord = access[String(index)] ?? null;
  const pos = getLastPos();
  const distanceKm = spot && pos ? haversineKm(pos, spot) : null;

  const top = spot ? byId.get(spot.sp[0]?.[0] ?? -1) : undefined;
  const birds = useMemo(
    () =>
      (spot?.sp ?? [])
        .map(([id, count]) => ({ sp: byId.get(id), count }))
        .filter((row): row is { sp: Species; count: number } => Boolean(row.sp)),
    [spot],
  );
  const notSeen = useMemo(() => birds.filter(({ sp }) => !seen.has(sp.id)).length, [birds, seen]);
  const shownBirds = notSeenOnly ? birds.filter(({ sp }) => !seen.has(sp.id)) : birds;

  const near = useMemo<NearSighting[]>(() => {
    if (!spot) return [];
    const out: NearSighting[] = [];
    for (const s of sightings) {
      if (s.lat == null || s.lng == null) continue;
      const km = haversineKm({ lat: Number(s.lat), lng: Number(s.lng) }, spot);
      if (km <= 1) out.push({ ...s, km });
    }
    out.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    return out;
  }, [sightings, spot]);

  if (!spot) {
    return (
      <div className="spots-screen">
        <header className="page-head page-head--back">
          <Link className="iconbtn" to="/spots" aria-label="Back to spots">
            <Icon name="back" />
          </Link>
          <h1>Spot</h1>
        </header>
        <p className="empty-inline">
          {!settled && !seqReady ? 'Loading the spot…' : 'That spot is not in the list. It may have been renamed since this link was saved.'}
        </p>
        <p className="pad-x">
          <Link className="btn" to="/spots">
            All spots
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="spots-screen spot-page">
      <header className="page-head page-head--back spot-head">
        <Link className="iconbtn" to="/spots" aria-label="Back to spots">
          <Icon name="back" />
        </Link>
        <div className="spot-head-text">
          <h1>{spot.name}</h1>
          <p className="muted small">
            {spot.lat.toFixed(3)}, {spot.lng.toFixed(3)}
            {distanceKm != null ? ` · ${distanceLabel(distanceKm)} away` : ''}
          </p>
        </div>
      </header>

      {top && (
        <figure className="spot-hero">
          <div className="spot-hero-photo">
            <SpeciesImage sp={top} size="large" eager />
          </div>
          <figcaption>
            Top bird here:{' '}
            <Link to={`/bird/${top.id}`}>{top.name}</Link>
            {spot.sp[0] ? ` · ${spot.sp[0][1].toLocaleString('en-AU')} records` : ''}
          </figcaption>
        </figure>
      )}

      <ul className="spot-facts" aria-label="At a glance">
        <li>
          <b>{spot.rich}</b> species
        </li>
        <li>
          <b>{spot.sp.reduce((sum, [, count]) => sum + count, 0).toLocaleString('en-AU')}</b> records
        </li>
        <li>
          <b>{notSeen}</b> new for you
        </li>
        {distanceKm != null && (
          <li>
            <b>{distanceLabel(distanceKm)}</b> away
          </li>
        )}
      </ul>

      <AccessBlock access={accessRecord} />

      <div className="spot-actions">
        <Link className="btn btn--primary" to={`/map/at/${spot.lat},${spot.lng}`}>
          <Icon name="pin" /> Show on map
        </Link>
        <a className="btn" href={directionsUrl(spot.lat, spot.lng)} target="_blank" rel="noopener">
          Directions
        </a>
      </div>

      <section className="spot-birds" aria-labelledby="spot-birds-title">
        <div className="spot-section-head">
          <h2 id="spot-birds-title">Birds here</h2>
          <button
            type="button"
            className={`chip${notSeenOnly ? ' chip--on' : ''}`}
            aria-pressed={notSeenOnly}
            onClick={() => setNotSeenOnly((on) => !on)}
          >
            Not seen yet ({notSeen})
          </button>
        </div>
        {shownBirds.length ? (
          <ul className="rows spot-bird-list">
            {shownBirds.map(({ sp, count }) => {
              const got = seen.has(sp.id);
              return (
                <li key={sp.id}>
                  <Link className="row row--sp" to={`/bird/${sp.id}`}>
                    <span className={got ? 'row-thumb row-thumb--seen' : 'row-thumb'}>
                      <SpeciesImage sp={sp} />
                    </span>
                    <span className="row-main">
                      <strong>{sp.name}</strong>
                      <span className="muted small">
                        {count.toLocaleString('en-AU')} records here · {got ? 'Seen' : 'Not seen yet'}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-inline">
            {notSeenOnly ? "You've seen every bird recorded here." : 'No birds recorded at this spot yet.'}
          </p>
        )}
      </section>

      <section className="spot-yours" aria-labelledby="spot-yours-title">
        <h2 id="spot-yours-title">Your sightings near here</h2>
        {near.length ? (
          <ul className="rows">
            {near.map((s) => {
              const sp = byId.get(s.speciesId);
              return (
                <li key={s.id} className="spot-yours-row">
                  <Link className="row row--sp" to={`/bird/${s.speciesId}`}>
                    <span className={seen.has(s.speciesId) ? 'row-thumb row-thumb--seen' : 'row-thumb'}>
                      {sp && <SpeciesImage sp={sp} />}
                    </span>
                    <span className="row-main">
                      <strong>{sp?.name ?? 'Species'}</strong>
                      <span className="muted small">
                        {s.date} · {s.place || 'Sighting'} · {distanceLabel(s.km)} from here
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-inline">No sightings of yours within 1 km of here yet.</p>
        )}
      </section>
    </div>
  );
}
