import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { badges } from '../../core/stats.js';
import { configured } from '../../core/cloud.js';
import { useOutings, useSightings } from '../../lib/hooks';
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
  ['rarity', 'Rarities'],
  ['habit', 'Habits'],
  ['kind', 'Other animals & plants'],
  ['habitat', 'Habitats'],
  ['group', 'Complete a group'],
];

const titleFor = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

export default function Badges() {
  const sightings = useSightings();
  const outings = useOutings();

  const list = useMemo(
    () => badges(sightings, outings) as Badge[],
    [sightings, outings],
  );

  const earned = list.filter((b) => b.done).length;

  // The v1 screen lists the known kinds, but the badge engine can return kinds the
  // section list does not name. Always render every badge, including new ones.
  const sections = useMemo(() => {
    const known = new Set(SECTIONS.map(([k]) => k));
    const extra = [...new Set(list.map((b) => b.kind))]
      .filter((k) => !known.has(k))
      .map((k): [string, string] => [k, titleFor(k)]);
    return [...SECTIONS, ...extra];
  }, [list]);

  return (
    <>
      <header className="page-head">
        <h1>Badges</h1>
        <div className="head-actions">
          <Link className="iconbtn" to="/settings" aria-label="Settings">
            <Icon name="gear" />
          </Link>
        </div>
      </header>

      <div className="quicklinks pad-x">
        <Link className="btn" to="/quiz">
          <Icon name="quiz" /> Guess the bird
        </Link>
        <Link className="btn" to="/stats">
          <Icon name="chart" /> Stats
        </Link>
        {configured && (
          <Link className="btn" to="/leaderboard">
            Leaderboard
          </Link>
        )}
      </div>

      <p className="list-count">
        <b>{earned}</b> of {list.length} earned
      </p>

      {sections.map(([kind, title]) => {
        const items = list.filter((b) => b.kind === kind);
        if (!items.length) return null;
        return (
          <section className="block" key={kind}>
            <h2 className="h2">{title}</h2>
            <ul className="badges">
              {items.map((b) => {
                const pct = b.need > 0 ? Math.round((b.have / b.need) * 100) : 0;
                return (
                  <li
                    key={b.id}
                    className={`badge ${b.done ? 'badge--done' : ''} badge--${kind}`}
                  >
                    <span className="medal" aria-hidden="true">
                      <span>{b.done ? '✓' : b.need}</span>
                    </span>
                    <span className="badge-txt">
                      <strong>{b.name}</strong>
                      <span className="small muted">{b.desc}</span>
                      {!b.done && (
                        <>
                          <span
                            className="meter meter--thin"
                            style={{ '--p': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={b.need}
                            aria-valuenow={b.have}
                            aria-label={`${b.name}: ${b.have} of ${b.need}`}
                          >
                            <span />
                          </span>
                          <span className="small muted">
                            {b.have} of {b.need}
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="pad">
        <Link className="btn" to="/stats">
          <Icon name="chart" /> See your full stats
        </Link>
      </div>
    </>
  );
}
