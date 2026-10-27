// Stats page: life list growth, months, calendar heatmap, places, and the dex by kind and group.
// The first visit in a session counts the totals up and fills each chart as it comes into view.
// Ported from v1's js/statsview.js (renderStats); the styles are v1's, in screens.css.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../core/db.js';
import { loadExtras } from '../../core/gallery.js';
import { cachedIndex, sized } from '../../core/media.js';
import { MONTHS } from '../../core/stats.js';
import { GROUPS, KINDS, SPECIES, byId, kindsPresent, type Species } from '../../lib/data';
import { normaliseSighting, useMedia, type Sighting } from '../../lib/hooks';
import { countUp, motionOK } from '../../lib/motion';
import { Icon } from '../../components/Icon';

/** A sighting as stored in IndexedDB, with the fields this page reads beyond the shared facade type. */
type StatSighting = Omit<Sighting, 'count'> & { count?: number | string | null; place?: string };

const MONTH_NAMES = MONTHS as string[];
const fmt = (n: number) => n.toLocaleString('en-AU');
const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return MONTH_NAMES[m - 1] ? `${day} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}` : d;
};
const short = (d: string) => {
  const [y, m] = d.split('-');
  return `${(MONTH_NAMES[Number(m) - 1] ?? '').slice(0, 3)} ${y}`;
};
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The count-up and chart fills play once per session, like v1.
let played = false;

/**
 * Every sighting, or null until IndexedDB has answered, so the first draw already has the real totals.
 * Like v1's boot, the first draw also waits for the saved photo index, and for the gallery photos when they
 * are in within a moment; gallery photos that arrive later fill in the Most logged thumbnails.
 */
function useLoadedSightings(): StatSighting[] | null {
  const [rows, setRows] = useState<StatSighting[] | null>(null);
  const [, setExtrasIn] = useState(false);
  useEffect(() => {
    let alive = true;
    const extras = loadExtras();
    const load = async () => {
      const all = ((await db.all('sightings')) as StatSighting[]).map(normaliseSighting);
      if (alive) setRows(all);
    };
    void Promise.all([cachedIndex(), Promise.race([extras, new Promise((r) => setTimeout(r, 150))])]).then(load);
    void extras.then(() => {
      if (alive) setExtrasIn(true);
    });
    const off = db.onChange((name: string) => {
      if (name === 'sightings') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

// Photos already shown this session come back at full strength, so a redraw doesn't make them blink (v1 `shown`).
const shown = new Set<string>();

/**
 * v1's birdImg(sp, 'small', '', { alt: '' }) for a Most logged row: the name is written beside the photo, so the
 * photo is not read out. It fades in the first time it arrives (the row shimmers meanwhile), and when the photo
 * index brings a better picture later, the photo already on screen stays until the new one has decoded
 * (v1 settleImages and patchSpeciesImages). A photo that fails shows the striped no-photo block, as a species
 * without a photo does; v1 left that row shimmering as if it were still loading.
 */
function Thumb({ sp }: { sp: Species }) {
  useMedia();
  const url = sized(sp.id, 'small') as string | null;
  const [src, setSrc] = useState(url);
  const [shownIn, setShownIn] = useState(() => !!url && shown.has(url));
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!url || url === src) return;
    const el = ref.current;
    if (!el || !el.complete || !el.naturalWidth) {
      setSrc(url);
      setShownIn(shown.has(url));
      setMissing(false);
      return;
    }
    let alive = true;
    const next = new Image();
    next.src = url;
    next.decode().then(
      () => {
        if (!alive) return;
        shown.add(url);
        setSrc(url);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [url, src]);

  // A photo that is already complete when drawn (memory cache) shows at once, with no fade.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shownIn || !el.complete || !el.naturalWidth) return;
    shown.add(el.getAttribute('src') || '');
    setShownIn(true);
  }, [src, shownIn]);

  if (!src || missing) return <span className="img-missing" aria-hidden="true" />;
  return (
    <img
      ref={ref}
      className={`fade${shownIn ? ' in' : ''}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => {
        shown.add(src);
        setShownIn(true);
      }}
      onError={() => setMissing(true)}
    />
  );
}

/** A total that counts up from zero on the first visit and simply shows its value after that. */
function StatNum({ n, play, delay }: { n: number; play: boolean; delay: number }) {
  const ref = useRef<HTMLElement>(null);
  const counted = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (play && !counted.current) {
      counted.current = true;
      void countUp(el, 0, n, { delay, format: fmt });
      return;
    }
    counted.current = true;
    // countUp writes the text itself, so keep it in step when the total changes later.
    el.textContent = fmt(n);
  }, [n, play, delay]);
  return (
    <b ref={ref} data-n={n}>
      {fmt(n)}
    </b>
  );
}

function Ring({ p }: { p: number }) {
  const style = {
    '--off': (100 - Math.min(1, p) * 100).toFixed(1),
    ...(p ? {} : { visibility: 'hidden' }),
  } as CSSProperties;
  return (
    <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle className="ring-track" cx="18" cy="18" r="15" />
      <circle className="ring-fill" cx="18" cy="18" r="15" pathLength={100} style={style} />
    </svg>
  );
}

function GrowthChart({ growth }: { growth: [string, number][] }) {
  if (growth.length < 2) return <p className="small muted">Needs sightings on at least two days.</p>;
  const W = 340;
  const H = 150;
  const P = 28;
  const first = growth[0][0];
  const last = growth[growth.length - 1][0];
  const t0 = Date.parse(first);
  const t1 = Math.max(Date.parse(last), t0 + 864e5);
  const max = growth[growth.length - 1][1];
  const x = (d: string) => P + ((Date.parse(d) - t0) / (t1 - t0)) * (W - P - 8);
  const y = (n: number) => H - 20 - (n / max) * (H - 34);
  let d = `M${x(first)},${y(0)}`;
  for (const [date, n] of growth) d += ` L${x(date)},${y(n)}`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Life list grew to ${max} species`}>
      <line x1={P} y1={H - 20} x2={W - 8} y2={H - 20} className="axis" />
      <text x={P - 6} y={y(max) + 4} textAnchor="end" className="lbl">
        {max}
      </text>
      <text x={P - 6} y={H - 16} textAnchor="end" className="lbl">
        0
      </text>
      <path d={`${d} L${x(last)},${H - 20} L${x(first)},${H - 20} Z`} className="area" />
      <path d={d} className="line" pathLength={1} />
      <text x={P} y={H - 4} className="lbl">
        {short(first)}
      </text>
      <text x={W - 8} y={H - 4} textAnchor="end" className="lbl">
        {short(last)}
      </text>
    </svg>
  );
}

function MonthBars({ vals, cur }: { vals: number[]; cur: number }) {
  const max = Math.max(1, ...vals);
  return (
    <>
      <div className="season season--tall" role="img" aria-label="Species per month">
        {vals.map((v, i) => (
          <i
            key={i}
            className={i === cur ? 'now' : ''}
            style={{ height: `${Math.max(2, (v / max) * 100)}%`, '--i': i } as CSSProperties}
            title={`${MONTH_NAMES[i]}: ${v}`}
          >
            <em>{v || ''}</em>
          </i>
        ))}
      </div>
      <div className="season-labels" aria-hidden="true">
        {[...'JFMAMJJASOND'].map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
    </>
  );
}

function Heatmap({ perDay, now }: { perDay: Map<string, Set<number>>; now: Date }) {
  const end = new Date(now);
  end.setHours(12);
  const startMon = new Date(end);
  startMon.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 7 * 25);
  const max = Math.max(1, ...[...perDay.values()].map((s) => s.size));
  const days: [string, number][] = [];
  for (const d = new Date(startMon); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    days.push([k, perDay.get(k)?.size || 0]);
  }
  return (
    <div className="heat" role="img" aria-label="Calendar of days out">
      {days.map(([k, n]) => (
        <i key={k} style={{ '--v': n ? 0.25 + (0.75 * n) / max : 0 } as CSSProperties} title={`${k}: ${n} species`} />
      ))}
    </div>
  );
}

// Groups sit under their kind, each kind with its own tally, so 18 bird groups and 26 others don't run together.
function GroupBars({ seen }: { seen: Set<number> }) {
  const kinds = kindsPresent.length > 1;
  return (
    <>
      {kindsPresent.map((k) => {
        const all = SPECIES.filter((s) => s.kind === k);
        const got = all.filter((s) => seen.has(s.id)).length;
        const groups: Record<string, { n: number; got: number }> = {};
        for (const s of all) {
          groups[s.group] ||= { n: 0, got: 0 };
          groups[s.group].n++;
          if (seen.has(s.id)) groups[s.group].got++;
        }
        return (
          <div key={k} className={`gkind kind--${k}`}>
            {kinds && (
              <h3 className="gkind-h">
                <Ring p={got / all.length} />
                <span>{KINDS[k].label}</span>
                <span className="num">
                  <span aria-hidden="true">{`${got}/${all.length}`}</span>
                  <span className="sr-only">{`${got} of ${all.length} seen`}</span>
                </span>
              </h3>
            )}
            <ul className="gbars">
              {Object.entries(groups).map(([g, v], i) => (
                <li key={g}>
                  <span>{GROUPS[g]}</span>
                  <span
                    className="meter meter--thin"
                    style={
                      {
                        '--p': `${Math.round((v.got / v.n) * 100)}%`,
                        '--s': (v.got / v.n).toFixed(3),
                        '--i': i,
                      } as CSSProperties
                    }
                  >
                    <span />
                  </span>
                  <span className="num">{`${v.got}/${v.n}`}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function StatsBody({ sightings, play }: { sightings: StatSighting[]; play: boolean }) {
  const S = sightings
    .slice()
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const now = new Date();
  const year = String(now.getFullYear());

  // cumulative life list
  const seen = new Set<number>();
  const growth: [string, number][] = [];
  for (const s of S) {
    if (!seen.has(s.speciesId)) {
      seen.add(s.speciesId);
      growth.push([s.date, seen.size]);
    }
  }
  // species per month this year
  const perMonth = Array.from({ length: 12 }, () => new Set<number>());
  S.filter((s) => s.date.startsWith(year)).forEach((s) => perMonth[Number(s.date.slice(5, 7)) - 1]?.add(s.speciesId));
  // per day
  const perDay = new Map<string, Set<number>>();
  S.forEach((s) => {
    if (!perDay.has(s.date)) perDay.set(s.date, new Set());
    perDay.get(s.date)!.add(s.speciesId);
  });
  const bestDay = [...perDay.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  // places
  const places = new Map<string, Set<number>>();
  S.forEach((s) => {
    const k = (s.place || '').trim();
    if (!k) return;
    if (!places.has(k)) places.set(k, new Set());
    places.get(k)!.add(s.speciesId);
  });
  const topPlaces = [...places.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const individuals = S.reduce((n, s) => n + (Number(s.count) || 0), 0);
  // most seen
  const freq = new Map<number, number>();
  S.forEach((s) => freq.set(s.speciesId, (freq.get(s.speciesId) || 0) + 1));
  const topBirds = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const totals: [number, string][] = [
    [seen.size, 'species'],
    [S.length, 'sightings'],
    [individuals, 'individuals counted'],
    [perDay.size, 'days out'],
  ];

  return (
    <>
      <div className="statgrid">
        {totals.map(([n, label], i) => (
          <div key={label}>
            <StatNum n={n} play={play} delay={120 + i * 80} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      {!S.length && <p className="empty-inline pad-x">Charts appear here once there are a few sightings.</p>}
      <section className="block">
        <h2 className="h2">Life list growth</h2>
        <GrowthChart growth={growth} />
      </section>
      <section className="block">
        <h2 className="h2">{`Species each month in ${year}`}</h2>
        <MonthBars vals={perMonth.map((s) => s.size)} cur={now.getMonth()} />
      </section>
      <section className="block">
        <h2 className="h2">Days out</h2>
        <p className="small muted">The last 26 weeks. Darker squares mean more species that day.</p>
        <Heatmap perDay={perDay} now={now} />
        {bestDay && (
          <p className="small">
            Best day: <strong>{`${bestDay[1].size} species`}</strong>{` on ${fmtDate(bestDay[0])}.`}
          </p>
        )}
      </section>
      {topPlaces.length > 0 && (
        <section className="block">
          <h2 className="h2">Top places</h2>
          <ul className="spots">
            {topPlaces.map(([p, set]) => (
              <li key={p}>
                <span>{p}</span>
                <span className="num">{set.size}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {topBirds.length > 0 && (
        <section className="block">
          <h2 className="h2">Most logged</h2>
          <ul className="rows">
            {topBirds.map(([id, n]) => {
              const sp = byId.get(id);
              if (!sp) return null;
              return (
                <li key={id}>
                  <Link className="row" to={`/bird/${id}`} data-tile={id}>
                    <span className="row-thumb">
                      <Thumb sp={sp} />
                    </span>
                    <span className="row-main">
                      <strong>{sp.name}</strong>
                    </span>
                    <span className="num">
                      {n}
                      <span className="sr-only">{` ${n === 1 ? 'sighting' : 'sightings'}`}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="block">
        <h2 className="h2">Dex progress by group</h2>
        <GroupBars seen={seen} />
      </section>
    </>
  );
}

export default function Stats() {
  const sightings = useLoadedSightings();
  // Decided once per visit: the first visit in a session plays, unless motion is reduced (then nothing moves).
  const [play] = useState(() => !played && typeof IntersectionObserver !== 'undefined' && motionOK());
  const pageRef = useRef<HTMLDivElement>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const ready = sightings !== null;

  // Each chart fills as it comes into view. Sections that appear later (new data) are watched too.
  useEffect(() => {
    if (!play || !ready) return;
    played = true;
    const io = (ioRef.current ??= new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }),
      { rootMargin: '0px 0px -10% 0px' },
    ));
    pageRef.current?.querySelectorAll('.block:not(.is-in)').forEach((el) => io.observe(el));
  }, [play, ready, sightings]);
  useEffect(() => () => ioRef.current?.disconnect(), []);

  return (
    <div ref={pageRef} className={`stats-page${play ? ' stats-play' : ''}`}>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>Stats</h1>
      </header>
      {sightings && <StatsBody sightings={sightings} play={play} />}
    </div>
  );
}
