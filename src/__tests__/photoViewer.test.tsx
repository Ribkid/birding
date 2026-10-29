// @vitest-environment jsdom
// The full-screen photo viewer: its geometry (contain, cover, zoom about a point, pinch, pan limits, the flight's
// frames) and its behaviour as a layer (label, focus, Escape and Close, keys, double tap, swipe, drag to close,
// neighbours only, iOS gesture events, the missing state). Motion is reduced here so every settle is immediate.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // lib/motion.ts reads prefers-reduced-motion when it loads.
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  });
});

import { PhotoViewer, viewerLabel, type ViewerPhoto } from '../components/PhotoViewer';
import {
  CLOSE_DRAG, GAP, IDENTITY, MAX_ZOOM, TAP_ZOOM, clampZoom, doubleTapZoom, dragCloses, drawnRect, easeMorph, fitRect, flyFrame,
  objectPosition, panLimits, photoRect, pinchZoom, rubber, swipeTarget, velocity, zoomAt,
} from '../components/photoViewerMath';
import { closeAllLayers, layers } from '../lib/layers';

describe('photo viewer geometry', () => {
  it('fits the whole photo in the stage, centred', () => {
    expect(fitRect(1600, 900, 390, 844)).toEqual({ x: 0, y: (844 - 219.375) / 2, w: 390, h: 219.375 });
    const tall = fitRect(600, 900, 390, 844);
    expect(tall.h).toBe(585);
    expect(tall.y).toBeCloseTo((844 - 585) / 2);
    expect(fitRect(0, 0, 390, 844)).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });

  it('places the whole photo as object-fit cover draws it in the hero (50% 38%)', () => {
    const frame = { x: 0, y: 0, w: 390, h: 506 };
    const r = drawnRect(960, 640, frame, 'cover', 0.5, 0.38);
    expect(r.h).toBeCloseTo(506);
    expect(r.w).toBeCloseTo(759);
    expect(r.x).toBeCloseTo((390 - 759) / 2);
    // A tall photo is cropped top and bottom, 38% of the overflow above.
    const t = drawnRect(400, 800, frame, 'cover', 0.5, 0.38);
    expect(t.w).toBe(390);
    expect(t.y).toBeCloseTo((506 - 780) * 0.38);
    // Contain letterboxes inside the frame instead.
    expect(drawnRect(960, 640, frame, 'contain').w).toBe(390);
  });

  it('reads object-position as fractions', () => {
    expect(objectPosition('50% 38%')).toEqual({ px: 0.5, py: 0.38 });
    expect(objectPosition('left top')).toEqual({ px: 0, py: 0 });
    expect(objectPosition('top right')).toEqual({ px: 1, py: 0 });
    expect(objectPosition('')).toEqual({ px: 0.5, py: 0.5 });
  });

  it('zooms about a point: what is under the finger stays under it', () => {
    const W = 390, H = 844;
    const z = zoomAt(IDENTITY, 3, 100, 300, W, H);
    // The photo point under (100, 300) before zooming...
    const u = { x: (100 - W / 2 - 0) / 1, y: (300 - H / 2 - 0) / 1 };
    // ...is drawn at the same place after.
    expect(W / 2 + z.x + u.x * z.s).toBeCloseTo(100);
    expect(H / 2 + z.y + u.y * z.s).toBeCloseTo(300);
  });

  it('pinches from the spread of two fingers and carries the photo with their midpoint', () => {
    const W = 390, H = 844;
    const z = pinchZoom(IDENTITY, { x: 195, y: 400 }, 100, { x: 215, y: 400 }, 300, W, H);
    expect(z.s).toBeCloseTo(3);
    // The point between the fingers moved 20 px right and the photo point under it came along.
    const u = (195 - W / 2) / 1;
    expect(W / 2 + z.x + u * z.s).toBeCloseTo(215);
  });

  it('keeps a zoomed photo within its edges and between 1x and 4x', () => {
    const W = 390, H = 844, fit = fitRect(960, 640, W, H);
    const l = panLimits(fit, 3, W, H);
    expect(l.x).toBeCloseTo((390 * 3 - 390) / 2);
    expect(l.y).toBeCloseTo(Math.max(0, (260 * 3 - 844) / 2));
    const z = clampZoom({ s: 9, x: 5000, y: -5000 }, fit, W, H);
    expect(z.s).toBe(MAX_ZOOM);
    const lim = panLimits(fit, MAX_ZOOM, W, H);
    expect(z.x).toBeCloseTo(lim.x);
    expect(z.y).toBeCloseTo(-lim.y);
    expect(clampZoom({ s: 0.5, x: 40, y: 40 }, fit, W, H)).toEqual({ s: 1, x: 0, y: 0 });
    // Past an edge, a finger moves the photo less and less.
    expect(rubber(50, 100)).toBe(50);
    expect(rubber(300, 100)).toBeGreaterThan(100);
    expect(rubber(300, 100)).toBeLessThan(220);
  });

  it('double tap toggles 2.5x at the tap and back to 1x', () => {
    const W = 390, H = 844, fit = fitRect(600, 800, W, H);
    const z = doubleTapZoom(IDENTITY, 195, 422, fit, W, H);
    expect(z.s).toBe(TAP_ZOOM);
    expect(doubleTapZoom(z, 10, 10, fit, W, H)).toEqual(IDENTITY);
  });

  it('works out where a zoomed photo is on screen', () => {
    const fit = { x: 0, y: 292, w: 390, h: 260 };
    expect(photoRect(fit, IDENTITY, 390, 844)).toEqual(fit);
    const r = photoRect(fit, { s: 2, x: 10, y: -20 }, 390, 844);
    expect(r).toEqual({ x: 195 + 10 - 390, y: 422 - 20 - 260, w: 780, h: 520 });
  });

  it('swipes one photo past 18% of the width or on a flick, and holds at the ends', () => {
    expect(swipeTarget(0, 5, -100, 0, 390)).toBe(1);
    expect(swipeTarget(1, 5, 100, 0, 390)).toBe(0);
    expect(swipeTarget(1, 5, -30, 0, 390)).toBe(1);
    expect(swipeTarget(1, 5, -30, -0.6, 390)).toBe(2);
    expect(swipeTarget(4, 5, -200, -1, 390)).toBe(4);
    expect(swipeTarget(0, 5, 200, 1, 390)).toBe(0);
  });

  it('a swipe that caught the photos still sliding goes on from the one they were sliding to', () => {
    // Sliding from photo 1 to photo 2 and caught 200 px short of it: another swipe on moves to photo 3...
    expect(swipeTarget(1, 5, -100, -0.6, 390, 200 - 100)).toBe(2);
    // ...a swipe back returns to photo 1 (index 0)...
    expect(swipeTarget(1, 5, 90, 0.6, 390, 200 + 90)).toBe(0);
    // ...and a short nudge settles on whichever photo is nearer.
    expect(swipeTarget(1, 5, -20, 0, 390, 200 - 20)).toBe(1);
    expect(swipeTarget(1, 5, 20, 0, 390, 200 + 20)).toBe(0);
  });

  it('closes a vertical drag past 100 px or on a flick in its direction', () => {
    expect(dragCloses(CLOSE_DRAG + 1, 0)).toBe(true);
    expect(dragCloses(-(CLOSE_DRAG + 1), 0)).toBe(true);
    expect(dragCloses(60, 0.2)).toBe(false);
    expect(dragCloses(60, 0.8)).toBe(true);
    expect(dragCloses(60, -0.8)).toBe(false);
  });

  it('measures velocity over the last 100 ms', () => {
    expect(velocity([[0, 0, 0], [200, 0, 0], [250, 50, 100], [300, 100, 200]])).toEqual({ vx: 1, vy: 2 });
    expect(velocity([[0, 0, 0]])).toEqual({ vx: 0, vy: 0 });
  });

  it('builds the flight frames with matching insets, so the browser can tween them', () => {
    const base = { w: 390, h: 260 };
    const open = flyFrame(base, { x: 0, y: 292, w: 390, h: 260 }, null, 0);
    expect(open.transform).toBe('translate(0.00px, 292.00px) scale(1.00000)');
    expect(open.clipPath).toBe('inset(0.00px 0.00px 0.00px 0.00px round 0.00px)');
    // Into the hero: the whole photo at cover size (759 wide), clipped to the 390x506 frame.
    const at = { x: -184.5, y: 0, w: 759, h: 506 };
    const hero = flyFrame(base, at, { x: 0, y: 0, w: 390, h: 506 }, 0);
    const k = 759 / 390;
    expect(hero.transform).toBe(`translate(-184.50px, 0.00px) scale(${k.toFixed(5)})`);
    expect(hero.clipPath).toBe(`inset(0.00px ${(184.5 / k).toFixed(2)}px 0.00px ${(184.5 / k).toFixed(2)}px round 0.00px)`);
  });

  it('eases with motion.css --ease-morph', () => {
    expect(easeMorph(0)).toBe(0);
    expect(easeMorph(0.5)).toBeCloseTo(0.875);
    expect(easeMorph(0.85)).toBeGreaterThan(1);
    expect(easeMorph(1)).toBe(1);
  });
});

// ---------- the viewer as a layer ----------
const photos: ViewerPhoto[] = [
  { src: 'https://example.test/a.jpg', small: 'https://example.test/a-small.jpg', credit: <>Photo: <a href="https://example.test/p">Ann</a>, CC BY 4.0</>, creditText: 'Photo: Ann, CC BY 4.0' },
  { src: 'https://example.test/b.jpg', credit: 'Photo: Bo, CC BY-NC 4.0', creditText: 'Photo: Bo, CC BY-NC 4.0' },
  { src: 'https://example.test/c.jpg' },
  { src: 'https://example.test/d.jpg' },
];

let clock = 1000;
function pointer(type: string, x: number, y: number, id = 1, step = 16) {
  clock += step;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'timeStamp', { value: clock });
  act(() => { document.querySelector('.pv-stage')!.dispatchEvent(e); });
}
// Closing plays out (a fade here, under reduced motion) before it reports.
const settled = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const zoomOf = () => document.querySelector<HTMLElement>('.pv-slide.is-current .pv-zoom')!.style.transform;
const status = () => document.getElementById(document.querySelector('.pv')!.getAttribute('aria-labelledby')!)?.textContent;

function setup(index = 0, extra: Partial<Parameters<typeof PhotoViewer>[0]> = {}) {
  const opener = document.createElement('button');
  opener.textContent = 'Photos';
  document.body.append(opener);
  opener.focus();
  const onIndex = vi.fn();
  const onClose = vi.fn();
  const view = render(<PhotoViewer photos={photos} index={index} onIndex={onIndex} onClose={onClose} name="Crested Pigeon" returnTo={opener} {...extra} />);
  const rerender = (i: number) => view.rerender(<PhotoViewer photos={photos} index={i} onIndex={onIndex} onClose={onClose} name="Crested Pigeon" returnTo={opener} {...extra} />);
  return { opener, onIndex, onClose, view, rerender };
}
// A frame on the page, as the species hero draws one: a photo that has loaded and is on show.
function pageFrame(shown: string) {
  const frame = document.createElement('figure');
  const img = document.createElement('img');
  img.src = shown;
  img.style.opacity = '1';
  Object.defineProperty(img, 'complete', { value: true });
  frame.append(img);
  document.body.append(frame);
  return frame;
}

beforeAll(() => {
  // jsdom draws no images: give every photo a size once it "loads".
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get() { return this.getAttribute('src') ? 960 : 0; } });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get() { return this.getAttribute('src') ? 640 : 0; } });
});
afterEach(() => {
  cleanup();
  closeAllLayers('test');
  document.body.innerHTML = '';
});

describe('the photo viewer', () => {
  it('opens as a modal dialog named by the photo and its credit, with focus on Close', () => {
    setup(0);
    const pv = document.querySelector('.pv')!;
    expect(pv.getAttribute('role')).toBe('dialog');
    expect(pv.getAttribute('aria-modal')).toBe('true');
    expect(status()).toBe('Photo 1 of 4, Crested Pigeon. Photo: Ann, CC BY 4.0');
    expect(document.getElementById(pv.getAttribute('aria-labelledby')!)!.getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    expect(pv.querySelector('.pv-count')?.textContent).toBe('1 / 4');
    expect(pv.querySelector('.pv-credit')?.textContent).toBe('Photo: Ann, CC BY 4.0');
    expect(layers()).toHaveLength(1);
    expect(viewerLabel(1, 6, 'Crested Pigeon')).toBe('Photo 2 of 6, Crested Pigeon');
  });

  it('Escape and Close end it and give focus back to what opened it', async () => {
    const a = setup(0);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await settled();
    expect(a.onClose).toHaveBeenCalledTimes(1);
    a.view.unmount();
    expect(document.activeElement).toBe(a.opener);
    document.body.innerHTML = '';

    const b = setup(1);
    fireEvent.click(document.querySelector('.pv-close')!);
    await settled();
    expect(b.onClose).toHaveBeenCalledTimes(1);
    b.view.unmount();
    expect(document.activeElement).toBe(b.opener);
  });

  it("closes on the phone's Back (a close request) before the page goes back", async () => {
    const watchers: { onclose: ((e: Event) => void) | null; destroyed: boolean }[] = [];
    (window as unknown as { CloseWatcher?: unknown }).CloseWatcher = class {
      onclose: ((e: Event) => void) | null = null;
      destroyed = false;
      constructor() { watchers.push(this); }
      destroy() { this.destroyed = true; }
    };
    try {
      const a = setup(1);
      expect(watchers).toHaveLength(1);
      act(() => watchers[0].onclose?.(new Event('close')));
      await settled();
      expect(a.onClose).toHaveBeenCalledTimes(1);
      a.view.unmount();
      expect(document.activeElement).toBe(a.opener);
      expect(layers()).toHaveLength(0);
      // Closed with its own button instead, it lets go of Back, so the next Back leaves the page.
      document.body.innerHTML = '';
      const b = setup(0);
      fireEvent.click(document.querySelector('.pv-close')!);
      await settled();
      b.view.unmount();
      expect(watchers[1].destroyed).toBe(true);
    } finally {
      delete (window as unknown as { CloseWatcher?: unknown }).CloseWatcher;
    }
  });

  it('closes at once on a change of address', () => {
    const { onClose } = setup(0);
    act(() => closeAllLayers('nav'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves between photos with the arrow keys and announces the new one with its credit', () => {
    const { onIndex, rerender } = setup(0);
    fireEvent.keyDown(document.querySelector('.pv')!, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenLastCalledWith(1);
    rerender(1);
    expect(status()).toBe('Photo 2 of 4, Crested Pigeon. Photo: Bo, CC BY-NC 4.0');
    expect(document.querySelector('.pv-count')?.textContent).toBe('2 / 4');
    fireEvent.keyDown(document.querySelector('.pv')!, { key: 'ArrowLeft' });
    expect(onIndex).toHaveBeenLastCalledWith(0);
  });

  it('has named Previous and Next buttons beside the count, which move through the photos and stay at the ends', () => {
    const { onIndex, rerender } = setup(0);
    const prev = () => document.querySelector<HTMLButtonElement>('.pv-nav [data-pv-step="-1"]')!;
    const next = () => document.querySelector<HTMLButtonElement>('.pv-nav [data-pv-step="1"]')!;
    expect(prev().getAttribute('aria-label')).toBe('Previous photo');
    expect(next().getAttribute('aria-label')).toBe('Next photo');
    // Reached with Tab after Close, in reading order around the count.
    expect([...document.querySelectorAll('.pv button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Close', 'Previous photo', 'Next photo']);
    expect(document.querySelector('.pv-nav')?.textContent).toBe('1 / 4');
    // At the first photo, Previous says it can't go further but stays, so focus is never dropped.
    expect(prev().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(prev());
    expect(onIndex).not.toHaveBeenCalled();
    next().focus();
    fireEvent.click(next());
    expect(onIndex).toHaveBeenLastCalledWith(1);
    rerender(1);
    expect(status()).toBe('Photo 2 of 4, Crested Pigeon. Photo: Bo, CC BY-NC 4.0');
    expect(prev().hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(prev());
    expect(onIndex).toHaveBeenLastCalledWith(0);
    rerender(3);
    expect(next().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(next());
    fireEvent.click(next());
    expect(onIndex).toHaveBeenCalledTimes(2);
  });

  it('shows no Previous and Next for a single photo', () => {
    render(<PhotoViewer photos={photos.slice(0, 1)} index={0} onIndex={() => {}} onClose={() => {}} name="Crested Pigeon" />);
    expect(document.querySelector('.pv-nav')).toBeNull();
    expect(document.querySelector('.pv-count')).toBeNull();
  });

  it('zooms in and out with + and -', () => {
    setup(0);
    const pv = document.querySelector('.pv')!;
    fireEvent.keyDown(pv, { key: '+' });
    expect(zoomOf()).toMatch(/scale\(1\.6/);
    expect(pv.classList.contains('is-zoomed')).toBe(true);
    // Zoomed, the arrows look around the photo instead of changing it.
    fireEvent.keyDown(pv, { key: '-' });
    expect(zoomOf()).toBe('');
    expect(pv.classList.contains('is-zoomed')).toBe(false);
  });

  it('double tap zooms to 2.5x and back', () => {
    setup(0);
    pointer('pointerdown', 512, 384); pointer('pointerup', 512, 384, 1, 40);
    pointer('pointerdown', 512, 384, 1, 80); pointer('pointerup', 512, 384, 1, 40);
    expect(zoomOf()).toMatch(/scale\(2\.5/);
    pointer('pointerdown', 512, 384, 1, 600); pointer('pointerup', 512, 384, 1, 40);
    pointer('pointerdown', 512, 384, 1, 80); pointer('pointerup', 512, 384, 1, 40);
    expect(zoomOf()).toBe('');
  });

  it('a sideways swipe at 1x moves to the next photo', () => {
    const { onIndex } = setup(0);
    pointer('pointerdown', 800, 400);
    for (let x = 780; x >= 500; x -= 40) pointer('pointermove', x, 402, 1, 30);
    pointer('pointerup', 500, 402, 1, 30);
    expect(onIndex).toHaveBeenLastCalledWith(1);
  });

  it('a drag down past 100 px closes it; a short one springs back', async () => {
    const a = setup(0);
    pointer('pointerdown', 512, 300);
    for (let y = 310; y <= 350; y += 10) pointer('pointermove', 512, y, 1, 60);
    expect(document.querySelector('.pv')!.classList.contains('pv--dragging')).toBe(true);
    pointer('pointerup', 512, 350, 1, 200);
    await settled();
    expect(a.onClose).not.toHaveBeenCalled();
    expect(zoomOf()).toBe('');
    pointer('pointerdown', 512, 300, 1, 500);
    for (let y = 320; y <= 460; y += 20) pointer('pointermove', 512, y, 1, 60);
    pointer('pointerup', 512, 460, 1, 60);
    await settled();
    expect(a.onClose).toHaveBeenCalledTimes(1);
  });

  it('draws only the photo on show and its neighbours', () => {
    const { rerender } = setup(0);
    const drawn = () => [...document.querySelectorAll('.pv-slide')].map((s) => !!s.querySelector('img.pv-img:not(.pv-img--soft), .pv-missing'));
    expect(drawn()).toEqual([true, true, false, false]);
    rerender(2);
    expect(drawn()).toEqual([false, true, true, true]);
    // The slides sit side by side with a gap; the ones not on show are hidden from screen readers.
    const slides = [...document.querySelectorAll<HTMLElement>('.pv-slide')];
    expect(slides[1].style.left).toBe(`calc(1 * (100% + ${GAP}px))`);
    expect(slides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['true', 'true', null, 'true']);
  });

  it('stops iOS page zoom (gesture events) only while it is open', () => {
    const { view } = setup(0);
    const ev = () => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; };
    expect(ev()).toBe(true);
    const move = new Event('touchmove', { cancelable: true, bubbles: true });
    document.querySelector('.pv-stage')!.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    view.unmount();
    expect(ev()).toBe(false);
  });

  it('falls back to the small copy, then to the no-photo block, when a photo will not load', () => {
    setup(0);
    const img = () => document.querySelector<HTMLImageElement>('.pv-slide.is-current img.pv-img:not(.pv-img--soft)');
    fireEvent.error(img()!);
    expect(img()!.getAttribute('src')).toBe(photos[0].small);
    fireEvent.error(img()!);
    const missing = document.querySelector('.pv-slide.is-current .pv-missing');
    expect(missing?.classList.contains('img-missing')).toBe(true);
    expect(missing?.getAttribute('aria-label')).toBe('Photo 1 of 4, Crested Pigeon');
  });

  it('keeps the soft copy under the photo while the photo fades in over it, then lets it go', async () => {
    setup(0);
    const soft = () => document.querySelector('.pv-slide.is-current img.pv-img--soft');
    expect(soft()).not.toBeNull();
    fireEvent.load(document.querySelector('.pv-slide.is-current img.pv-img:not(.pv-img--soft)')!);
    expect(document.querySelector('.pv-slide.is-current img.is-wait')).toBeNull();
    expect(soft()).not.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(soft()).toBeNull();
  });

  it('keeps the copy the page was showing under the photo while it loads, and with no signal', () => {
    // Photo 2 has no small copy of its own; the page's frame was showing a smaller one of it.
    const frame = pageFrame('https://example.test/b-shown.jpg');
    setup(1, { origin: () => frame });
    const soft = document.querySelector('.pv-slide.is-current img.pv-img--soft');
    expect(soft?.getAttribute('src')).toBe('https://example.test/b-shown.jpg');
    fireEvent.error(document.querySelector('.pv-slide.is-current img.pv-img:not(.pv-img--soft)')!);
    expect(document.querySelector('.pv-slide.is-current img.pv-img')?.getAttribute('src')).toBe('https://example.test/b-shown.jpg');
    expect(document.querySelector('.pv-slide.is-current .pv-missing')).toBeNull();
  });

  it("the page's name and controls over the frame step aside while the photo is out, and come back", async () => {
    const frame = pageFrame('https://example.test/a.jpg');
    const name = document.createElement('h1');
    document.body.append(name);
    const a = setup(0, { origin: () => frame, cover: () => [name] });
    pointer('pointerdown', 512, 300);
    for (let y = 310; y <= 350; y += 10) pointer('pointermove', 512, y, 1, 60);
    expect([frame.style.visibility, name.style.visibility]).toEqual(['hidden', 'hidden']);
    pointer('pointerup', 512, 350, 1, 200);
    await settled();
    expect([frame.style.visibility, name.style.visibility]).toEqual(['', '']);
    pointer('pointerdown', 512, 300, 1, 500);
    for (let y = 320; y <= 460; y += 20) pointer('pointermove', 512, y, 1, 60);
    expect(name.style.visibility).toBe('hidden');
    pointer('pointerup', 512, 460, 1, 60);
    await settled();
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect([frame.style.visibility, name.style.visibility]).toEqual(['', '']);
  });
});
