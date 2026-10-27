import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ANIMALS,
  ANIMAL_KINDS,
  GROUPS,
  HABITATS,
  KINDS,
  RARITY,
  SPECIES,
  dexCode,
  inSeason,
  kindsPresent,
  pluralFor,
  scopeFor,
  type Species,
} from '../lib/data';
import { useSightings, lastSeenKey } from '../lib/hooks';
import { Icon } from '../components/Icon';
import { Band, Pips, SpeciesImage } from '../components/SpeciesImage';

type Show = 'all' | 'seen' | 'unseen';
type Sort = 'dex' | 'name' | 'rarity' | 'recent';
type Layout = 'grid' | 'list';

export default function Dex() {
  const sightings = useSightings();
  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);

  const [kind, setKind] = useState<string>('animals');
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<Sort>('dex');
  const [layout, setLayout] = useState<Layout>('grid');
  const [rarity, setRarity] = useState('');
  const [habitat, setHabitat] = useState('');
  const [group, setGroup] = useState('');
  const [season, setSeason] = useState(false);

  const month = new Date().getMonth() + 1;
  const scope = useMemo(() => scopeFor(kind), [kind]);
  const scopeSeen = scope.filter((s) => seen.has(s.id)).length;
  const pct = Math.round((scopeSeen / Math.max(1, scope.length)) * 100);
  const filtersOn = Boolean(rarity || habitat || group || season || show !== 'all');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scope.filter((s) => {
      if (show === 'seen' && !seen.has(s.id)) return false;
      if (show === 'unseen' && seen.has(s.id)) return false;
      if (rarity && String(s.rarity) !== rarity) return false;
      if (habitat && !s.habitats.includes(habitat)) return false;
      if (group && s.group !== group) return false;
      if (season && !inSeason(s, month)) return false;
      if (needle && !`${s.name} ${s.sci}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [scope, q, show, rarity, habitat, group, season, seen, month]);

  const groupsPresent = useMemo(() => {
    const keys = new Set(list.map((s) => s.group));
    return Object.keys(GROUPS).filter((g) => keys.has(g));
  }, [list]);

  const sorted = useMemo(() => {
    const rows = list.slice();
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rarity') rows.sort((a, b) => b.rarity - a.rarity || a.id - b.id);
    else if (sort === 'recent')
      rows.sort(
        (a, b) =>
          lastSeenKey(sightings, b.id).localeCompare(lastSeenKey(sightings, a.id)) || a.id - b.id,
      );
    return rows;
  }, [list, sort, sightings]);

  const animalKinds = ANIMAL_KINDS.filter((k) => kindsPresent.includes(k));

  const reset = () => {
    setQ('');
    setShow('all');
    setRarity('');
    setHabitat('');
    setGroup('');
    setSeason(false);
  };

  const tile = (s: Species) => (
    <li key={s.id}>
      <Link
        className={`tile kind--${s.kind} ${seen.has(s.id) ? 'tile--seen' : ''}`}
        to={`/bird/${s.id}`}
      >
        <span className="tile-img">
          <SpeciesImage sp={s} />
        </span>
        <Band sp={s} seen={seen.has(s.id)} />
        <span className="tile-name">{s.name}</span>
      </Link>
    </li>
  );

  const row = (s: Species) => (
    <li key={s.id}>
      <Link className={`row row--sp kind--${s.kind}`} to={`/bird/${s.id}`}>
        <span className={`row-thumb ${seen.has(s.id) ? 'row-thumb--seen' : ''}`}>
          <SpeciesImage sp={s} />
        </span>
        <span className="row-main">
          <strong>{s.name}</strong>
          <span className="muted small">{GROUPS[s.group]}</span>
        </span>
        <Pips rarity={s.rarity} /> <Band sp={s} seen={seen.has(s.id)} />
      </Link>
    </li>
  );

  const block = (items: Species[]) =>
    layout === 'list' ? (
      <ul className="rows pad-x">{items.map(row)}</ul>
    ) : (
      <ul className="dex-grid">{items.map(tile)}</ul>
    );

  let body: ReactNode;
  if (!list.length) {
    body = (
      <div className="empty">
        <p>Nothing matches those filters.</p>
        <button className="btn" onClick={reset}>
          Clear filters
        </button>
      </div>
    );
  } else if (sort === 'dex') {
    body = groupsPresent.map((g) => {
      const items = list.filter((s) => s.group === g);
      const all = SPECIES.filter((s) => s.group === g);
      const got = all.filter((s) => seen.has(s.id)).length;
      const gKind = items[0]?.kind ?? 'bird';
      return (
        <section className={`dex-group kind--${gKind}`} key={g}>
          <h2 className="dex-group-h">
            <span>{GROUPS[g]}</span>
            <span className="dex-group-n">
              {got}/{all.length}
            </span>
          </h2>
          {block(items)}
        </section>
      );
    });
  } else {
    body = <section className="dex-group">{block(sorted)}</section>;
  }

  return (
    <>
      <header className="dex-head">
        <div className="dex-head-top">
          <h1 className="wordmark">
            <img className="logo" src="/icons/logo.svg" alt="" width={52} height={52} />
            <span className="wordmark-txt">
              Sarah's BirdyDex<small>South East Queensland</small>
            </span>
          </h1>
          <div className="head-actions">
            <Link className="iconbtn" to="/settings" aria-label="Settings">
              <Icon name="gear" />
            </Link>
          </div>
        </div>

        <div className="tally" aria-label={`${scopeSeen} of ${scope.length} ${pluralFor(kind, scope.length)} seen`}>
          <span className="tally-band">
            <b>{scopeSeen}</b>
            <i>/{scope.length}</i>
          </span>
          <div className="tally-meta">
            <span>
              {pluralFor(kind, 2)} {kind === 'plant' ? 'found' : 'seen'}
            </span>
            <div className="meter" style={{ '--p': `${pct}%` } as CSSProperties}>
              <span />
            </div>
          </div>
        </div>

        <div className="id-buttons">
          <Link className="idbtn" to="/listen">
            <Icon name="mic" />
            <span>
              <strong>Listen</strong>
              <em>ID by call</em>
            </span>
          </Link>
          <Link className="idbtn" to="/scan">
            <Icon name="scan" />
            <span>
              <strong>Scan</strong>
              <em>ID from a photo</em>
            </span>
          </Link>
        </div>

        {kindsPresent.length > 1 && (
          <div className="kind-tabs" role="tablist" aria-label="What to show">
            <button
              role="tab"
              aria-selected={kind === 'animals'}
              className="kind-tab kind--all"
              onClick={() => {
                setKind('animals');
                setGroup('');
              }}
            >
              <span>All animals</span>
              <em>
                {ANIMALS.filter((s) => seen.has(s.id)).length}/{ANIMALS.length}
              </em>
            </button>
            {animalKinds.map((k) => {
              const all = scopeFor(k);
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  className={`kind-tab kind--${k} ${kind === k ? 'on' : ''}`}
                  onClick={() => {
                    setKind(k);
                    setGroup('');
                  }}
                >
                  <i aria-hidden="true" />
                  <span>{KINDS[k].label}</span>
                  <em>
                    {all.filter((s) => seen.has(s.id)).length}/{all.length}
                  </em>
                </button>
              );
            })}
            {kindsPresent.includes('plant') && (
              <button
                role="tab"
                aria-selected={kind === 'plant'}
                className={`kind-tab kind-tab--quiet kind--plant ${kind === 'plant' ? 'on' : ''}`}
                onClick={() => {
                  setKind('plant');
                  setGroup('');
                }}
              >
                <i aria-hidden="true" />
                <span>Plants</span>
                <em>
                  {scopeFor('plant').filter((s) => seen.has(s.id)).length}/{scopeFor('plant').length}
                </em>
              </button>
            )}
          </div>
        )}
      </header>

      <div className="dex-tools">
        <div className="searchbox searchbox--dex">
          <Icon name="search" />
          <input
            type="search"
            placeholder={`Filter ${scope.length} ${pluralFor(kind, 2)}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter by name"
          />
        </div>
        <button
          className="iconbtn iconbtn--tool"
          aria-label={layout === 'list' ? 'Show as grid' : 'Show as list'}
          onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
        >
          <Icon name={layout === 'list' ? 'grid' : 'list'} />
        </button>
      </div>

      <div className="chips chips--scroll chips--dex" role="group" aria-label="Filter and sort">
        {(
          [
            ['all', 'All'],
            ['seen', 'Seen'],
            ['unseen', 'Not seen'],
          ] as [Show, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={`chip ${show === value ? 'chip--on' : ''}`}
            aria-pressed={show === value}
            onClick={() => setShow(value)}
          >
            {label}
          </button>
        ))}
        <button className={`chip ${season ? 'chip--on' : ''}`} aria-pressed={season} onClick={() => setSeason(!season)}>
          In season now
        </button>
        <select
          className={`chip chip--select ${sort !== 'dex' ? 'chip--on' : ''}`}
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="dex">Dex order</option>
          <option value="name">Name A–Z</option>
          <option value="rarity">Rarest first</option>
          <option value="recent">Recently seen</option>
        </select>
        <select
          className={`chip chip--select ${rarity ? 'chip--on' : ''}`}
          aria-label="Rarity"
          value={rarity}
          onChange={(e) => setRarity(e.target.value)}
        >
          <option value="">Any rarity</option>
          {Object.entries(RARITY).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
        <select
          className={`chip chip--select ${habitat ? 'chip--on' : ''}`}
          aria-label="Habitat"
          value={habitat}
          onChange={(e) => setHabitat(e.target.value)}
        >
          <option value="">Any habitat</option>
          {Object.entries(HABITATS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={`chip chip--select ${group ? 'chip--on' : ''}`}
          aria-label="Group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">All groups</option>
          {Object.entries(GROUPS)
            .filter(([key]) => scope.some((s) => s.group === key))
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </select>
        {filtersOn && (
          <button className="chip" onClick={reset}>
            Clear
          </button>
        )}
      </div>

      {(q || filtersOn) && (
        <p className="list-count">
          <b>{list.length}</b> {list.length === 1 ? 'species' : 'species'}
        </p>
      )}

      <div className="dex dex--colour">{body}</div>
    </>
  );
}
