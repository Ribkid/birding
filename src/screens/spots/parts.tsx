import { byId, type Species } from '../../lib/data';
import { SpeciesImage } from '../../components/SpeciesImage';
import { accessBadges, OSM_CREDIT, OSM_URL, type SpotAccess } from '../../lib/spots';

/** The access score as "3/5", or "Not known" when OSM has nothing. */
export function AccessScore({ access }: { access: SpotAccess | null }) {
  if (!access || access.score == null) return <span className="spot-access-unknown">Access not known yet</span>;
  return (
    <span className="spot-score" aria-label={`Access score ${access.score} out of 5`}>
      <b>{access.score}</b>
      <span aria-hidden="true">/5</span>
    </span>
  );
}

/** Small pills for what is there. `max` keeps a card down to its most useful three. */
export function AccessBadges({ access, max = 3 }: { access: SpotAccess | null; max?: number }) {
  const badges = accessBadges(access);
  if (!badges.length) return <p className="spot-access-unknown">Access not known yet</p>;
  return (
    <ul className="spot-badges" aria-label="Access">
      {badges.slice(0, max).map((badge) => (
        <li key={badge} className="spot-badge">
          {badge}
        </li>
      ))}
    </ul>
  );
}

/** The full access block on a spot's page: the score, its reasons, any caveat, and the ODbL credit. */
export function AccessBlock({ access }: { access: SpotAccess | null }) {
  return (
    <section className="spot-access" aria-labelledby="spot-access-title">
      <div className="spot-access-head">
        <h2 id="spot-access-title">Access</h2>
        <AccessScore access={access} />
      </div>
      {access && access.score != null ? (
        <>
          <ul className="spot-reasons">
            {access.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            {access.fee === 'yes' && !access.reasons.includes('Entry fee') && <li>Entry fee</li>}
          </ul>
          {access.note && <p className="spot-access-note">{access.note}</p>}
        </>
      ) : (
        <p className="muted small">
          No parking, toilets, paths or hides are mapped near this spot yet. It is listed, just not ranked as
          easy or hard.
        </p>
      )}
      <p className="spot-credit small">
        <a href={OSM_URL} target="_blank" rel="noopener">
          {OSM_CREDIT}
        </a>
      </p>
    </section>
  );
}

/** Four or five photos of the birds most recorded at a spot. */
export function SpotPhotos({ sp, count = 5 }: { sp: [number, number][]; count?: number }) {
  const species = sp
    .slice(0, count)
    .map(([id]) => byId.get(id))
    .filter((s): s is Species => Boolean(s));
  if (!species.length) return null;
  return (
    <ul className="spot-photos" aria-label="Most recorded birds">
      {species.map((s) => (
        <li key={s.id} className="spot-photo">
          <SpeciesImage sp={s} />
        </li>
      ))}
    </ul>
  );
}
