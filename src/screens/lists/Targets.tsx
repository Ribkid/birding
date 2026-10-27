import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { haversineKm, periodFilter } from '../../core/stats.js';
import { nearbyTargets } from '../../core/seqdata.js';
import {
  HABITATS,
  KINDS,
  RARITY,
  byId,
  kindsPresent,
  type Species,
} from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Pips, SpeciesImage } from '../../components/SpeciesImage';
import {
  MONTH_NAMES,
  getPosition,
  plural,
  suggestTargets,
  targetOptions,
  useSeqVersion,
  useSightingRows,
} from './shared';
import './lists.css';

type Scope = 'life' | 'year' | 'near';

interface Hotspot {
  name: string;
  lat: number;
  lng: number;
  sp: [number, number][];
}

interface NearEntry {
  id: number;
  score: number;
  best: { h: Hotspot; c: number; d: number };
}

interface NearResult {
  spots: { h: Hotspot; d: number }[];
  list: NearEntry[];
}

export default function Targets() {
  const sightings = useSightingRows();
  const [params] = useSearchParams();
  const seqVersion = useSeqVersion();
  const initialNear = params.get('near') === '1';

  const now = new Date();
  const year = String(now.getFullYear());

  const [scope, setScope] = useState<Scope>(initialNear ? 'near' : 'life');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [habitat, setHabitat] = useState('');
  const [kind, setKind] = useState('bird');

  const [position, setPosition] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [nearStatus, setNearStatus] = useState(
    initialNear ? 'Finding you…' : 'Use “Near me” to look around your current spot.',
  );
  const [nearResult, setNearResult] = useState<NearResult>({ spots: [], list: [] });
  const [attempt, setAttempt] = useState(0);

  const lifeSeen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
  const seen = useMemo(
    () =>
      scope === 'year'
        ? new Set(
            sightings.filter(periodFilter('year', now)).map((s) => s.speciesId),
          )
        : lifeSeen,
    [scope, sightings, lifeSeen, now],
  );

  const options = useMemo(() => targetOptions(), [seqVersion]);
  const list = useMemo(
    () =>
      scope === 'near'
        ? []
        : suggestTargets({ seen, month, habitat, kinds: [kind], ...options }),
    [scope, seen, month, habitat, kind, options],
  );

  useEffect(() => {
    if (scope === 'near' && kind !== 'bird') {
      setScope('life');
    }
  }, [scope, kind]);

  useEffect(() => {
    if (scope !== 'near') return;
    let alive = true;
    setNearStatus(position ? 'Looking around you…' : 'Finding you…');

    const run = async () => {
      try {
        const pos = position ?? (await getPosition());
        if (!alive) return;
        setPosition(pos);
        const result = nearbyTargets(pos, lifeSeen, 15) as NearResult;
        if (!alive) return;
        setNearResult(result);
        setNearStatus(
          result.spots.length
            ? `Birds you haven't seen that are recorded at the ${plural(
                result.spots.length,
                'hotspot',
              )} within 15 km of you. Most often reported first.`
            : 'No hotspots within 15 km. Try the life list targets instead.',
        );
      } catch (err) {
        if (!alive) return;
        setNearStatus(
          err instanceof Error ? err.message : 'Could not get your location. Try again.',
        );
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [scope, lifeSeen, seqVersion, attempt]);

  const nearRows = useMemo(
    () =>
      nearResult.list
        .map((entry) => ({ entry, sp: byId.get(entry.id) }))
        .filter(
          (row): row is { entry: NearEntry; sp: Species } =>
            Boolean(row.sp) && (!habitat || row.sp!.habitats.includes(habitat)),
        )
        .slice(0, 60),
    [nearResult, habitat],
  );

  const kindLabel = KINDS[kind]?.label ?? 'Species';

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>Targets</h1>
      </header>

      <div className="chips">
        {kind === 'bird' && (
          <button
            type="button"
            className={`chip ${scope === 'near' ? 'chip--on' : ''}`}
            aria-pressed={scope === 'near'}
            onClick={() => setScope('near')}
          >
            <Icon name="pin" /> Near me
          </button>
        )}
        <button
          type="button"
          className={`chip ${scope === 'life' ? 'chip--on' : ''}`}
          aria-pressed={scope === 'life'}
          onClick={() => setScope('life')}
        >
          Life list
        </button>
        <button
          type="button"
          className={`chip ${scope === 'year' ? 'chip--on' : ''}`}
          aria-pressed={scope === 'year'}
          onClick={() => setScope('year')}
        >
          {year} list
        </button>
        {scope !== 'near' && (
          <select
            className="chip chip--select"
            aria-label="Month"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select
          className={`chip chip--select ${habitat ? 'chip--on' : ''}`}
          aria-label="Habitat"
          value={habitat}
          onChange={(event) => setHabitat(event.target.value)}
        >
          <option value="">Any habitat</option>
          {Object.entries(HABITATS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {kindsPresent.length > 1 && (
        <div className="chips chips--scroll" role="group" aria-label="Kind">
          {kindsPresent.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip chip--kind kind--${k} ${kind === k ? 'chip--on' : ''}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {KINDS[k]?.label ?? k}
            </button>
          ))}
        </div>
      )}

      {scope === 'near' ? (
        <>
          <p className="muted small pad-x">{nearStatus}</p>
          {!position && !nearStatus.startsWith('Finding you') ? (
            <div className="pad-x">
              <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                <Icon name="pin" /> Try again
              </button>
            </div>
          ) : null}
          <p className="list-count">
            <b>{nearRows.length}</b> to find
          </p>
          <ul className="rows pad-x">
            {nearRows.map(({ entry, sp }) => {
              const distance = position
                ? haversineKm(position, entry.best.h)
                : entry.best.d;
              return (
                <li key={sp.id}>
                  <Link className={`row row--sp kind--${sp.kind}`} to={`/bird/${sp.id}`}>
                    <span className="row-thumb">
                      <SpeciesImage sp={sp} />
                    </span>
                    <span className="row-main">
                      <strong>{sp.name}</strong>
                      <span className="muted small">
                        Best spot: {entry.best.h.name} ({distance.toFixed(1)} km)
                      </span>
                    </span>
                    <Pips rarity={sp.rarity} />
                  </Link>
                </li>
              );
            })}
            {nearRows.length === 0 && !nearStatus.startsWith('Finding you') && (
              <li className="muted pad">
                {nearResult.spots.length === 0
                  ? 'No hotspots near you yet. Try the life list targets instead.'
                  : 'No unseen birds match that habitat near you.'}
              </li>
            )}
          </ul>
        </>
      ) : (
        <>
          <p className="muted small pad-x">
            {kindLabel} you still need that are reported in South East Queensland in{' '}
            {MONTH_NAMES[month - 1]}. The most often reported come first.
          </p>
          <p className="list-count">
            <b>{list.length}</b> to find
          </p>
          <ul className="rows pad-x">
            {list.map((sp) => (
              <li key={sp.id}>
                <Link className={`row row--sp kind--${sp.kind}`} to={`/bird/${sp.id}`}>
                  <span className="row-thumb">
                    <SpeciesImage sp={sp} />
                  </span>
                  <span className="row-main">
                    <strong>{sp.name}</strong>
                    <span className="muted small">
                      {RARITY[sp.rarity]?.label}. {sp.habitats.map((h) => HABITATS[h]).join(', ')}
                    </span>
                  </span>
                  <Pips rarity={sp.rarity} />
                </Link>
              </li>
            ))}
            {list.length === 0 && (
              <li className="muted pad">
                Nothing left to find for that month with those filters.
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}
