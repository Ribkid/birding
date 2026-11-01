import { Link } from 'react-router-dom';
import { distanceLabel } from '../../lib/spots';
import { EBIRD_CREDIT, relativeDay, tidySpotName } from '../../lib/ebird';
import { useHuntRows } from '../../lib/useHunt';
import { useRoughLocation } from '../../lib/useRoughLocation';
import { SpeciesImage } from '../../components/SpeciesImage';
import NewForYou from '../../components/NewForYou';
import './huntList.css';

function Skeleton() {
  return (
    <div className="hunt-list-skeleton" aria-hidden="true">
      <span /><span /><span />
    </div>
  );
}

/** Targets' first section: nearby eBird reports cut to the birds still missing from her dex. */
export default function HuntList() {
  const rough = useRoughLocation();
  const hunt = useHuntRows(rough.pos);
  const spots = new Set((hunt.snapshot?.spots ?? []).map((row) => row[0]));
  const rows = hunt.rows.slice(0, 12);

  if (hunt.snapshot === null) return null;

  return (
    <section className="hunt-list" aria-labelledby="hunt-list-title" data-hunt-source={hunt.source}>
      <header className="hunt-list-head">
        <h2 id="hunt-list-title">Reported near you this week</h2>
        <p className="small muted">Birds missing from your dex, nearest report first.</p>
      </header>

      {!rough.pos ? (
        <div className="hunt-list-locate">
          <p>Use your rough location to find the birds close to you this week.</p>
          <button type="button" className="btn btn--small" onClick={rough.ask} disabled={rough.asking}>
            {rough.asking ? 'Finding you…' : 'Find birds near me'}
          </button>
          {rough.error && <p className="hunt-list-note" role="status">{rough.error}</p>}
        </div>
      ) : hunt.loading && !hunt.rows.length ? (
        <Skeleton />
      ) : rows.length ? (
        <>
          <p className="hunt-list-count">
            {hunt.rows.length === 1 ? '1 bird' : `${hunt.rows.length} birds`} within 25 km
            {hunt.source === 'snapshot' ? ' · saved snapshot' : ''}
          </p>
          <ul className="hunt-list-rows">
            {rows.map(({ sp, obs, distanceKm }) => {
              const place = tidySpotName(obs.where);
              return (
                <li key={sp.id}>
                  <Link className="hunt-list-bird" to={`/bird/${sp.id}`}>
                    <span className="hunt-list-photo"><SpeciesImage sp={sp} alt="" /></span>
                    <span className="hunt-list-main">
                      <strong>{sp.name}</strong>
                      <span className="hunt-list-meta">{distanceLabel(distanceKm)} away · {relativeDay(obs.date)}</span>
                    </span>
                  </Link>
                  <span className="hunt-list-place-row">
                    {spots.has(obs.loc) ? (
                      <Link className="hunt-list-place" to={`/spot/${obs.loc}`}>{place.name}</Link>
                    ) : (
                      <span className="hunt-list-place">{place.name}</span>
                    )}
                    {place.restricted && <span className="hunt-list-restricted">Restricted</span>}
                    <NewForYou />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="hunt-list-note">
          {hunt.online
            ? "You've seen every bird reported near you this week."
            : 'The saved snapshot has no unseen nearby birds for this week.'}
        </p>
      )}

      {hunt.loading && hunt.rows.length > 0 && <p className="hunt-list-note small">Checking for newer reports…</p>}
      <p className="hunt-list-privacy small muted">Uses your rough location, never saved.</p>
      <p className="hunt-list-credit small"><a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a></p>
    </section>
  );
}
