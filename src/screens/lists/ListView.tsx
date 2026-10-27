import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../core/db.js';
import { inPatch, periodFilter, speciesList } from '../../core/stats.js';
import { GROUPS, KINDS, byId, kindsPresent, type Species } from '../../lib/data';
import { flip } from '../../lib/motion';
import { Icon } from '../../components/Icon';
import { Band, SpeciesImage } from '../../components/SpeciesImage';
import { ConfirmDialog, fmtDate, MONTH_NAMES, type Patch, type SightingRow } from './shared';
import { CountKey, useStoreRows } from './hubParts';
import './lists.css';

interface SpeciesEntry {
  sp: Species;
  first: SightingRow;
  count: number;
}

const VALID_KEYS = ['life', 'year', 'month'];

// v1 kept the sort and the kind filter in app state, so they hold for the session (state.listSort, state.listKind).
const session: { sort: 'dex' | 'date'; kind: string } = { sort: 'dex', kind: 'all' };

// What an empty list says: which kind, which period, and for a patch how it fills (v1 emptyList).
function emptyList(lk: string, period: string, now: Date, patch?: Patch): string {
  const what = lk === 'all' ? 'Nothing' : `No ${(KINDS[lk]?.label ?? lk).toLowerCase()}`;
  const when =
    period === 'life'
      ? ''
      : period === 'year'
        ? ` in ${now.getFullYear()}`
        : period === 'month'
          ? ` in ${MONTH_NAMES[now.getMonth()]}`
          : ` in ${period}`;
  return patch
    ? `${what} logged inside this patch${when} yet. Any sighting within ${patch.radiusKm} km of its centre counts here.`
    : `${what} logged${when} yet. Tap + to log a sighting.`;
}

/** A life, year, month or past-year list, or a patch's list: ported from v1 renderList (js/app.js:1950). */
export default function ListView() {
  const { key: rawKey, id } = useParams();
  const navigate = useNavigate();
  const sightingRows = useStoreRows<SightingRow>('sightings');
  const patchRows = useStoreRows<Patch>('patches');
  const ready = sightingRows != null && patchRows != null;

  const patchId = id != null ? Number(id) : null;
  const patch = patchId != null ? patchRows?.find((p) => p.id === patchId) : undefined;
  const period = rawKey ?? 'life';
  const validPeriod = VALID_KEYS.includes(period) || /^\d{4}$/.test(period);

  const [lk, setKindState] = useState(session.kind);
  const [sort, setSortState] = useState(session.sort);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const monthName = MONTH_NAMES[now.getMonth()];
  const back = (
    <Link className="iconbtn" to="/lists" aria-label="Back to lists">
      <Icon name="back" />
    </Link>
  );

  if (patchId != null && ready && !patch) {
    return (
      <>
        <header className="page-head page-head--back">
          {back}
          <h1>Patch</h1>
        </header>
        <div className="pad">
          <p>That patch isn&apos;t on this device.</p>
          <Link className="btn" to="/lists">
            Back to lists
          </Link>
        </div>
      </>
    );
  }

  if (!validPeriod) {
    return (
      <>
        <header className="page-head page-head--back">
          {back}
          <h1>List</h1>
        </header>
        <div className="empty">
          <p>That list isn&apos;t one of ours.</p>
          <Link className="btn" to="/lists">
            Choose a list
          </Link>
        </div>
      </>
    );
  }

  const label =
    period === 'life'
      ? 'Life list'
      : period === 'year'
        ? `${year} list`
        : period === 'month'
          ? `${monthName} ${year}`
          : `${period} list`;
  const base = patchId != null ? `/patch/${patchId}` : '/list';
  const byDex = sort === 'dex';

  let entries: SpeciesEntry[] = [];
  if (ready) {
    const src = patch ? sightingRows.filter((s) => inPatch(s, patch)) : sightingRows;
    const map = speciesList(src.filter(periodFilter(period, now))) as Map<number, { first: SightingRow; count: number }>;
    entries = [...map.entries()]
      .map(([spId, e]) => ({ sp: byId.get(spId) as Species, first: e.first, count: e.count }))
      .filter((e) => e.sp && (lk === 'all' || e.sp.kind === lk));
    if (byDex) entries.sort((a, b) => a.sp.id - b.sp.id);
    else
      entries.sort((a, b) =>
        (b.first.date + (b.first.time ?? '')).localeCompare(a.first.date + (a.first.time ?? '')),
      );
  }

  // Dex order groups by family (or kind); newest first groups by the month she first saw each one.
  const groupOf = byDex
    ? (e: SpeciesEntry) => GROUPS[e.sp.group] || KINDS[e.sp.kind]?.label || ''
    : (e: SpeciesEntry) => {
        const [y, m] = e.first.date.split('-').map(Number);
        return `${MONTH_NAMES[m - 1]} ${y}`;
      };
  // Rows under tidy section headers, in the order the groups first appear (v1 rowSections).
  const groups = new Map<string, SpeciesEntry[]>();
  for (const e of entries) {
    const g = groupOf(e);
    const list = groups.get(g) ?? [];
    list.push(e);
    groups.set(g, list);
  }

  // The rows slide to their new places when the order or the filter changes (v1 flip on '.row--sp').
  const redraw = (fn: () => void) =>
    flip(() => flushSync(fn), { selector: '.row--sp', key: (el) => el.getAttribute('href') ?? undefined });
  const toggleSort = () =>
    redraw(() => {
      session.sort = sort === 'dex' ? 'date' : 'dex';
      setSortState(session.sort);
    });
  const pickKind = (k: string) =>
    redraw(() => {
      session.kind = k;
      setKindState(k);
    });

  // A row of kind chips, shown only once other animals or plants are in the dex (v1 kindChips).
  const kindOpts: [string, string][] = [
    ['all', 'Everything'],
    ...kindsPresent.map((k): [string, string] => [k, KINDS[k]?.label ?? k]),
  ];

  return (
    <>
      <header className="page-head page-head--back">
        {back}
        <div className="lists-head-text">
          <h1>{patch ? patch.name : patchId != null ? 'Patch' : label}</h1>
          {patch && (
            <p className="muted small">
              {label}, within {patch.radiusKm} km
            </p>
          )}
        </div>
      </header>
      {ready && (
        <>
          <div className="lbar">
            <nav className="lseg" aria-label="Which list">
              {(['life', 'year', 'month'] as const).map((p) => (
                <Link
                  key={p}
                  className="lseg-btn"
                  to={`${base}/${p}`}
                  aria-current={period === p ? 'page' : undefined}
                >
                  {p === 'life' ? (
                    'Life'
                  ) : p === 'year' ? (
                    year
                  ) : (
                    <>
                      <span className="lseg-long">{monthName}</span>
                      <span className="lseg-short">{monthName.slice(0, 3)}</span>
                    </>
                  )}
                </Link>
              ))}
            </nav>
            <button
              type="button"
              className="chip lsort"
              aria-label={`Sort: ${byDex ? 'dex order' : 'newest first'}. Tap to change`}
              onClick={toggleSort}
            >
              {byDex ? 'Dex order' : 'Newest first'}
            </button>
          </div>
          {kindsPresent.length >= 2 && (
            <div className="chips chips--scroll" role="group" aria-label="Kind">
              {kindOpts.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={`chip${k !== 'all' ? ` kind--${k} chip--kind` : ''}${lk === k ? ' chip--on' : ''}`}
                  aria-pressed={lk === k}
                  onClick={() => pickKind(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <p className="list-count">
            <CountKey k={`${base}/${period}/${lk}`} value={entries.length} /> species
          </p>
          {groups.size ? (
            [...groups].map(([g, items]) => (
              <section className="lsec" key={g}>
                <h2 className="lsec-h">
                  <span>{g}</span>
                  <span className="lsec-n">
                    {items.length}
                    <span className="sr-only"> species</span>
                  </span>
                </h2>
                <ul className="rows rows--card">
                  {items.map((e) => (
                    <li key={e.sp.id}>
                      <Link className="row row--sp" to={`/bird/${e.sp.id}`}>
                        <span className="row-thumb row-thumb--seen">
                          <SpeciesImage sp={e.sp} />
                        </span>
                        <span className="row-main">
                          <strong>{e.sp.name}</strong>
                          <span className="muted small">
                            First {fmtDate(e.first.date)}
                            {e.count > 1 ? `, seen ${e.count} times` : ''}
                          </span>
                        </span>
                        <Band sp={e.sp} seen />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="empty-inline lempty">{emptyList(lk, period, now, patch)}</p>
          )}
          {patch && (
            <div className="row-end pad">
              <button type="button" className="btn btn--danger btn--quiet" onClick={() => setConfirmDelete(true)}>
                Delete patch
              </button>
            </div>
          )}
        </>
      )}

      {patch && confirmDelete && (
        <ConfirmDialog
          title={`Delete ${patch.name}?`}
          body="Your sightings stay; only the patch list is removed."
          confirmLabel="Delete patch"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await db.del('patches', patch.id);
              setConfirmDelete(false);
              navigate('/lists');
            } catch {
              setConfirmDelete(false);
            }
          }}
        />
      )}
    </>
  );
}
