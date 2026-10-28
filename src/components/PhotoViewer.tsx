// The full-screen photo viewer. A photo on the page (the species hero's) grows out of its frame into the whole,
// uncropped photo on a dark stage, so Sarah can look closely at a bill, an eye ring or the wing bars:
// - pinch from 1x to 4x around her fingers, double tap for 2.5x at the tap (and back), pan within the photo;
// - at 1x, swipe sideways for the next photo, or drag up or down to put it back: the photo follows the finger, the
//   stage clears, and past 100 px or on a flick it shrinks back into its frame on the page;
// - arrows, + and -, and Escape from the keyboard, with focus kept inside and given back on close.
// It sits on the layer stack (lib/layers.ts), so a change of address closes it at once. It is controlled: the
// caller owns the photo list and the index (onIndex) and says where each photo lives on the page (origin), so the
// same viewer can show her own photos or Scan's reference photos later. Only the photo on show and its neighbours
// are drawn, from the addresses the page already uses. Reduced motion: a 120 ms fade instead of the flight; pinch
// and drag still follow her fingers. Geometry and gesture rules are in photoViewerMath.ts.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, openLayer, type Layer } from '../lib/layers';
import { motionOK, settle } from '../lib/motion';
import { shownPhotos } from './SpeciesImage';
import {
  GAP, IDENTITY, MAX_ZOOM, clamp, clampZoom, doubleTapZoom, dragCloses, dragLook, drawnRect, easeMorph, fitRect, flyFrame,
  intersect, lerpZoom, objectPosition, photoRect, pinchZoom, rubber, rubberScale, softPan, swipeTarget, velocity, zoomAt, zoomCss,
  type Rect, type Zoom,
} from './photoViewerMath';
import './photoViewer.css';

export interface ViewerPhoto {
  /** The photo's address (the large one the page shows). */
  src: string;
  /** A smaller copy of the same photo, shown while the large one loads and kept if it can't (no signal). */
  small?: string | null;
  /** The credit line, drawn in the glass pill (it may hold a link). */
  credit?: ReactNode;
  /** The credit as plain words, for screen readers. */
  creditText?: string;
}

export interface PhotoViewerProps {
  photos: ViewerPhoto[];
  index: number;
  /** She moved to another photo (a swipe or an arrow key). */
  onIndex: (index: number) => void;
  /** The viewer has finished closing; take it off the page. */
  onClose: () => void;
  /** What the photos are of, for "Photo 2 of 6, Crested Pigeon". */
  name: string;
  /** The frame on the page that shows photo `index`: its rect is where the photo grows from and shrinks back into.
   *  Called when the viewer opens and again when it closes, so the caller can bring that photo into view first. */
  origin?: (index: number) => Element | null | undefined;
  /** Where focus goes back to on close (by default, whatever had focus when it opened). */
  returnTo?: Element | null;
}

export const viewerLabel = (i: number, n: number, name: string) => `Photo ${i + 1} of ${n}, ${name}`;

let uid = 0;

export function PhotoViewer({ photos, index, onIndex, onClose, name, origin, returnTo }: PhotoViewerProps) {
  const n = photos.length;
  const i = clamp(index, 0, Math.max(0, n - 1));
  const rootRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ index: i, n, onIndex, onClose, origin });
  live.current = { index: i, n, onIndex, onClose, origin };
  const ctl = useRef<Controller | null>(null);
  const [statusId] = useState(() => `pv-status-${++uid}`);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const c = controller(root, live);
    ctl.current = c;
    const hash = location.hash;
    const layer: Layer = openLayer(root, {
      labelledBy: statusId,
      close: (why) => c.close(why),
      returnTo: returnTo ?? document.activeElement,
    });
    c.open();
    return () => {
      c.destroy();
      ctl.current = null;
      // Closed by a change of address: focus belongs to the new screen.
      closeLayer(layer, { restore: location.hash === hash });
    };
    // Opened once; the photos and index that follow are read through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    ctl.current?.indexChanged(i);
  }, [i, n]);

  const cur = photos[i];
  return createPortal(
    <div className="pv" ref={rootRef} data-photo-viewer="">
      <div className="pv-backdrop" />
      <div className="pv-stage">
        <div className="pv-track">
          {photos.map((ph, k) => (
            <div
              className={`pv-slide${k === i ? ' is-current' : ''}`}
              key={ph.src}
              data-pv={k}
              style={{ left: `calc(${k} * (100% + ${GAP}px))` }}
              aria-hidden={k === i ? undefined : true}
            >
              <div className="pv-zoom">
                {Math.abs(k - i) <= 1 ? <ViewerImage ph={ph} alt={viewerLabel(k, n, name)} /> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pv-top">
        <button type="button" className="pv-close" data-pv-close="" aria-label="Close" onClick={() => ctl.current?.close('button')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
        {n > 1 && <p className="pv-count" aria-hidden="true"><b>{i + 1}</b> / {n}</p>}
      </div>
      {cur?.credit ? <p className="pv-credit">{cur.credit}</p> : null}
      <p className="sr-only" id={statusId} aria-live="polite">
        {viewerLabel(i, n, name)}{cur?.creditText ? `. ${cur.creditText}` : ''}
      </p>
    </div>,
    document.body,
  );
}

type Look = 'wait' | 'in' | 'small' | 'missing';

/**
 * One photo, drawn whole. The small copy (if any) shows soft underneath while the large one loads; if the large one
 * can't load the small one is kept; if neither can, the striped no-photo block shows, as on the page.
 */
function ViewerImage({ ph, alt }: { ph: ViewerPhoto; alt: string }) {
  const [look, setLook] = useState<Look>(() => (shownPhotos.has(ph.src) ? 'in' : 'wait'));
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (look === 'wait' && el?.complete && el.naturalWidth) {
      shownPhotos.add(ph.src);
      setLook('in');
    }
  }, [look, ph.src]);
  if (look === 'missing') return <span className="pv-missing img-missing" role="img" aria-label={alt} />;
  const small = ph.small && ph.small !== ph.src ? ph.small : null;
  return (
    <>
      {small && look === 'wait' ? <img className="pv-img pv-img--soft" src={small} alt="" aria-hidden="true" decoding="async" draggable={false} /> : null}
      <img
        ref={ref}
        className={`pv-img${look === 'wait' ? ' is-wait' : ''}`}
        src={look === 'small' && small ? small : ph.src}
        alt={alt}
        decoding="async"
        draggable={false}
        onLoad={() => {
          if (look === 'wait') {
            // The page's own frame for this photo then draws it at once rather than fading it in again.
            shownPhotos.add(ph.src);
            setLook('in');
          }
        }}
        onError={() => setLook((l) => (l === 'wait' && small ? 'small' : 'missing'))}
      />
    </>
  );
}

// ---------- the imperative part: gestures and motion, run outside React's render ----------

interface Live {
  index: number;
  n: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  origin?: (i: number) => Element | null | undefined;
}
interface Controller {
  open: () => void;
  close: (why?: string) => void;
  indexChanged: (i: number) => void;
  destroy: () => void;
}
type Mode = 'wait' | 'pan' | 'swipe' | 'drag' | 'pinch';
interface Gesture {
  mode: Mode;
  x0: number; y0: number; z0: Zoom;
  m0?: { x: number; y: number }; d0?: number; m?: { x: number; y: number };
  samples: [number, number, number][];
  dx: number; dy: number;
}

const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const DUR = 320;
const viewport = (): Rect => ({ x: 0, y: 0, w: innerWidth, h: innerHeight });
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

/** motion.css's --ease-morph (a linear() curve where supported) for the Web Animations API. */
function morphEasing(el: Element) {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ease-morph').trim();
  if (!v || v.startsWith('var(')) return EASE_OUT;
  try { el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, easing: v }).cancel(); return v; } catch { return EASE_OUT; }
}

/** The part of an element that is on screen: clipped by every ancestor that clips (the hero, the gallery). */
function visibleRect(el: Element): Rect | null {
  let clip = intersect(rectOf(el), viewport());
  for (let p = el.parentElement; p && clip && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clip = intersect(clip, rectOf(p));
  }
  return clip;
}

/** Where a frame on the page draws a photo of this shape: the whole photo's rect, and the part the frame shows. */
function drawnIn(frame: Element, nat: { w: number; h: number } | null) {
  const imgs = [...frame.querySelectorAll('img')].reverse();
  // The photo on show (the large one, or the small copy under it while the large one loads), for the flight's image;
  // the top one sets how the frame draws it (its box, object-fit and object-position).
  const shownImg = imgs.find((im) => {
    if (!im.complete || !im.naturalWidth) return false;
    const s = getComputedStyle(im);
    return s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.5;
  });
  const styled = imgs[0] || null;
  const size = nat || (shownImg ? { w: shownImg.naturalWidth, h: shownImg.naturalHeight } : null);
  const clip = visibleRect(frame);
  if (!size || !clip) return null;
  const box = styled ? rectOf(styled) : rectOf(frame);
  const cs = styled ? getComputedStyle(styled) : null;
  const { px, py } = objectPosition(cs?.objectPosition);
  const at = drawnRect(size.w, size.h, box, cs?.objectFit || 'cover', px, py);
  const radius = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
  return { src: shownImg ? shownImg.currentSrc || shownImg.src : '', nat: size, at, clip: intersect(clip, box) || clip, radius };
}

function controller(root: HTMLDivElement, live: { current: Live }): Controller {
  const back = root.querySelector<HTMLElement>('.pv-backdrop')!;
  const stage = root.querySelector<HTMLElement>('.pv-stage')!;
  const track = root.querySelector<HTMLElement>('.pv-track')!;
  const chrome = () => [...root.querySelectorAll<HTMLElement>('.pv-top, .pv-credit')];
  const canAnimate = typeof root.animate === 'function';

  let phase: 'opening' | 'open' | 'closing' | 'gone' = 'opening';
  let shown = live.current.index;
  let z: Zoom = { ...IDENTITY };
  let trackX = 0;
  let ui = 1;
  let fly: HTMLImageElement | null = null;
  const anims = new Set<Animation>();

  const size = () => ({ W: root.clientWidth || innerWidth, H: root.clientHeight || innerHeight });
  const slideEl = (k = shown) => track.querySelector<HTMLElement>(`[data-pv="${k}"]`);
  const zoomEl = (k = shown) => slideEl(k)?.querySelector<HTMLElement>('.pv-zoom') || null;
  const imgEl = (k = shown) => slideEl(k)?.querySelector<HTMLImageElement>('img.pv-img:not(.pv-img--soft)') || null;
  const natural = (k = shown) => { const im = imgEl(k); return im && im.complete && im.naturalWidth ? { w: im.naturalWidth, h: im.naturalHeight } : null; };
  const fitNow = () => { const { W, H } = size(); const nat = natural(); return fitRect(nat?.w || 0, nat?.h || 0, W, H); };
  const restX = (k: number) => -k * (size().W + GAP);

  const setZoom = (next: Zoom) => {
    z = next;
    const el = zoomEl();
    if (el) el.style.transform = z.s === 1 && !z.x && !z.y ? '' : zoomCss(z);
    root.classList.toggle('is-zoomed', z.s > 1.01);
  };
  const setTrack = (x: number) => { trackX = x; track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`; };
  const setUi = (v: number) => {
    ui = clamp(v, 0, 1);
    if (ui >= 1) root.style.removeProperty('--pv-ui'); else root.style.setProperty('--pv-ui', ui.toFixed(3));
  };
  const setBack = (v: number | null) => { back.style.opacity = v == null ? '' : v.toFixed(3); };
  const backNow = () => parseFloat(getComputedStyle(back).opacity) || 0;

  // The frame on the page this photo goes back into is hidden while the photo flies or is dragged, so it isn't
  // drawn twice; it is shown again once the photo has landed.
  let hidden: HTMLElement | null = null;
  const hideOrigin = (el: HTMLElement | null) => {
    if (hidden === el) return;
    if (hidden) hidden.style.visibility = '';
    hidden = el;
    if (el) el.style.visibility = 'hidden';
  };
  const originOf = (k: number) => (live.current.origin?.(k) as HTMLElement | null | undefined) || null;

  // ---------- frame-by-frame settling (zoom, pan, the track, a drag springing back) ----------
  let tw: { raf: number; frame: (e: number) => void; done?: () => void } | null = null;
  const tween = (dur: number, frame: (e: number) => void, done?: () => void) => {
    finishTween();
    if (!motionOK() || dur <= 0) { frame(1); done?.(); return; }
    const t0 = performance.now();
    const me = { raf: 0, frame, done };
    tw = me;
    const step = (now: number) => {
      if (tw !== me) return;
      const t = Math.min(1, (now - t0) / dur);
      frame(easeMorph(t));
      if (t < 1) { me.raf = requestAnimationFrame(step); return; }
      tw = null;
      done?.();
    };
    me.raf = requestAnimationFrame(step);
  };
  // A new touch takes over from wherever the last motion would have ended.
  function finishTween() {
    const t = tw;
    if (!t) return;
    tw = null;
    cancelAnimationFrame(t.raf);
    t.frame(1);
    t.done?.();
  }
  const animateZoom = (to: Zoom, dur = 280) => { const from = { ...z }; tween(dur, (e) => setZoom(lerpZoom(from, to, e))); };
  const placeTrack = (animated: boolean) => {
    const to = restX(shown), from = trackX;
    if (!animated || Math.abs(to - from) < 0.5) { setTrack(to); return; }
    tween(300, (e) => setTrack(from + (to - from) * e));
  };

  const run = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    const a = el.animate(frames, opts);
    anims.add(a);
    void a.finished.then(() => anims.delete(a), () => anims.delete(a));
    return a;
  };
  const stopAnims = () => { for (const a of anims) a.cancel(); anims.clear(); };
  const makeFly = (src: string, base: Rect, start: { transform: string; clipPath: string }) => {
    fly?.remove();
    const im = document.createElement('img');
    im.className = 'pv-fly';
    im.alt = '';
    im.setAttribute('aria-hidden', 'true');
    im.decoding = 'sync';
    im.src = src;
    im.style.width = `${base.w}px`;
    im.style.height = `${base.h}px`;
    im.style.transform = start.transform;
    im.style.clipPath = start.clipPath;
    root.append(im);
    fly = im;
    return im;
  };
  const clearFly = () => { fly?.remove(); fly = null; root.classList.remove('pv--flying'); };

  // ---------- opening ----------
  async function open() {
    const k = shown;
    setTrack(restX(k));
    root.querySelector<HTMLElement>('.pv-close')?.focus({ preventScroll: true });
    const done = () => {
      if (phase !== 'opening') return;
      stopAnims();
      clearFly();
      setBack(null);
      chrome().forEach((el) => { el.style.opacity = ''; });
      hideOrigin(null);
      phase = 'open';
    };
    if (!canAnimate) { done(); return; }
    const from = motionOK() ? (() => { const o = originOf(k); return o ? { o, d: drawnIn(o, natural(k)) } : null; })() : null;
    if (!from?.d || !from.d.src) {
      // Reduced motion, or nothing on the page to grow from: the viewer fades in where it is.
      run(root, [{ opacity: 0 }, { opacity: 1 }], { duration: motionOK() ? 200 : 120, easing: motionOK() ? EASE_OUT : 'linear' });
      done();
      return;
    }
    const { W, H } = size();
    const base = fitRect(from.d.nat.w, from.d.nat.h, W, H);
    const start = flyFrame(base, from.d.at, from.d.clip, from.d.radius);
    const end = flyFrame(base, base, null, 0);
    setBack(0);
    chrome().forEach((el) => { el.style.opacity = '0'; });
    root.classList.add('pv--flying');
    const im = makeFly(from.d.src, base, start);
    // The same photo the page already drew, so this is quick; it keeps the first frame from being empty.
    await settle(im.decode?.() ?? Promise.resolve(), 120);
    if (phase !== 'opening' || fly !== im) return;
    hideOrigin(from.o);
    const easing = morphEasing(root);
    const flight = run(im, [start, end], { duration: DUR, easing, fill: 'both' });
    run(back, [{ opacity: 0 }, { opacity: 0.96 }], { duration: DUR, easing: EASE_OUT, fill: 'both' });
    for (const el of chrome()) run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 150, easing: EASE_OUT, fill: 'both' });
    await settle(flight.finished, DUR + 400);
    done();
  }

  // ---------- closing ----------
  function finish() {
    if (phase === 'gone') return;
    phase = 'gone';
    stopAnims();
    finishTween();
    clearFly();
    hideOrigin(null);
    live.current.onClose();
  }
  function close(why?: string) {
    if (phase === 'gone') return;
    // A change of address: it goes at once, and the next screen's transition takes over.
    if (why === 'nav') { finish(); return; }
    if (phase === 'closing') return;
    phase = 'closing';
    root.classList.add('pv--closing');
    g = null;
    pts.clear();
    finishTween();
    // Closed while still opening: carry on from where the backdrop had got to.
    const b = backNow();
    stopAnims();
    setBack(b >= 0.95 ? null : b);
    clearFly();
    chrome().forEach((el) => { el.style.opacity = ''; });
    void closeMotion().then(finish, finish);
  }
  async function closeMotion() {
    if (!canAnimate) return;
    const k = shown;
    const nat = natural(k);
    const o = originOf(k);
    const to = motionOK() && o && nat ? drawnIn(o, nat) : null;
    const im = imgEl(k);
    if (!to || !nat || !im) {
      // Reduced motion, or the photo has nowhere on the page to go back to: the viewer fades where it is.
      hideOrigin(null);
      const a = run(root, [{ opacity: 1 }, { opacity: 0 }], { duration: motionOK() ? 200 : 120, easing: 'linear', fill: 'forwards' });
      await settle(a.finished, 600);
      return;
    }
    const { W, H } = size();
    const base = fitRect(nat.w, nat.h, W, H);
    const now = photoRect(base, z, W, H);
    const start = flyFrame(base, now, intersect(now, { x: 0, y: 0, w: W, h: H }), 0);
    const end = flyFrame(base, to.at, to.clip, to.radius);
    hideOrigin(o);
    makeFly(im.currentSrc || im.src, base, start);
    root.classList.add('pv--flying');
    const easing = morphEasing(root);
    const flight = run(fly!, [start, end], { duration: DUR, easing, fill: 'forwards' });
    run(back, [{ opacity: backNow() }, { opacity: 0 }], { duration: DUR - 40, easing: EASE_OUT, fill: 'forwards' });
    for (const el of chrome()) run(el, [{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: 140, easing: 'linear', fill: 'forwards' });
    await settle(flight.finished, DUR + 400);
    // Landed: the frame shows the photo again, and the flying copy fades off it, so the name and scrim over the
    // hero come back softly rather than popping in.
    hideOrigin(null);
    if (fly) await settle(run(fly, [{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'linear', fill: 'forwards' }).finished, 400);
  }

  // ---------- moving between photos ----------
  function go(k: number) {
    const n = live.current.n;
    const to = clamp(k, 0, Math.max(0, n - 1));
    if (to === shown) { placeTrack(true); return; }
    live.current.onIndex(to);
    // If the caller didn't move, the track goes back.
    requestAnimationFrame(() => { if (shown !== to && phase === 'open') placeTrack(true); });
  }
  function indexChanged(k: number) {
    if (k === shown) return;
    finishTween();
    const old = zoomEl(shown);
    if (old) old.style.transform = '';
    shown = k;
    z = { ...IDENTITY };
    root.classList.remove('is-zoomed');
    // Keep the page's gallery on the photo she is looking at, so closing lands in it.
    if (phase === 'open') originOf(k);
    placeTrack(phase === 'open' && motionOK());
  }

  // ---------- gestures (pointer events, no library) ----------
  const pts = new Map<number, { x: number; y: number }>();
  let g: Gesture | null = null;
  let lastTap = { t: -1e9, x: 0, y: 0 };
  const midDist = () => {
    const [a, b] = [...pts.values()];
    return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const endDrag = () => { root.classList.remove('pv--dragging'); };
  const springBack = () => {
    const fromZ = { ...z }, fromB = backNow(), fromU = ui;
    tween(300, (e) => {
      setZoom(lerpZoom(fromZ, IDENTITY, e));
      setBack(fromB + (0.96 - fromB) * Math.min(1, e));
      setUi(fromU + (1 - fromU) * Math.min(1, e));
    }, () => { setBack(null); setUi(1); hideOrigin(null); });
  };
  const settleZoom = (m: { x: number; y: number }) => {
    const { W, H } = size();
    let t = z.s > MAX_ZOOM ? zoomAt(z, MAX_ZOOM, m.x, m.y, W, H) : z;
    t = t.s <= 1.01 ? { ...IDENTITY } : clampZoom(t, fitNow(), W, H);
    animateZoom(t, 300);
  };

  function down(e: PointerEvent) {
    if (phase !== 'open' || (e.pointerType === 'mouse' && e.button !== 0) || pts.size >= 2) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    finishTween();
    if (pts.size === 2) {
      // A second finger turns whatever the first was doing into a pinch.
      if (g?.mode === 'swipe') setTrack(restX(shown));
      if (g?.mode === 'drag') { endDrag(); setZoom({ ...IDENTITY }); setBack(null); setUi(1); hideOrigin(null); }
      const { m, d } = midDist();
      g = { mode: 'pinch', x0: m.x, y0: m.y, z0: { ...z }, m0: m, d0: d, m, samples: [], dx: 0, dy: 0 };
      return;
    }
    g = { mode: 'wait', x0: e.clientX, y0: e.clientY, z0: { ...z }, samples: [[e.timeStamp, e.clientX, e.clientY]], dx: 0, dy: 0 };
  }

  function move(e: PointerEvent) {
    const p = pts.get(e.pointerId);
    if (!p || !g || phase !== 'open') return;
    p.x = e.clientX;
    p.y = e.clientY;
    const { W, H } = size();
    if (g.mode === 'pinch') {
      if (pts.size < 2) return;
      const { m, d } = midDist();
      g.m = m;
      const raw = pinchZoom(g.z0, g.m0!, g.d0!, m, d, W, H);
      const s = rubberScale(raw.s);
      setZoom(softPan(s === raw.s ? raw : zoomAt(raw, s, m.x, m.y, W, H), fitNow(), W, H));
      return;
    }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    g.dx = dx;
    g.dy = dy;
    g.samples.push([e.timeStamp, e.clientX, e.clientY]);
    if (g.samples.length > 12) g.samples.shift();
    if (g.mode === 'wait') {
      if (Math.hypot(dx, dy) < 6) return;
      g.mode = z.s > 1.01 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'drag';
      if (g.mode === 'drag') {
        root.classList.add('pv--dragging');
        hideOrigin(originOf(shown));
      }
    }
    if (g.mode === 'pan') {
      setZoom(softPan({ s: g.z0.s, x: g.z0.x + dx, y: g.z0.y + dy }, fitNow(), W, H));
    } else if (g.mode === 'swipe') {
      const n = live.current.n;
      const edge = (shown <= 0 && dx > 0) || (shown >= n - 1 && dx < 0);
      setTrack(restX(shown) + (edge ? rubber(dx, 0, 80) : dx));
    } else if (g.mode === 'drag') {
      const look = dragLook(dx, dy, H);
      setZoom(look.zoom);
      setBack(look.backdrop);
      setUi(look.ui);
    }
  }

  function up(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g || phase !== 'open') return;
    const { W } = size();
    if (g.mode === 'pinch') {
      if (pts.size === 1) {
        // One finger still down: it carries on panning from here.
        const [p] = [...pts.values()];
        g = { mode: 'pan', x0: p.x, y0: p.y, z0: { ...z }, samples: [[e.timeStamp, p.x, p.y]], dx: 0, dy: 0 };
        return;
      }
      const m = g.m || { x: W / 2, y: size().H / 2 };
      g = null;
      settleZoom(m);
      return;
    }
    if (pts.size) return;
    const s = g;
    g = null;
    const cancelled = e.type === 'pointercancel';
    const { vx, vy } = velocity(s.samples, e.timeStamp);
    if (s.mode === 'wait') { if (!cancelled) tap(e); return; }
    if (s.mode === 'pan') {
      const { W: w, H: h } = size();
      animateZoom(clampZoom({ s: z.s, x: z.x + vx * 160, y: z.y + vy * 160 }, fitNow(), w, h), 360);
      return;
    }
    if (s.mode === 'swipe') { go(cancelled ? shown : swipeTarget(shown, live.current.n, s.dx, vx, W)); return; }
    endDrag();
    if (!cancelled && dragCloses(s.dy, vy)) close('drag');
    else springBack();
  }

  function tap(e: PointerEvent) {
    const t = e.timeStamp;
    if (t - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      lastTap = { t: -1e9, x: 0, y: 0 };
      const { W, H } = size();
      animateZoom(doubleTapZoom(z, e.clientX, e.clientY, fitNow(), W, H), 300);
      return;
    }
    lastTap = { t, x: e.clientX, y: e.clientY };
  }

  function key(e: KeyboardEvent) {
    if (phase !== 'open' || e.altKey || e.ctrlKey || e.metaKey) return;
    const { W, H } = size();
    const zoomed = z.s > 1.01;
    const pan = (dx: number, dy: number) => animateZoom(clampZoom({ s: z.s, x: z.x + dx, y: z.y + dy }, fitNow(), W, H), 200);
    const zoomTo = (s: number) => animateZoom(s <= 1.05 ? { ...IDENTITY } : clampZoom(zoomAt(z, Math.min(MAX_ZOOM, s), W / 2, H / 2, W, H), fitNow(), W, H), 240);
    switch (e.key) {
      case 'ArrowLeft': if (zoomed) pan(W * 0.2, 0); else go(shown - 1); break;
      case 'ArrowRight': if (zoomed) pan(-W * 0.2, 0); else go(shown + 1); break;
      case 'ArrowUp': if (zoomed) pan(0, H * 0.2); break;
      case 'ArrowDown': if (zoomed) pan(0, -H * 0.2); break;
      case '+': case '=': case 'Add': zoomTo(z.s * 1.6); break;
      case '-': case '_': case 'Subtract': zoomTo(z.s / 1.6); break;
      case 'PageUp': case 'PageDown': case 'Home': case 'End': break; // the page behind doesn't scroll
      default: return;
    }
    e.preventDefault();
  }

  // A trackpad pinch (ctrl + wheel) zooms at the pointer; a wheel pans a zoomed photo. The page behind never scrolls.
  function wheel(e: WheelEvent) {
    e.preventDefault();
    if (phase !== 'open') return;
    const { W, H } = size();
    if (e.ctrlKey) {
      const s = clamp(z.s * Math.exp(-e.deltaY * 0.01), 1, MAX_ZOOM);
      setZoom(s <= 1.001 ? { ...IDENTITY } : clampZoom(zoomAt(z, s, e.clientX, e.clientY, W, H), fitNow(), W, H));
    } else if (z.s > 1.01) {
      setZoom(clampZoom({ s: z.s, x: z.x - e.deltaX, y: z.y - e.deltaY }, fitNow(), W, H));
    }
  }

  // iOS Safari zooms the page on its own gesture events whatever touch-action says; touches never scroll it.
  const noGesture = (e: Event) => e.preventDefault();
  const noScroll = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
  const resize = () => {
    if (phase === 'gone') return;
    finishTween();
    setTrack(restX(shown));
    const { W, H } = size();
    setZoom(z.s > 1.01 ? clampZoom(z, fitNow(), W, H) : { ...IDENTITY });
  };

  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  root.addEventListener('keydown', key);
  root.addEventListener('wheel', wheel, { passive: false });
  root.addEventListener('touchmove', noScroll, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, noGesture);
  addEventListener('resize', resize);

  return {
    open: () => { void open(); },
    close,
    indexChanged,
    destroy() {
      if (phase !== 'gone') phase = 'gone';
      if (tw) { cancelAnimationFrame(tw.raf); tw = null; }
      stopAnims();
      clearFly();
      hideOrigin(null);
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      root.removeEventListener('keydown', key);
      root.removeEventListener('wheel', wheel);
      root.removeEventListener('touchmove', noScroll);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(t, noGesture);
      removeEventListener('resize', resize);
    },
  };
}
