import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { inPatch, speciesList, totals, yearTotals } from '../../core/stats.js';
import { byId, RARITY, type Species } from '../../lib/data';
import { stagger } from '../../lib/look';
import { Icon } from '../../components/Icon';
import {
  fmtDate,
  MONTH_NAMES,
  suggestTargets,
  targetOptions,
  useSeqVersion,
  type OutingRow,
  type Patch,
  type SightingRow,
} from './shared';
import { ChanceBar, CountKey, HubIcon, QuietImage, targetChances, useStoreRows } from './hubParts';
import './lists.css';

interface Totals {
  life: number;
  year: number;
  month: number;
}

type FirstSeen = Map<number, { first: SightingRow }>;

const NONE: never[] = [];

const outingStart = (outing: OutingRow): number => {
  if (outing.startedAt != null) return outing.startedAt;
  const parsed = Date.parse(`${outing.date}T${outing.time || '00:00'}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** The Lists hub, ported from v1 renderLists (birding-refresh js/app.js:1851). */
export default function Lists() {
  const sightingRows = useStoreRows<SightingRow>('sightings');
  const outingRows = useStoreRows<OutingRow>('outings');
  const patchRows = useStoreRows<Patch>('patches');
  const seqVersion = useSeqVersion();
  const ready = sightingRows != null && outingRows != null && patchRows != null;
  const sightings = sightingRows ?? NONE;
  const outings = outingRows ?? NONE;
  const patches = patchRows ?? NONE;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthName = MONTH_NAMES[now.getMonth()];

  const t = totals(sightings, now) as Totals;
  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
  const options = useMemo(() => targetOptions(), [seqVersion]);
  const allTg = useMemo(() => suggestTargets({ seen, month, ...options }), [seen, month, options]);
  const tg = allTg.slice(0, 8);
  const chance = useMemo(() => targetChances(allTg.slice(0, 8), month, options.score), [allTg, month, options]);

  const sortedOutings = useMemo(() => outings.slice().sort((a, b) => outingStart(b) - outingStart(a)), [outings]);
  const years = useMemo(
    () => (yearTotals(sightings) as { year: string; count: number }[]).filter((y) => y.year !== String(year)),
    [sightings, year],
  );

  // The life card shows her newest find.
  const newSp = useMemo(() => {
    const key = (s: SightingRow) => s.date + (s.time || '');
    const newest = [...(speciesList(sightings) as FirstSeen).entries()].sort((a, b) =>
      key(b[1].first).localeCompare(key(a[1].first)),
    )[0];
    return newest ? byId.get(newest[0]) : undefined;
  }, [sightings]);

  const patchTotals = patches.map((p) => ({ p, pt: totals(sightings.filter((s) => inPatch(s, p)), now) as Totals }));

  // What each outing turned up, newest first, for the photo strip.
  const strips = useMemo(() => {
    const by = new Map<number, Species[]>();
    const sorted = sightings.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    for (const s of sorted) {
      if (s.outingId == null) continue;
      const sp = byId.get(s.speciesId);
      if (!sp) continue;
      const list = by.get(s.outingId) ?? [];
      list.push(sp);
      by.set(s.outingId, list);
    }
    return by;
  }, [sightings]);

  // v1 drew straight into #view, so the hub's blocks are its direct children here too.
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() =>
      stagger(document.getElementById('view'), '.lh-stat, .tcard, .pcard, .ocard', { key: 'lists', max: 14 }),
    );
    return () => cancelAnimationFrame(id);
  }, [ready]);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/me" aria-label="Back to Me">
          <Icon name="back" />
        </Link>
        <h1>Lists</h1>
      </header>

      {ready && (
        <>
          <div className="lh-stats">
            <Link className={`lh-stat lh-stat--life${newSp ? ' lh-stat--photo' : ''}`} to="/list/life">
              {newSp && (
                <span className="lh-stat-img">
                  <QuietImage sp={newSp} />
                </span>
              )}
              <CountKey k="life" value={t.life} />
              <span className="lh-stat-l">Life list</span>{' '}
              {newSp ? (
                <span className="lh-stat-new">Newest: {newSp.name}</span>
              ) : (
                <span className="lh-stat-new lh-stat-hint">Your first find shows up here, photo and all.</span>
              )}
            </Link>
            <Link className="lh-stat" to="/list/year">
              <CountKey k="year" value={t.year} />
              <span className="lh-stat-l">{year} list</span>
            </Link>
            <Link className="lh-stat" to="/list/month">
              <CountKey k="month" value={t.month} />
              <span className="lh-stat-l">{monthName}</span>
            </Link>
          </div>
          <div className="lh-links">
            <Link className="lh-link" to="/stats">
              <Icon name="chart" /> Stats
            </Link>
            <Link className="lh-link" to="/log">
              <Icon name="list" /> All sightings
            </Link>
          </div>

          <section className="block lh-sec">
            <div className="block-h">
              <h2 className="h2">Targets for {monthName}</h2>
              <Link to="/targets">See all</Link>
            </div>
            <p className="muted small">Birds you haven&apos;t seen that are most often reported in SEQ this month.</p>
            {tg.length ? (
              <ul className="tcar" aria-label={`Targets for ${monthName}`}>
                {tg.map((s) => (
                  <li key={s.id}>
                    <Link className={`tcard kind--${s.kind}`} to={`/bird/${s.id}`}>
                      <span className="row-thumb tcard-img">
                        <QuietImage sp={s} />
                      </span>
                      <span className="tcard-txt">
                        <strong>{s.name}</strong>
                        <span className="tcard-r">{RARITY[s.rarity]?.label}</span>
                        <ChanceBar p={chance.get(s.id) ?? 0.06} cls="chance--on-photo" when="" />
                      </span>
                    </Link>
                  </li>
                ))}
                {allTg.length > tg.length && (
                  <li>
                    <Link className="tcard tcard--more" to="/targets">
                      <b>{allTg.length}</b>
                      <span>See all targets</span>
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="empty-inline">You have seen every likely bird for this month. Impressive.</p>
            )}
            <Link className="btn btn--block near-btn" to="/targets?near=1">
              <Icon name="pin" /> Find targets near me
            </Link>
          </section>

          <section className="block lh-sec">
            <div className="block-h">
              <h2 className="h2">Patches</h2>
              {/* v1 sets state.mapMode = 'patch': the map opens with the new-patch sheet up. */}
              <Link to="/map" state={{ mapMode: 'patch' }}>
                New patch
              </Link>
            </div>
            <p className="muted small">
              A patch is a place you visit often, like your yard or a local park. Any sighting inside its circle
              counts automatically.
            </p>
            {patchTotals.length ? (
              <ul className="lh-patches">
                {patchTotals.map(({ p, pt }) => (
                  <li key={p.id}>
                    <Link className="pcard" to={`/patch/${p.id}`}>
                      <span className="pcard-ring" aria-hidden="true" />
                      <span className="pcard-main">
                        <strong>{p.name}</strong>
                        <span className="muted small">{p.radiusKm} km radius</span>
                      </span>{' '}
                      <span className="pcard-nums">
                        <span>
                          <b>{pt.life}</b> life
                        </span>
                        <span>
                          <b>{pt.year}</b> {year}
                        </span>
                        <span>
                          <b>{pt.month}</b> {monthName.slice(0, 3)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">No patches yet. Add your yard first: it is the most fun list to grow.</p>
            )}
          </section>

          <section className="block lh-sec">
            <div className="block-h">
              <h2 className="h2">Outings</h2>
            </div>
            {sortedOutings.length ? (
              <ul className="lh-outings">
                {sortedOutings.slice(0, 12).map((o) => {
                  const sp = strips.get(o.id) ?? NONE;
                  return (
                    <li key={o.id}>
                      <Link className="ocard" to={`/outing/${o.id}`}>
                        <span className={`ocard-strip${sp.length ? '' : ' ocard-strip--empty'}`} aria-hidden="true">
                          {sp.length ? (
                            <>
                              {sp.slice(0, 4).map((s, i) => (
                                <span className="ocard-ph" key={`${s.id}-${i}`}>
                                  <QuietImage sp={s} />
                                </span>
                              ))}
                              {sp.length > 4 && <span className="ocard-more">+{sp.length - 4}</span>}
                            </>
                          ) : (
                            <HubIcon name="outing" />
                          )}
                        </span>
                        <span className="ocard-txt">
                          <strong>{o.place || 'Unnamed place'}</strong>
                          <span className="muted small">
                            {fmtDate(o.date)}, {o.time}
                            {o.endedAt && o.durationMin ? `, ${o.durationMin} min` : ''}
                          </span>
                          {!o.endedAt && <> <span className="ocard-live">In progress</span></>}
                        </span>{' '}
                        <span className="ocard-n">
                          <b>{sp.length}</b>
                          <span>species</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="empty-inline">Start an outing with the + button to tally everything you see at one spot.</p>
            )}
          </section>

          {years.length > 0 && (
            <section className="block lh-sec">
              <h2 className="h2">Past years</h2>
              <ul className="rows rows--card">
                {years.map((y) => (
                  <li key={y.year}>
                    <Link className="row" to={`/list/${y.year}`}>
                      <span className="row-main">
                        <strong>{y.year}</strong>
                      </span>
                      <span className="row-n">{y.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
