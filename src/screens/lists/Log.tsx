// #/log, All sightings: v1 renderLog (js/app.js). Every sighting, newest first, in sections by day. A row opens the
// shared Edit sighting sheet, and the empty state's button opens Log a sighting, both over this page as in v1.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { byId, kindsPresent } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { MinePhoto } from '../../components/MinePhoto';
import { SpeciesImage } from '../../components/SpeciesImage';
import { openSightingSheet } from '../../components/SightingSheet';
import { CountKey, useStoreRows } from './hubParts';
import { fmtDate, type SightingRow } from './shared';
import './lists.css';

const what = () => (kindsPresent.length < 2 ? 'bird' : kindsPresent.includes('plant') ? 'bird, animal and plant' : 'bird and animal');

export default function Log() {
  const rows = useStoreRows<SightingRow>('sightings');

  const sections = useMemo(() => {
    if (!rows) return null;
    const sorted = rows.slice().sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`));
    const groups = new Map<string, SightingRow[]>();
    for (const s of sorted) {
      const g = fmtDate(s.date);
      const items = groups.get(g) ?? [];
      items.push(s);
      groups.set(g, items);
    }
    return { total: sorted.length, groups: [...groups] };
  }, [rows]);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>All sightings</h1>
      </header>

      {sections && sections.total > 0 && (
        <>
          <p className="list-count">
            <CountKey k="log" value={sections.total} /> {sections.total === 1 ? 'sighting' : 'sightings'}
          </p>
          {sections.groups.map(([g, items]) => (
            <section className="lsec" key={g}>
              <h2 className="lsec-h">
                <span>{g}</span>
                <span className="lsec-n">
                  {items.length}
                  <span className="sr-only"> {items.length === 1 ? 'sighting' : 'sightings'}</span>
                </span>
              </h2>
              <ul className="rows rows--card">
                {items.map((s) => {
                  const sp = byId.get(s.speciesId);
                  return (
                    <li key={s.id}>
                      <button type="button" className="row row--sp" data-edit={s.id} onClick={() => openSightingSheet({ sighting: s })}>
                        {/* The name is written beside the photo, so the photo isn't read out too. */}
                        <span className="row-thumb" aria-hidden="true">
                          {s.photoId != null ? <MinePhoto photoId={s.photoId} /> : sp ? <SpeciesImage sp={sp} /> : <span className="img-missing" aria-hidden="true" />}
                        </span>
                        <span className="row-main">
                          <strong>{sp?.name}</strong>
                          <span className="muted small">{`${s.time || ''} ${s.place || ''}`}</span>
                        </span>
                        <span className="row-n">{s.count ?? 'X'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {sections && sections.total === 0 && (
        <div className="empty">
          <p className="empty-h">No sightings yet</p>
          <p className="small">Every {what()} you log lands here, newest first. Tap + or press and hold a tile in the dex.</p>
          <div className="row-center">
            <button type="button" className="btn btn--primary" data-logfirst="" onClick={() => openSightingSheet()}>
              Log a sighting
            </button>
          </div>
        </div>
      )}
    </>
  );
}
