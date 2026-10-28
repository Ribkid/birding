import { useState } from 'react';
import { Link } from 'react-router-dom';
import { byId, kindsPresent } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { MinePhoto } from '../../components/MinePhoto';
import { SpeciesImage } from '../../components/SpeciesImage';
import { SightingEditSheet } from '../SightingEditSheet';
import { fmtDate, type SightingRow } from './shared';
import { CountKey, useStoreRows } from './hubParts';
import './lists.css';

/**
 * Every sighting, newest first, under a heading per day (v1 renderLog, js/app.js:2113). A row opens the sighting
 * sheet; her own photo stands in for the species photo when she took one.
 */
export default function Log() {
  // Drawn once the sightings have loaded, so the empty state never flashes and the count rises from the real total.
  const rows = useStoreRows<SightingRow>('sightings');
  const [editing, setEditing] = useState<SightingRow | null>(null);

  const list = (rows ?? [])
    .slice()
    .sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`));
  // Rows under tidy section headers, in the order the days first appear (v1 rowSections).
  const days = new Map<string, SightingRow[]>();
  for (const s of list) {
    const day = fmtDate(s.date);
    const items = days.get(day) ?? [];
    items.push(s);
    days.set(day, items);
  }
  const what =
    kindsPresent.length < 2 ? 'bird' : kindsPresent.includes('plant') ? 'bird, animal and plant' : 'bird and animal';

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>All sightings</h1>
      </header>
      {rows != null &&
        (list.length ? (
          <>
            <p className="list-count">
              <CountKey k="log" value={list.length} /> {list.length === 1 ? 'sighting' : 'sightings'}
            </p>
            {[...days].map(([day, items]) => (
              <section className="lsec" key={day}>
                <h2 className="lsec-h">
                  <span>{day}</span>
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
                        <button type="button" className="row row--sp" data-edit={s.id} onClick={() => setEditing(s)}>
                          <span className="row-thumb">
                            {s.photoId != null ? (
                              <MinePhoto photoId={s.photoId} />
                            ) : sp ? (
                              <SpeciesImage sp={sp} />
                            ) : (
                              <span className="img-missing" aria-hidden="true" />
                            )}
                          </span>{' '}
                          <span className="row-main">
                            <strong>{sp?.name ?? 'Unknown species'}</strong>
                            <span className="muted small">
                              {s.time || ''} {s.place || ''}
                            </span>
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
        ) : (
          <div className="empty">
            <p className="empty-h">No sightings yet</p>
            <p className="small">
              Every {what} you log lands here, newest first. Tap + or press and hold a tile in the dex.
            </p>
            <div className="row-center">
              <Link className="btn btn--primary" to="/add">
                Log a sighting
              </Link>
            </div>
          </div>
        ))}

      {editing && <SightingEditSheet sighting={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
