import { useMemo } from 'react';
import type { Species } from '../../lib/data';
import { useEbirdSnapshot, useLiveEbird, useOnline } from '../../lib/useEbird';
import { EBIRD_CREDIT, tidySpotName, type LiveRecent } from '../../lib/ebird';
import { liveLikely, nearestHotspotWithin, nearestSavedHotspotWithin, snapshotLikely } from '../../lib/likelyHere';
import { SpeciesImage } from '../../components/SpeciesImage';
import NewForYou from '../../components/NewForYou';
import './likelyHere.css';

interface Props {
  live: boolean;
  lat: number | null | undefined;
  lng: number | null | undefined;
  seen: ReadonlySet<number>;
  counted: ReadonlySet<number>;
  onAdd: (sp: Species) => void;
}

function Skeleton({ place }: { place?: string }) {
  return (
    <section className="likely-here" aria-label="Likely here" aria-busy="true">
      <header>
        <h2>Likely here</h2>
        <p className="small muted">{place ? `Near ${place}` : 'Birds reported at the nearest eBird hotspot.'}</p>
      </header>
      <div className="likely-here-skeleton" aria-hidden="true"><span /><span /><span /></div>
    </section>
  );
}

/** Birds recently reported at the eBird hotspot closest to this outing, one tap from the existing tally. */
export default function LikelyHere({ live, lat, lng, seen, counted, onAdd }: Props) {
  const online = useOnline();
  const snapshot = useEbirdSnapshot();
  const point = useMemo(
    () => (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : null),
    [lat, lng],
  );
  const near = useMemo(
    () => (snapshot && point ? nearestHotspotWithin(snapshot, point) : null),
    [snapshot, point],
  );
  const savedNear = useMemo(
    () => (snapshot && point ? nearestSavedHotspotWithin(snapshot, point) : null),
    [snapshot, point],
  );
  const locId = near?.spot[0] ?? '';
  const feed = useLiveEbird<LiveRecent[]>({ recent: '', loc: locId }, !!near && online);

  if (!live || !point) return null;
  if (snapshot === undefined) return <Skeleton />;
  if (!snapshot || !near) return null;
  if (feed.loading) return <Skeleton place={tidySpotName(near.spot[1]).name} />;

  const liveRows = feed.data?.length ? liveLikely(feed.data, snapshot, seen, counted) : [];
  const savedSpot = savedNear ?? near;
  const savedRows = snapshotLikely(snapshot, savedSpot.spot[0], seen, counted);
  const usingLive = liveRows.length > 0;
  const rows = usingLive ? liveRows : savedRows;
  if (!rows.length) return null;
  const shown = usingLive ? near : savedSpot;

  const place = tidySpotName(shown.spot[1]);
  return (
    <section className="likely-here" aria-labelledby="likely-here-title">
      <header>
        <h2 id="likely-here-title">Likely here</h2>
        <p className="small muted">
          Near <strong>{place.name}</strong>{place.restricted && <span className="likely-here-restricted">Restricted</span>}
          {' '}· {shown.distanceKm < 0.1 ? 'right here' : `${shown.distanceKm.toFixed(1)} km away`}
        </p>
        <p className="small muted">{usingLive ? 'Reported there in the last 30 days.' : 'Saved eBird reports for this hotspot.'}</p>
      </header>
      <ul className="likely-here-rail">
        {rows.map((sp) => (
          <li key={sp.id}>
            <button
              type="button"
              className="likely-here-card"
              aria-label={`Add ${sp.name} to this outing`}
              onClick={() => onAdd(sp)}
            >
              <span className="likely-here-photo"><SpeciesImage sp={sp} alt="" /></span>
              <span className="likely-here-main">
                <strong>{sp.name}</strong>
                {seen.has(sp.id) ? <span className="small muted">Seen before</span> : <NewForYou />}
              </span>
              <span className="likely-here-add" aria-hidden="true">+</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small likely-here-credit">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
