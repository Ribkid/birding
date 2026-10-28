import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PhotoRef } from '../../lib/data';
import { toast } from '../../lib/toast';

export const QI = {
  close: <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />,
  playCircle: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5l6 3.5-6 3.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  warn: <><path d="M12 4l9 16H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  deck: <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  // v1 I.facts: a calendar, on the deck's 'Add 10 … around in <month>' button.
  facts: <path d="M5 6h14v14H5zM5 10h14M9 3.5V7M15 3.5V7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  compare: <path d="M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  image: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5M15.5 9.5h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
};

const credit = (p?: PhotoRef | null) => (p ? `Photo: ${String(p.credit || 'Unknown').slice(0, 50)}${p.license ? `, ${p.license}` : ''}` : '');

/** A quiz photo with the same fall-back chain as v1: if a host fails, try the next picture, then say why not.
 * onShow hears which picture is on screen (null when none is), so the answer's glass can be tinted from it. */
export function PhotoBox({ photos, alt = '', cls = 'lq-photo', missing = '', style, onShow }: {
  photos?: PhotoRef[] | null; alt?: string; cls?: string; missing?: ReactNode; style?: CSSProperties; onShow?: (src: string | null) => void;
}) {
  const list = photos || [];
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [photos?.[0]?.src]);
  const p = list[i];
  useEffect(() => { onShow?.(p?.src || null); }, [p?.src]);
  if (!p) return <figure className={`${cls} is-missing`}><span className="lq-nophoto">{missing || 'No photo saved on this phone.'}</span></figure>;
  return (
    <figure className={cls} style={style}>
      <span className="whole">
        <img className="whole-bg" src={p.src} alt="" aria-hidden="true" decoding="async" />
        <img className="whole-fg" src={p.src} alt={alt} decoding="async" onError={() => setI((n) => n + 1)} />
      </span>
      <figcaption className="lq-credit">{credit(p)}</figcaption>
    </figure>
  );
}

/** Slightly blurred silhouette filter, as in v1 (a drawing filter, not a pixel read). */
export function SilhouetteFilter() {
  const ink = [0.075, 0.125, 0.114], ground = [0.914, 0.937, 0.925];
  return (
    <svg className="lq-defs" aria-hidden="true" focusable="false">
      <filter id="lq-sil" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="2" />
        <feColorMatrix type="matrix" values=".2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 0 0 0 1 0" />
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues={[...Array(5).fill(ink[0]), ...Array(6).fill(ground[0])].join(' ')} />
          <feFuncG type="discrete" tableValues={[...Array(5).fill(ink[1]), ...Array(6).fill(ground[1])].join(' ')} />
          <feFuncB type="discrete" tableValues={[...Array(5).fill(ink[2]), ...Array(6).fill(ground[2])].join(' ')} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

function Wave({ seed }: { seed: string }) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let x = h >>> 0;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  return (
    <span className="lq-wave" aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => {
        const env = Math.sin(Math.PI * (i + 0.5) / 32) ** 0.6;
        return <i key={i} style={{ '--h': (0.16 + 0.84 * env * (0.3 + 0.7 * rnd())).toFixed(2), '--j': i % 7 } as CSSProperties} />;
      })}
    </span>
  );
}

export interface CallClip { src: string; local?: string; artist?: string; license?: string; seconds?: number }

/** How to stop each player holding a clip (the big call player and the feedback's play buttons). Like v1's single
 * audio, only one clip plays at a time: starting one stops the others, and a question change stops them all. */
const live = new Set<() => void>();
export function stopCalls() {
  for (const stop of [...live]) stop();
  live.clear();
}
/** Stop every other player before this one plays. */
function claim(stop: () => void) {
  for (const s of [...live]) if (s !== stop) s();
  live.clear();
  live.add(stop);
}
const failText = () => (navigator.onLine ? 'That recording would not play.' : 'This recording needs a connection.');

/** The big call player: progress ring, play/pause and a moving waveform. */
export function CallPlayer({ call, seed, extra, onFail }: { call?: CallClip | null; seed: string | number; extra?: ReactNode; onFail?: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [progress, setProgress] = useState(0);
  const [failMsg, setFailMsg] = useState('');
  // Stopped by another clip, a new question or leaving: back to the start, as v1's stopAudio resets the button and ring.
  const [halt] = useState(() => function halt() {
    const a = audio.current;
    if (a) { a.onended = null; a.onerror = null; a.ontimeupdate = null; a.pause(); }
    audio.current = null;
    live.delete(halt);
    setState('idle');
    setProgress(0);
  });
  useEffect(() => () => { halt(); setFailMsg(''); }, [call?.src, call?.local, halt]);
  const toggle = async () => {
    if (!call?.src && !call?.local) return;
    if (state === 'loading') return;
    setFailMsg('');
    const cur = audio.current;
    if (cur && state === 'playing') { cur.pause(); setState('idle'); return; }
    if (cur) {
      claim(halt);
      await cur.play().catch(() => {});
      if (audio.current === cur) setState('playing');
      return;
    }
    claim(halt);
    setState('loading');
    const a = new Audio(call.local || call.src);
    audio.current = a;
    const fail = () => {
      if (audio.current !== a) return; // stopped on purpose (Next, another clip): not a failure
      audio.current = null;
      live.delete(halt);
      setState('idle');
      setFailMsg(failText());
      onFail?.();
    };
    a.onended = () => { setState('idle'); setProgress(0); live.delete(halt); };
    a.onerror = fail;
    a.ontimeupdate = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
    try { await a.play(); if (audio.current === a) setState('playing'); } catch { fail(); }
  };
  return (
    <div className="lq-call">
      <span className="lq-player">
        <svg className="lq-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="54" pathLength="100" />
          <circle className="lq-ring-fg" cx="60" cy="60" r="54" pathLength="100" style={{ strokeDashoffset: 100 - progress * 100 }} />
        </svg>
        <button type="button" className={`lq-play${state === 'loading' ? ' is-loading' : ''}${state === 'playing' ? ' is-playing' : ''}`} aria-label={state === 'playing' ? 'Pause the call' : 'Play the call'} onClick={toggle}>
          <span><svg viewBox="0 0 24 24" aria-hidden="true">{state === 'playing' ? QI.pause : QI.play}</svg></span>
        </button>
      </span>
      <Wave seed={String(seed)} />
      <p className="lq-status" aria-live="polite">{failMsg || (state === 'playing' ? 'Playing' : state === 'loading' ? 'Loading the call…' : 'Tap to listen')}</p>
      {call?.artist && <p className="lq-credit">Recording: {String(call.artist || 'Unknown').slice(0, 50)}{call.license ? `, ${call.license}` : ''}</p>}
      {extra}
    </div>
  );
}

export type PlayButtonState = { key: string; state: 'loading' | 'playing' | 'paused' } | null;
/** The answer's 'Hear it again', 'Hear its call' and 'Hear the one you picked' buttons (v1 playCall on a [data-play]
 * button). A tap stops any other clip, the big player included, and plays this one at once; the button shows it
 * loading, then the pause icon while it plays. Tapping the same button again pauses it, and again carries on. */
export function usePlayButtons() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState<PlayButtonState>(null);
  const [halt] = useState(() => function halt() {
    const a = audio.current;
    if (a) { a.onended = null; a.onerror = null; a.pause(); }
    audio.current = null;
    live.delete(halt);
    setOn(null);
  });
  useEffect(() => halt, [halt]);
  const toggle = (key: string, clip?: CallClip | null) => {
    const cur = audio.current;
    if (cur && on?.key === key) {
      if (on.state === 'loading') return;
      if (cur.paused) {
        claim(halt);
        cur.play().then(() => { if (audio.current === cur) setOn({ key, state: 'playing' }); }).catch(() => {});
      } else {
        cur.pause();
        setOn({ key, state: 'paused' });
      }
      return;
    }
    if (!clip?.src && !clip?.local) return;
    halt();
    claim(halt);
    const a = new Audio(clip.local || clip.src);
    audio.current = a;
    setOn({ key, state: 'loading' });
    const done = () => {
      if (audio.current !== a) return false; // stopped on purpose (Next, another clip): not a failure
      audio.current = null;
      live.delete(halt);
      setOn(null);
      return true;
    };
    // v1 playCall's fail(): these buttons have no status line of their own, so the reason goes out as a toast.
    const fail = () => { if (done()) toast(failText()); };
    a.onended = done;
    a.onerror = fail;
    a.play().then(() => { if (audio.current === a) setOn({ key, state: 'playing' }); }).catch(fail);
  };
  return { on, toggle, stop: halt };
}

/** A play button as a round chip in the answer dock: the icon swaps to pause while it plays, and a small tick or cross
 * says whose call it is (the right answer's, or the one she picked), matching the marks on the answers. */
export function PlayChip({ on, which, label, tone, onPlay, style }: {
  on: PlayButtonState; which: string; label: string; tone: 'right' | 'wrong' | 'plain'; onPlay: (which: string) => void; style?: CSSProperties;
}) {
  const st = on?.key === which ? on.state : null;
  return (
    <button type="button" className={`lq-chip lq-chip--${tone}${st === 'playing' ? ' is-playing' : st === 'loading' ? ' is-loading' : ''}`} data-play={which} aria-label={label} title={label} style={style} onClick={() => onPlay(which)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{st === 'playing' ? QI.pause : QI.play}</svg>
      {tone !== 'plain' && <span className="lq-chip-tag" aria-hidden="true"><svg viewBox="0 0 24 24">{tone === 'right' ? QI.tick : QI.cross}</svg></span>}
    </button>
  );
}

/** One of the answer's play buttons, drawn as v1's: the icon swaps to pause while it plays. */
export function PlayButton({ on, which, label, onPlay }: { on: PlayButtonState; which: string; label: string; onPlay: (which: string) => void }) {
  const st = on?.key === which ? on.state : null;
  return (
    <button type="button" className={`btn lq-act${st === 'playing' ? ' is-playing' : st === 'loading' ? ' is-loading' : ''}`} data-play={which} onClick={() => onPlay(which)}>
      <span data-ic><svg viewBox="0 0 24 24" aria-hidden="true">{st === 'playing' ? QI.pause : QI.play}</svg></span>
      <span data-label>{label}</span>
    </button>
  );
}
