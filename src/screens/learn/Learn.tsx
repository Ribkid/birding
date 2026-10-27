import { useEffect, useMemo, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';
import { byId, KINDS, SPECIES, kindsPresent, type Species } from '../../lib/data';
import { useMedia, useSightings } from '../../lib/hooks';
import { useStagger, CountUp } from '../../components/Motion';
import { useTint } from '../../components/Motion';
import * as Q from '../../core/quiz.js';
import {
  learnReady, getLearn, getDaily, learnStats, masteryOf, dueCards, allCards, boxes, currentStreak, setActive,
  dayStr, monthName, accuracyForKinds, packProgress, setPrefs, saveLearn, kindLabel,
  packs as PACKS, isMastered, bestKey, ROUND,
} from '../../core/learn.js';
import './learn.css';

const MODE_INFO: Record<string, [string, string]> = {
  quick: ['Quick 10', 'A mix of photos, calls, field notes and facts.'],
  photo: ['Photo', 'Name it from a photo.'],
  call: ['Call', 'Listen, then pick the bird or frog.'],
  whoami: ['Who am I?', 'Field notes with the names blanked out.'],
  duel: ['Look-alike duels', 'Two that get mixed up. Pick the right one.'],
  rapid: ['Rapid fire', 'As many in a row as you can in 60 seconds.'],
  silhouette: ['Silhouettes', 'Shape and shade only. The colour comes back when you answer.'],
  zoom: ['Zoom in', 'A close-up crop that pulls back once you answer.'],
  facts: ['Seasons and facts', 'When, where and how big. No photos needed.'],
};
const DIFF: Record<string, [string, string]> = {
  easy: ['Easy', 'Wrong answers come from other groups.'],
  normal: ['Normal', 'One look-alike among the answers.'],
  hard: ['Hard', 'Every wrong answer is one of its closest matches.'],
};
const MODE_ICONS: Record<string, React.ReactNode> = {
  quick: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  photo: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  call: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  whoami: <path d="M6 4h9l3 3v13H6zM9 10h6M9 13.5h6M9 17h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  duel: <path d="M3.5 6.5h7v11h-7zM13.5 6.5h7v11h-7z" fill="none" stroke="currentColor" strokeWidth="2" />,
  rapid: <path d="M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9.5v4l2.5 1.5M10 3h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  silhouette: <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" /></>,
  zoom: <path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20M10.5 8v5M8 10.5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  facts: <path d="M5 6h14v14H5zM5 10h14M9 3.5V7M15 3.5V7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
};
const TICK = <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />;
const CROSS = <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />;
const PACKS_SHOWN = 6;

const faceSrc = (id: number, size = 'small') => Q.photosFor(id, { size, prefer: 'wiki' })[0]?.src || '';
const tintable = (src: string) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src) || (!!src && new URL(src, location.href).origin === location.origin);

export default function Learn() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);
  const [allPacks, setAllPacks] = useState(false);
  useMedia();
  useSightings();

  useEffect(() => {
    setActive(null);
    let alive = true;
    void learnReady().then(() => { if (alive) { setReady(true); force(); } }).catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const L = getLearn();
  const D = getDaily();
  const today = dayStr();
  const streak = ready ? currentStreak() : 0;
  const cards = ready ? allCards() : [];
  const due = ready ? dueCards().length : 0;
  const boxN = ready ? boxes() : [0, 0, 0, 0, 0];
  const date = new Date();
  const picks = D?.today?.date === today ? D.today.picks : [];
  const doneToday = D?.history?.[today] != null;
  const prefs = L?.prefs || { kind: 'animals', scope: 'all', difficulty: 'normal' };
  const kinds = ['animals', ...kindsPresent];
  const scopes: [string, string][] = [['all', 'Everything'], ['seen', "Ones I've seen"], ['month', `Around in ${monthName(date)}`]];

  const hero = useMemo(() => {
    const day = dayStr();
    const rng = Q.seeded(Q.hashStr(`hero|${day}`));
    const month = date.getMonth() + 1;
    let list: Species[] = SPECIES.filter((s) => (Q.relRate(s.id, month) ?? 0) >= 0.5 && (Q.relRate(s.id, month) ?? 0) < 0.8 && Q.hasPhoto(s));
    if (!list.length) list = SPECIES.filter((s) => s.rarity <= 2 && Q.hasPhoto(s));
    const tinted = list.filter((s) => tintable(faceSrc(s.id)));
    if (tinted.length) list = tinted;
    return list.length ? list[(rng() * list.length) | 0] : null;
  }, [date, ready]);
  const heroSrc = hero ? faceSrc(hero.id, 'large') : '';
  const tintRef = useTint<HTMLAnchorElement>(heroSrc, null);

  const packs = useMemo(() => (ready ? packProgress().filter((p: { total: number }) => p.total >= 5) : []), [ready, L?.packs]);
  const packN = packs.length;
  const packsDone = packs.filter((p: { plays: number }) => p.plays > 0).length;
  const mastered = ready ? Object.keys(L?.cards || {}).filter((id) => isMastered(Number(id))).length : 0;

  const packCover = (key: string) => {
    const list = Q.packSpecies(key).filter((s: Species) => Q.hasPhoto(s));
    if (!list.length) return '';
    const common = list.filter((s: Species) => s.rarity <= 3);
    const pool = Q.shuffle((common.length >= 3 ? common : list).slice(), Q.seeded(Q.hashStr(`pack|${today}|${key}`)));
    return faceSrc(pool[0]?.id);
  };
  const modeFaces = (kind: string): Record<string, number> => {
    const all = Q.speciesFor(kind).filter((s: Species) => Q.hasPhoto(s));
    if (!all.length) return {};
    const rng = Q.seeded(Q.hashStr(`faces|${today}|${kind}`));
    const common = all.filter((s: Species) => s.rarity <= 2);
    const pool = Q.shuffle((common.length >= 12 ? common : all).slice(), rng);
    const used = new Set<number>();
    const out: Record<string, number> = {};
    for (const m of Q.MODES) {
      const ok = m === 'call' ? (s: Species) => Q.CALL_KINDS.includes(s.kind) && Q.hasCall(s.id) : () => true;
      const s = pool.find((x: Species) => !used.has(x.id) && ok(x)) || pool.find((x: Species) => !used.has(x.id));
      if (s) { used.add(s.id); out[m] = s.id; }
    }
    return out;
  };
  const faces = useMemo(() => modeFaces(prefs.kind), [prefs.kind, ready]);
  const hubRef = useStagger<HTMLDivElement>('.lh-daily, .lh-packs > li, .lh-modes[data-modes] > li, .lh-stats > li', 'learn-hub');

  if (!ready) return <div className="learn learn--loading" aria-busy="true" />;

  const set = (patch: Record<string, unknown>) => { setPrefs(patch); force(); };
  const callOk = Q.CALL_KINDS.includes(prefs.kind) || prefs.kind === 'animals';
  const dailyLine = doneToday ? `Done: ${D.history[today]} of 5. A new set comes tomorrow.`
    : picks.length ? `${picks.length} of 5 answered. Pick up where you left off.`
    : `Five species around in ${monthName(date)}. About two minutes.`;

  return (
    <>
      <header className="page-head lh-head"><h1 className="lh-title">Learn</h1><p className="lh-lede">Quizzes on the birds, wildlife and plants of South East Queensland.</p></header>
      <div className="learn" ref={hubRef}>
        {(streak || packsDone || mastered) ? (
          <ul className="lh-stats" aria-label="How you're going at a glance">
            <li><CountUp value={streak} /><span>day streak</span></li>
            <li><CountUp value={packsDone} /><span>of {packN} packs done</span></li>
            <li><CountUp value={mastered} /><span>species mastered</span></li>
          </ul>
        ) : null}
        {!navigator.onLine && <p className="lh-offline" role="status">No signal. Questions use the photos and calls saved on this phone, plus field notes.</p>}

        <Link ref={tintRef} className={`lh-daily${doneToday ? ' is-done' : ''}${hero ? ` kind--${hero.kind}` : ''}`} to="/learn/daily">
          {hero && <span className="lh-daily-photo" aria-hidden="true"><img src={heroSrc} alt="" /></span>}
          <span className="lh-daily-top">
            <span className="lh-date" aria-hidden="true"><b>{date.getDate()}</b><span>{monthName(date)}</span></span>
            {streak > 0 && <span className="lh-streak"><b>{streak}</b><span>{streak === 1 ? 'day' : 'days'} in a row</span></span>}
          </span>
          <span className="lh-daily-main"><strong>Today's challenge</strong><span>{dailyLine}</span></span>
          <span className="lh-daily-foot">
            <span className="lh-pips" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => {
                const p = picks[i];
                return <i key={i} className={p ? (p.right ? 'is-right' : 'is-wrong') : ''}>{p ? (p.right ? <svg viewBox="0 0 24 24">{TICK}</svg> : <svg viewBox="0 0 24 24">{CROSS}</svg>) : null}</i>;
              })}
            </span>
            <span className="lh-go">{doneToday ? 'See how you went' : picks.length ? 'Carry on' : 'Start'}</span>
          </span>
        </Link>

        <section className="lh-sec" aria-labelledby="lh-packs-h">
          <div className="lh-sec-h"><h2 id="lh-packs-h">Quiz packs</h2></div>
          {packN ? (
            <>
              <ul className="lh-modes lh-packs">
                {packs.map((p: any, i: number) => {
                  if (!allPacks && i >= PACKS_SHOWN) return null;
                  const cover = packCover(p.key);
                  const frac = p.total ? p.got / p.total : 0;
                  return (
                    <li key={p.key}>
                      <Link className={`lh-mode lh-pack${p.kind ? ` kind--${p.kind}` : ''}`} to={`/learn/play/${p.key}`} aria-label={`${p.name}. ${p.total} species${p.got ? `, ${p.got} got right` : ''}${p.best != null ? `. Best ${p.best} of ${p.of}` : ''}.`}>
                        <span className="lh-mode-bg" aria-hidden="true">{cover && <img src={cover} alt="" />}</span>
                        <span className="lh-mode-top" aria-hidden="true">
                          {p.got ? <span className="lh-ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" pathLength="100" /><circle className="lh-ring-fg" cx="20" cy="20" r="16" pathLength="100" style={{ strokeDashoffset: 100 - frac * 100 }} /></svg><b>{Math.max(1, Math.round(frac * 100))}<span>%</span></b></span> : <span />}
                          {p.best != null && <span className="lh-best">Best <b>{p.best}</b><span>/{p.of}</span></span>}
                        </span>
                        <span className="lh-mode-txt" aria-hidden="true"><strong>{p.name}</strong><span className="lh-mode-desc">{p.blurb}</span><span className="lh-pack-n">{p.total} species</span></span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {packN > PACKS_SHOWN && (
                <button type="button" className="btn btn--block lh-more" aria-expanded={allPacks} onClick={() => setAllPacks((v) => !v)}>
                  {allPacks ? 'Show fewer packs' : `Show all ${packN} packs`}
                </button>
              )}
            </>
          ) : <p className="small muted lh-empty">The packs appear once the species list has loaded.</p>}
        </section>

        <section className="lh-sec" aria-labelledby="lh-play-h">
          <div className="lh-sec-h"><h2 id="lh-play-h">Quick play</h2></div>
          <div className="lh-kinds" role="group" aria-label="What to practise">
            {kinds.map((k) => (
              <button key={k} type="button" className={`lh-kind${k !== 'animals' ? ` kind--${k}` : ''}`} data-kind={k} aria-pressed={prefs.kind === k} onClick={() => set({ kind: k })}><i aria-hidden="true" />{kindLabel(k)}</button>
            ))}
          </div>
          <div className="lh-seg" role="group" aria-label="Which species" style={{ '--n': scopes.length, '--idx': Math.max(0, scopes.findIndex(([k]) => k === prefs.scope)) } as React.CSSProperties}>
            <span className="lh-seg-thumb" aria-hidden="true" />
            {scopes.map(([k, l]) => <button key={k} type="button" data-scope={k} aria-pressed={prefs.scope === k} onClick={() => set({ scope: k })}>{l}</button>)}
          </div>
          <div className="lh-seg" role="group" aria-label="Difficulty" style={{ '--n': 3, '--idx': Math.max(0, Object.keys(DIFF).indexOf(prefs.difficulty)) } as React.CSSProperties}>
            <span className="lh-seg-thumb" aria-hidden="true" />
            {Object.entries(DIFF).map(([k, [l]]) => <button key={k} type="button" data-diff={k} aria-pressed={prefs.difficulty === k} onClick={() => set({ difficulty: k })}>{l}</button>)}
          </div>
          <p className="small muted lh-hint">{DIFF[prefs.difficulty]?.[1]}</p>
          <ul className={`lh-modes${prefs.kind !== 'animals' ? ` kind--${prefs.kind}` : ''}`} data-modes>
            {Q.MODES.map((m: string) => {
              const [title, desc] = MODE_INFO[m];
              const off = m === 'call' && !callOk;
              const id = faces[m];
              const b = (L?.best as Record<string, number> | undefined)?.[bestKey(m, prefs)];
              return (
                <li key={m} className={m === 'quick' ? 'lh-mode--wide' : ''}>
                  <Link className={`lh-mode lh-mode--${m}${off ? ' is-off' : ''}`} to={off ? '#' : `/learn/play/${m}`} aria-disabled={off || undefined} onClick={(e) => { if (off) e.preventDefault(); }}>
                    <span className="lh-mode-bg" aria-hidden="true">{id ? <img src={faceSrc(id, m === 'quick' ? 'large' : 'small')} alt="" /> : null}</span>
                    <span className="lh-mode-top"><span className="lh-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24">{MODE_ICONS[m]}</svg></span>{b != null && <span className="lh-best">{m === 'rapid' ? 'Best streak' : 'Best'} <b>{b}</b>{m === 'rapid' ? null : <span>/{ROUND}</span>}</span>}</span>
                    <span className="lh-mode-txt"><strong>{title}</strong><span className="lh-mode-desc">{off ? 'Calls are for birds and frogs. Choose All animals, Birds or Frogs.' : desc}</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="lh-sec" aria-labelledby="lh-deck-h">
          <div className="lh-sec-h"><h2 id="lh-deck-h">Review deck</h2><Link to="/learn/deck">{cards.length ? 'Open' : 'Set up'}</Link></div>
          {cards.length ? (
            <Link className={`lh-deck${due ? ' is-due' : ''}`} to="/learn/deck" aria-label={`${due} ${due === 1 ? 'card' : 'cards'} due. Open the review deck`}>
              <span className="lh-boxes" aria-hidden="true">
                {boxN.map((n, i) => {
                  const max = Math.max(1, ...boxN);
                  return <span className="lh-box" key={i}><b>{n}</b><span className="lh-box-bar"><i style={{ '--h': (n / max).toFixed(3), '--j': i } as React.CSSProperties} /></span><em>{i + 1}</em></span>;
                })}
              </span>
              <span className="lh-deck-txt"><strong>{due ? `${due} ${due === 1 ? 'card' : 'cards'} to review` : 'Nothing due right now'}</strong><span className="small muted">Know a card and it moves along a box. Box 4 and 5 count as mastered.</span></span>
            </Link>
          ) : <p className="small muted lh-empty">Species you miss in a round land here, so they come back until you know them. You can also add a set yourself.</p>}
        </section>

        <section className="lh-sec" aria-labelledby="lh-prog-h">
          <div className="lh-sec-h"><h2 id="lh-prog-h">How you're going</h2></div>
          <Progress />
        </section>
      </div>
    </>
  );
}

function Progress() {
  const rows = accuracyForKinds() as { k: string; all: number; mastered: number; acc: { n: number; pct: number } | null }[];
  const active = rows.filter((r) => r.acc || r.mastered);
  const idle = rows.filter((r) => !r.acc && !r.mastered);
  if (!active.length) return <p className="small muted lh-empty">Answer a few questions and your accuracy, and how many species you have mastered, show here for each kind.</p>;
  return (
    <>
      <ul className="lh-prog">
        {active.map(({ k, all, mastered, acc }, i) => (
          <li key={k} className={`kind--${k}`}>
            <span className="lh-dot" aria-hidden="true" />
            <span className="lh-prog-main"><strong>{KINDS[k]?.label || k}</strong><span className="lh-meter" aria-hidden="true"><span style={{ '--p': (mastered / all).toFixed(3), '--j': i } as React.CSSProperties} /></span><span className="small muted">{mastered} of {all} mastered</span></span>
            <span className="lh-acc">{acc ? <><b>{acc.pct}%</b><span>right of {acc.n}</span></> : <span>No answers yet</span>}</span>
          </li>
        ))}
      </ul>
      {idle.length > 0 && <p className="small muted lh-empty">Nothing yet for {idle.map((r) => KINDS[r.k]?.label.toLowerCase()).join(', ')}.</p>}
    </>
  );
}
