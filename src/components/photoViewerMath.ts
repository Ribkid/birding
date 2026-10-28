// Geometry and gesture rules for the full-screen photo viewer (PhotoViewer.tsx). Pure functions, so they can be
// tested without a browser. Rects are in CSS pixels; a zoom is the photo's scale and how far its centre has moved
// from the centre of the stage.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Zoom { s: number; x: number; y: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const TAP_ZOOM = 2.5;
/** The gap between photos on the swipe track. */
export const GAP = 16;
/** A vertical drag at 1x that goes further than this (or is flicked) closes the viewer. */
export const CLOSE_DRAG = 100;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const IDENTITY: Zoom = { s: 1, x: 0, y: 0 };

/** The whole photo drawn in a W×H box (object-fit: contain), centred. */
export function fitRect(nw: number, nh: number, W: number, H: number): Rect {
  if (!(nw > 0 && nh > 0 && W > 0 && H > 0)) return { x: 0, y: 0, w: W, h: H };
  const k = Math.min(W / nw, H / nh);
  const w = nw * k, h = nh * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/**
 * Where the whole photo lies when a frame draws it with object-fit (cover crops it, contain letterboxes it) at
 * object-position px py (0 to 1). With cover the photo is larger than the frame and the frame clips it.
 */
export function drawnRect(nw: number, nh: number, frame: Rect, fit: string = 'cover', px = 0.5, py = 0.5): Rect {
  if (!(nw > 0 && nh > 0)) return { ...frame };
  const k = fit === 'contain' || fit === 'scale-down' ? Math.min(frame.w / nw, frame.h / nh)
    : fit === 'fill' ? NaN : Math.max(frame.w / nw, frame.h / nh);
  if (Number.isNaN(k)) return { ...frame };
  const w = nw * k, h = nh * k;
  return { x: frame.x + (frame.w - w) * px, y: frame.y + (frame.h - h) * py, w, h };
}

/** CSS object-position as fractions ('50% 38%' is { px: .5, py: .38 }); keywords and percentages only. */
export function objectPosition(value: string | null | undefined): { px: number; py: number } {
  const word: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  const read = (p: string | undefined) => (p == null ? 0.5 : p in word ? word[p] : /%$/.test(p) ? parseFloat(p) / 100 : 0.5);
  let [a, b] = parts;
  if (a === 'top' || a === 'bottom') [a, b] = [b, a];
  return { px: read(a), py: read(b) };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

/** How far the photo's centre can move at scale s before an edge comes inside the stage. */
export function panLimits(fit: Rect, s: number, W: number, H: number) {
  return { x: Math.max(0, (fit.w * s - W) / 2), y: Math.max(0, (fit.h * s - H) / 2) };
}

/** Clamped to 1x to 4x, and panned no further than the photo's edges. */
export function clampZoom(z: Zoom, fit: Rect, W: number, H: number): Zoom {
  const s = clamp(z.s, MIN_ZOOM, MAX_ZOOM);
  const l = panLimits(fit, s, W, H);
  return { s, x: clamp(z.x, -l.x, l.x), y: clamp(z.y, -l.y, l.y) };
}

/** Past a limit the photo follows the finger less and less, as a rubber band does. */
export function rubber(v: number, lim: number, reach = 120) {
  const over = Math.abs(v) - lim;
  if (over <= 0) return v;
  return Math.sign(v) * (lim + reach * (1 - 1 / (over / reach + 1)));
}
/** The same for scale, below 1x and above 4x while her fingers are still down. */
export function rubberScale(s: number) {
  if (s < MIN_ZOOM) return MIN_ZOOM - 0.4 * (1 - 1 / ((MIN_ZOOM - s) / 0.4 + 1));
  if (s > MAX_ZOOM) return MAX_ZOOM + 1.2 * (1 - 1 / ((s - MAX_ZOOM) / 1.2 + 1));
  return s;
}
/** Panning while her fingers are down: free within the photo, rubber-banded past its edges. */
export function softPan(z: Zoom, fit: Rect, W: number, H: number): Zoom {
  const l = panLimits(fit, Math.max(1, z.s), W, H);
  return { s: z.s, x: rubber(z.x, l.x), y: rubber(z.y, l.y) };
}

/** Scale to s2 keeping the stage point (px, py) still: what is under the finger stays under it. */
export function zoomAt(z: Zoom, s2: number, px: number, py: number, W: number, H: number): Zoom {
  const cx = px - W / 2, cy = py - H / 2, r = s2 / z.s;
  return { s: s2, x: cx - (cx - z.x) * r, y: cy - (cy - z.y) * r };
}

/** Two fingers: the scale follows their spread, and the point between them carries the photo. */
export function pinchZoom(z0: Zoom, m0: { x: number; y: number }, d0: number, m: { x: number; y: number }, d: number, W: number, H: number): Zoom {
  const s = z0.s * (d / Math.max(1, d0));
  const r = s / z0.s;
  const c0x = m0.x - W / 2, c0y = m0.y - H / 2, cx = m.x - W / 2, cy = m.y - H / 2;
  return { s, x: cx - (c0x - z0.x) * r, y: cy - (c0y - z0.y) * r };
}

/** A double tap: back to 1x when zoomed, otherwise 2.5x at the tap, kept within the photo. */
export function doubleTapZoom(z: Zoom, px: number, py: number, fit: Rect, W: number, H: number): Zoom {
  if (z.s > 1.01) return { ...IDENTITY };
  return clampZoom(zoomAt(z, TAP_ZOOM, px, py, W, H), fit, W, H);
}

/** Where the photo is on screen under a zoom. */
export function photoRect(fit: Rect, z: Zoom, W: number, H: number): Rect {
  const w = fit.w * z.s, h = fit.h * z.s;
  return { x: W / 2 + z.x - w / 2, y: H / 2 + z.y - h / 2, w, h };
}

/**
 * The photo a swipe lands on: past 18% of the width or a flick moves one photo on, in her direction, from `index`
 * (the photo on show, or the one the track was sliding to when her finger caught it); a shorter one settles on the
 * photo nearest to where the track is (`off`, from index's rest: dx, or more if she caught it part way); the ends
 * hold.
 */
export function swipeTarget(index: number, count: number, dx: number, vx: number, W: number, off = dx) {
  const far = Math.abs(dx) > W * 0.18;
  const flick = Math.abs(vx) > 0.35 && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > 8;
  const to = far || flick ? index + (dx < 0 ? 1 : -1) : index + Math.round(-off / (W + GAP));
  return clamp(to, 0, Math.max(0, count - 1));
}

/** A vertical drag closes past 100 px, or on a flick in the direction she is dragging. */
export function dragCloses(dy: number, vy: number) {
  return Math.abs(dy) > CLOSE_DRAG || (Math.abs(vy) > 0.5 && Math.sign(vy) === Math.sign(dy) && Math.abs(dy) > 12);
}

/** How far a drag to close has gone (0 to 1), and what it does to the photo, the backdrop and the controls. */
export function dragLook(dx: number, dy: number, H: number) {
  const p = clamp(Math.abs(dy) / Math.max(1, H * 0.5), 0, 1);
  return { p, zoom: { s: 1 - 0.18 * p, x: dx * 0.7, y: dy } as Zoom, backdrop: 0.96 * (1 - p), ui: clamp(1 - Math.abs(dy) / 90, 0, 1) };
}

/** Velocity in px/ms over the last 100 ms of samples [time, x, y]. */
export function velocity(samples: [number, number, number][], now?: number) {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  const t = now ?? last[0];
  const first = samples.find(([ts]) => t - ts <= 100) || samples[0];
  const dt = Math.max(1, last[0] - first[0]);
  return { vx: (last[1] - first[1]) / dt, vy: (last[2] - first[2]) / dt };
}

/**
 * One frame of the photo flying between a frame on the page and the viewer. The flying image is laid out at the
 * base size (the photo fitted to the viewer) from the top left corner; this places it over `at` (the whole photo's
 * rect) and clips it to `clip` (the part a frame shows), both on screen. Every frame names all four insets and a
 * radius, so the browser can interpolate between them.
 */
export function flyFrame(base: { w: number; h: number }, at: Rect, clip: Rect | null, radius = 0) {
  const k = at.w / Math.max(1, base.w);
  const c = clip || at;
  const px = (v: number) => `${Math.max(0, v / k).toFixed(2)}px`;
  return {
    transform: `translate(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px) scale(${k.toFixed(5)})`,
    clipPath: `inset(${px(c.y - at.y)} ${px(at.x + at.w - c.x - c.w)} ${px(at.y + at.h - c.y - c.h)} ${px(c.x - at.x)} round ${px(radius)})`,
  };
}

// --ease-morph from motion.css, for motion run frame by frame (zoom, pan and swipe settling).
const MORPH: [number, number][] = [[0, 0], [0.1, 0.24], [0.2, 0.46], [0.3, 0.64], [0.4, 0.78], [0.5, 0.875], [0.6, 0.94], [0.7, 0.985], [0.8, 1.008], [0.9, 1.006], [1, 1]];
export function easeMorph(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  for (let i = 1; i < MORPH.length; i++) {
    const [t1, v1] = MORPH[i];
    if (t <= t1) {
      const [t0, v0] = MORPH[i - 1];
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
    }
  }
  return 1;
}

export const lerpZoom = (a: Zoom, b: Zoom, e: number): Zoom => ({ s: a.s + (b.s - a.s) * e, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
export const zoomCss = (z: Zoom) => `translate3d(${z.x.toFixed(2)}px, ${z.y.toFixed(2)}px, 0) scale(${z.s.toFixed(4)})`;
