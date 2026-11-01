import { accessBadges, OSM_CREDIT, OSM_URL, type SpotAccess } from '../../lib/spots';

/** The access score as "3/5". Nothing at all when OpenStreetMap knows nothing, rather than saying so on every card. */
export function AccessScore({ access }: { access: SpotAccess | null }) {
  if (!access || access.score == null) return null;
  return (
    <span className="spot-score" aria-label={`Access ${access.score} out of 5`}>
      <b>{access.score}</b>
      <span aria-hidden="true">/5</span>
    </span>
  );
}

/** The access score and small pills for what is there; `max` keeps a card to its most useful few. Nothing when unknown. */
export function AccessBadges({ access, max = 3 }: { access: SpotAccess | null; max?: number }) {
  const badges = accessBadges(access);
  if (!badges.length && (!access || access.score == null)) return null;
  return (
    <span className="spot-badges" role="list" aria-label="Access">
      <AccessScore access={access} />
      {badges.slice(0, max).map((badge) => (
        <span key={badge} role="listitem" className="spot-badge">
          {badge}
        </span>
      ))}
    </span>
  );
}

/** The access block on a spot's page: the score, its reasons, any caveat and the ODbL credit; one quiet line when unknown. */
export function AccessBlock({ access }: { access: SpotAccess | null }) {
  if (!access || access.score == null) {
    return (
      <p className="spot-access-none small">
        Access: nothing mapped nearby yet (<a href={OSM_URL} target="_blank" rel="noopener">OpenStreetMap</a>)
      </p>
    );
  }
  return (
    <section className="spot-access" aria-labelledby="spot-access-title">
      <div className="spot-access-head">
        <h2 id="spot-access-title">Access</h2>
        <AccessScore access={access} />
      </div>
      <ul className="spot-reasons">
        {access.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        {access.fee === 'yes' && !access.reasons.includes('Entry fee') && <li>Entry fee</li>}
      </ul>
      {access.note && <p className="spot-access-note">{access.note}</p>}
      <p className="spot-credit small">
        <a href={OSM_URL} target="_blank" rel="noopener">
          {OSM_CREDIT}
        </a>
      </p>
    </section>
  );
}
