import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { useSightings } from '../../lib/hooks';
import { useEbirdSnapshot } from '../../lib/useEbird';
import { areaProgress, assignSightingArea } from '../../lib/areas';
import { EBIRD_CREDIT } from '../../lib/ebird';
import { REGION } from '../../lib/region';
import { SpeciesImage } from '../../components/SpeciesImage';
import NewForYou from '../../components/NewForYou';
import './areaDexes.css';

// "Council-area dexes" in SEQ, "Area dexes" in Melbourne (whose 37 councils are grouped into 8 areas).
const AREA_LINE = `${REGION.ebird.areaLabel.charAt(0).toUpperCase()}${REGION.ebird.areaLabel.slice(1).replace(/ /g, '-')} dexes, placed by your nearest eBird hotspot within 3 km.`;

type View = 'all' | 'seen' | 'unseen';

function Ring({ seen, total }: { seen: number; total: number }) {
  const fraction = total ? Math.min(1, seen / total) : 0;
  return (
    <span className="area-dex-ring" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle className="area-dex-ring-track" cx="20" cy="20" r="16" />
        <circle
          className="area-dex-ring-fill"
          cx="20"
          cy="20"
          r="16"
          pathLength="100"
          style={{ '--off': 100 - fraction * 100 } as CSSProperties}
        />
      </svg>
      <b>{seen}</b>
    </span>
  );
}

/** Lists' “Your areas”: eleven council-area rings and an inline, photo-first area dex. */
export default function AreaDexes() {
  const snapshot = useEbirdSnapshot();
  const sightings = useSightings();
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const areas = useMemo(
    () => (snapshot ? areaProgress(sightings, snapshot) : []),
    [snapshot, sightings],
  );

  if (snapshot === undefined) {
    return (
      <section className="area-dex" aria-label="Your areas" aria-busy="true">
        <h2>Your areas</h2>
        <div className="area-dex-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
      </section>
    );
  }
  if (!snapshot || !snapshot.regions || !areas.length) return null;

  const current = open ? snapshot.regions[open] : null;
  const area = open ? areas.find((item) => item.code === open) : null;
  const seenHere = new Set(
    open
      ? sightings
        .filter((sighting) => assignSightingArea(sighting, snapshot) === open)
        .map((sighting) => sighting.speciesId)
      : [],
  );
  const ids = current?.ids ?? [];
  const shown = ids.filter((id) => {
    if (view === 'seen') return seenHere.has(id);
    if (view === 'unseen') return !seenHere.has(id);
    return true;
  });

  return (
    <section className="area-dex" aria-labelledby="area-dex-title">
      <header className="area-dex-head">
        <div>
          <h2 id="area-dex-title">Your areas</h2>
          <p className="small muted">{AREA_LINE}</p>
        </div>
      </header>

      <ul className="area-dex-grid">
        {areas.map((item) => {
          const selected = open === item.code;
          return (
            <li key={item.code}>
              <button
                type="button"
                className={`area-dex-tile${selected ? ' is-open' : ''}`}
                aria-expanded={selected}
                aria-controls="area-dex-panel"
                disabled={!item.total}
                onClick={() => {
                  setView('all');
                  setOpen(selected ? null : item.code);
                }}
              >
                <Ring seen={item.seen} total={item.total} />
                <span className="area-dex-tile-main">
                  <strong>{item.name}</strong>
                  <span>{item.total ? `${item.seen} / ${item.total}` : 'No list yet'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && area && current && (
        <div className="area-dex-panel" id="area-dex-panel">
          <div className="area-dex-panel-head">
            <div>
              <h3>{area.name} dex</h3>
              <p className="small muted">{area.seen} seen of {area.total}</p>
            </div>
            <button type="button" className="iconbtn area-dex-close" aria-label="Close area dex" onClick={() => setOpen(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="chips area-dex-views" role="group" aria-label="Show area birds">
            {([['all', `All ${ids.length}`], ['unseen', `Not seen ${ids.length - seenHere.size}`], ['seen', `Seen ${seenHere.size}`]] as [View, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip${view === key ? ' chip--on' : ''}`}
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {shown.length ? (
            <ul className="area-dex-birds">
              {shown.map((id) => {
                const sp = byId.get(id);
                if (!sp) return null;
                const got = seenHere.has(id);
                return (
                  <li key={id}>
                    <Link className="area-dex-bird" to={`/bird/${id}`}>
                      <span className={got ? 'area-dex-photo is-seen' : 'area-dex-photo'}>
                        <SpeciesImage sp={sp} alt="" />
                      </span>
                      <span className="area-dex-bird-main">
                        <strong>{sp.name}</strong>
                        <span className="small muted">{sp.sci}</span>
                      </span>
                      {got ? <span className="area-dex-seen">Seen</span> : <NewForYou />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-inline area-dex-empty">Nothing matches that view yet.</p>
          )}
        </div>
      )}

      <p className="area-dex-note small muted">Sightings without coordinates count only towards your overall dex.</p>
      <p className="small area-dex-credit"><a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a></p>
    </section>
  );
}
