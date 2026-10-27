import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GROUPS, HABITATS, RARITY, SPECIES, byId, dexCode } from '../lib/data';
import { useSightings } from '../lib/hooks';
import { galleryFor, infoFor } from '../core/gallery.js';
import { Icon } from '../components/Icon';
import { Pips, SpeciesImage } from '../components/SpeciesImage';

export default function Bird() {
  const { id } = useParams();
  const sp = byId.get(Number(id));
  const sightings = useSightings();

  const mine = useMemo(
    () =>
      sightings
        .filter((s) => s.speciesId === sp?.id)
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)),
    [sightings, sp?.id],
  );

  if (!sp) {
    return (
      <div className="pad">
        <p>That species isn't in the dex.</p>
        <Link className="btn" to="/dex">
          Back to the dex
        </Link>
      </div>
    );
  }

  const info = infoFor(sp.id) as { text?: string; status?: string; sources?: { title: string; url: string }[] } | null;
  const gallery = galleryFor(sp.id) as { src: string; credit?: string; license?: string; page?: string }[];
  const similar = SPECIES.filter((s) => s.id !== sp.id && s.group === sp.group).slice(0, 4);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/dex" aria-label="Back to the dex">
          <Icon name="back" />
        </Link>
        <h1>{sp.name}</h1>
      </header>

      <div className="bird-hero">
        <SpeciesImage sp={sp} size="large" whole />
      </div>

      <section className="pad">
        <div className="bird-title">
          <div>
            <h2 className="h2">{sp.name}</h2>
            <p className="muted small">
              <i>{sp.sci}</i>
            </p>
          </div>
          <span className={`band band--${sp.kind} band--on band--big`}>{dexCode(sp.id)}</span>
        </div>

        {info?.text && <p className="bird-notes">{info.text}</p>}

        <dl className="facts">
          <div>
            <dt>Group</dt>
            <dd>{GROUPS[sp.group]}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{sp.sizeText}</dd>
          </div>
          <div>
            <dt>Habitat</dt>
            <dd>{sp.habitats.map((h) => HABITATS[h]).join(', ')}</dd>
          </div>
          <div>
            <dt>Rarity</dt>
            <dd>
              <Pips rarity={sp.rarity} /> {RARITY[sp.rarity]?.label}
            </dd>
          </div>
          {sp.nocturnal && (
            <div>
              <dt>Active</dt>
              <dd>Mostly at night</dd>
            </div>
          )}
        </dl>

        {info?.status && <p className="small muted">Conservation: {info.status}</p>}

        <div className="quicklinks">
          <Link className="btn" to={`/map/sp/${sp.id}`}>
            <Icon name="pin" /> Show where it's reported
          </Link>
        </div>
      </section>

      {mine.length > 0 && (
        <section className="pad">
          <h2 className="h2">Your sightings</h2>
          <ul className="rows">
            {mine.slice(0, 6).map((s) => (
              <li className="row" key={s.id}>
                <span className="row-main">
                  <strong>{s.date}</strong>
                  <span className="muted small">{s.time}{s.note ? ` — ${s.note}` : ''}</span>
                </span>
                <span className="row-n">{s.count ?? 1}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gallery.length > 0 && (
        <section className="pad">
          <h2 className="h2">More photos</h2>
          <ul className="gallery">
            {gallery.slice(0, 6).map((g) => (
              <li key={g.src}>
                <img src={g.src} alt={sp.name} loading="lazy" decoding="async" />
                <span className="credit small muted">
                  {g.page ? (
                    <a href={g.page} target="_blank" rel="noopener">
                      {g.credit || 'Unknown'}
                    </a>
                  ) : (
                    g.credit || 'Unknown'
                  )}
                  {g.license ? `, ${g.license}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {similar.length > 0 && (
        <section className="pad">
          <h2 className="h2">Similar species</h2>
          <ul className="rows">
            {similar.map((s) => (
              <li key={s.id}>
                <Link className="row row--sp" to={`/bird/${s.id}`}>
                  <span className="row-thumb">
                    <SpeciesImage sp={s} />
                  </span>
                  <span className="row-main">
                    <strong>{s.name}</strong>
                    <span className="muted small">{s.sizeText}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
