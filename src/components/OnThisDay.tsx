import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../lib/data';
import { useSeen } from '../lib/hooks';
import { useEbirdSnapshot, useLiveEbird, useOnline } from '../lib/useEbird';
import { useRoughLocation } from '../lib/useRoughLocation';
import { nearestRegionCode } from '../lib/areas';
import {
  EBIRD_CREDIT,
  REGION_NAMES,
  relativeDay,
  roughLatLng,
  sameDayLastYear,
  tidySpotName,
  type EbirdObservation,
  type HistoricDay,
} from '../lib/ebird';
import { SpeciesImage } from './SpeciesImage';
import { Sheet } from './Sheet';
import NewForYou from './NewForYou';
import './onThisDay.css';

interface Props {
  variant?: 'card' | 'rail';
}

/** “This day last year” from a historic regional feed, using the nearest council area when a fix exists. */
export default function OnThisDay({ variant = 'card' }: Props) {
  const online = useOnline();
  const snapshot = useEbirdSnapshot();
  const seen = useSeen();
  const rough = useRoughLocation();
  const date = sameDayLastYear();
  const point = roughLatLng(rough.pos);
  const region = snapshot ? (nearestRegionCode(snapshot, point) ?? 'BRI') : 'BRI';
  const live = useLiveEbird<HistoricDay>(
    { historic: '', region: `AU-QLD-${region}`, date },
    online && snapshot !== undefined,
  );
  const [open, setOpen] = useState(false);
  const rail = variant === 'rail';

  const species = useMemo(() => {
    if (!live.data || !snapshot) return [];
    const codes = snapshot.codes ?? {};
    const one = new Map<string, EbirdObservation>();
    for (const obs of live.data.sightings) if (!one.has(obs.code)) one.set(obs.code, obs);
    return [...one.values()].map((obs) => {
      const id = codes[obs.code];
      return { obs, sp: id == null ? null : byId.get(id) ?? null };
    });
  }, [live.data, snapshot]);
  const fresh = species.filter(({ sp }) => sp && !seen.has(sp.id)).slice(0, 6);
  const count = species.length;
  const lead = (fresh[0] ?? species.find((row) => row.sp))?.sp ?? null;
  const area = REGION_NAMES[region] ?? region;

  if (!online || snapshot === undefined) {
    if (!online) return null;
    return (
      <div className={rail ? 'today-card on-this-day-rail on-this-day-skeleton' : 'on-this-day on-this-day-skeleton'} aria-busy="true">
        <span /><span />
      </div>
    );
  }
  if (live.loading) {
    return (
      <div className={rail ? 'today-card on-this-day-rail on-this-day-skeleton' : 'on-this-day on-this-day-skeleton'} aria-busy="true">
        <span /><span />
      </div>
    );
  }
  if (!live.data || !count) return null;

  const card = (
    <button
      type="button"
      className={rail ? 'today-card on-this-day-rail' : 'on-this-day-card'}
      aria-haspopup="dialog"
      aria-label={`This day last year: ${count} species reported around ${area}. Open the list.`}
      onClick={() => setOpen(true)}
    >
      {lead && <span className="on-this-day-photo"><SpeciesImage sp={lead} alt="" /></span>}
      <span className="on-this-day-main">
        <span className="on-this-day-kicker">This day last year</span>
        <strong>{count} species around {area}</strong>
        {fresh.length > 0 && <NewForYou label={`${fresh.length} new for you`} />}
      </span>
    </button>
  );

  return (
    <>
      {rail ? card : <section className="on-this-day" aria-label="This day last year">{card}</section>}
      {open && (
        <Sheet open onClose={() => setOpen(false)} labelledBy="on-this-day-title" cls="on-this-day-sheet">
          <h2 className="sheet-title" id="on-this-day-title">This day last year</h2>
          <p className="small muted on-this-day-sub">
            {count} species reported around {area} on {date}.
          </p>
          {fresh.length ? (
            <ul className="on-this-day-list">
              {fresh.map(({ obs, sp }) => {
                if (!sp) return null;
                const place = tidySpotName(obs.where);
                return (
                  <li key={`${obs.code}:${obs.loc}`}>
                    <span className="on-this-day-row-photo"><SpeciesImage sp={sp} alt="" /></span>
                    <span className="on-this-day-row-main">
                      <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
                      <span className="small muted">{place.name} · {relativeDay(obs.date)}</span>
                    </span>
                    {place.restricted && <span className="on-this-day-restricted">Restricted</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-inline">You have seen every species reported that day.</p>
          )}
          <p className="small muted on-this-day-privacy">
            {rough.pos ? 'Uses your rough location to choose the nearest area, never saved.' : 'Brisbane is shown until a rough location is available.'}
          </p>
          <p className="small on-this-day-credit"><a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a></p>
          <button type="button" className="btn btn--block" onClick={() => setOpen(false)}>Done</button>
        </Sheet>
      )}
    </>
  );
}
