import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Species } from '../lib/data';
import { haversineKm } from '../core/stats.js';
import { distanceLabel } from '../lib/spots';
import {
  EBIRD_CREDIT,
  relativeDay,
  roughLatLng,
  tidySpotName,
  type EbirdObservation,
  type SpeciesSightings,
} from '../lib/ebird';
import { useEbirdSnapshot, useLiveEbird, useOnline } from '../lib/useEbird';
import { useRoughLocation } from '../lib/useRoughLocation';
import { SpeciesImage } from './SpeciesImage';
import './whereToFind.css';

const directions = (row: Pick<EbirdObservation, 'lat' | 'lng'>) =>
  `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;

function LoadingRows() {
  return (
    <div className="where-find-skeleton" aria-hidden="true">
      <span /><span />
    </div>
  );
}

/** The species page's live card. It asks only for a deliberate location tap and always leaves the page usable. */
export default function WhereToFind({ sp }: { sp: Species }) {
  const snapshot = useEbirdSnapshot();
  const online = useOnline();
  const rough = useRoughLocation();
  const code = useMemo(() => {
    const codes = snapshot?.codes;
    if (!codes) return '';
    return Object.keys(codes).find((key) => codes[key] === sp.id) ?? '';
  }, [snapshot, sp.id]);
  const point = roughLatLng(rough.pos);
  const queryPoint = point ?? { lat: 0, lng: 0 };

  const nearest = useLiveEbird<EbirdObservation[]>({
    nearest: '',
    sp: code || 'none',
    lat: queryPoint.lat,
    lng: queryPoint.lng,
  }, !!code && !!point);
  const recent = useLiveEbird<SpeciesSightings>({ species: '', sp: code || 'none' }, !!code);

  const spots = useMemo(
    () => new Map((snapshot?.spots ?? []).map((row) => [row[0], row[1]])),
    [snapshot],
  );
  const places = useMemo(() => {
    const seen = new Set<string>();
    return (recent.data?.sightings ?? []).filter((row) => {
      if (!row.loc || seen.has(row.loc)) return false;
      seen.add(row.loc);
      return true;
    }).slice(0, 5);
  }, [recent.data]);

  if (!online) return null;
  if (snapshot === undefined) {
    return (
      <section className="where-find" aria-label="Where to find it now" aria-busy="true">
        <LoadingRows />
      </section>
    );
  }
  if (!snapshot || !code) return null;

  const first = nearest.data?.[0];
  const firstPlace = first ? tidySpotName(first.where) : null;
  const away = first && rough.pos ? distanceLabel(haversineKm(rough.pos, first)) : '';

  return (
    <section className="where-find" aria-labelledby="where-find-title">
      <header className="where-find-head">
        <span className="where-find-photo"><SpeciesImage sp={sp} alt="" /></span>
        <div>
          <h2 id="where-find-title">Where to find it now</h2>
          <p className="small muted">Live eBird reports from the last 30 days.</p>
        </div>
      </header>

      <div className="where-find-block">
        <h3>Nearest recent sighting</h3>
        {!rough.pos ? (
          <div className="where-find-locate">
            <p>Use your rough location to see the nearest report.</p>
            <button type="button" className="btn btn--small" onClick={rough.ask} disabled={rough.asking}>
              {rough.asking ? 'Finding you…' : 'Use my rough location'}
            </button>
            {rough.error && <p className="where-find-error" role="status">{rough.error}</p>}
          </div>
        ) : nearest.loading ? (
          <LoadingRows />
        ) : first && firstPlace ? (
          <div className="where-find-nearest">
            <p>
              Seen {away ? `${away} away ` : ''}at{' '}
              {spots.has(first.loc) ? (
                <Link className="where-find-place" to={`/spot/${first.loc}`}>{firstPlace.name}</Link>
              ) : (
                <span className="where-find-place">{firstPlace.name}</span>
              )}
              , {relativeDay(first.date)}.
            </p>
            {firstPlace.restricted && <span className="where-find-restricted">Restricted</span>}
            <div className="where-find-links">
              {spots.has(first.loc) && <Link to={`/spot/${first.loc}`}>Spot details</Link>}
              <a href={directions(first)} target="_blank" rel="noopener">Directions</a>
            </div>
          </div>
        ) : (
          <p className="muted small">No recent report came through just now.</p>
        )}
      </div>

      <div className="where-find-block">
        <h3>Recent in SEQ</h3>
        {recent.loading ? (
          <LoadingRows />
        ) : recent.data && recent.data.total > 0 ? (
          <>
            <p className="where-find-count">Reported {recent.data.total} times in SEQ in the last 30 days.</p>
            <ol className="where-find-places">
              {places.map((row) => {
                const place = tidySpotName(row.where);
                return (
                  <li key={`${row.loc}:${row.date}`}>
                    <span className="where-find-place-main">
                      {spots.has(row.loc) ? (
                        <Link className="where-find-place" to={`/spot/${row.loc}`}>{place.name}</Link>
                      ) : (
                        <span className="where-find-place">{place.name}</span>
                      )}
                      {place.restricted && <span className="where-find-restricted">Restricted</span>}
                      <span className="small muted">{relativeDay(row.date)} · {row.n} reported</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="muted small">No reports came through just now. Try again when you have signal.</p>
        )}
      </div>

      <p className="where-find-privacy small muted">Uses your rough location, never saved.</p>
      <p className="where-find-credit small">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
