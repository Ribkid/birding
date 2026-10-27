import { useEffect, useMemo, useReducer, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { badges } from '../../core/stats.js';
import { learnReady, learnStats } from '../../core/learn.js';
import { configured } from '../../core/cloud.js';
import { useOutings, useSightings } from '../../lib/hooks';
import { Icon } from '../../components/Icon';
import { HubIcon } from '../lists/hubParts';
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

const Ring = ({ p }: { p: number }) => (
  <svg className={`ring${p > 0 ? '' : ' ring--zero'}`} viewBox="0 0 36 36" aria-hidden="true">
    <circle className="ring-track" cx="18" cy="18" r="15.5" />
    <circle className="ring-fill" cx="18" cy="18" r="15.5" pathLength="100" style={{ '--off': 100 - p * 100 } as CSSProperties} />
  </svg>
);

export default function Badges() {
  const sightings = useSightings();
  const outings = useOutings();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [shelfIn, setShelfIn] = useState(false);
  const [ringsIn, setRingsIn] = useState(true);

  useEffect(() => {
    let alive = true;
    learnReady().then(() => { if (alive) tick(); }).catch(() => {});
    const shelf = window.setTimeout(() => setShelfIn(true), 80);
    const rings = window.setTimeout(() => setRingsIn(false), 1400);
    return () => {
      alive = false;
      window.clearTimeout(shelf);
      window.clearTimeout(rings);
    };
  }, []);

  const list = useMemo(() => {
    let learning: Record<string, number> = {};
    try { learning = (learnStats() || {}) as Record<string, number>; } catch { /* not loaded yet */ }
    return badges(sightings, outings, learning) as Badge[];
  }, [sightings, outings, tick]);

  const earned = list.filter((b) => b.done).length;
  const next = list.filter((b) => !b.done).sort((x, y) => y.have / y.need - x.have / x.need || x.need - y.need)[0];
  const sections = SECTIONS.filter(([k]) => list.some((b) => b.kind === k));
  const shown = (kind: string) => kind !== 'rarity' && kind !== 'habitat';

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
            <p className="trophy-n"><b>{earned}</b><span>of {list.length}</span></p>
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
          <Link className="btn" to="/learn"><HubIcon name="learn" /> Learn</Link>
          <Link className="btn" to="/stats"><Icon name="chart" /> Stats</Link>
          {configured && <Link className="btn" to="/leaderboard">Leaderboard</Link>}
        </div>
      </section>

      {sections.map(([kind, title]) => {
        const items = list.filter((b) => b.kind === kind);
        const done = items.filter((b) => b.done);
        return (
          <section className="shelf-sec" key={kind} style={{ '--emask': emblemMask(kind) } as CSSProperties}>
            <h2 className="h2 shelf-h"><span>{title}</span><span className="shelf-n" aria-hidden="true">{done.length}/{items.length}</span></h2>
            <ul className={`shelf shelf--play${shelfIn ? ' is-in' : ''}`}>
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
