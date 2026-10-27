// Calls on the species page, ported from v1's renderBird (birding-refresh js/app.js, getCalls and the Calls block).
// Our own clips come first (they play offline), then the full Atlas of Living Australia recordings (streamed,
// online only), then Wikimedia Commons, which is only searched when there is no local clip.
import { useEffect, useRef, useState } from 'react';
import type { Species } from '../lib/data';
import { audioUrl, calls as commonsCalls, hasLocalCall, localCalls } from '../core/media.js';
import { loadSeq, seq } from '../core/seqdata.js';

export interface Clip {
  src: string;
  title: string;
  artist?: string;
  license?: string;
  page?: string;
  from?: string;
  local?: boolean;
  orig?: string;
  seconds?: number;
}

type SeqCalls = { species?: Record<number, { calls?: Omit<Clip, 'title'>[] }> } | null;
const seqCalls = (id: number) => (seq() as SeqCalls)?.species?.[id]?.calls || [];

async function getCalls(sp: Species): Promise<Clip[]> {
  await Promise.resolve(loadSeq()).catch(() => null);
  const local = (await localCalls(sp.id)) as Clip[];
  const used = new Set(local.map((c) => c.orig));
  const ala: Clip[] = navigator.onLine
    ? seqCalls(sp.id).filter((c) => !used.has(c.src)).map((c) => ({
      ...c, title: `Full ${c.from === 'iNaturalist Australia' ? 'iNaturalist' : c.from} recording`,
    }))
    : [];
  let commons: Clip[] = [];
  if (!local.length) try { commons = (await commonsCalls(sp)) as Clip[]; } catch { /* none found */ }
  return [...local, ...ala, ...commons].slice(0, 4);
}

/** Offline, only species with a local clip can be played. */
export const hasCalls = (id: number) => hasLocalCall(id) || (navigator.onLine && seqCalls(id).length > 0);

type Status = 'loading' | 'ready' | 'empty' | 'failed';

export interface CallPlayer {
  enabled: boolean;
  status: Status;
  emptyText: string;
  list: Clip[];
  playing: number;
  paused: boolean;
  busy: number;
  progress: number;
  viz: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  toggle: (i: number) => void;
  /** The call words' play button plays the first recording, with the same player. */
  playFirst: () => void;
}

/**
 * Two players, as in v1: our clips (and downloaded Commons files) can feed the visualiser; streamed ALA recordings
 * can't, and an element wired to the visualiser plays them silent, so they get a plain one. Blob URLs are revoked
 * when a player moves on and when the page goes (item 70). With reduced motion the visualiser stays off.
 */
export function useCallPlayer(sp: Species, toast: (msg: string) => void): CallPlayer {
  const enabled = sp.kind === 'bird' || sp.kind === 'frog';
  const [status, setStatus] = useState<Status>('loading');
  const [emptyText, setEmptyText] = useState('');
  const [list, setList] = useState<Clip[]>([]);
  const [playing, setPlaying] = useState(-1);
  const [paused, setPaused] = useState(true);
  const [busy, setBusy] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [viz, setViz] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toastRef = useRef(toast);
  const api = useRef<{ toggle: (i: number) => void; ready: Promise<void> } | null>(null);

  useEffect(() => { toastRef.current = toast; }, [toast]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true, stopped = false;
    let clips: Clip[] = [];
    let markReady = () => {};
    const ready = new Promise<void>((r) => { markReady = r; });
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fx = new Audio(), plain = new Audio();
    let audio = fx, current = -1, raf = 0;
    let actx: AudioContext | null = null, analyser: AnalyserNode | null = null;
    const blobOf = new Map<HTMLAudioElement, string>();
    const revokeIfBlob = (u: string) => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); };
    const setSrc = (el: HTMLAudioElement, url: string) => {
      const old = blobOf.get(el);
      if (old && old !== url) URL.revokeObjectURL(old);
      if (url.startsWith('blob:')) blobOf.set(el, url); else blobOf.delete(el);
      el.src = url;
    };
    const vizOff = () => { cancelAnimationFrame(raf); if (alive) setViz(false); };
    const draw = () => {
      const canvas = canvasRef.current, g = canvas?.getContext('2d');
      if (!canvas || !g || !analyser) return;
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue('--azure').trim(), sun = css.getPropertyValue('--sun').trim();
      const tick = () => {
        // The canvas is 0 tall until it is shown, so its size is read each frame rather than once.
        const W = Math.round(canvas.clientWidth * devicePixelRatio), H = Math.round(canvas.clientHeight * devicePixelRatio);
        if (canvas.width !== W) canvas.width = W;
        if (canvas.height !== H) canvas.height = H;
        analyser!.getByteFrequencyData(bins);
        g.clearRect(0, 0, W, H);
        const n = 48, bw = W / n;
        for (let i = 0; i < n; i++) {
          const v = bins[Math.floor(i * bins.length * 0.5 / n)] / 255;
          g.fillStyle = v > 0.7 ? sun : accent;
          const h = Math.max(2, v * H);
          g.fillRect(i * bw + 1, H - h, bw - 2, h);
        }
        raf = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(raf);
      tick();
    };
    const sync = () => { if (!alive) return; setPlaying(current); setPaused(audio.paused); };
    for (const el of [fx, plain]) {
      el.addEventListener('timeupdate', () => {
        if (alive && el === audio && el.duration) setProgress((el.currentTime / el.duration) * 100);
      });
      for (const ev of ['play', 'pause', 'ended']) el.addEventListener(ev, sync);
      el.addEventListener('ended', vizOff);
      el.addEventListener('error', () => {
        if (stopped || el !== audio || !el.getAttribute('src')) return;
        toastRef.current(navigator.onLine ? 'That recording would not play. Try another.' : 'That call is not saved on this phone yet. Save calls in Settings.');
        // A failed load fires no pause event, so the button would keep saying Pause. Reset it; a tap tries again.
        current = -1;
        vizOff();
        if (alive) { setPlaying(-1); setPaused(true); }
      });
    }
    fx.addEventListener('play', () => { if (alive && analyser && !reduce) setViz(true); });

    const toggle = async (i: number) => {
      if (!clips[i]) return;
      if (i === current) {
        if (audio.paused) audio.play().catch(() => {}); else audio.pause();
        return;
      }
      current = i;
      setPlaying(i);
      setBusy(i);
      const url = (await audioUrl(clips[i].src)) as string;
      if (!alive) { revokeIfBlob(url); return; }
      setBusy((b) => (b === i ? -1 : b));
      if (current !== i) { revokeIfBlob(url); return; }
      // The visualiser can only read audio from this site or downloaded blobs.
      const readable = url.startsWith('blob:') || !!clips[i].local;
      audio.pause();
      audio = readable ? fx : plain;
      if (readable && !reduce) {
        try {
          if (!actx) {
            actx = new AudioContext();
            analyser = actx.createAnalyser();
            analyser.fftSize = 256;
            actx.createMediaElementSource(fx).connect(analyser);
            analyser.connect(actx.destination);
          }
          void actx.resume().catch(() => {});
          draw();
        } catch { /* no visualiser */ }
      } else vizOff();
      setProgress(0);
      setSrc(audio, url);
      audio.play().catch(() => {});
      sync();
    };
    api.current = { toggle: (i) => { void toggle(i); }, ready };

    getCalls(sp)
      .then((found) => {
        if (!alive) return;
        clips = found;
        setList(found);
        if (found.length) { setStatus('ready'); return; }
        setEmptyText(!navigator.onLine ? 'Calls for this one need an internet connection.'
          : sp.kind === 'bird' ? 'No free recording found for this bird. Try the xeno-canto link below.' : '');
        setStatus('empty');
      })
      .catch(() => { if (alive) setStatus('failed'); })
      .finally(markReady);

    return () => {
      alive = false;
      stopped = true;
      for (const el of [fx, plain]) { el.pause(); el.removeAttribute('src'); }
      for (const u of blobOf.values()) URL.revokeObjectURL(u);
      blobOf.clear();
      cancelAnimationFrame(raf);
      if (actx) void actx.close().catch(() => {});
      api.current = null;
    };
  }, [enabled, sp]);

  return {
    enabled, status, emptyText, list, playing, paused, busy, progress, viz, canvasRef,
    toggle: (i) => api.current?.toggle(i),
    playFirst: () => { const a = api.current; if (a) void a.ready.then(() => api.current?.toggle(0)); },
  };
}

export const PlayIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>;

// Credit line for a recording. Our clips are cut down from the original, which the licence asks us to say.
function CallCredit({ c }: { c: Clip }) {
  const who = String(c.artist || 'Unknown').slice(0, 50);
  return (
    <>
      By {c.page ? <a href={c.page} target="_blank" rel="noopener">{who}</a> : who}{c.license ? `, ${c.license}` : ''}.
      {c.local ? ` Trimmed from the ${c.from === 'iNaturalist Australia' ? 'iNaturalist' : 'original'} recording.` : ''}
    </>
  );
}

export function CallsSection({ p }: { p: CallPlayer }) {
  if (!p.enabled) return null;
  let body: React.ReactNode;
  if (p.status === 'loading') body = <><h2 className="h2">Calls</h2><p className="muted small">Looking for recordings…</p></>;
  else if (p.status === 'failed') body = <><h2 className="h2">Calls</h2><p className="muted small">Calls need an internet connection the first time.</p></>;
  else if (p.status === 'empty') body = p.emptyText ? <><h2 className="h2">Calls</h2><p className="muted small">{p.emptyText}</p></> : null;
  else {
    body = (
      <>
        <h2 className="h2">Calls</h2>
        <canvas className={`viz${p.viz ? ' on' : ''}`} ref={p.canvasRef} aria-hidden="true" />
        {p.list.map((c, i) => {
          const on = i === p.playing && !p.paused;
          return (
            <div className="call-row" key={`${c.src}-${i}`}>
              <button type="button" className={`playbtn${p.busy === i ? ' loading' : ''}`} data-play={i}
                aria-label={on ? `Pause recording ${i + 1}` : `Play recording ${i + 1}`} onClick={() => p.toggle(i)}>
                {on ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div className="call-meta">
                <span className="call-title">{String(c.title || 'Recording').slice(0, 70)}</span>
                <span className="small muted call-credit"><CallCredit c={c} /></span>
                <span className="call-progress"><span style={{ width: i === p.playing ? `${p.progress}%` : '0' }} /></span>
              </div>
            </div>
          );
        })}
      </>
    );
  }
  return <section className="call" data-calls="" aria-live="polite">{body}</section>;
}
