import { useState } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { useEbirdSnapshot, useLiveEbird, useOnline } from '../../lib/useEbird';
import {
  EBIRD_CREDIT,
  relativeDay,
  type EbirdChecklist,
  type EbirdVisit,
} from '../../lib/ebird';
import { SpeciesImage } from '../../components/SpeciesImage';
import { Sheet } from '../../components/Sheet';
import NewForYou from '../../components/NewForYou';
import './latestVisits.css';

function VisitSkeleton() {
  return (
    <section className="latest-visits" aria-label="Latest visits" aria-busy="true">
      <h2>Latest visits</h2>
      <div className="latest-visits-skeleton" aria-hidden="true"><span /><span /></div>
    </section>
  );
}

function visitWhen(date: string, time: string) {
  const relative = relativeDay(date);
  return time ? `${relative} at ${time}` : relative;
}

function ChecklistSheet({ sub, onClose }: { sub: string; onClose: () => void }) {
  const snapshot = useEbirdSnapshot();
  const seen = useSeen();
  const live = useLiveEbird<EbirdChecklist>({ checklist: '', sub }, true);
  const data = live.data;
  const titleId = `visit-${sub}`;
  const codes = snapshot?.codes ?? {};

  return (
    <Sheet open onClose={onClose} labelledBy={titleId} cls="visit-sheet">
      <h2 className="sheet-title" id={titleId}>
        {data ? `Checklist · ${visitWhen(data.date, data.time)}` : 'Checklist'}
      </h2>
      {live.loading || snapshot === undefined ? (
        <div className="visit-sheet-skeleton" aria-label="Loading checklist" aria-busy="true">
          <span /><span /><span /><span />
        </div>
      ) : data ? (
        <>
          <p className="small muted visit-sheet-sub">{data.species.length} species reported on this visit.</p>
          {data.species.length ? (
            <ul className="visit-sheet-list">
              {data.species.map((row) => {
                const id = codes[row.code];
                const sp = id == null ? null : byId.get(id);
                const isNew = !!sp && !seen.has(sp.id);
                return (
                  <li key={row.code}>
                    <span className="visit-sheet-photo">
                      {sp ? <SpeciesImage sp={sp} alt="" /> : <span aria-hidden="true">{row.name.slice(0, 1)}</span>}
                    </span>
                    <span className="visit-sheet-main">
                      {sp ? (
                        <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
                      ) : (
                        <strong>{row.name}</strong>
                      )}
                      <span className="small muted">{row.n === 1 ? '1 reported' : `${row.n} reported`}</span>
                    </span>
                    {isNew && <NewForYou />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-inline">No species were listed on this checklist.</p>
          )}
          <div className="visit-sheet-actions">
            <a className="btn" href={`https://ebird.org/checklist/${sub}`} target="_blank" rel="noopener">Open in eBird</a>
            <button type="button" className="btn btn--quiet" onClick={onClose}>Done</button>
          </div>
          <p className="small visit-sheet-credit"><a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a></p>
        </>
      ) : (
        <>
          <p className="visit-sheet-error">This checklist could not be loaded right now.</p>
          <a className="btn" href={`https://ebird.org/checklist/${sub}`} target="_blank" rel="noopener">Open in eBird</a>
        </>
      )}
    </Sheet>
  );
}

/** The ten most recently submitted checklists at a hotspot. Observer names stay on eBird. */
export default function LatestVisits({ locId }: { locId: string }) {
  const online = useOnline();
  const live = useLiveEbird<EbirdVisit[]>({ visits: '', loc: locId }, !!locId && online);
  const [sub, setSub] = useState<string | null>(null);

  if (!online) return null;
  if (live.loading) return <VisitSkeleton />;
  if (!live.data?.length) return null;

  return (
    <section className="latest-visits" aria-labelledby="latest-visits-title">
      <header>
        <h2 id="latest-visits-title">Latest visits</h2>
        <p className="small muted">Recent eBird checklists at this hotspot. Observer names are not shown.</p>
      </header>
      <ul className="latest-visits-list">
        {live.data.map((visit) => (
          <li key={visit.sub}>
            <button
              type="button"
              className="latest-visit"
              aria-label={`Open checklist from ${visitWhen(visit.date, visit.time)}, ${visit.species} species`}
              onClick={() => setSub(visit.sub)}
            >
              <span className="latest-visit-main">
                <strong>{visitWhen(visit.date, visit.time)}</strong>
                <span className="small muted">{visit.species} species</span>
              </span>
              <span className="latest-visit-go" aria-hidden="true">View</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small latest-visits-credit"><a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a></p>
      {sub && <ChecklistSheet sub={sub} onClose={() => setSub(null)} />}
    </section>
  );
}
