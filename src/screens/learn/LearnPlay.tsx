import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HABITATS, KINDS, byId, type QuizQuestion, type RoundState } from '../../lib/data';
import { useMedia, useSightings } from '../../lib/hooks';
import { countUp, flip, motionOK } from '../../lib/motion';
import * as Q from '../../core/quiz.js';
import { db } from '../../core/db.js';
import { loadSeq } from '../../core/seqdata.js';
import { loadExtras } from '../../core/gallery.js';
import { cachedIndex } from '../../core/media.js';
import {
  learnReady, newPracticeRound, newDailyRound, newDeckRound, answer as recordAnswer, finishRound,
  roundNote, testSet, allCards, dueCards, boxes, nextDue, addCards, gradeCard, dayStr, monthName,
  packBy, ROUND, RAPID_MS, kindLabel, emptyMessage, startOfDay, getLearn, getActive, setActive, activeFor,
} from '../../core/learn.js';
import { PhotoBox, CallPlayer, SilhouetteFilter, QI, stopCalls, usePlayButtons, PlayChip, type CallClip, type PlayButtonState } from './QuizMedia';
import { answerLayout, dockActions, foldKeys, nextLabel, trailOf, trailText, verdictOf, type AnswerLayout, type Verdict } from './answerDock';
import { FadeImage } from '../../components/SpeciesImage';
import { lookAfterDraw } from '../../lib/look';
import { toast } from '../../lib/toast';
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

// The round on screen is kept in learn.js (getActive) with the route it belongs to, so leaving for a species page or
// Compare and pressing Back puts her back where she was, as v1 does. This remembers how far down the page she was.
const scrollOf = new WeakMap<object, number>();
const hereNow = () => window.location.hash;

// v1 focusWithin (js/learn.js:273): a screen drawn here only takes focus for its heading when she was already in the
// screen, or the route's focus has parked on it while it loaded. A cold load leaves focus where the browser put it.
const focusInView = () => {
  const view = document.getElementById('view');
  const a = document.activeElement;
  return !!view && !!a && a !== document.body && a.isConnected && view.contains(a);
};
// v1 drawn() runs lookAfterDraw after every question, card and result, so the frosted top bar follows the screen on
// it (its back control is the screen's [data-quit] or page-head back link), not the loading shell the route began with.
function useLookAfterDraw(deps: unknown[]) {
  useEffect(() => {
    lookAfterDraw(document.getElementById('view'));
  }, deps);
}
function useRememberScroll(round: object | null) {
  useEffect(() => {
    if (!round) return;
    const here = hereNow();
    // Only while this round's route is showing: the next screen's scroll-to-top must not overwrite it.
    const onScroll = () => { if (hereNow() === here) scrollOf.set(round, window.scrollY); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [round]);
}

function promptFor(q: QuizQuestion) {
  return q.prompt;
}

function Media({ q, still = false, onShow }: { q: QuizQuestion; still?: boolean; onShow?: (src: string | null) => void }) {
  const [showHint, setShowHint] = useState(false);
  const sp = byId.get(q.focus);
  if (!sp) return null;
  const missing = <>This photo needs a connection. Here are its field notes instead: {cleanClue(Q.blankNotes(sp, q.wrong || []))}</>;
  if (q.type === 'photo') return <PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}`} missing={missing} onShow={onShow} />;
  if (q.type === 'silhouette') {
    return <><SilhouetteFilter /><PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}, shown as a silhouette`} cls={`lq-photo lq-photo--sil${q.picked != null ? ' is-revealed' : ''}${still ? ' no-anim' : ''}`} missing={missing} onShow={onShow} /></>;
  }
  if (q.type === 'zoom') return <PhotoBox photos={q.photos} alt={`Mystery ${KINDS[sp.kind]?.one || 'species'}, close up`} cls={`lq-photo lq-photo--zoom${q.picked != null ? ' is-revealed' : ''}${still ? ' no-anim' : ''}`} style={{ '--zx': `${q.zoom?.x ?? 50}%`, '--zy': `${q.zoom?.y ?? 50}%`, '--zs': q.zoom?.scale ?? 2 } as React.CSSProperties} missing={missing} onShow={onShow} />;
  if (q.type === 'call') return (
    <>
      <CallPlayer call={q.call as CallClip} seed={q.call?.src || sp.id} onFail={() => setShowHint(true)} />
      {showHint && q.picked == null && <p className="lq-hint">Field notes: {cleanClue(Q.blankNotes(sp, q.wrong || []))}</p>}
    </>
  );
  if (q.type === 'whoami') return <blockquote className="lq-clue">{cleanClue(q.clue || '')}</blockquote>;
  if (q.type === 'fact' && q.photos?.length) return <PhotoBox photos={q.photos} alt={speciesName(q.img)} cls="lq-photo lq-photo--small" onShow={onShow} />;
  return null;
}

function Options({ q, picked, onPick, rapid, round, still = false, folded }: {
  q: QuizQuestion; picked: string | null; onPick: (key: string) => void; rapid: boolean; round: number; still?: boolean; folded?: Set<string>;
}) {
  const disabled = picked != null;
  // A restored answer is drawn without replaying the pop and shake (v1 showAnswer restore adds no-anim).
  const calm = disabled && still ? ' no-anim' : '';
  if (q.options[0]?.photos) {
    const n = q.options.length;
    return (
      <div className={`lq-duel${n > 2 ? ' lq-duel--four' : ''}`}>
        {q.options.map((o, i) => {
          const cls = disabled ? (o.key === q.answer ? ' is-right' : o.key === picked ? ' is-wrong' : ' is-dim') : '';
          const named = q.named || disabled;
          const suffix = disabled ? (o.key === q.answer ? ' (right answer)' : o.key === picked ? ' (your answer)' : '') : '';
          return (
            <button key={o.key} type="button" className={`lq-side${cls}${calm}`} data-pick={o.key} aria-disabled={disabled || undefined} aria-label={named ? `${o.label}${suffix}` : SIDES[n]?.[i] || `Photo ${i + 1}`} onClick={() => onPick(o.key)}>
              <PhotoBox key={`${round}-${o.key}`} photos={o.photos} alt="" cls="lq-photo lq-photo--duel" missing="Photo not saved on this phone" />
              <span className="lq-side-name" data-name>{named ? o.label : ''}</span>
              <span className="lq-opt-mark" aria-hidden="true">{disabled && o.key === q.answer ? <svg viewBox="0 0 24 24" aria-hidden="true">{QI.tick}</svg> : disabled && o.key === picked ? <svg viewBox="0 0 24 24" aria-hidden="true">{QI.cross}</svg> : null}</span>
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
        // Each answer sits in a wrapper that carries the move (flip) when the others fold away under a photo, so the
        // answer's own pop or shake still plays on the button inside.
        return (
          <div key={o.key} className={`lq-opt-wrap${folded?.has(o.key) ? ' is-folded' : ''}`} data-flip={`opt-${o.key}`}>
            <button type="button" className={`lq-opt${cls}${calm}`} data-pick={o.key} aria-disabled={disabled || undefined} onClick={() => onPick(o.key)}>
              <span className={`lq-opt-label${q.italic ? ' is-sci' : ''}`}>{o.label}</span>
              <span className="lq-opt-mark" aria-hidden="true">{disabled && o.key === q.answer ? <svg viewBox="0 0 24 24" aria-hidden="true">{QI.tick}</svg> : disabled && o.key === picked ? <svg viewBox="0 0 24 24" aria-hidden="true">{QI.cross}</svg> : null}</span>
              <span className="sr-only">{suffix}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------- the answer (Learn answer dock) ----------
// A photo question's verdict is a glass footer that grows out of the bottom of the mystery photo, in the same card,
// so the bird stays on screen while the field mark explains it. Its glass is tinted by a soft blur of the photo above
// it (solid in the outdoor theme). Focus moves to it (role=status), so the verdict is read out.
function PhotoVerdict({ v, glow, vRef }: { v: Verdict; glow: string | null; vRef: RefObject<HTMLElement | null> }) {
  const [glowOk, setGlowOk] = useState(true);
  return (
    <div ref={vRef as RefObject<HTMLDivElement>} className={`lq-verdictbar ${v.right ? 'is-right' : 'is-wrong'}`} role="status" tabIndex={-1} data-fb>
      {glow && glowOk ? <img className="lq-glow" src={glow} alt="" aria-hidden="true" decoding="async" onError={() => setGlowOk(false)} /> : null}
      <span className="lq-vb-mark" aria-hidden="true"><svg viewBox="0 0 24 24">{v.right ? QI.tick : QI.cross}</svg></span>
      <p className="lq-vb-text">
        <strong>{v.lead}</strong>{v.rest || v.name ? ' ' : ''}{v.rest}
        {v.name && v.nameId ? <Link to={`/bird/${v.nameId}`}>{v.name}</Link> : null}{v.tail}
      </p>
      {v.line && <p className="lq-vb-line">{v.line}</p>}
      {v.mark && <p className="lq-vb-line">{v.mark}</p>}
    </div>
  );
}

function Source({ q }: { q: QuizQuestion }) {
  if (q.type !== 'fact' || !q.source?.title) return null;
  return <p className="lq-source">Source: {q.source.url ? <a href={q.source.url} target="_blank" rel="noopener">{q.source.title}</a> : q.source.title}</p>;
}
function Safety({ text }: { text?: string }) {
  return text ? <p className="lq-safety"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.warn}</svg><span>{text}</span></p> : null;
}

// The rest of a photo question's feedback (how to tell them apart, the snake rule, the source) stays as a card below
// the two answers, where she can scroll to it.
function MoreCard({ q, v }: { q: QuizQuestion; v: Verdict }) {
  if (!v.tell && !q.safety && !(q.type === 'fact' && q.source?.title)) return null;
  return (
    <div className="lq-more">
      {v.tell && <p className="lq-tell"><strong>How to tell them apart.</strong> {v.tell}</p>}
      <Safety text={q.safety} />
      <Source q={q} />
    </div>
  );
}

// Who am I?, call and fact questions without a photo keep v1's feedback card under the answers (focused and brought
// into view, clear of the dock). Duels and odd one out keep it for the rest, with their verdict line in the dock.
// Next and the play and Compare buttons live in the dock.
function AnswerCard({ q, v, layout, restore = false, vRef }: {
  q: QuizQuestion; v: Verdict; layout: AnswerLayout; restore?: boolean; vRef: RefObject<HTMLElement | null>;
}) {
  const ans = byId.get(q.focus);
  const fbRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = fbRef.current;
    // Coming back to an answered question (v1 showAnswer restore) neither moves focus nor scrolls.
    if (!el || restore || layout !== 'card') return;
    el.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
  }, []);
  if (!ans) return null;
  const setRef = (el: HTMLDivElement | null) => {
    fbRef.current = el;
    if (layout === 'card') vRef.current = el;
  };
  return (
    <div ref={setRef} className={`lq-fb ${v.right ? 'is-right' : 'is-wrong'}${restore ? ' no-anim' : ''}${layout === 'dock' ? ' lq-fb--rest' : ''}`} data-fb tabIndex={-1}>
      {layout === 'card' && <p className="lq-verdict"><svg viewBox="0 0 24 24" aria-hidden="true">{v.right ? QI.tick : QI.cross}</svg><span>{v.right ? 'Correct.' : v.text}</span></p>}
      {v.speciesQ && <p className="lq-name"><Link to={`/bird/${ans.id}`}>{ans.name}</Link> <span className="lq-sci">{ans.sci}</span></p>}
      {(q.type === 'call' || q.type === 'whoami') && q.photos?.length ? <PhotoBox photos={q.photos} alt={ans.name} cls="lq-photo lq-photo--answer" /> : null}
      {v.line && <p className="lq-line">{v.line}</p>}
      {v.mark && <p className="lq-line">{v.mark}</p>}
      {v.tell && <p className="lq-tell"><strong>How to tell them apart.</strong> {v.tell}</p>}
      <Safety text={q.safety} />
      <Source q={q} />
    </div>
  );
}

/** What the dock shows: the last answered question, kept while the dock slides away after Next. */
interface DockSnap { q: QuizQuestion; v: Verdict; i: number; n: number; layout: AnswerLayout }

// One glass dock for the whole round, just above the tab bar (and the outing bar when one shows). It rises when she
// answers and slips away on Next. Next is always in the same place, at its right; to its left, round chips for Hear
// its call, Hear the one you picked and Compare. Duels and odd one out add their verdict line on top. The page keeps
// room for it at its foot, and toasts sit above it (--lq-dock-h on <body>).
function Dock({ snap, up, still, onNext, onPlay, playing, vRef }: {
  snap: DockSnap | null; up: boolean; still: boolean; onNext: () => void; onPlay: (which: string) => void;
  playing: PlayButtonState; vRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.body.style.setProperty('--lq-dock-h', `${Math.ceil(el.offsetHeight)}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); document.body.style.removeProperty('--lq-dock-h'); };
  }, []);
  const actions = snap ? dockActions(snap.q) : [];
  const withVerdict = !!snap && snap.layout === 'dock';
  return (
    <div ref={ref} className={`lq-dock glass${up ? ' is-up' : ''}${still ? ' no-anim' : ''}${withVerdict ? ' lq-dock--verdict' : ''}`} inert={!up} data-dock>
      {withVerdict && snap && (
        <p ref={vRef as RefObject<HTMLParagraphElement>} className={`lq-dock-verdict ${snap.v.right ? 'is-right' : 'is-wrong'}`} role="status" tabIndex={-1}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{snap.v.right ? QI.tick : QI.cross}</svg><span>{snap.v.right ? 'Correct.' : snap.v.text}</span>
        </p>
      )}
      <div className="lq-dock-row">
        {actions.length > 0 && (
          <div className="lq-chips">
            {actions.map((a, j) => (a.kind === 'play'
              ? <PlayChip key={a.key} on={playing} which={a.which!} label={a.label} tone={a.tone} onPlay={onPlay} style={{ '--j': j } as CSSProperties} />
              : <Link key={a.key} className="lq-chip lq-chip--plain" to={a.to!} aria-label={a.label} title={a.label} style={{ '--j': j } as CSSProperties}><svg viewBox="0 0 24 24" aria-hidden="true">{QI.compare}</svg></Link>))}
          </div>
        )}
        <button type="button" className="btn btn--primary lq-next" onClick={onNext}>{snap ? nextLabel(snap.i, snap.n) : 'Next'}</button>
      </div>
    </div>
  );
}

// The header's trail: one segment per question, filled green for right and red for wrong, the current one marked.
// Answers already given when it was drawn (a resumed round) show as they are; an answer given now fills in.
const roundIds = new WeakMap<object, number>();
let roundSeq = 0;
const roundKey = (g: object) => { let k = roundIds.get(g); if (!k) { k = ++roundSeq; roundIds.set(g, k); } return k; };
function Trail({ game }: { game: RoundState }) {
  const segs = trailOf(game.qs, game.i);
  const [settled] = useState(() => new Set(segs.flatMap((s, n) => (s === 'right' || s === 'wrong' ? [n] : []))));
  const n = game.qs.length;
  return (
    <span className="lq-trail" role="progressbar" aria-label="Your round" aria-valuemin={1} aria-valuemax={n} aria-valuenow={Math.min(game.i + 1, n)} aria-valuetext={trailText(game.qs, game.i)} style={{ '--n': n } as CSSProperties}>
      {segs.map((s, k) => <i key={k} className={`is-${s}${(s === 'right' || s === 'wrong') && !settled.has(k) ? ' is-new' : ''}`} />)}
    </span>
  );
}

// ---------- answer motion ----------
// A gentle spring (about 2% overshoot) for the footer's height; plain ease-out for opacity and the leaving answers.
const SPRING_SOFT = 'linear(0, 0.017 2.5%, 0.062 5%, 0.125 7.5%, 0.2 10%, 0.282 12.5%, 0.366 15%, 0.527 20%, 0.667 25%, 0.781 30%, 0.868 35%, 0.93 40%, 0.986 47.5%, 1.012 55%, 1.02 65%, 1.016 75%, 1.008 87.5%, 1)';
// The app's spring (--ease-spring): a small overshoot for the verdict's tick or cross.
const SPRING = 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067 22.5%, 1.077 25.1%, 1.07 28.1%, 1.017 34.2%, .995 38.7%, .988 43.3%, 1.002 56.5%, 1)';
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const canAnimate = () => motionOK() && !document.hidden && typeof Element.prototype.animate === 'function';
function animateSafe(el: Element, kf: Keyframe[], opts: KeyframeAnimationOptions) {
  // An engine without linear() easing throws on it: fall back to ease-out rather than skip the motion.
  try { return el.animate(kf, opts); } catch { try { return el.animate(kf, { ...opts, easing: EASE_OUT }); } catch { return null; } }
}
// The answers that fold away leave as quick fading copies where they were, under the page, while the two that stay
// slide together over them.
function ghostsOf(keys: string[]) {
  return keys.flatMap((k) => {
    const el = document.querySelector<HTMLElement>(`.lq .lq-opt-wrap[data-flip="opt-${k}"]`);
    if (!el) return [];
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return [];
    return [{ el: el.cloneNode(true) as HTMLElement, r }];
  });
}
function playGhosts(list: { el: HTMLElement; r: DOMRect }[]) {
  if (!list.length) return;
  const layer = document.createElement('div');
  layer.className = 'lq-ghosts';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  for (const { el, r } of list) {
    el.className = 'lq-ghost';
    el.removeAttribute('data-flip');
    el.querySelectorAll('[data-pick]').forEach((b) => { b.removeAttribute('data-pick'); b.setAttribute('aria-disabled', 'true'); });
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    layer.append(el);
  }
  document.body.append(layer);
  const anims = [...layer.children].map((g) => animateSafe(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.95)' }], { duration: 180, easing: EASE_OUT, fill: 'forwards' }));
  const clear = () => layer.remove();
  void Promise.allSettled(anims.map((a) => a?.finished)).then(clear);
  window.setTimeout(clear, 800);
}
/**
 * Answer a photo question with motion: the other answers fold away (flip() slides the two that stay together), and
 * the verdict footer grows out of the photo with a height and opacity spring. Returns how much the footer has still
 * to grow, so keepInView can allow for it. Reduced motion, a hidden tab or no WAAPI: the final layout at once.
 */
function answerUnderPhoto(commit: () => void, q: QuizQuestion, key: string, footRef: RefObject<HTMLDivElement | null>) {
  if (!canAnimate()) { commit(); return 0; }
  const ghosts = ghostsOf(q.options.filter((o) => o.key !== key && o.key !== q.answer).map((o) => o.key));
  flip(() => {
    commit();
    // Measure the moves with the footer still shut: its own growth then carries the answers the rest of the way.
    const f = footRef.current;
    if (f) { f.style.height = '0px'; f.style.overflow = 'hidden'; }
  }, { selector: '.lq [data-flip]', key: (el) => el.dataset.flip });
  playGhosts(ghosts);
  const f = footRef.current;
  if (!f) return 0;
  const h = f.scrollHeight;
  // While the footer grows, the screen keeps the room it will take at its foot, so the page is never shorter than
  // its final length and a scroll to keep the answers in view is not cut short.
  const screen = f.closest<HTMLElement>('.lq-screen');
  screen?.style.setProperty('--lq-grow', `${h}px`);
  const grow = animateSafe(f, [{ height: '0px' }, { height: `${h}px` }], { duration: 480, easing: SPRING_SOFT });
  f.style.height = '';
  const bar = f.firstElementChild;
  if (bar) animateSafe(bar, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 60, easing: EASE_OUT, fill: 'backwards' });
  // The rest of the feedback settles in below once the two answers have slid into place.
  const more = document.querySelector('.lq .lq-more');
  if (more) animateSafe(more, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 200, easing: EASE_OUT, fill: 'backwards' });
  const mark = f.querySelector('.lq-vb-mark');
  if (mark) animateSafe(mark, [{ opacity: 0, transform: 'scale(.3) rotate(-30deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 120, easing: SPRING, fill: 'backwards' });
  const done = () => { f.style.overflow = ''; screen?.style.removeProperty('--lq-grow'); };
  if (grow) grow.finished.then(done, done); else done();
  return grow ? h : 0;
}
/**
 * Only when the dock would hide her pick or the right answer (a short screen, or the outing bar showing): scroll to
 * show them above it. When that leaves the whole photo in view, the photo settles just under the question head,
 * rather than stopping with the question half under it. Never so far that the verdict leaves the screen. On a
 * 390x844 phone without an outing, nothing moves.
 */
function keepInView(layout: AnswerLayout, grow: number) {
  const dock = document.querySelector<HTMLElement>('.lq-dock');
  if (!dock) return;
  const dockTop = innerHeight - (parseFloat(getComputedStyle(dock).bottom) || 0) - dock.offsetHeight;
  const headBottom = document.querySelector('.lq-head')?.getBoundingClientRect().bottom ?? 0;
  let bottom = 0, top = 0;
  if (layout === 'photo') {
    const opts = document.querySelector('.lq .lq-options');
    const foot = document.querySelector('.lq .lq-foot');
    if (!opts || !foot) return;
    bottom = opts.getBoundingClientRect().bottom + grow;
    top = foot.getBoundingClientRect().top;
  } else {
    const pair = [...document.querySelectorAll('.lq .lq-side.is-right, .lq .lq-side.is-wrong')].map((e) => e.getBoundingClientRect());
    if (!pair.length) return;
    bottom = Math.max(...pair.map((r) => r.bottom));
    top = Math.min(...pair.map((r) => r.top));
  }
  const need = bottom + 10 - dockTop;
  if (need <= 1) return;
  const media = document.querySelector('.lq .lq-card, .lq .lq-duel');
  const snap = media ? media.getBoundingClientRect().top - headBottom - 10 : 0;
  const by = Math.min(Math.max(need, snap), top - headBottom - 8);
  if (by > 1) window.scrollBy({ top: by, behavior: motionOK() ? 'smooth' : 'auto' });
}

// v1 scoreHTML/playScore: the score sits inside a ring that fills to the share she got right, in the big stamp
// numerals (.lr-score b); the first time it is shown the ring fills and the number counts up, not when she comes back
// to it (v1 game.shown).
function ScoreHero({ round, big, of, frac, note }: { round: RoundState; big: number; of: string; frac: number; note: string }) {
  const ringRef = useRef<SVGCircleElement>(null);
  const numRef = useRef<HTMLElement>(null);
  const [first] = useState(() => !round.shown);
  useEffect(() => {
    round.shown = true;
    const ring = ringRef.current;
    if (!first || !motionOK() || !ring) return;
    const to = ring.style.strokeDashoffset;
    ring.style.strokeDashoffset = '100';
    void ring.getBoundingClientRect();
    ring.classList.add('is-filling');
    ring.style.strokeDashoffset = to;
    void countUp(numRef.current, 0, big, { delay: 120 });
  }, []);
  return (
    <section className="lr-hero" aria-label="Your score">
      <div className="lr-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" pathLength="100" /><circle ref={ringRef} className={`lr-ring-fg${frac > 0 ? '' : ' is-zero'}`} cx="60" cy="60" r="52" pathLength="100" style={{ strokeDashoffset: (100 - frac * 100).toFixed(1) }} /></svg>
        <p className="lr-score" role="status"><b ref={numRef} aria-hidden="true">{big}</b><span aria-hidden="true">{of}</span><span className="sr-only">{big} {of}</span></p>
      </div>
      <p className="lr-note">{note}</p>
    </section>
  );
}

function Results({ game, total, onAgain, onAgainMissed, onHub, takeFocus }: {
  game: RoundState; total: number; onAgain: () => void; onAgainMissed: (ids: number[]) => void; onHub: () => void;
  takeFocus: () => boolean;
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
  // v1 drawResults focuses its heading only if she was in the screen (See how you went, the clock running out while
  // she answered); a cold load of a finished daily leaves focus alone, and the route's own focus covers arriving here.
  useEffect(() => { if (takeFocus()) headRef.current?.focus({ preventScroll: true }); }, [game]);
  return (
    <div className="lr">
      <header className="page-head"><h1 ref={headRef} className="lh-title" tabIndex={-1}>{roundName}</h1></header>
      <ScoreHero round={game} big={big} of={of} frac={frac} note={note} />
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
              // v1 faceSrc + imgTag: shimmers, fades in once ('fade in' when already shown), hides if it fails.
              const face: string = Q.photosFor(sp.id, { size: 'small', prefer: 'wiki' })[0]?.src || '';
              return (
                <li key={i} className={`lr-card kind--${sp.kind}`}>
                  <Link to={`/bird/${sp.id}`}>
                    <span className="lr-card-img">{face ? <FadeImage key={sp.id} src={face} /> : null}</span>
                    <span className="lr-mark"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.cross}</svg><span className="sr-only">Wrong:</span></span>
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
                  <span className="lr-mark"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.tick}</svg><span className="sr-only">Right</span></span>
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
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [game, setGame] = useState<RoundState | null>(null);
  // True from coming back to a saved round until she next answers or moves on.
  const [resumed, setResumed] = useState(false);
  const [ready, setReady] = useState(false);
  const [deckMode, setDeckMode] = useState<'overview' | 'card' | 'done'>('overview');
  const [deckGame, setDeckGame] = useState<RoundState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [rapidLeft, setRapidLeft] = useState(RAPID_MS);
  // The answer's play buttons; they share one clip with the big call player (QuizMedia).
  const buttons = usePlayButtons();
  useMedia();
  const startRef = useRef(0);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const wantHeadFocus = useRef(false);
  // The answered question's verdict (the photo's footer, the dock's verdict line or the feedback card), which takes
  // focus when she answers and when she comes back to an answered question.
  const verdictRef = useRef<HTMLElement | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  const dockSnap = useRef<DockSnap | null>(null);
  // The photo on screen, to tint the verdict footer's glass.
  const [glow, setGlow] = useState<string | null>(null);

  const stopInline = buttons.stop;

  const isDeck = pack === 'deck';
  const isDaily = pack === 'daily';

  // v1 startRound/renderDaily: when no round can be made, say why in a toast and go back to the hub (toHub replaces
  // the route), where the choice that caused it can be changed.
  const toHub = (msg: string) => {
    toast(msg);
    setActive(null);
    navigate('/learn', { replace: true });
  };

  useEffect(() => {
    let alive = true;
    setGame(null);
    setResumed(false);
    setReady(false);
    void (async () => {
      await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()]);
      if (!alive) return;
      setReady(true);
      if (isDeck) return;
      // Back from a species page or Compare: the same question, options, answer and feedback, or the same results
      // (v1 renderLearn keeps `game` while its route matches). learn.js stores window.location.hash as the route.
      const active = activeFor(hereNow()) as RoundState | null;
      if (active) {
        setResumed(true);
        setGame(active);
        if (active.mode === 'rapid') setRapidLeft(Math.max(0, (active.endsAt || 0) - Date.now()));
        return;
      }
      if (isDaily) {
        const r = newDailyRound();
        if (!alive) return;
        if (r.error) { toHub(r.error); return; }
        // A new round takes focus for its heading only after in-app navigation (the route's focus is in the screen).
        wantHeadFocus.current = focusInView();
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
      if (r.error) { toHub(r.error); return; }
      if (r.notice) toast(r.notice);
      wantHeadFocus.current = focusInView();
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
      // Time up: the results take focus for their heading if she was answering (v1 ticker -> drawResults focusWithin).
      if (!left && focusInView()) wantHeadFocus.current = true;
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

  // A new question (Next, Play again, Practise missed, or a round just started) puts focus on its heading, as v1's
  // drawn()/focusPageHeading do. Play again shows the loading shell first, so wait until the heading is there.
  useEffect(() => {
    if (wantHeadFocus.current && promptRef.current) {
      promptRef.current.focus({ preventScroll: true });
      wantHeadFocus.current = false;
    }
  }, [game, game?.i]);

  // Every new question and the results start at the top, like v1 drawn(); a resumed round goes back to where she was.
  useEffect(() => { if (!resumed) window.scrollTo(0, 0); }, [game?.i, isOver]);
  useRememberScroll(game);
  useEffect(() => {
    if (!resumed || !game) return;
    window.scrollTo(0, scrollOf.get(game) || 0);
    // v1 focuses the screen's heading after a route change (the results heading focuses itself). Back on an answered
    // question, focus goes to its verdict instead, drawn as it was left with nothing replayed. The route's own focus
    // (RouteFocus) takes the heading in its next frame, so the verdict takes it back after that, unless she has
    // moved on meanwhile.
    const cur = game.qs[game.i];
    const verdict = cur?.picked != null && game.mode !== 'rapid' ? verdictRef.current : null;
    if (!verdict) { promptRef.current?.focus({ preventScroll: true }); return; }
    verdict.focus({ preventScroll: true });
    const id = requestAnimationFrame(() => {
      const a = document.activeElement;
      const idle = !a || a === document.body || a === promptRef.current || a === document.getElementById('view');
      if (idle && verdict.isConnected) verdict.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [resumed, game]);

  // These must be declared before any early return: the results screen calls them.
  const restart = async () => {
    wantHeadFocus.current = true;
    setResumed(false);
    stopCalls();
    setActive(null);
    setGame(null);
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
      toHub(r.error);
      return;
    }
    if ('notice' in r && r.notice) toast(r.notice);
    setGame(r.game);
    setActive(r.game);
    if (r.game?.mode === 'rapid') setRapidLeft(RAPID_MS);
  };
  const startWithIds = async (ids: number[]) => {
    wantHeadFocus.current = true;
    setResumed(false);
    stopCalls();
    stopInline();
    await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()]);
    const mode = game?.mode === 'rapid' ? 'photo' : pack === 'test' ? 'quick' : pack;
    const r = await newPracticeRound(mode, {
      ids,
      seen: new Set(((await db.all('sightings')) as { speciesId: number }[]).map((s) => s.speciesId)),
    } as any);
    if (r.error) {
      toHub(r.error);
      return;
    }
    if (r.notice) toast(r.notice);
    setGame(r.game);
    setActive(r.game);
    if (r.game?.mode === 'rapid') setRapidLeft(RAPID_MS);
  };
  const next = () => {
    if (!game) return;
    wantHeadFocus.current = true;
    setResumed(false);
    stopCalls();
    stopInline();
    game.i += 1;
    setRevealed(false);
    force();
  };
  const pick = (key: string) => {
    if (!game || !current || current.picked != null) return;
    const q = current;
    const layout = answerLayout(q, game.mode);
    let ok = false;
    // Answer and draw at once (flushSync), so the motion below starts from the answered layout.
    const commit = () => {
      ok = recordAnswer(game, q, key);
      flushSync(() => { setResumed(false); force(); });
    };
    let grow = 0;
    if (layout === 'photo') grow = answerUnderPhoto(commit, q, key, footRef);
    else commit();
    // The verdict takes focus, so it is read out (the feedback card focuses itself, as v1's did).
    if (layout === 'photo' || layout === 'dock') {
      verdictRef.current?.focus({ preventScroll: true });
      keepInView(layout, grow);
    }
    navigator.vibrate?.(ok ? 30 : [40, 60, 40]);
    if (game.mode === 'rapid') {
      const g = game;
      window.setTimeout(() => {
        if (g.qs[g.i] === q) { wantHeadFocus.current = true; setResumed(false); stopInline(); g.i += 1; setRevealed(false); force(); }
      }, ok ? 450 : 1100);
    }
  };
  const play = (which: string) => {
    if (!current) return;
    const q = current;
    const sp = which === 'answer' ? byId.get(q.focus) : byId.get(Number(which));
    if (!sp) return;
    const list = which === 'answer' && q.call ? [q.call as CallClip] : Q.callsOf(sp.id);
    const clip = list[Math.floor(Math.random() * list.length)] as CallClip | undefined;
    buttons.toggle(which, clip);
  };

  useLookAfterDraw([ready, game, game?.i, isOver]);

  if (isDeck) return <Deck onBack={() => navigate('/learn')} />;

  if (!ready || !game) return <div className="learn learn--loading" aria-busy="true" />;

  if (isOver) {
    const takeFocus = () => {
      const want = wantHeadFocus.current || focusInView();
      wantHeadFocus.current = false;
      return want;
    };
    return <Results game={game} total={total} takeFocus={takeFocus} onAgain={() => { void restart(); }} onAgainMissed={(ids) => { void startWithIds(ids); }} onHub={() => { setActive(null); navigate('/learn', { replace: true }); }} />;
  }

  const q = current!;
  const picked = q.picked ?? null;
  const right = picked != null && picked === q.answer;
  const layout = answerLayout(q, game.mode);
  const v = picked != null && layout !== 'rapid' ? verdictOf(q) : null;
  if (v) dockSnap.current = { q, v, i: game.i, n: game.qs.length, layout };
  const folded = new Set(foldKeys(q, game.mode));
  const roundName = game.daily ? "Today's challenge" : game.testId ? 'Test me' : game.pack ? packBy[game.pack]?.name : MODE_INFO[game.mode] || '';
  const safety = q.safety || (game.pack && packBy[game.pack]?.safety ? Q.SNAKE_RULE : '');
  const sub = q.type === 'duel' ? 'Tap the photo you think it is.' : q.type === 'odd' ? 'Tap the odd one out.' : q.sub || '';

  return (
    <div className={`lq-screen lq-screen--${game.mode}${game.kind && game.kind !== 'animals' ? ` kind--${game.kind}` : ''}`} data-own-topbar>
      <header className="lq-head glass">
        <button type="button" className="iconbtn" data-quit aria-label={game.daily ? 'Back to Learn. Your answers so far are saved' : 'Stop and go back to Learn'} onClick={() => { setActive(null); if (!game.daily) setGame(null); navigate('/learn', { replace: true }); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{game.daily ? QI.back : QI.close}</svg>
        </button>
        {game.mode === 'rapid' ? (
          <span className="lq-bar lq-bar--time" aria-hidden="true"><span style={{ transform: `scaleX(${(rapidLeft / RAPID_MS).toFixed(3)})` }} /></span>
        ) : <Trail key={roundKey(game)} game={game} />}
        {game.mode === 'rapid'
          ? <span className="lq-count" data-secs aria-label="Seconds left">{Math.ceil(rapidLeft / 1000)}<span>s</span></span>
          : <span className="lq-count" aria-hidden="true">{game.i + 1}<span>/{game.qs.length}</span></span>}
      </header>
      {/* v1 headHTML: rapid fire has its streak line where the other rounds have their kicker. */}
      {game.mode === 'rapid'
        ? <p className="lq-hud" role="status"><span>In a row <b>{game.streak || 0}</b></span><span>Best this round <b>{game.top || 0}</b></span></p>
        : <p className="lq-kicker">{roundName}{game.testId ? <span>{speciesName(game.testId)} and its look-alikes</span> : game.practice ? <span>The ones you missed</span> : game.pack ? <span>Quiz pack</span> : null}</p>}
      <div className={`lq lq--${q.type}`}>
        <h1 ref={promptRef} className="lq-prompt" tabIndex={-1}>{promptFor(q)}</h1>
        {sub && <p className="lq-sub">{sub}</p>}
        {safety && <p className="lq-safety"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.warn}</svg><span>{safety}</span></p>}
        {layout === 'photo' ? (
          // The mystery photo and, once she answers, its verdict footer, in one rounded card.
          <div className={`lq-card${v ? ` is-answered ${v.right ? 'is-right' : 'is-wrong'}` : ''}`}>
            <Media key={game.i} q={q} still={resumed} onShow={setGlow} />
            {v && <div ref={footRef} className="lq-foot"><PhotoVerdict v={v} glow={glow} vRef={verdictRef} /></div>}
          </div>
        ) : <Media key={game.i} q={q} still={resumed} />}
        <Options q={q} picked={picked} onPick={pick} rapid={game.mode === 'rapid'} round={game.i} still={resumed} folded={folded} />
        {v && layout === 'photo' && <MoreCard q={q} v={v} />}
        {v && (layout === 'card' || layout === 'dock') && <AnswerCard key={`fb-${game.i}`} q={q} v={v} layout={layout} restore={resumed} vRef={verdictRef} />}
        {picked != null && game.mode === 'rapid' && <p className={`lq-verdict lq-fb ${right ? 'is-right' : 'is-wrong'} lq-fb--brief${resumed ? ' no-anim' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true">{right ? QI.tick : QI.cross}</svg><span>{right ? 'Correct.' : `Not quite. It's the ${speciesName(q.focus)}.`}</span></p>}
      </div>
      {game.mode !== 'rapid' && <Dock snap={dockSnap.current} up={!!v} still={resumed} onNext={next} onPlay={play} playing={buttons.on} vRef={verdictRef} />}
    </div>
  );
}

// ---------- review deck ----------
function Deck({ onBack }: { onBack: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);
  // Back from a species page returns to the same card, or to Deck reviewed (v1 renderDeck keeps the deck round while
  // its route matches). The answer stays shown if it was.
  const [saved] = useState(() => {
    const a = activeFor(hereNow(), { deck: true });
    return a?.game ? a as { mode: 'card' | 'done'; game: RoundState; revealed: boolean } : null;
  });
  const [mode, setMode] = useState<'overview' | 'card' | 'done'>(saved?.mode || 'overview');
  const [game, setGame] = useState<RoundState | null>(saved?.game || null);
  const [revealed, setRevealed] = useState(saved?.revealed || false);
  const backRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const resuming = useRef(!!saved);
  // Each card and the Deck reviewed screen put focus on their heading once drawn (v1 drawCard/drawDeckDone focusHead),
  // so grading by keyboard does not drop focus to <body> when the answer it was on goes away.
  const wantHead = useRef(false);
  // Show the answer: focus the answer and bring it into view smoothly, where she is (v1 drawCard data-reveal).
  const wantBack = useRef(false);
  const sightings = useSightings();
  useMedia();
  useEffect(() => {
    if (wantHead.current && headRef.current) {
      headRef.current.focus({ preventScroll: true });
      wantHead.current = false;
    }
    const back = backRef.current;
    if (wantBack.current && back) {
      wantBack.current = false;
      back.focus({ preventScroll: true });
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => back.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
    }
  });

  useEffect(() => { void learnReady().then(() => { setReady(true); force(); }); }, []);
  useEffect(() => {
    if (game && mode !== 'overview') setActive({ deck: true, route: hereNow(), mode, game, revealed });
    else if (getActive()?.deck) setActive(null);
  }, [mode, game, revealed]);
  useRememberScroll(game);
  // Each card and the done screen start at the top (v1 drawn()); showing the answer does not. A card missed and put
  // back is a new queue entry, so it counts as a new card even when it is the only one left.
  useEffect(() => { if (!resuming.current) window.scrollTo(0, 0); }, [game?.queue?.[0], mode]);
  useLookAfterDraw([ready, game, game?.queue?.[0], mode]);
  useEffect(() => {
    if (!ready || !resuming.current) return;
    resuming.current = false;
    if (game) window.scrollTo(0, scrollOf.get(game) || 0);
    headRef.current?.focus({ preventScroll: true });
  }, [ready]);
  const deckKind = (getLearn()?.prefs?.kind as string) || 'animals';
  const due = ready ? dueCards() : [];
  const cards = ready ? allCards() : [];
  const boxN = ready ? boxes() : [0, 0, 0, 0, 0];
  const next = ready ? nextDue() : null;
  const nextTxt = next ? (startOfDay(next.due) <= startOfDay() ? 'More come due later today.' : `Next ones are due ${new Date(next.due).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}.`) : '';

  const startReview = () => {
    const g = newDeckRound(due.slice(0, 20));
    wantHead.current = true;
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
    // v1 renderDeck: what happened is a toast (read out through #announce), and the overview is drawn again.
    toast(n ? `Added ${n} ${n === 1 ? 'card' : 'cards'}.` : which === 'seen' ? (sightings.length ? 'Everything you have seen is already in the deck.' : 'Nothing logged yet. Log a sighting and it can go in the deck.') : 'Those are all in the deck already.');
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
      wantHead.current = true;
      setRevealed(false);
      if (!game.queue!.length) setMode('done');
      force();
    };
    return (
      <div className="lq-screen lq-screen--deck" data-own-topbar>
        <header className="lq-head glass">
          <button type="button" className="iconbtn" data-quit aria-label="Stop reviewing" onClick={() => { setGame(null); setMode('overview'); }}><svg viewBox="0 0 24 24" aria-hidden="true">{QI.close}</svg></button>
          <span className="lq-bar" role="progressbar" aria-label={`Card ${game.n! + 1} of ${game.total}`} aria-valuemin={1} aria-valuemax={game.total} aria-valuenow={game.n! + 1}><span style={{ transform: `scaleX(${(game.n! / Math.max(1, game.total!)).toFixed(3)})` }} /></span>
          <span className="lq-count" aria-hidden="true">{game.queue!.length}<span> left</span></span>
        </header>
        <p className="lq-kicker">Review deck<span>Box {(getLearn()?.cards?.[c.id]?.[c.skill]?.box) || 1}, {c.skill === 'call' ? 'by call' : 'by sight'}</span></p>
        <div className="lq ld-card">
          <h1 ref={headRef} className="lq-prompt" tabIndex={-1}>{c.skill === 'call' ? 'Whose call is this?' : `Which ${KINDS[sp.kind]?.one || 'species'} is this?`}</h1>
          {c.skill === 'call' ? <CallPlayer key={`${c.id}|${c.skill}|${c.reps}|${game.n}|${game.queue!.length}`} call={(Q.callsOf(sp.id) as CallClip[])[0]} seed={sp.id} /> : <PhotoBox key={`${c.id}|${c.skill}|${c.reps}|${game.n}|${game.queue!.length}`} photos={photos} alt={`Mystery ${KINDS[sp.kind]?.one}`} missing={<>This photo needs a connection. Its field notes: {cleanClue(Q.blankNotes(sp))}</>} />}
          {!revealed && <button type="button" className="btn btn--primary btn--block" onClick={() => { wantBack.current = true; setRevealed(true); }}>Show the answer</button>}
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
                <button type="button" className="btn" onClick={() => grade('missed')}><svg viewBox="0 0 24 24" aria-hidden="true">{QI.cross}</svg><span>Missed</span></button>
                <button type="button" className="btn" onClick={() => grade('unsure')}><span>Unsure</span></button>
                <button type="button" className="btn btn--primary" onClick={() => grade('knew')}><svg viewBox="0 0 24 24" aria-hidden="true">{QI.tick}</svg><span>Knew it</span></button>
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
        <header className="page-head"><h1 ref={headRef} className="lh-title" tabIndex={-1}>Deck reviewed</h1></header>
        <ScoreHero round={game} big={t.knew} of="knew it" frac={seenN ? t.knew / seenN : 0} note={`${t.unsure ? `${t.unsure} unsure. ` : ''}${t.missed ? `${t.missed} missed, and they'll come back soon. ` : ''}Cards you knew come back in a few days.`} />
        <div className="lr-actions"><Link className="btn btn--primary btn--block" to="/learn">Back to Learn</Link><button type="button" className="btn btn--block" onClick={() => { setGame(null); setMode('overview'); }}>Deck overview</button></div>
      </div>
    );
  }

  return (
    <>
      <header className="page-head page-head--back"><Link className="iconbtn" to="/learn" aria-label="Back to Learn"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.back}</svg></Link><h1 className="lh-title">Review deck</h1></header>
      <div className="learn">
        <DeckSummary boxN={boxN} cards={cards.length} />
        {due.length ? <button type="button" className="btn btn--primary btn--block" onClick={startReview}>Review {due.length > 20 ? 20 : due.length} {due.length === 1 ? 'card' : 'cards'}</button>
          : <p className="ld-none" role="status">{cards.length ? `Nothing to review right now. ${nextTxt}` : 'Add a set to start. Species you miss in any round are added for you.'}</p>}
        <section className="lh-sec"><div className="lh-sec-h"><h2>Add cards</h2></div>
          <div className="ld-add">
            <button type="button" className="btn btn--block" onClick={() => add('month')}><span className="ld-add-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.facts}</svg></span><span>Add 10 {deckKind === 'animals' ? 'animals' : KINDS[deckKind]?.label.toLowerCase()} around in {monthName()}</span></button>
            <button type="button" className="btn btn--block" onClick={() => add('seen')}><span className="ld-add-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{QI.deck}</svg></span><span>Add the ones I've seen</span></button>
          </div>
          <p className="small muted">Birds and frogs with recordings get a call card as well as a photo card.</p>
        </section>
      </div>
    </>
  );
}

// v1 renderDeck: the boxes grow from nothing each time the overview is drawn, once it is 40% on screen (data-grow and
// growOnView), unless motion is reduced.
function DeckSummary({ boxN, cards }: { boxN: number[]; cards: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [grow] = useState(motionOK);
  const [isIn, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!grow || !el) return;
    if (typeof IntersectionObserver !== 'function') { setIn(true); return; }
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { setIn(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const max = Math.max(1, ...boxN);
  return (
    <div ref={ref} className={`ld-summary${isIn ? ' is-in' : ''}`} {...(grow ? { 'data-grow': '' } : {})}>
      <span className="lh-boxes lh-boxes--big" aria-hidden="true">
        {boxN.map((n, i) => <span className="lh-box" key={i}><b>{n}</b><span className="lh-box-bar"><i style={{ '--h': (n / max).toFixed(3), '--j': i } as React.CSSProperties} /></span><em>{i + 1}</em></span>)}
      </span>
      <p className="small muted">{cards ? `${cards} cards. ${boxN[3] + boxN[4]} in box 4 or 5, which count as mastered.` : 'No cards yet.'} Knew it moves a card along a box: it comes back after 1, 3, 7, then 21 days. Missed sends it back to box 1.</p>
    </div>
  );
}

