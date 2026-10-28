import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { badges } from '../../core/stats.js';
import { learnReady, learnStats } from '../../core/learn.js';
import { configured } from '../../core/cloud.js';
import { db } from '../../core/db.js';
import { normaliseSighting, type Outing, type Sighting } from '../../lib/hooks';
import { countUp, motionOK } from '../../lib/motion';
import { Icon } from '../../components/Icon';
import './progress.css';

interface Badge {
  id: string;
  name: string;
  desc: string;
  have: number;
  need: number;
  done: boolean;
  kind: string;
}

const SECTIONS: [string, string][] = [
  ['milestone', 'Milestones'],
  ['kind', 'Animals & plants'],
  ['rarity', 'Rarities'],
  ['habit', 'Habits'],
  ['learning', 'Learning'],
  ['habitat', 'Habitats'],
  ['group', 'Complete a group'],
];

// v1 js/app.js:2398 — one emblem per shelf, coloured by the section's CSS.
const EMBLEM: Record<string, string> = {
  milestone: '<path class="e-tail" d="M21 40l-6 20 9-4.5 5 7.5 4-17zM43 40l6 20-9-4.5-5 7.5-4-17z"/><circle class="e-body" cx="32" cy="28" r="22"/><circle class="e-line" cx="32" cy="28" r="17"/>',
  kind: '<path class="e-body" d="M32 4l24 14v28L32 60 8 46V18z"/><path class="e-line" d="M32 11l18 10.5v21L32 53 14 42.5v-21z"/>',
  rarity: '<path class="e-body" d="M20 8h24l14 16-26 34L6 24z"/><path class="e-line" d="M6 24h52M20 8l6 16 6-16 6 16 6-16M26 24l6 34 6-34"/>',
  habit: '<path class="e-body" d="M32 5l23 8v17c0 15-10 25-23 29C19 55 9 45 9 30V13z"/><path class="e-line" d="M32 11l17 6v13c0 11-7.5 19-17 22.5C22.5 49 15 41 15 30V17z"/>',
  learning: '<rect class="e-tail" x="15" y="7" width="36" height="46" rx="6" transform="rotate(9 33 30)"/><rect class="e-body" x="12" y="10" width="36" height="46" rx="6" transform="rotate(-5 30 33)"/>',
  habitat: '<path class="e-body" d="M32 4c15 9 23 23 20 37-2.5 10-11 16-20 19-9-3-17.5-9-20-19C9 27 17 13 32 4z"/><path class="e-line" d="M32 13v46M32 27l-9-7M32 27l9-7M32 39l-11-8M32 39l11-8M32 50l-8-6M32 50l8-6"/>',
  group: '<rect class="e-body" x="5" y="17" width="54" height="30" rx="8"/><path class="e-line" d="M11 22.5h42"/>',
};

const emblemMask = (kind: string) =>
  `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${EMBLEM[kind]}</svg>`)}')`;

// v1 account.js leaderboardLink(): the trophy on the Leaderboard link.
const Trophy = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4v3h-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

// v1 icon.learn (js/app.js:170): the card stack on the Learn link.
const LearnIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Ring = ({ p }: { p: number }) => (
  <svg className={`ring${p > 0 ? '' : ' ring--zero'}`} viewBox="0 0 36 36" aria-hidden="true">
    <circle className="ring-track" cx="18" cy="18" r="15.5" />
    <circle className="ring-fill" cx="18" cy="18" r="15.5" pathLength="100" style={{ '--off': 100 - p * 100 } as CSSProperties} />
  </svg>
);

// v1 renderBadges keeps these for the session: the earned count from the last visit (the number stamps up from it,
// from nothing on the first visit) and the shelves whose medals have already played.
let badgesEarned: number | null = null;
const shelvesPlayed = new Set<string>();

/** Her sightings and outings, or null until both have been read (v1 had them in memory before drawing). */
function useRows() {
  const [rows, setRows] = useState<{ sightings: Sighting[]; outings: Outing[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, o] = await Promise.all([db.all('sightings'), db.all('outings')]);
      if (alive) setRows({ sightings: (s as Sighting[]).map(normaliseSighting), outings: o as Outing[] });
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'sightings' || name === 'outings') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

export default function Badges() {
  const rows = useRows();
  // Bumped when learning progress has loaded, so the memo below recomputes (v1 redraws).
  const [learnTick, learnLoaded] = useReducer((n: number) => n + 1, 0);
  // v1: the trophy ring fills in only on the first visit of the session.
  const [ringsIn, setRingsIn] = useState(() => badgesEarned == null);
  // Shelves that animate as they come into view: not played yet this session, motion allowed (v1 renderBadges).
  const [play] = useState(() => (motionOK() && typeof IntersectionObserver !== 'undefined' ? new Set(SECTIONS.map(([k]) => k).filter((k) => !shelvesPlayed.has(k))) : new Set<string>()));
  const [shelvesIn, setShelvesIn] = useState<ReadonlySet<string>>(() => new Set());
  const earnedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    learnReady().then(() => { if (alive) learnLoaded(); }).catch(() => {});
    const rings = ringsIn ? window.setTimeout(() => setRingsIn(false), 1400) : 0;
    return () => {
      alive = false;
      window.clearTimeout(rings);
    };
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    let learning: Record<string, number> = {};
    try { learning = (learnStats() || {}) as Record<string, number>; } catch { /* not loaded yet */ }
    return badges(rows?.sightings ?? [], rows?.outings ?? [], learning) as Badge[];
  }, [rows, learnTick]);

  const earned = list.filter((b) => b.done).length;
  const loaded = rows != null;

  // v1: the earned count stamps up from where it was last time, 150 ms in. The number is written here only, so
  // React never holds a text node that countUp replaces; a new count gets a new element (keyed below), so an older
  // count still running cannot write over it.
  useLayoutEffect(() => {
    const el = earnedRef.current;
    if (!el) return;
    if (!loaded) { el.textContent = ''; return; }
    void countUp(el, badgesEarned || 0, earned, { delay: 150 });
    badgesEarned = earned;
  }, [loaded, earned]);
  const next = list.filter((b) => !b.done).sort((x, y) => y.have / y.need - x.have / x.need || x.need - y.need)[0];
  const sections = SECTIONS.filter(([k]) => list.some((b) => b.kind === k));
  const shown = (kind: string) => kind !== 'rarity' && kind !== 'habitat';
  const sectionKeys = sections.map(([k]) => k).join(' ');

  // v1: each shelf's rings fill and its earned medals catch the light as that shelf comes into view, once a session.
  useEffect(() => {
    if (!loaded || !play.size) return;
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const k = (en.target as HTMLElement).dataset.shelf;
        if (!k) continue;
        shelvesPlayed.add(k);
        io.unobserve(en.target);
        setShelvesIn((prev) => new Set(prev).add(k));
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    document.querySelectorAll<HTMLElement>('.shelf--play[data-shelf]:not(.is-in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loaded, sectionKeys, play]);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/me" aria-label="Back to Me"><Icon name="back" /></Link>
        <h1>Badges</h1>
      </header>

      <section className={`trophy${ringsIn ? ' rings-in' : ''}`} aria-label="Badges earned">
        <div className="trophy-top">
          <div className="trophy-ring">
            <Ring p={earned / Math.max(1, list.length)} />
            <p className="trophy-n"><b data-earned="" key={loaded ? earned : -1} ref={earnedRef} /><span>of {list.length}</span></p>
          </div>
          <div className="trophy-txt">
            <p className="trophy-h">
              {!earned ? 'No badges yet' : earned === list.length ? 'Every badge earned' : `${list.length - earned} more to earn`}
            </p>
            {next ? (
              <p className="trophy-next"><span>Closest:</span> <strong>{next.name}</strong>. {next.desc}{next.have ? ` (${next.have} so far)` : ''}.</p>
            ) : (
              <p className="trophy-next">The whole shelf is yours.</p>
            )}
          </div>
        </div>
        <div className="trophy-links">
          <Link className="btn" to="/learn"><LearnIcon /> Learn</Link>
          <Link className="btn" to="/stats"><Icon name="chart" /> Stats</Link>
          {configured && <Link className="btn" to="/leaderboard"><Trophy /> Leaderboard</Link>}
        </div>
      </section>

      {sections.map(([kind, title]) => {
        const items = list.filter((b) => b.kind === kind);
        const done = items.filter((b) => b.done);
        return (
          <section className="shelf-sec" key={kind} style={{ '--emask': emblemMask(kind) } as CSSProperties}>
            <h2 className="h2 shelf-h"><span>{title}</span><span className="shelf-n" aria-hidden="true">{done.length}/{items.length}</span></h2>
            <ul className={`shelf${play.has(kind) ? ' shelf--play' : ''}${shelvesIn.has(kind) ? ' is-in' : ''}`} data-shelf={kind}>
              {[...done, ...items.filter((b) => !b.done)].map((b, i) => (
                <li
                  key={b.id}
                  className={`badge badge--${kind}${b.done ? ' badge--done' : ''}${kind === 'kind' ? ` kind--${b.id.split('-')[1]}` : ''}`}
                  style={{ '--p': Math.round((b.have / b.need) * 100), '--i': i } as CSSProperties}
                >
                  <span className="emb" aria-hidden="true">
                    {!b.done && <span className="emb-ring" />}
                    <svg viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: EMBLEM[kind] }} />
                    {shown(kind) && <b className="emb-n">{b.need}</b>}
                  </span>
                  <strong className="badge-name">{b.name}</strong>
                  <span className="badge-desc">{b.desc}<span className="sr-only">. {b.done ? 'Earned' : `${b.have} of ${b.need} so far`}.</span></span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
