import { Link } from 'react-router-dom';
import { SpeciesImage } from '../../components/SpeciesImage';
import NewForYou from '../../components/NewForYou';
import { distanceLabel } from '../../lib/spots';
import {
  EBIRD_CREDIT,
  relativeDay,
  roughLatLng,
  tidySpotName,
  type EbirdObservation,
} from '../../lib/ebird';
import { rareNearbyRows } from '../../lib/rare';
import { useSeen } from '../../lib/hooks';
import { useEbirdSnapshot, useLiveEbird, useOnline } from '../../lib/useEbird';
import './rareNearby.css';

function SkeletonCard() {
  return (
    <section className="rare-near" aria-label="Rare birds near you" aria-busy="true">
      <h2>Rare birds near you</h2>
      <div className="rare-near-skeleton" aria-hidden="true"><span /><span /><span /></div>
    </section>
  );
}

/** The live, distance-ranked counterpart to the baked SEQ notable feed. It only appears with a rough fix. */
export default function RareNearby({ pos }: { pos: { lat: number; lng: number } | null }) {
  const online = useOnline();
  const snapshot = useEbirdSnapshot();
  const seen = useSeen();
  const point = roughLatLng(pos);
  const live = useLiveEbird<EbirdObservation[]>({
    notable: '',
    lat: point?.lat ?? 0,
    lng: point?.lng ?? 0,
    dist: 50,
    back: 7,
  }, !!point && online);

  if (!online || !point) return null;
  if (snapshot === undefined || live.loading) return <SkeletonCard />;
  if (!snapshot || !live.data?.length) return null;

  const rows = rareNearbyRows(live.data, snapshot, seen, 6);
  if (!rows.length) return null;
  const spots = new Set(snapshot.spots.map((row) => row[0]));

  return (
    <section className="rare-near" aria-labelledby="rare-near-title">
      <header>
        <h2 id="rare-near-title">Rare birds near you</h2>
        <p className="small muted">Notable eBird reports within 50 km, nearest first.</p>
      </header>
      <ul className="rare-near-rows">
        {rows.map(({ obs, sp, isNew }) => {
          const place = tidySpotName(obs.where);
          return (
            <li key={`${obs.code}:${obs.loc}:${obs.date}`}>
              <span className="rare-near-photo">
                {sp ? <SpeciesImage sp={sp} alt="" /> : <span aria-hidden="true">{obs.name.slice(0, 1)}</span>}
              </span>
              <span className="rare-near-main">
                <span className="rare-near-name">
                  {sp ? <Link to={`/bird/${sp.id}`}>{sp.name}</Link> : <strong>{obs.name}</strong>}
                  {isNew && <NewForYou />}
                </span>
                <span className="small muted">
                  {distanceLabel(obs.distanceKm ?? null)} away · {relativeDay(obs.date)} · {obs.n} reported
                </span>
                <span className="rare-near-place-row">
                  {spots.has(obs.loc) ? (
                    <Link className="rare-near-place" to={`/spot/${obs.loc}`}>{place.name}</Link>
                  ) : (
                    <span className="rare-near-place">{place.name}</span>
                  )}
                  {place.restricted && <span className="rare-near-restricted">Restricted</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="rare-near-privacy small muted">Uses your rough location, never saved.</p>
      <p className="small rare-near-credit">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
