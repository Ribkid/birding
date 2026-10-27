import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PhotoRef } from '../../lib/data';

export const QI = {
  close: <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />,
  playCircle: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5l6 3.5-6 3.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  warn: <><path d="M12 4l9 16H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  deck: <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  compare: <path d="M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  image: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5M15.5 9.5h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
};

const credit = (p?: PhotoRef | null) => (p ? `Photo: ${String(p.credit || 'Unknown').slice(0, 50)}${p.license ? `, ${p.license}` : ''}` : '');

/** A quiz photo with the same fall-back chain as v1: if a host fails, try the next picture, then say why not. */
export function PhotoBox({ photos, alt = '', cls = 'lq-photo', missing = '', style }: {
  photos?: PhotoRef[] | null; alt?: string; cls?: string; missing?: ReactNode; style?: CSSProperties;
}) {
  const list = photos || [];
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [photos?.[0]?.src]);
  const p = list[i];
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

/** Every player currently holding audio, so a question change can silence the old clip. */
const live = new Set<HTMLAudioElement>();
export function stopCalls() {
  for (const a of live) { a.pause(); }
  live.clear();
}

/** The big call player: progress ring, play/pause and a moving waveform. */
export function CallPlayer({ call, seed, extra, onFail }: { call?: CallClip | null; seed: string | number; extra?: ReactNode; onFail?: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [progress, setProgress] = useState(0);
  const [failMsg, setFailMsg] = useState('');
  useEffect(() => () => {
    audio.current?.pause();
    if (audio.current) live.delete(audio.current);
    audio.current = null;
    setState('idle');
    setProgress(0);
    setFailMsg('');
  }, [call?.src, call?.local]);
  const toggle = async () => {
    if (!call?.src && !call?.local) return;
    if (state === 'loading') return;
    setFailMsg('');
    if (audio.current && state === 'playing') { audio.current.pause(); setState('idle'); return; }
    if (audio.current && state === 'idle') { await audio.current.play().catch(() => {}); setState('playing'); return; }
    setState('loading');
    const a = new Audio(call.local || call.src);
    audio.current = a;
    live.add(a);
    a.onended = () => { setState('idle'); setProgress(0); live.delete(a); };
    a.onerror = () => {
      setState('idle');
      live.delete(a);
      setFailMsg(navigator.onLine ? 'That recording would not play.' : 'This recording needs a connection.');
      onFail?.();
    };
    a.ontimeupdate = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
    try { await a.play(); setState('playing'); } catch {
      setState('idle');
      setFailMsg(navigator.onLine ? 'That recording would not play.' : 'This recording needs a connection.');
      onFail?.();
    }
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
