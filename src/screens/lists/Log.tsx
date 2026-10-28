// #/log, All sightings: v1 renderLog (js/app.js). Every sighting, newest first, in sections by day. A row opens the
// shared Edit sighting sheet, and the empty state's button opens Log a sighting, both over this page as in v1.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { byId, kindsPresent } from '../../lib/data';
import { db } from '../../core/db.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { openSightingSheet } from '../../components/SightingSheet';
import { CountKey, useStoreRows } from './hubParts';
import { fmtDate, type SightingRow } from './shared';
import './lists.css';

/** Her own photo for a row, read from the photos store only as the row comes near the screen (v1 hydratePhotos). */
function OwnPhoto({ photoId }: { photoId: number }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState('');
  useEffect(() => {
    const el = imgRef.current;
    if (near || !el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let alive = true, made = '';
    void Promise.resolve(db.get('photos', photoId)).then((rec: { blob?: Blob } | undefined) => {
      if (!alive || !rec?.blob) return;
      made = URL.createObjectURL(rec.blob);
      setUrl(made);
    }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [near, photoId]);
  return <img ref={imgRef} src={url || undefined} alt="" loading="lazy" decoding="async" data-photo={photoId} />;
}

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
                          {s.photoId != null ? <OwnPhoto photoId={s.photoId} /> : sp ? <SpeciesImage sp={sp} /> : <span className="img-missing" aria-hidden="true" />}
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
