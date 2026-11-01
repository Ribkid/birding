import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hotspots } from '../../core/seqdata.js';
import { haversineKm } from '../../core/stats.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { byId, SPECIES, type Species } from '../../lib/data';
import { useSeen, useSightings, type Sighting } from '../../lib/hooks';
import { getLastPos } from '../../lib/lastPos';
import { useSeqReady } from '../../lib/seq';
import {
  EBIRD_CREDIT,
  fetchLiveEbird,
  liveListIds,
  loadSpotData,
  mapLiveRecent,
  type LiveRecent,
  type SpotData,
} from '../../lib/ebird';
import {
  distanceLabel,
  loadSpotAccess,
  spotAccess,
  type HotspotLike,
  type SpotAccess,
} from '../../lib/spots';
import { featureBird, tidySpotName } from '../../lib/spotLook';
import { AccessBlock } from './parts';
import './spots.css';

const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

interface NearSighting extends Sighting {
  km: number;
  place?: string;
}

type RecentRow = { id: number; date: string; n: number | null };

function birdedLabel(latest: string | null | undefined): string | null {
  if (!latest) return null;
  const time = new Date(latest.replace(' ', 'T')).getTime();
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
  if (days === 0) return 'Birded today';
  if (days === 1) return 'Birded yesterday';
  if (days < 30) return `Birded ${days} days ago`;
  return `Last birded ${new Date(time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function SpotDetail() {
  const { idx } = useParams();
  const seqReady = useSeqReady();
  const seen = useSeen();
  const sightings = useSightings();
  const [data, setData] = useState<SpotData | null>(null);
  const [access, setAccess] = useState<Record<string, SpotAccess>>(() => spotAccess());
  const [notSeenOnly, setNotSeenOnly] = useState(false);
  const [liveRecent, setLiveRecent] = useState<RecentRow[] | null>(null);
  const [liveList, setLiveList] = useState<number[] | null>(null);

  useEffect(() => {
    if (!seqReady) return;
    let alive = true;
    void loadSpotData(hotspots() as HotspotLike[]).then(async (result) => {
      const records = await loadSpotAccess(result.source === 'eBird' ? 'ebird' : 'ala');
      if (!alive) return;
      setAccess(records);
      setData(result);
    });
    return () => { alive = false; };
  }, [seqReady]);

  const all = data?.spots ?? [];
  const index = Number(idx);
  const spot = idx?.startsWith('L')
    ? all.find((row) => row.locId === idx)
    : Number.isInteger(index) && index >= 0 ? all[index] : undefined;
  const locId = spot?.locId;
  const snapshot = data?.snapshot ?? null;
  const accessRecord = access[locId ?? String(index)] ?? null;
  const pos = getLastPos();
  const distanceKm = spot && pos ? haversineKm(pos, spot) : null;

  useEffect(() => {
    setLiveRecent(null);
    setLiveList(null);
    if (!locId || !snapshot) return;
    let alive = true;
    void fetchLiveEbird('recent', locId).then((rows) => {
      if (alive && rows) setLiveRecent(mapLiveRecent(rows as LiveRecent[], SPECIES));
    });
    if (snapshot.codes) {
      void fetchLiveEbird('list', locId).then((codes) => {
        if (alive && codes) setLiveList(liveListIds(codes as string[], snapshot));
      });
    }
    return () => { alive = false; };
  }, [locId, snapshot]);

  const birds = useMemo(() => {
    if (!spot) return [] as { sp: Species; count: number | null }[];
    const counts = new Map(spot.sp);
    const ids = liveList ?? spot.sp.map(([id]) => id);
    return ids
      .map((id) => ({ sp: byId.get(id), count: locId ? null : counts.get(id) ?? 0 }))
      .filter((row): row is { sp: Species; count: number | null } => Boolean(row.sp));
  }, [spot, liveList, locId]);
  const notSeen = useMemo(() => birds.filter(({ sp }) => !seen.has(sp.id)).length, [birds, seen]);
  const shownBirds = notSeenOnly ? birds.filter(({ sp }) => !seen.has(sp.id)) : birds;
  const recentIds = liveRecent?.map((row) => row.id) ?? (locId ? snapshot?.recent[locId]?.map(([id]) => id) : undefined) ?? [];
  // Without a full list, a bird seen there lately leads the page instead.
  const top = spot ? featureBird(birds.length ? birds.map(({ sp }) => sp.id) : recentIds, seen, spot.locId ?? String(index)) : undefined;
  const recent: RecentRow[] = liveRecent ?? (locId ? snapshot?.recent[locId]?.map(([id, date]) => ({ id, date, n: null })) : []) ?? [];

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
          {!data ? 'Loading the spot…' : 'That spot is not in the list. It may have been renamed since this link was saved.'}
        </p>
        <p className="pad-x">
          <Link className="btn" to="/spots">All spots</Link>
        </p>
      </div>
    );
  }

  const lastBirded = birdedLabel(spot.latestObsDt);
  const { name, restricted } = tidySpotName(spot.name);

  return (
    <div className="spots-screen spot-page">
      <header className="page-head page-head--back spot-head">
        <Link className="iconbtn" to="/spots" aria-label="Back to spots">
          <Icon name="back" />
        </Link>
        <div className="spot-head-text">
          <h1>{name}</h1>
          <p className="spot-head-meta small">
            {restricted && <span className="spot-tag">Restricted</span>}
            {lastBirded && <span className="spot-last">{lastBirded}</span>}
            {distanceKm != null && <span>{distanceLabel(distanceKm)} away</span>}
          </p>
        </div>
      </header>

      {top && (
        <figure className="spot-hero">
          <div className="spot-hero-photo"><SpeciesImage sp={top} size="large" alt="" eager /></div>
          <figcaption className="spot-hero-glass">
            {seen.has(top.id) ? 'Recorded here' : 'Look for it here'}
            <Link to={`/bird/${top.id}`}>{top.name}</Link>
          </figcaption>
        </figure>
      )}

      <ul className="spot-facts" aria-label="At a glance">
        <li><b>{spot.rich}</b> species</li>
        <li><b>{(locId ? spot.checklists ?? 0 : spot.sp.reduce((sum, [, count]) => sum + count, 0)).toLocaleString('en-AU')}</b> {locId ? 'checklists' : 'records'}</li>
        {birds.length > 0 && <li><b>{notSeen}</b> new for you</li>}
        {distanceKm != null && <li><b>{distanceLabel(distanceKm)}</b> away</li>}
      </ul>

      <AccessBlock access={accessRecord} />

      <div className="spot-actions">
        <Link className="btn btn--primary" to={`/map/at/${spot.lat},${spot.lng}`}>
          <Icon name="pin" /> Show on map
        </Link>
        <a className="btn" href={directionsUrl(spot.lat, spot.lng)} target="_blank" rel="noopener">Directions</a>
      </div>

      {locId && (
        <section className="spot-birds" aria-labelledby="spot-recent-title">
          <div className="spot-section-head"><h2 id="spot-recent-title">Seen here lately</h2></div>
          <p className="muted small">Live from eBird when online, otherwise from the saved snapshot.</p>
          {recent.length ? (
            <ul className="rows spot-bird-list">
              {recent.map(({ id, date, n }) => {
                const sp = byId.get(id);
                if (!sp) return null;
                const got = seen.has(id);
                return (
                  <li key={id}>
                    <Link className="row row--sp" to={`/bird/${id}`}>
                      <span className={got ? 'row-thumb row-thumb--seen' : 'row-thumb'}><SpeciesImage sp={sp} /></span>
                      <span className="row-main">
                        <strong>{sp.name}</strong>
                        <span className="muted small">
                          {new Date(date.replace(' ', 'T')).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                          {n != null ? ` · ${n} reported` : ''} · {got ? 'Seen in your dex' : 'Not seen yet'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="empty-inline">No recent sightings of dex birds are saved for this spot.</p>}
        </section>
      )}

      <section className="spot-birds" aria-labelledby="spot-birds-title">
        <div className="spot-section-head">
          <h2 id="spot-birds-title">{locId ? 'All birds here' : 'Birds here'}</h2>
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
                    <span className={got ? 'row-thumb row-thumb--seen' : 'row-thumb'}><SpeciesImage sp={sp} /></span>
                    <span className="row-main">
                      <strong>{sp.name}</strong>
                      <span className="muted small">
                        {count != null ? `${count.toLocaleString('en-AU')} records here · ` : ''}{got ? 'Seen in your dex' : 'Not seen yet'}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-inline">
            {notSeenOnly ? "You've seen every bird recorded here." : locId ? 'No species list is available offline for this spot yet.' : 'No birds recorded at this spot yet.'}
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
                      <span className="muted small">{s.date} · {s.place || 'Sighting'} · {distanceLabel(s.km)} from here</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="empty-inline">No sightings of yours within 1 km of here yet.</p>}
      </section>

      {locId && (
        <p className="spot-credit spots-credit small">
          <a href={`https://ebird.org/hotspot/${locId}`} target="_blank" rel="noopener">View this spot on eBird</a>
          {' · '}
          <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
        </p>
      )}
    </div>
  );
}
