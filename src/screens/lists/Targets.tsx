import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { periodFilter } from '../../core/stats.js';
import { nearbyTargets } from '../../core/seqdata.js';
import { HABITATS, KINDS, RARITY, byId, kindsPresent, type Species } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Pips, SpeciesImage } from '../../components/SpeciesImage';
import {
  MONTH_NAMES,
  getPosition,
  plural,
  suggestTargets,
  targetOptions,
  useSeqVersion,
  type SightingRow,
} from './shared';
import { ChanceBar, CountKey, targetChances, useStoreRows } from './hubParts';
import './lists.css';

type Scope = 'life' | 'year' | 'near';

interface Filters {
  month: number;
  habitat: string;
  scope: Scope;
  kind: string;
}

interface Hotspot {
  name: string;
  lat: number;
  lng: number;
}

interface NearResult {
  spots: { h: Hotspot; d: number }[];
  list: { id: number; best: { h: Hotspot; d: number } }[];
}

type Fix = { lat: number; lng: number; acc: number; at: number };

// v1 kept the target filters and the last position in app state, so they hold for the session (state.targetF,
// state.lastPos). A position is reused for two minutes.
let saved: Filters | null = null;
let lastPos: Fix | null = null;
const POS_MS = 120000;
const freshPos = () => (lastPos && Date.now() - lastPos.at <= POS_MS ? lastPos : null);

/** One target row (v1 rowSpecies): the thumb, the name and its line, then the rarity pips. */
function TargetRow({ sp, seen, sub, extra }: { sp: Species; seen: boolean; sub: string; extra?: ReactNode }) {
  return (
    <li>
      <Link className="row row--sp" to={`/bird/${sp.id}`}>
        <span className={seen ? 'row-thumb row-thumb--seen' : 'row-thumb'}>
          <SpeciesImage sp={sp} />
        </span>
        <span className="row-main">
          <strong>{sp.name}</strong>
          <span className="muted small">{sub}</span>
          {extra}
        </span>
        <Pips rarity={sp.rarity} />
      </Link>
    </li>
  );
}

/** Targets: ported from v1 renderTargets (js/app.js:1991). */
export default function Targets() {
  const sightingRows = useStoreRows<SightingRow>('sightings');
  const [params] = useSearchParams();
  const seqVersion = useSeqVersion();
  const wantNear = params.get('near') === '1';

  const now = new Date();
  const year = now.getFullYear();

  const [f, setF] = useState<Filters>(() => {
    saved ??= { month: now.getMonth() + 1, habitat: '', scope: 'life', kind: 'bird' };
    if (wantNear) Object.assign(saved, { scope: 'near', kind: 'bird' });
    return { ...saved };
  });
  const update = (patch: Partial<Filters>) =>
    setF((prev) => {
      const next = { ...prev, ...patch };
      if (next.kind !== 'bird' && next.scope === 'near') next.scope = 'life';
      saved = next;
      return next;
    });
  // "Find targets near me" on Lists opens this page on Near me (v1 set targetF.scope = 'near' as it went).
  useEffect(() => {
    if (wantNear) update({ scope: 'near', kind: 'bird' });
  }, [wantNear]);

  const sightings = sightingRows ?? [];
  const lifeSeen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
  const seen = useMemo(
    () => (f.scope === 'year' ? new Set(sightings.filter(periodFilter('year', now)).map((s) => s.speciesId)) : lifeSeen),
    [f.scope, sightings, lifeSeen],
  );

  const options = useMemo(() => targetOptions(), [seqVersion]);
  const list = useMemo(
    () =>
      f.scope === 'near'
        ? []
        : suggestTargets({ seen, month: f.month, habitat: f.habitat, kinds: [f.kind], ...options }),
    [f, seen, options],
  );
  const chance = useMemo(() => targetChances(list, f.month, options.score), [list, f.month, options]);

  // Near me: where she is, then the hotspots within 15 km.
  const [pos, setPos] = useState<Fix | null>(freshPos);
  const [posError, setPosError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (f.scope !== 'near') return;
    const known = freshPos();
    if (known) {
      setPos(known);
      return;
    }
    let alive = true;
    setPos(null);
    setPosError(null);
    getPosition().then(
      (p) => {
        lastPos = { ...p, at: Date.now() };
        if (alive) setPos(lastPos);
      },
      (err: unknown) => {
        if (alive) setPosError(err instanceof Error ? err.message : 'Could not get your location. Try again outside or near a window.');
      },
    );
    return () => {
      alive = false;
    };
  }, [f.scope, attempt]);
  const near = useMemo(
    () => (f.scope === 'near' && pos && sightingRows ? (nearbyTargets(pos, lifeSeen, 15) as NearResult) : null),
    [f.scope, pos, lifeSeen, sightingRows, seqVersion],
  );
  const nearRows = near
    ? near.list
        .map((x) => ({ x, sp: byId.get(x.id) }))
        .filter((r): r is { x: NearResult['list'][number]; sp: Species } => !!r.sp && (!f.habitat || r.sp.habitats.includes(f.habitat)))
        .slice(0, 60)
    : [];
  const nearStatus = posError
    ? posError
    : !near
      ? 'Finding you…'
      : near.spots.length
        ? `Birds you haven't seen that are recorded at the ${plural(near.spots.length, 'hotspot')} within 15 km of you. Most often reported first.`
        : 'No hotspots within 15 km. Try the life list targets instead.';

  const monthName = MONTH_NAMES[f.month - 1];

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>Targets</h1>
      </header>
      {sightingRows != null && (
        <>
          <div className="chips">
            {f.kind === 'bird' && (
              <button
                type="button"
                className={`chip${f.scope === 'near' ? ' chip--on' : ''}`}
                aria-pressed={f.scope === 'near'}
                onClick={() => {
                  if (f.scope === 'near' && posError) setAttempt((n) => n + 1);
                  update({ scope: 'near' });
                }}
              >
                <Icon name="pin" /> Near me
              </button>
            )}
            <button
              type="button"
              className={`chip${f.scope === 'life' ? ' chip--on' : ''}`}
              aria-pressed={f.scope === 'life'}
              onClick={() => update({ scope: 'life' })}
            >
              Life list
            </button>
            <button
              type="button"
              className={`chip${f.scope === 'year' ? ' chip--on' : ''}`}
              aria-pressed={f.scope === 'year'}
              onClick={() => update({ scope: 'year' })}
            >
              {year} list
            </button>
            {f.scope !== 'near' && (
              <select
                className="chip chip--select"
                aria-label="Month"
                value={f.month}
                onChange={(e) => update({ month: Number(e.target.value) })}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <select
              className={`chip chip--select${f.habitat ? ' chip--on' : ''}`}
              aria-label="Habitat"
              value={f.habitat}
              onChange={(e) => update({ habitat: e.target.value })}
            >
              <option value="">Any habitat</option>
              {Object.entries(HABITATS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {kindsPresent.length >= 2 && (
            <div className="chips chips--scroll" role="group" aria-label="Kind">
              {kindsPresent.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip kind--${k} chip--kind${f.kind === k ? ' chip--on' : ''}`}
                  aria-pressed={f.kind === k}
                  onClick={() => update({ kind: k })}
                >
                  {KINDS[k]?.label ?? k}
                </button>
              ))}
            </div>
          )}

          {f.scope === 'near' ? (
            <>
              <p className="muted small pad-x" role="status">
                {nearStatus}
              </p>
              <div className="pad-x">
                {posError && (
                  <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                    <Icon name="pin" /> Try again
                  </button>
                )}
                <ul className={`rows rows--card${nearRows.length ? '' : ' hidden'}`}>
                  {nearRows.map(({ x, sp }) => (
                    <TargetRow
                      key={sp.id}
                      sp={sp}
                      seen={lifeSeen.has(sp.id)}
                      sub={`Best spot: ${x.best.h.name} (${x.best.d.toFixed(1)} km)`}
                    />
                  ))}
                </ul>
                {near && near.list.length > 0 && !nearRows.length && (
                  <p className="empty-inline">No unseen birds match that habitat near you.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muted small pad-x">
                {KINDS[f.kind]?.label ?? 'Species'} you still need that are reported in SEQ in {monthName}. The most
                often reported come first.
              </p>
              <p className="list-count">
                <CountKey k={`targets/${f.kind}/${f.scope}/${f.month}/${f.habitat}`} value={list.length} /> to find
              </p>
              <div className="pad-x">
                {list.length ? (
                  <ul className="rows rows--card">
                    {list.map((s) => (
                      <TargetRow
                        key={s.id}
                        sp={s}
                        seen={lifeSeen.has(s.id)}
                        sub={`${RARITY[s.rarity]?.label}. ${s.habitats.map((h) => HABITATS[h]).join(', ')}`}
                        extra={<ChanceBar p={chance.get(s.id) ?? 0.06} cls="chance--grow" when={` in ${monthName}`} />}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="empty-inline">Nothing left to find here. Try another month or habitat.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
