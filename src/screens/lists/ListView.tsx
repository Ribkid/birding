import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../core/db.js';
import { inPatch, periodFilter, speciesList } from '../../core/stats.js';
import { GROUPS, KINDS, byId, kindsPresent, type Species } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { Band, Pips, SpeciesImage } from '../../components/SpeciesImage';
import {
  ConfirmDialog,
  fmtDate,
  MONTH_NAMES,
  plural,
  usePatches,
  useSettled,
  useSightingRows,
  type SightingRow,
} from './shared';
import './lists.css';

interface SpeciesEntry {
  sp: Species;
  first: SightingRow;
  last: SightingRow;
  count: number;
  total: number;
}

const VALID_KEYS = ['life', 'year', 'month'];

export default function ListView() {
  const { key: rawKey, id } = useParams();
  const navigate = useNavigate();
  const sightings = useSightingRows();
  const patches = usePatches();
  const settled = useSettled();

  const patchId = id != null ? Number(id) : null;
  const patch = patchId != null ? patches.find((p) => p.id === patchId) : undefined;
  const period = rawKey ?? 'life';
  const validPeriod = VALID_KEYS.includes(period) || /^\d{4}$/.test(period);

  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'dex' | 'date'>('dex');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const now = new Date();
  const year = String(now.getFullYear());

  const source = useMemo(() => {
    if (!patch) return sightings;
    return sightings.filter((s) => inPatch(s, patch));
  }, [sightings, patch]);

  const entries = useMemo(() => {
    if (!validPeriod) return [];
    const map = speciesList(source.filter(periodFilter(period, now))) as Map<
      number,
      { first: SightingRow; last: SightingRow; count: number; total: number }
    >;
    const rows: SpeciesEntry[] = [];
    for (const [idValue, entry] of map) {
      const sp = byId.get(idValue);
      if (!sp) continue;
      if (kind !== 'all' && sp.kind !== kind) continue;
      rows.push({ sp, ...entry });
    }
    if (sort === 'dex') rows.sort((a, b) => a.sp.id - b.sp.id);
    else
      rows.sort((a, b) =>
        `${b.first.date} ${b.first.time ?? ''}`.localeCompare(`${a.first.date} ${a.first.time ?? ''}`),
      );
    return rows;
  }, [source, period, now, kind, sort, validPeriod]);

  const grouped = useMemo(() => {
    const present = new Set(entries.map((entry) => entry.sp.group));
    return Object.keys(GROUPS)
      .filter((group) => present.has(group))
      .map((group) => ({
        group,
        label: GROUPS[group],
        items: entries.filter((entry) => entry.sp.group === group),
      }));
  }, [entries]);

  const label =
    period === 'life'
      ? 'Life list'
      : period === 'year'
        ? `${year} list`
        : period === 'month'
          ? `${MONTH_NAMES[now.getMonth()]} ${year}`
          : `${period} list`;

  if (patchId != null && !patch) {
    return (
      <>
        <header className="page-head page-head--back">
          <Link className="iconbtn" to="/lists" aria-label="Back to lists">
            <Icon name="back" />
          </Link>
          <h1>Patch</h1>
        </header>
        <div className="pad">
          {settled ? (
            <>
              <p>That patch isn&apos;t on this device.</p>
              <Link className="btn" to="/lists">
                Back to lists
              </Link>
            </>
          ) : (
            <p className="muted">Looking for that patch…</p>
          )}
        </div>
      </>
    );
  }

  if (!validPeriod) {
    return (
      <>
        <header className="page-head page-head--back">
          <Link className="iconbtn" to="/lists" aria-label="Back to lists">
            <Icon name="back" />
          </Link>
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

  const base = patch ? `/patch/${patch.id}` : '/list';

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <div className="lists-head-text">
          <h1>{patch ? patch.name : label}</h1>
          {patch && (
            <p className="muted small">
              {label}, within {patch.radiusKm} km
            </p>
          )}
        </div>
      </header>

      <div className="chips">
        {(['life', 'year', 'month'] as const).map((option) => (
          <Link
            key={option}
            className={`chip ${period === option ? 'chip--on' : ''}`}
            to={`${base}/${option}`}
            aria-current={period === option ? 'page' : undefined}
          >
            {option === 'life' ? 'Life' : option === 'year' ? year : MONTH_NAMES[now.getMonth()]}
          </Link>
        ))}
        <span className="spacer" />
        <button
          type="button"
          className="chip"
          onClick={() => setSort(sort === 'dex' ? 'date' : 'dex')}
        >
          {sort === 'dex' ? 'Dex order' : 'Newest first'}
        </button>
      </div>

      {kindsPresent.length > 1 && (
        <div className="chips chips--scroll" role="group" aria-label="Kind">
          <button
            type="button"
            className={`chip ${kind === 'all' ? 'chip--on' : ''}`}
            aria-pressed={kind === 'all'}
            onClick={() => setKind('all')}
          >
            Everything
          </button>
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

      <p className="list-count">
        <b>{entries.length}</b> {plural(entries.length, 'species')}
      </p>

      {entries.length === 0 ? (
        <div className="empty">
          <p>
            {sightings.length === 0
              ? 'Nothing on this list yet. Log your first sighting to start it.'
              : 'Nothing on this list yet.'}
          </p>
          {sightings.length === 0 && (
            <Link className="btn" to="/add">
              Log a sighting
            </Link>
          )}
        </div>
      ) : (
        grouped.map((section) => (
          <section
            className={`dex-group kind--${section.items[0]?.sp.kind ?? 'bird'}`}
            key={section.group}
          >
            <h2 className="dex-group-h">
              <span>{section.label}</span>
              <span className="dex-group-n">{section.items.length}</span>
            </h2>
            <ul className="rows">
              {section.items.map((entry) => (
                <li key={entry.sp.id}>
                  <Link
                    className={`row row--sp kind--${entry.sp.kind}`}
                    to={`/bird/${entry.sp.id}`}
                  >
                    <span className="row-thumb row-thumb--seen">
                      <SpeciesImage sp={entry.sp} />
                    </span>
                    <span className="row-main">
                      <strong>{entry.sp.name}</strong>
                      <span className="muted small">
                        First {fmtDate(entry.first.date)}
                        {entry.count > 1 ? `, seen ${entry.count} times` : ''}
                      </span>
                    </span>
                    <Pips rarity={entry.sp.rarity} /> <Band sp={entry.sp} seen={true} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {patch && (
        <div className="row-end pad">
          <button
            type="button"
            className="btn btn--danger btn--quiet"
            onClick={() => setConfirmDelete(true)}
          >
            Delete patch
          </button>
        </div>
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
