import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { HABITATS, KINDS, byId, type QuizQuestion, type RoundState } from '../../lib/data';
import { useMedia, useSightings } from '../../lib/hooks';
import { CountUp } from '../../components/Motion';
import * as Q from '../../core/quiz.js';
import { db } from '../../core/db.js';
import { loadSeq } from '../../core/seqdata.js';
import { loadExtras } from '../../core/gallery.js';
import { cachedIndex } from '../../core/media.js';
import {
  learnReady, newPracticeRound, newDailyRound, newDeckRound, answer as recordAnswer, finishRound,
  roundNote, testSet, allCards, dueCards, boxes, nextDue, addCards, gradeCard, dayStr, monthName,
  packBy, ROUND, RAPID_MS, kindLabel, emptyMessage, startOfDay, getLearn, getActive, setActive,
} from '../../core/learn.js';
import { PhotoBox, CallPlayer, SilhouetteFilter, QI, stopCalls, type CallClip } from './QuizMedia';
import './learn.css';

const SIDES: Record<number, string[]> = {
  2: ['Photo on the left', 'Photo on the right'],
  4: ['Top left photo', 'Top right photo', 'Bottom left photo', 'Bottom right photo'],
};
const MODE_INFO: Record<string, string> = {
  quick: 'Quick 10', photo: 'Photo', call: 'Call', whoami: 'Who am I?', duel: 'Look-alike duels',
  rapid: 'Rapid fire', silhouette: 'Silhouettes', zoom: 'Zoom in', facts: 'Seasons and facts',
};

const cleanClue = (clue: string) => {
  const parts = String(clue || '').split('\u0001');
  return parts.map((p, i) => (
    <span key={i}>{p}{i < parts.length - 1 && <span className="lq-blank"><span className="sr-only">blank</span></span>}</span>
  ));
};

function speciesName(id?: number | null) { return byId.get(Number(id))?.name || ''; }

function promptFor(q: QuizQuestion) {
  return q.prompt;
}

function Media({ q }: { q: QuizQuestion }) {
  const sp = byId.get(q.focus);
  if (!sp) return null;
  const missing = `This photo needs a connection. Here are its field notes instead: ${Q.blankNotes(sp, q.wrong || [])}`;
  if (q.type === 'photo') return <PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}`} missing={missing} />;
  if (q.type === 'silhouette') {
    return <><SilhouetteFilter /><PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}, shown as a silhouette`} cls={`lq-photo lq-photo--sil${q.picked != null ? ' is-revealed' : ''}`} missing={missing} /></>;
  }
  if (q.type === 'zoom') return <PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}, close up`} cls={`lq-photo lq-photo--zoom${q.picked != null ? ' is-revealed' : ''}`} style={{ '--zx': `${q.zoom?.x ?? 50}%`, '--zy': `${q.zoom?.y ?? 50}%`, '--zs': q.zoom?.scale ?? 2 } as React.CSSProperties} missing={missing} />;
  if (q.type === 'call') return <CallPlayer call={q.call as CallClip} seed={q.call?.src || sp.id} />;
  if (q.type === 'whoami') return <blockquote className="lq-clue">{cleanClue(q.clue || '')}</blockquote>;
  if (q.type === 'fact' && q.photos?.length) return <PhotoBox photos={q.photos} alt={speciesName(q.img)} cls="lq-photo lq-photo--small" />;
  return null;
}

function Options({ q, picked, onPick, rapid, round }: { q: QuizQuestion; picked: string | null; onPick: (key: string) => void; rapid: boolean; round: number }) {
  const disabled = picked != null;
  if (q.options[0]?.photos) {
    const n = q.options.length;
    return (
      <div className={`lq-duel${n > 2 ? ' lq-duel--four' : ''}`}>
        {q.options.map((o, i) => {
          const cls = disabled ? (o.key === q.answer ? ' is-right' : o.key === picked ? ' is-wrong' : ' is-dim') : '';
          const named = q.named || disabled;
          const suffix = disabled ? (o.key === q.answer ? ' (right answer)' : o.key === picked ? ' (your answer)' : '') : '';
          return (
            <button key={o.key} type="button" className={`lq-side${cls}`} data-pick={o.key} aria-disabled={disabled || undefined} aria-label={named ? `${o.label}${suffix}` : SIDES[n]?.[i] || `Photo ${i + 1}`} onClick={() => onPick(o.key)}>
              <PhotoBox key={`${round}-${o.key}`} photos={o.photos} alt="" cls="lq-photo lq-photo--duel" missing="Photo not saved on this phone" />
              <span className="lq-side-name" data-name>{named ? o.label : ''}</span>
              <span className="lq-opt-mark" aria-hidden="true">{disabled && o.key === q.answer ? <svg viewBox="0 0 24 24">{QI.tick}</svg> : disabled && o.key === picked ? <svg viewBox="0 0 24 24">{QI.cross}</svg> : null}</span>
              <span className="sr-only">{suffix}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={`lq-options${rapid ? ' lq-options--grid' : ''}`} role="group" aria-label="Answers">
      {q.options.map((o) => {
        const cls = disabled ? (o.key === q.answer ? ' is-right' : o.key === picked ? ' is-wrong' : ' is-dim') : '';
        const suffix = disabled ? (o.key === q.answer ? ' (right answer)' : o.key === picked ? ' (your answer)' : '') : '';
        return (
          <button key={o.key} type="button" className={`lq-opt${cls}`} data-pick={o.key} aria-disabled={disabled || undefined} onClick={() => onPick(o.key)}>
            <span className={`lq-opt-label${q.italic ? ' is-sci' : ''}`}>{o.label}</span>
            <span className="lq-opt-mark" aria-hidden="true">{disabled && o.key === q.answer ? <svg viewBox="0 0 24 24">{QI.tick}</svg> : disabled && o.key === picked ? <svg viewBox="0 0 24 24">{QI.cross}</svg> : null}</span>
            <span className="sr-only">{suffix}</span>
          </button>
        );
      })}
    </div>
  );
}

function Feedback({ q, right, game, onNext, onPlay }: {
  q: QuizQuestion; right: boolean; game: RoundState; onNext: () => void;
  onPlay: (which: string) => void;
}) {
  const ans = byId.get(q.focus);
  if (!ans) return null;
  const pickedOpt = q.options.find((o) => o.key === q.picked);
  const pickedSp = pickedOpt?.sp ? byId.get(pickedOpt.sp) : null;
  const ansLabel = q.options.find((o) => o.key === q.answer)?.label || '';
  const speciesQ = q.type !== 'fact' || q.ttype === 'Calls';
  const verdictText = right ? 'Correct.' : q.miss ? String(q.miss)
    : q.type === 'duel' ? `Not quite. That one is the ${pickedSp?.name}.`
    : speciesQ ? `Not quite. It's the ${ans.name}.`
    : q.options.find((o) => o.key === q.answer)?.sp ? `Not quite. It's the ${ansLabel}.`
    : `Not quite. It's ${ansLabel}.`;
  const tell = q.type === 'duel' ? q.tell : !right && pickedSp ? Q.tellFor(ans.id, pickedSp.id) : null;
  const cw = q.type === 'call' ? Q.callWords(ans) : null;
  const line = q.explain || (cw ? cw.sentence : Q.fieldMark(ans));
  const mark = q.type === 'odd' ? Q.fieldMark(ans) : '';
  const last = game.i + 1 >= game.qs.length;
  const fbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fbRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
  }, []);
  return (
    <div ref={fbRef} className={`lq-fb ${right ? 'is-right' : 'is-wrong'}`} data-fb tabIndex={-1}>
      <p className="lq-verdict"><svg viewBox="0 0 24 24">{right ? QI.tick : QI.cross}</svg><span>{verdictText}</span></p>
      {speciesQ && <p className="lq-name"><Link to={`/bird/${ans.id}`}>{ans.name}</Link> <span className="lq-sci">{ans.sci}</span></p>}
      {(q.type === 'call' || q.type === 'whoami') && q.photos?.length ? <PhotoBox photos={q.photos} alt={ans.name} cls="lq-photo lq-photo--answer" /> : null}
      {line && <p className="lq-line">{line}</p>}
      {mark && <p className="lq-line">{mark}</p>}
      {tell && <p className="lq-tell"><strong>How to tell them apart.</strong> {tell}</p>}
      <div className="lq-actions">
        {Q.hasCall(ans.id) && q.type !== 'fact' && <button type="button" className="btn lq-act" onClick={() => onPlay(q.type === 'call' ? 'answer' : String(ans.id))}><span><svg viewBox="0 0 24 24">{QI.play}</svg></span><span>{q.type === 'call' ? 'Hear it again' : 'Hear its call'}</span></button>}
        {!right && pickedSp && Q.hasCall(pickedSp.id) && q.type !== 'fact' && <button type="button" className="btn lq-act" onClick={() => onPlay(String(pickedSp.id))}><span><svg viewBox="0 0 24 24">{QI.play}</svg></span><span>Hear the one you picked</span></button>}
        {!right && pickedSp && pickedSp.kind === ans.kind && <Link className="btn lq-act" to={`/compare/${ans.id}/${pickedSp.id}`}><svg viewBox="0 0 24 24">{QI.compare}</svg><span>Compare the two</span></Link>}
      </div>
      <button type="button" className="btn btn--primary btn--block lq-next" onClick={onNext}>{last ? (game.daily ? "See today's result" : 'See how you went') : 'Next question'}</button>
    </div>
  );
}

function Results({ game, total, onAgain, onAgainMissed, onHub }: {
  game: RoundState; total: number; onAgain: () => void; onAgainMissed: (ids: number[]) => void; onHub: () => void;
}) {
  const asked = game.qs.filter((q) => q.picked != null);
  const missed = asked.filter((q) => q.picked !== q.answer);
  const rights = game.mode === 'rapid' ? [] : asked.filter((q) => q.picked === q.answer);
  const big = game.mode === 'rapid' ? game.top || 0 : game.score;
  const of = game.mode === 'rapid' ? 'in a row' : `of ${total}`;
  const frac = total ? game.score / total : 0;
  const note = roundNote(game, total);
  const wrongs = game.mode === 'rapid' ? missed.slice(0, 15) : missed;
  const roundName = game.daily ? "Today's challenge" : game.testId ? 'Test me' : game.pack ? packBy[game.pack]?.name : MODE_INFO[game.mode] || '';
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="lr">
      <header className="page-head"><h1 ref={headRef} className="lh-title" tabIndex={-1}>{roundName}</h1></header>
      <section className="lr-hero" aria-label="Your score">
        <div className="lr-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" pathLength="100" /><circle className={`lr-ring-fg${frac > 0 ? '' : ' is-zero'}`} cx="60" cy="60" r="52" pathLength="100" style={{ strokeDashoffset: 100 - frac * 100 }} /></svg>
          <p className="lr-score" role="status"><CountUp value={big} /><span aria-hidden="true">{of}</span><span className="sr-only">{big} {of}</span></p>
        </div>
        <p className="lr-note">{note}</p>
      </section>
      <div className="lr-actions">
        {missed.length > 0 && !game.daily && <button type="button" className="btn btn--primary btn--block" onClick={() => onAgainMissed([...new Set(missed.map((q) => q.focus))].slice(0, ROUND))}>Practise {missed.length === 1 ? 'the one' : missed.length > ROUND ? `${ROUND} of the ${missed.length}` : `the ${missed.length}`} you missed</button>}
        {game.daily ? <Link className="btn btn--primary btn--block" to="/learn">Back to Learn</Link> : <button type="button" className={`btn ${missed.length ? '' : 'btn--primary'} btn--block`} onClick={onAgain}>Play again</button>}
        {game.daily && missed.some((x) => x.type !== 'fact') && <Link className="btn btn--block" to="/learn/deck">Review the ones you missed</Link>}
        {game.testId ? <Link className="btn btn--quiet btn--block" to={`/bird/${game.testId}`}>Back to the {speciesName(game.testId)}</Link> : null}
        {!game.daily && <button type="button" className="btn btn--quiet btn--block" onClick={onHub}>Back to Learn</button>}
      </div>
      {wrongs.length > 0 && (
        <>
          <h2 className="lr-h">The ones you missed</h2>
          <ul className="lr-cards">
            {wrongs.map((q, i) => {
              const sp = byId.get(q.focus);
              if (!sp) return null;
              const picked = q.options.find((o) => o.key === q.picked)?.label || 'nothing';
              const fact = q.type === 'fact' && q.ttype !== 'Calls';
              const sub = fact ? `${q.prompt} It's ${q.options.find((o) => o.key === q.answer)?.label || ''}. You picked ${picked}.` : `You picked ${picked}`;
              return (
                <li key={i} className={`lr-card kind--${sp.kind}`}>
                  <Link to={`/bird/${sp.id}`}>
                    <span className="lr-card-img">{Q.hasPhoto(sp) ? <img src={Q.photosFor(sp.id, { size: 'small', prefer: 'wiki' })[0]?.src} alt="" /> : null}</span>
                    <span className="lr-mark"><svg viewBox="0 0 24 24">{QI.cross}</svg><span className="sr-only">Wrong:</span></span>
                    <span className="lr-card-txt"><strong>{sp.name}</strong><span>{sub}</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {rights.length > 0 && (
        <>
          <h2 className="lr-h">{wrongs.length ? 'The ones you got' : 'Every one right'}</h2>
          <ul className="lr-list">
            {rights.map((q, i) => {
              const sp = byId.get(q.focus);
              if (!sp) return null;
              const title = q.type === 'fact' && q.ttype !== 'Calls' ? q.prompt : sp.name;
              return (
                <li key={i} className="is-right">
                  <span className="lr-mark"><svg viewBox="0 0 24 24">{QI.tick}</svg><span className="sr-only">Right</span></span>
                  <Link className="lr-main" to={`/bird/${sp.id}`}><strong>{title}</strong><span className="small muted">{q.type === 'fact' ? q.options.find((o) => o.key === q.answer)?.label : 'Got it'}</span></Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function LearnPlay({ fixedPack }: { fixedPack?: string }) {
  const params = useParams();
  const pack = fixedPack || params.pack || 'quick';
  const navigate = useNavigate();
  const location = useLocation();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [game, setGame] = useState<RoundState | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [deckMode, setDeckMode] = useState<'overview' | 'card' | 'done'>('overview');
  const [deckGame, setDeckGame] = useState<RoundState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [rapidLeft, setRapidLeft] = useState(RAPID_MS);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const inlineAudio = useRef<HTMLAudioElement | null>(null);
  useMedia();
  const startRef = useRef(0);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const wantHeadFocus = useRef(false);

  const stopInline = () => {
    inlineAudio.current?.pause();
    inlineAudio.current = null;
    setPlayingKey(null);
  };
  useEffect(() => () => { inlineAudio.current?.pause(); inlineAudio.current = null; }, []);

  const isDeck = pack === 'deck';
  const isDaily = pack === 'daily';

  useEffect(() => {
    let alive = true;
    setError('');
    setGame(null);
    setReady(false);
    void (async () => {
      await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()]);
      if (!alive) return;
      setReady(true);
      if (isDeck) return;
      const active = getActive();
      if (active && active.route === location.hash && !active.done) {
        setGame(active);
        if (active.mode === 'rapid') setRapidLeft(Math.max(0, (active.endsAt || 0) - Date.now()));
        return;
      }
      if (isDaily) {
        const r = newDailyRound();
        if (!alive) return;
        if (r.error) { setError(r.error); return; }
        setGame(r.game);
        setActive(r.game);
        return;
      }
      const testId = pack === 'test' ? Number(params.id) : null;
      if (pack === 'test' && (!testId || !byId.has(testId))) {
        navigate('/learn', { replace: true });
        return;
      }
      const seenNow = new Set(((await db.all('sightings')) as { speciesId: number }[]).map((s) => s.speciesId));
      if (!alive) return;
      const r = testId
        ? await newPracticeRound('quick', { ids: testSet(testId), testId, seen: seenNow } as any)
        : await newPracticeRound(pack, { seen: seenNow } as any);
      if (!alive) return;
      if (r.error) { setError(r.error); return; }
      setGame(r.game);
      setActive(r.game);
      if (r.game?.mode === 'rapid') setRapidLeft(RAPID_MS);
    })();
    return () => { alive = false; };
  }, [pack, isDeck, isDaily]);

  useEffect(() => {
    if (!game || game.mode !== 'rapid') return;
    const tick = setInterval(() => {
      const left = Math.max(0, (game.endsAt || 0) - Date.now());
      setRapidLeft(left);
      if (!left) clearInterval(tick);
    }, 200);
    return () => clearInterval(tick);
  }, [game]);

  const finish = useCallback(() => {
    if (!game) return;
    const asked = game.qs.filter((q) => q.picked != null);
    const total = game.mode === 'rapid' ? asked.length : game.qs.length;
    finishRound(game, total);
    force();
  }, [game]);

  const current = game?.qs[game?.i ?? 0];
  const asked = game ? game.qs.filter((q) => q.picked != null) : [];
  const total = game ? (game.mode === 'rapid' ? asked.length : game.qs.length) : 0;
  const isOver = !!game && (!current || game.i >= game.qs.length || (game.mode === 'rapid' && rapidLeft <= 0 && current.picked == null));

  // Finish outside render, so restarting a rapid round is never ended by stale state.
  useEffect(() => {
    if (!game || game.done || !isOver) return;
    finish();
  }, [game, isOver, finish]);

  useEffect(() => {
    if (wantHeadFocus.current) {
      promptRef.current?.focus({ preventScroll: true });
      wantHeadFocus.current = false;
    }
  }, [game?.i]);

  // Every new question and the results start at the top, like v1 drawn().
  useEffect(() => { window.scrollTo(0, 0); }, [game?.i, isOver]);

  // These must be declared before any early return: the results screen calls them.
  const restart = async () => {
    wantHeadFocus.current = true;
    stopCalls();
    setActive(null);
    setGame(null);
    setError('');
    stopInline();
    await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()]);
    const testId = pack === 'test' ? Number(params.id) : null;
    const r = isDaily ? newDailyRound() : testId
      ? await newPracticeRound('quick', {
        ids: testSet(testId),
        testId,
        seen: new Set(((await db.all('sightings')) as { speciesId: number }[]).map((s) => s.speciesId)),
      } as any)
      : await newPracticeRound(pack, {
        seen: new Set(((await db.all('sightings')) as { speciesId: number }[]).map((s) => s.speciesId)),
      } as any);
    if (r.error) {
      setError(r.error);
      return;
    }
    setGame(r.game);
    setActive(r.game);
    if (r.game?.mode === 'rapid') setRapidLeft(RAPID_MS);
  };
  const startWithIds = async (ids: number[]) => {
    wantHeadFocus.current = true;
    stopCalls();
    stopInline();
    await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()]);
    const mode = game?.mode === 'rapid' ? 'photo' : pack === 'test' ? 'quick' : pack;
    const r = await newPracticeRound(mode, {
      ids,
      seen: new Set(((await db.all('sightings')) as { speciesId: number }[]).map((s) => s.speciesId)),
    } as any);
    if (r.error) {
      setError(r.error);
      return;
    }
    setGame(r.game);
    setActive(r.game);
    setError('');
    if (r.game?.mode === 'rapid') setRapidLeft(RAPID_MS);
  };
  const next = () => {
    if (!game) return;
    wantHeadFocus.current = true;
    stopCalls();
    stopInline();
    game.i += 1;
    setRevealed(false);
    force();
  };
  const pick = (key: string) => {
    if (!game || !current || current.picked != null) return;
    const q = current;
    const ok = recordAnswer(game, q, key);
    navigator.vibrate?.(ok ? 30 : [40, 60, 40]);
    if (game.mode === 'rapid') {
      const g = game;
      window.setTimeout(() => {
        if (g.qs[g.i] === q) { wantHeadFocus.current = true; stopInline(); g.i += 1; setRevealed(false); force(); }
      }, ok ? 450 : 1100);
    }
    force();
  };
  const play = (which: string) => {
    if (!current) return;
    const q = current;
    const sp = which === 'answer' ? byId.get(q.focus) : byId.get(Number(which));
    if (!sp) return;
    const list = which === 'answer' && q.call ? [q.call as CallClip] : Q.callsOf(sp.id);
    const clip = list[Math.floor(Math.random() * list.length)] as CallClip | undefined;
    if (!clip) return;
    if (playingKey === which && inlineAudio.current) {
      stopInline();
      return;
    }
    stopInline();
    const audio = new Audio(clip.local || clip.src);
    inlineAudio.current = audio;
    setPlayingKey(which);
    audio.onended = () => { inlineAudio.current = null; setPlayingKey(null); };
    audio.onerror = () => { inlineAudio.current = null; setPlayingKey(null); };
    void audio.play().catch(() => { inlineAudio.current = null; setPlayingKey(null); });
  };

  if (isDeck) return <Deck onBack={() => navigate('/learn')} />;

  if (error) {
    return (
      <div className="lr">
        <header className="page-head page-head--back"><Link className="iconbtn" to="/learn" aria-label="Back to Learn"><svg viewBox="0 0 24 24">{QI.back}</svg></Link><h1 className="lh-title">Learn</h1></header>
        <div className="learn"><p className="lh-empty" role="status">{error}</p><Link className="btn btn--primary btn--block" to="/learn">Back to Learn</Link></div>
      </div>
    );
  }
  if (!ready || !game) return <div className="learn learn--loading" aria-busy="true" />;

  if (isOver) {
    return <Results game={game} total={total} onAgain={() => { void restart(); }} onAgainMissed={(ids) => { void startWithIds(ids); }} onHub={() => { setActive(null); navigate('/learn'); }} />;
  }

  const q = current!;
  const picked = q.picked ?? null;
  const right = picked != null && picked === q.answer;
  const roundName = game.daily ? "Today's challenge" : game.testId ? 'Test me' : game.pack ? packBy[game.pack]?.name : MODE_INFO[game.mode] || '';
  const safety = q.safety || (game.pack && packBy[game.pack]?.safety ? Q.SNAKE_RULE : '');
  const sub = q.type === 'duel' ? 'Tap the photo you think it is.' : q.type === 'odd' ? 'Tap the odd one out.' : q.sub || '';

  return (
    <div className={`lq-screen lq-screen--${game.mode}${game.kind && game.kind !== 'animals' ? ` kind--${game.kind}` : ''}`} data-own-topbar>
      <header className="lq-head glass">
        <Link className="iconbtn" to="/learn" aria-label={game.daily ? 'Back to Learn. Your answers so far are saved' : 'Stop and go back to Learn'} onClick={() => { setActive(null); if (!game.daily) setGame(null); }}>
          <svg viewBox="0 0 24 24">{game.daily ? QI.back : QI.close}</svg>
        </Link>
        {game.mode === 'rapid' ? (
          <span className="lq-bar lq-bar--time" aria-hidden="true"><span style={{ transform: `scaleX(${(rapidLeft / RAPID_MS).toFixed(3)})` }} /></span>
        ) : (
          <span className="lq-bar" role="progressbar" aria-label={`Question ${game.i + 1} of ${game.qs.length}`} aria-valuemin={1} aria-valuemax={game.qs.length} aria-valuenow={game.i + 1}>
            <span style={{ transform: `scaleX(${((picked != null ? game.i + 1 : game.i) / game.qs.length).toFixed(3)})` }} />
          </span>
        )}
        <span className="lq-count" aria-hidden="true">{game.mode === 'rapid' ? <>{Math.ceil(rapidLeft / 1000)}<span>s</span></> : <>{game.i + 1}<span>/{game.qs.length}</span></>}</span>
      </header>
      {game.mode === 'rapid' && <p className="lq-hud" role="status"><span>In a row <b>{game.streak || 0}</b></span><span>Best this round <b>{game.top || 0}</b></span></p>}
      <p className="lq-kicker">{roundName}{game.testId ? <span>{speciesName(game.testId)} and its look-alikes</span> : game.practice ? <span>The ones you missed</span> : game.pack ? <span>Quiz pack</span> : null}</p>
      <div className={`lq lq--${q.type}`}>
        <h1 ref={promptRef} className="lq-prompt" tabIndex={-1}>{promptFor(q)}</h1>
        {sub && <p className="lq-sub">{sub}</p>}
        {safety && <p className="lq-safety"><svg viewBox="0 0 24 24">{QI.warn}</svg><span>{safety}</span></p>}
        <Media key={game.i} q={q} />
        <Options q={q} picked={picked} onPick={pick} rapid={game.mode === 'rapid'} round={game.i} />
        {picked != null && game.mode !== 'rapid' && <Feedback q={q} right={right} game={game} onNext={next} onPlay={play} />}
        {picked != null && game.mode === 'rapid' && <p className={`lq-verdict lq-fb ${right ? 'is-right' : 'is-wrong'} lq-fb--brief`}><svg viewBox="0 0 24 24">{right ? QI.tick : QI.cross}</svg><span>{right ? 'Correct.' : `Not quite. It's the ${speciesName(q.focus)}.`}</span></p>}
      </div>
    </div>
  );
}

// ---------- review deck ----------
function Deck({ onBack }: { onBack: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'overview' | 'card' | 'done'>('overview');
  const [game, setGame] = useState<RoundState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [toast, setToast] = useState('');
  const backRef = useRef<HTMLDivElement>(null);
  const sightings = useSightings();
  useMedia();

  useEffect(() => { void learnReady().then(() => { setReady(true); force(); }); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [game?.n, game?.queue?.length, mode, revealed]);
  useEffect(() => { if (revealed) backRef.current?.focus({ preventScroll: true }); }, [revealed]);
  const due = ready ? dueCards() : [];
  const cards = ready ? allCards() : [];
  const boxN = ready ? boxes() : [0, 0, 0, 0, 0];
  const next = ready ? nextDue() : null;
  const nextTxt = next ? (startOfDay(next.due) <= startOfDay() ? 'More come due later today.' : `Next ones are due ${new Date(next.due).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}.`) : '';

  const startReview = () => {
    const g = newDeckRound(due.slice(0, 20));
    setGame(g as any); setMode('card'); setRevealed(false);
  };
  const add = (which: 'month' | 'seen') => {
    const month = new Date().getMonth() + 1;
    const p = getLearn()?.prefs || { kind: 'animals' };
    const seenIds = new Set(sightings.map((s) => s.speciesId));
    let list = which === 'month'
      ? Q.poolFor({ kind: p.kind, scope: 'month', month }).sort((a: any, b: any) => (Q.relRate(b.id, month) ?? 0) - (Q.relRate(a.id, month) ?? 0) || a.rarity - b.rarity)
      : [...seenIds].map((id) => byId.get(id)).filter(Boolean);
    const cardsNow = getLearn()?.cards || {};
    list = list.filter((s: any) => !cardsNow[s.id]).slice(0, which === 'month' ? 10 : 30);
    const n = addCards(list, 'all');
    setToast(n ? `Added ${n} ${n === 1 ? 'card' : 'cards'}.` : which !== 'seen' ? 'Those are all in the deck already.' : 'Nothing new to add.');
    force();
  };

  if (!ready) return <div className="learn learn--loading" aria-busy="true" />;

  if (mode === 'card' && game) {
    const c = game.queue?.[0];
    if (!c) { setMode('done'); return null; }
    const sp = byId.get(c.id);
    if (!sp) { game.queue!.shift(); force(); return null; }
    const photos = Q.photosFor(sp.id);
    const mates = Q.lookalikesOf(sp.id).map((id: number) => byId.get(id)).filter(Boolean);
    const peaks = Q.peaksOf(sp.id);
    const cw = Q.callWords(sp);
    const grade = (g: 'knew' | 'unsure' | 'missed') => {
      const box = gradeCard(c.id, c.skill, g);
      game.tally![g]++;
      game.queue!.shift();
      if (box === 1 && c.reps < 2) game.queue!.push({ ...c, reps: c.reps + 1 }); else game.n!++;
      setRevealed(false);
      if (!game.queue!.length) setMode('done');
      force();
    };
    return (
      <div className="lq-screen lq-screen--deck" data-own-topbar>
        <header className="lq-head glass">
          <button type="button" className="iconbtn" aria-label="Stop reviewing" onClick={() => { setGame(null); setMode('overview'); }}><svg viewBox="0 0 24 24">{QI.close}</svg></button>
          <span className="lq-bar" role="progressbar" aria-label={`Card ${game.n! + 1} of ${game.total}`} aria-valuemin={1} aria-valuemax={game.total} aria-valuenow={game.n! + 1}><span style={{ transform: `scaleX(${(game.n! / Math.max(1, game.total!)).toFixed(3)})` }} /></span>
          <span className="lq-count" aria-hidden="true">{game.queue!.length}<span> left</span></span>
        </header>
        <p className="lq-kicker">Review deck<span>Box {(getLearn()?.cards?.[c.id]?.[c.skill]?.box) || 1}, {c.skill === 'call' ? 'by call' : 'by sight'}</span></p>
        <div className="lq ld-card">
          <h1 className="lq-prompt" tabIndex={-1}>{c.skill === 'call' ? 'Whose call is this?' : `Which ${KINDS[sp.kind]?.one || 'species'} is this?`}</h1>
          {c.skill === 'call' ? <CallPlayer key={`${c.id}|${c.skill}|${game.n}|${game.queue!.length}`} call={(Q.callsOf(sp.id) as CallClip[])[0]} seed={sp.id} /> : <PhotoBox key={`${c.id}|${c.skill}|${game.n}|${game.queue!.length}`} photos={photos} alt={`Mystery ${KINDS[sp.kind]?.one}`} missing={`This photo needs a connection. Its field notes: ${Q.blankNotes(sp)}`} />}
          {!revealed && <button type="button" className="btn btn--primary btn--block" onClick={() => setRevealed(true)}>Show the answer</button>}
          {revealed && (
            <div ref={backRef} className="ld-back" tabIndex={-1}>
              <p className="ld-name"><Link to={`/bird/${sp.id}`}>{sp.name}</Link></p>
              <p className="lq-sci">{sp.sci}{sp.kind !== 'bird' ? <> <span className={`kindtag kind--${sp.kind}`}>{KINDS[sp.kind]?.one}</span></> : null}</p>
              <ul className="ld-marks">{Q.fieldMarks(sp, 3).map((s: string, i: number) => <li key={i}>{s}</li>)}{cw && c.skill === 'call' ? <li>Listen for "{cw.words}".</li> : null}</ul>
              {mates[0] && <p className="lq-tell"><strong>Not to be confused with the {mates[0].name}.</strong> {Q.tellFor(sp.id, mates[0].id)}</p>}
              <dl className="ld-facts">
                {peaks && <div><dt>Most reported</dt><dd>{peaks.charAt(0).toUpperCase() + peaks.slice(1)}</dd></div>}
                <div><dt>Where</dt><dd>{sp.habitats.map((h) => HABITATS[h]).join(', ') || 'Not recorded'}</dd></div>
              </dl>
              {c.skill === 'call' && <PhotoBox photos={photos} alt={sp.name} cls="lq-photo lq-photo--answer" />}
              <div className="ld-grade" role="group" aria-label="How did you go?">
                <button type="button" className="btn" onClick={() => grade('missed')}><svg viewBox="0 0 24 24">{QI.cross}</svg><span>Missed</span></button>
                <button type="button" className="btn" onClick={() => grade('unsure')}><span>Unsure</span></button>
                <button type="button" className="btn btn--primary" onClick={() => grade('knew')}><svg viewBox="0 0 24 24">{QI.tick}</svg><span>Knew it</span></button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'done' && game) {
    const t = game.tally!;
    const seenN = t.knew + t.unsure + t.missed;
    return (
      <div className="lr">
        <header className="page-head"><h1 className="lh-title" tabIndex={-1}>Deck reviewed</h1></header>
        <section className="lr-hero" aria-label="Your score">
          <div className="lr-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" pathLength="100" /><circle className="lr-ring-fg" cx="60" cy="60" r="52" pathLength="100" style={{ strokeDashoffset: 100 - (seenN ? t.knew / seenN : 0) * 100 }} /></svg><p className="lr-score" role="status"><CountUp value={t.knew} /><span aria-hidden="true">knew it</span></p></div>
          <p className="lr-note">{t.unsure ? `${t.unsure} unsure. ` : ''}{t.missed ? `${t.missed} missed, and they'll come back soon. ` : ''}Cards you knew come back in a few days.</p>
        </section>
        <div className="lr-actions"><Link className="btn btn--primary btn--block" to="/learn">Back to Learn</Link><button type="button" className="btn btn--block" onClick={() => { setGame(null); setMode('overview'); }}>Deck overview</button></div>
      </div>
    );
  }

  return (
    <>
      <header className="page-head page-head--back"><Link className="iconbtn" to="/learn" aria-label="Back to Learn"><svg viewBox="0 0 24 24">{QI.back}</svg></Link><h1 className="lh-title">Review deck</h1></header>
      <div className="learn">
        <div className="ld-summary">
          <span className="lh-boxes lh-boxes--big" aria-hidden="true">
            {boxN.map((n, i) => {
              const max = Math.max(1, ...boxN);
              return <span className="lh-box" key={i}><b>{n}</b><span className="lh-box-bar"><i style={{ '--h': (n / max).toFixed(3), '--j': i } as React.CSSProperties} /></span><em>{i + 1}</em></span>;
            })}
          </span>
          <p className="small muted">{cards.length ? `${cards.length} cards. ${boxN[3] + boxN[4]} in box 4 or 5, which count as mastered.` : 'No cards yet.'} Knew it moves a card along a box: it comes back after 1, 3, 7, then 21 days. Missed sends it back to box 1.</p>
        </div>
        {due.length ? <button type="button" className="btn btn--primary btn--block" onClick={startReview}>Review {due.length > 20 ? 20 : due.length} {due.length === 1 ? 'card' : 'cards'}</button>
          : <p className="ld-none" role="status">{cards.length ? `Nothing to review right now. ${nextTxt}` : 'Add a set to start. Species you miss in any round are added for you.'}</p>}
        <section className="lh-sec"><div className="lh-sec-h"><h2>Add cards</h2></div>
          <div className="ld-add">
            <button type="button" className="btn btn--block" onClick={() => add('month')}><span className="ld-add-ic"><svg viewBox="0 0 24 24">{QI.deck}</svg></span><span>Add 10 species around in {monthName()}</span></button>
            <button type="button" className="btn btn--block" onClick={() => add('seen')}><span className="ld-add-ic"><svg viewBox="0 0 24 24">{QI.deck}</svg></span><span>Add the ones I've seen</span></button>
          </div>
          <p className="small muted">Birds and frogs with recordings get a call card as well as a photo card.</p>
        </section>
        {toast && <p className="small muted" role="status">{toast}</p>}
      </div>
    </>
  );
}

