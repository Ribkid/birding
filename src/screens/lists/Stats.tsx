import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { periodFilter } from '../../core/stats.js';
import { GROUPS, SPECIES, byId } from '../../lib/data';
import { Icon } from '../../components/Icon';
import {
  MONTH_NAMES,
  fmtDate,
  plural,
  useOutingRows,
  useSightingRows,
} from './shared';
import './lists.css';

type Period = 'all' | 'year' | 'month';


const shortDate = (date: string): string => {
  const [year, month] = date.split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  return `${name ? name.slice(0, 3) : ''} ${year}`;
};

function GrowthChart({ growth }: { growth: [string, number][] }) {
  if (growth.length < 2) {
    return <p className="small muted">Needs sightings on at least two days.</p>;
  }
  const W = 340;
  const H = 150;
  const P = 28;
  const t0 = Date.parse(growth[0][0]);
  const t1 = Math.max(Date.parse(growth[growth.length - 1][0]), t0 + 864e5);
  const max = growth[growth.length - 1][1];
  const x = (date: string) => P + ((Date.parse(date) - t0) / (t1 - t0)) * (W - P - 8);
  const y = (value: number) => H - 20 - (value / max) * (H - 34);

  let path = `M${x(growth[0][0])},${y(0)}`;
  for (const [date, value] of growth) path += ` L${x(date)},${y(value)}`;
  const last = growth[growth.length - 1][0];
  const first = growth[0][0];

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Life list grew to ${max} species`}
    >
      <line x1={P} y1={H - 20} x2={W - 8} y2={H - 20} className="axis" />
      <text x={P - 6} y={y(max) + 4} textAnchor="end" className="lbl">
        {max}
      </text>
      <text x={P - 6} y={H - 16} textAnchor="end" className="lbl">
        0
      </text>
      <path
        d={`${path} L${x(last)},${H - 20} L${x(first)},${H - 20} Z`}
        className="area"
      />
      <path d={path} className="line" />
      <text x={P} y={H - 4} className="lbl">
        {shortDate(first)}
      </text>
      <text x={W - 8} y={H - 4} textAnchor="end" className="lbl">
        {shortDate(last)}
      </text>
    </svg>
  );
}

function MonthBars({ values, current }: { values: number[]; current: number }) {
  const max = Math.max(1, ...values);
  return (
    <>
      <div className="season season--tall" role="img" aria-label="Species per month">
        {values.map((value, index) => (
          <i
            key={index}
            className={index === current ? 'now' : undefined}
            style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
            title={`${MONTH_NAMES[index]}: ${value}`}
          >
            <em>{value || ''}</em>
          </i>
        ))}
      </div>
      <div className="season-labels" aria-hidden="true">
        {[...'JFMAMJJASOND'].map((letter, index) => (
          <span key={index}>{letter}</span>
        ))}
      </div>
    </>
  );
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function Heatmap({ perDay, now }: { perDay: Map<string, Set<number>>; now: Date }) {
  const end = new Date(now);
  end.setHours(12);
  const startMonday = new Date(end);
  startMonday.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 7 * 25);
  const max = Math.max(1, ...[...perDay.values()].map((set) => set.size));

  const days: { key: string; count: number }[] = [];
  const cursor = new Date(startMonday);
  while (cursor <= end) {
    const key = dayKey(cursor);
    days.push({ key, count: perDay.get(key)?.size ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div className="heat" role="img" aria-label="Calendar of birding days">
      {days.map((day) => (
        <i
          key={day.key}
          style={
            {
              '--v': day.count ? 0.25 + (0.75 * day.count) / max : 0,
            } as CSSProperties
          }
          title={`${day.key}: ${day.count} species`}
        />
      ))}
    </div>
  );
}

function GroupBars({ seen }: { seen: Set<number> }) {
  const groups = new Map<string, { total: number; got: number }>();
  for (const sp of SPECIES) {
    const entry = groups.get(sp.group) ?? { total: 0, got: 0 };
    entry.total += 1;
    if (seen.has(sp.id)) entry.got += 1;
    groups.set(sp.group, entry);
  }
  return (
    <ul className="gbars">
      {[...groups.entries()].map(([group, value]) => (
        <li key={group}>
          <span>{GROUPS[group] ?? group}</span>
          <span
            className="meter meter--thin"
            style={
              {
                '--p': `${Math.round((value.got / Math.max(1, value.total)) * 100)}%`,
              } as CSSProperties
            }
          >
            <span />
          </span>
          <span className="num">
            {value.got}/{value.total}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Stats() {
  const sightings = useSightingRows();
  const outings = useOutingRows();
  const [period, setPeriod] = useState<Period>('all');

  const now = new Date();
  const year = String(now.getFullYear());

  const all = useMemo(
    () =>
      sightings
        .slice()
        .sort((a, b) =>
          `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`),
        ),
    [sightings],
  );

  const filtered = useMemo(
    () => all.filter(periodFilter(period, now)),
    [all, period, now],
  );

  const lifeSeen = useMemo(() => new Set(all.map((s) => s.speciesId)), [all]);
  const speciesSeen = useMemo(() => new Set(filtered.map((s) => s.speciesId)), [filtered]);

  const growth = useMemo(() => {
    const seen = new Set<number>();
    const points: [string, number][] = [];
    for (const sighting of filtered) {
      if (seen.has(sighting.speciesId)) continue;
      seen.add(sighting.speciesId);
      points.push([sighting.date, seen.size]);
    }
    return points;
  }, [filtered]);

  const perMonth = useMemo(() => {
    const months = Array.from({ length: 12 }, () => new Set<number>());
    for (const sighting of filtered) {
      if (!sighting.date?.startsWith(year)) continue;
      const index = Number(sighting.date.slice(5, 7)) - 1;
      if (index >= 0 && index < 12) months[index].add(sighting.speciesId);
    }
    return months;
  }, [filtered, year]);

  const perDay = useMemo(() => {
    const days = new Map<string, Set<number>>();
    for (const sighting of filtered) {
      const set = days.get(sighting.date) ?? new Set<number>();
      set.add(sighting.speciesId);
      days.set(sighting.date, set);
    }
    return days;
  }, [filtered]);

  const bestDay = useMemo(
    () => [...perDay.entries()].sort((a, b) => b[1].size - a[1].size)[0],
    [perDay],
  );

  const individuals = useMemo(
    () => filtered.reduce((total, sighting) => total + (Number(sighting.count) || 0), 0),
    [filtered],
  );

  const topPlaces = useMemo(() => {
    const places = new Map<string, Set<number>>();
    for (const sighting of filtered) {
      const key = (sighting.place ?? '').trim();
      if (!key) continue;
      const set = places.get(key) ?? new Set<number>();
      set.add(sighting.speciesId);
      places.set(key, set);
    }
    return [...places.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  }, [filtered]);

  const topSpecies = useMemo(() => {
    const frequency = new Map<number, number>();
    for (const sighting of filtered) {
      frequency.set(sighting.speciesId, (frequency.get(sighting.speciesId) ?? 0) + 1);
    }
    return [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);

  const yearRows = useMemo(() => {
    const years = new Map<string, { species: Set<number>; count: number }>();
    for (const sighting of all) {
      const key = (sighting.date ?? '').slice(0, 4) || 'Undated';
      const entry = years.get(key) ?? { species: new Set<number>(), count: 0 };
      entry.species.add(sighting.speciesId);
      entry.count += 1;
      years.set(key, entry);
    }
    return [...years.entries()]
      .map(([label, value]) => ({
        label,
        species: value.species.size,
        count: value.count,
      }))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [all]);

  const periodLabel =
    period === 'all' ? 'all time' : period === 'year' ? year : MONTH_NAMES[now.getMonth()];

  const body = (
    <>
      <div className="statgrid">
          <div>
            <b>{speciesSeen.size}</b>
            <span>species</span>
          </div>
          <div>
            <b>{filtered.length}</b>
            <span>sightings</span>
          </div>
          <div>
            <b>{individuals.toLocaleString('en-AU')}</b>
            <span>individuals counted</span>
          </div>
          <div>
            <b>{perDay.size}</b>
            <span>days out</span>
          </div>
        </div>

        {all.length === 0 && (
          <p className="empty-inline pad-x">
            Charts appear here once there are a few sightings.{' '}
            <Link to="/add">Log a sighting</Link> when you are ready.
          </p>
        )}

        <section className="block">
          <h2 className="h2">Life list growth</h2>
          <GrowthChart growth={growth} />
        </section>

        <section className="block">
          <h2 className="h2">Species each month in {year}</h2>
          <MonthBars values={perMonth.map((set) => set.size)} current={now.getMonth()} />
        </section>

        <section className="block">
          <h2 className="h2">Birding days</h2>
          <p className="small muted">
            The last 26 weeks. Darker squares mean more species that day.
          </p>
          <Heatmap perDay={perDay} now={now} />
          {bestDay && (
            <p className="small">
              Best day: <strong>{bestDay[1].size} species</strong> on{' '}
              {fmtDate(bestDay[0])}.
            </p>
          )}
        </section>

        {topPlaces.length > 0 && (
          <section className="block">
            <h2 className="h2">Top places</h2>
            <ul className="spots">
              {topPlaces.map(([place, set]) => (
                <li key={place}>
                  <span>{place}</span>
                  <span className="num">{set.size}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {topSpecies.length > 0 && (
          <section className="block">
            <h2 className="h2">Most logged</h2>
            <ul className="spots">
              {topSpecies.map(([id, count]) => {
                const sp = byId.get(id);
                return (
                  <li key={id}>
                    {sp ? (
                      <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
                    ) : (
                      <span>Unknown species</span>
                    )}
                    <span className="num">{count}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="block">
          <h2 className="h2">Dex progress by group</h2>
          <GroupBars seen={lifeSeen} />
        </section>
    </>
  );

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>Stats</h1>
      </header>


      {body}

      <section className="block">
        <div className="block-h">
          <h2 className="h2">By year</h2>
        </div>
        {yearRows.length > 0 ? (
          <ul className="spots">
            {yearRows.map((row) => (
              <li key={row.label}>
                {/^\d{4}$/.test(row.label) ? (
                  <Link to={`/list/${row.label}`}>{row.label}</Link>
                ) : (
                  <span>{row.label}</span>
                )}
                <span className="num">
                  {row.species} sp · {row.count}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-inline">Your years will appear once you log a sighting.</p>
        )}
      </section>

    </>
  );
}
