import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { useEbirdSnapshot } from '../../lib/useEbird';
import { applyAroundWeek, recentWeekSpecies } from '../../lib/aroundWeek';
import { EBIRD_CREDIT } from '../../lib/ebird';
import { REGION } from '../../lib/region';
import { SpeciesImage } from '../../components/SpeciesImage';
import './aroundWeek.css';

/** A photo-first entrance to the Learn pack filled from the last seven days of eBird reports. */
export default function AroundWeek() {
  const snapshot = useEbirdSnapshot();
  const ids = useMemo(
    () => (snapshot ? recentWeekSpecies(snapshot) : null),
    [snapshot],
  );

  useEffect(() => {
    if (snapshot) applyAroundWeek(snapshot);
  }, [snapshot]);

  if (snapshot === undefined) {
    return (
      <section className="lh-sec around-week" aria-label="Around this week" aria-busy="true">
        <div className="lh-sec-h"><h2>Around this week</h2></div>
        <div className="around-week-skeleton" aria-hidden="true"><span /><span /></div>
      </section>
    );
  }
  if (!ids || ids.length < 5) return null;
  const lead = ids.map((id) => byId.get(id)).find(Boolean) ?? null;
  if (!lead) return null;

  return (
    <section className="lh-sec around-week" aria-labelledby="around-week-title">
      <div className="lh-sec-h">
        <h2 id="around-week-title">Around this week</h2>
        <span className="small muted">{ids.length} recent birds</span>
      </div>
      <Link
        className="around-week-card"
        to="/learn/play/around"
        aria-label={`Around this week: play a quiz on ${ids.length} birds reported in the last seven days.`}
      >
        <span className="around-week-photo"><SpeciesImage sp={lead} alt="" /></span>
        <span className="around-week-main">
          <strong>What's been reported near {REGION.short} hotspots</strong>
          <span className="small muted">A photo-first pack from the last seven days of eBird reports.</span>
          <span className="around-week-play">Play <span aria-hidden="true">→</span></span>
        </span>
      </Link>
      <p className="small around-week-credit">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
