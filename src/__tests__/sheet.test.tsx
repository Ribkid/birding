// @vitest-environment jsdom
// Sheets that follow her thumb and leave the way they came: the release speed, when a release closes, the scrim that
// clears with the finger, the exit that carries on from the finger's speed, the closing copy (inert, hidden, without
// ids, focus back at once), a reopen taking over from the copy, and the places a drag never starts.
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exitTiming, flushClosingSheets, releaseVelocity, scrimAt, Sheet, shouldClose, translateYOf } from '../components/Sheet';
import { closeAllLayers } from '../lib/layers';

describe('translateYOf', () => {
  it('reads an inline translateY, a computed matrix and matrix3d, and none', () => {
    expect(translateYOf('translateY(120px)')).toBe(120);
    expect(translateYOf('translateY(-14.5px)')).toBe(-14.5);
    expect(translateYOf('matrix(1, 0, 0, 1, 0, 516)')).toBe(516);
    expect(translateYOf('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 88, 0, 1)')).toBe(88);
    expect(translateYOf('none')).toBe(0);
    expect(translateYOf('')).toBe(0);
  });
});

describe('releaseVelocity', () => {
  it('measures the last 100 ms of moves of a flick', () => {
    // 36 px every 16 ms, lifted a frame after the last move.
    const pts: [number, number][] = [[0, 400], [16, 436], [32, 472], [48, 508]];
    expect(releaseVelocity(pts, 58)).toBeCloseTo(108 / 48, 5);
  });

  it('is not slowed by the gap between the last move and the lift', () => {
    // Moves 50 ms apart and the lift 50 ms later, as a test harness sends them: still 0.72 px/ms.
    const pts: [number, number][] = [[0, 400], [50, 436], [100, 472], [150, 508]];
    expect(releaseVelocity(pts, 200)).toBeCloseTo(72 / 100, 5);
  });

  it('is 0 once the finger rested before lifting, however fast it got there', () => {
    const pts: [number, number][] = [[0, 400], [16, 436], [32, 472]];
    expect(releaseVelocity(pts, 32 + 120)).toBe(0);
  });

  it('only counts the recent moves of a long, slowing drag', () => {
    const pts: [number, number][] = [[0, 400], [40, 500], [200, 510], [260, 512]];
    // From the move at 200 ms (the oldest within 100 ms of the last), 2 px in 60 ms.
    expect(releaseVelocity(pts, 270)).toBeCloseTo(2 / 60, 5);
  });

  it('is 0 for a press without moves, and negative for an upward flick', () => {
    expect(releaseVelocity([[0, 400]], 10)).toBe(0);
    expect(releaseVelocity([[0, 400], [16, 360]], 20)).toBeLessThan(0);
  });
});

describe('shouldClose', () => {
  it('closes past 30% of the height when let go of at rest, and not before', () => {
    expect(shouldClose(130, 400, 0)).toBe(true);
    expect(shouldClose(110, 400, 0)).toBe(false);
  });

  it('closes on a flick down well short of 30%', () => {
    expect(shouldClose(40, 400, 0.6)).toBe(true);
    expect(shouldClose(40, 400, 0.4)).toBe(false);
  });

  it('stays open when she flicks it back up, however far down it was', () => {
    expect(shouldClose(200, 400, -0.8)).toBe(false);
    expect(shouldClose(200, 400, -0.3)).toBe(true);
  });
});

describe('scrimAt', () => {
  it('clears with the drag, to a fifth at the sheet\'s full height, and stays full above rest', () => {
    expect(scrimAt(0, 400)).toBe(1);
    expect(scrimAt(200, 400)).toBeCloseTo(0.6, 5);
    expect(scrimAt(800, 400)).toBeCloseTo(0.2, 5);
    expect(scrimAt(-30, 400)).toBe(1);
  });
});

describe('exitTiming', () => {
  // cubic-bezier(.3333, y1, .6667, .6667): x runs evenly, so the start speed is 3 * y1 times the average speed.
  const startSpeed = (t: { duration: number; easing: string }, dist: number) => {
    const y1 = Number(/cubic-bezier\(\.3333, ([\d.]+),/.exec(t.easing)![1]);
    return 3 * y1 * (dist / t.duration);
  };

  it('leaves at the finger\'s speed', () => {
    const t = exitTiming(300, 2);
    expect(t.duration).toBe(150);
    expect(startSpeed(t, 300)).toBeCloseTo(2, 1);
  });

  it('is quicker for less distance and a faster finger, within 140 to 300 ms', () => {
    expect(exitTiming(450, 0).duration).toBe(300);
    expect(exitTiming(300, 0).duration).toBe(200);
    expect(exitTiming(300, 3).duration).toBe(140);
    expect(exitTiming(20, 0).duration).toBe(140);
    expect(exitTiming(400, 2).duration).toBeLessThan(exitTiming(400, 0.6).duration);
  });

  it('starts from rest when let go of at rest, and never runs backwards', () => {
    expect(startSpeed(exitTiming(300, 0), 300)).toBe(0);
    expect(startSpeed(exitTiming(300, -1), 300)).toBe(0);
    expect(exitTiming(0, 1)).toEqual({ duration: 140, easing: 'cubic-bezier(.3333, 0.000, .6667, .6667)' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The component: jsdom has no Web Animations, so element.animate is stood in for, with exits that end when told.
let ends: (() => void)[] = [];
const animate = vi.fn(function animate() {
  let done!: () => void;
  const finished = new Promise<void>((r) => { done = r; });
  ends.push(done);
  return { finished, cancel() {} } as unknown as Animation;
});

beforeEach(() => {
  ends = [];
  animate.mockClear();
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
});
afterEach(() => {
  cleanup();
  closeAllLayers('test');
  flushClosingSheets();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers();
});

const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

function Harness({ onClose }: { onClose?: (why?: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>Add</button>
      {open && (
        <Sheet open onClose={(why) => { onClose?.(why); setOpen(false); }} label="Add a sighting">
          <h2 id="sheet-h">Add a sighting</h2>
          <label>Count <input name="count" id="count" defaultValue="" /></label>
          <div className="stage" data-nodrag="">Framing stage</div>
          <div className="crop" style={{ touchAction: 'none' }}><span className="crop-in">Photo</span></div>
          <button type="button" data-close="" onClick={() => setOpen(false)}>Cancel</button>
        </Sheet>
      )}
    </>
  );
}

// A sheet that stays mounted and is closed by its open prop (the + sheet), so React takes its wrapper out before the
// sheet's own effects hear of it.
function Toggled() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>Add</button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Add">
        <h2>Add</h2>
        <button type="button" data-close="" onClick={() => setOpen(false)}>Cancel</button>
      </Sheet>
    </>
  );
}

// A tall sheet and a short one, opened from the page.
function TwoSheets() {
  const [which, setWhich] = useState<'' | 'tall' | 'short'>('');
  return (
    <>
      <button type="button" id="open-tall" onClick={() => setWhich('tall')}>Tall</button>
      <button type="button" id="open-short" onClick={() => setWhich('short')}>Short</button>
      {which === 'tall' && (
        <Sheet open onClose={() => setWhich('')} label="Log a sighting">
          <div className="tall">Log a sighting</div>
          <button type="button" data-close="" onClick={() => setWhich('')}>Cancel</button>
        </Sheet>
      )}
      {which === 'short' && (
        <Sheet open onClose={() => setWhich('')} label="Add">
          <div className="short">Add</div>
          <button type="button" data-close="" onClick={() => setWhich('')}>Cancel</button>
        </Sheet>
      )}
    </>
  );
}

async function openSheet() {
  // The click that ends a drag is dropped until the next task; a test's next tap comes after it, as hers would.
  await act(() => new Promise<void>((r) => setTimeout(r, 0)));
  const opener = document.getElementById('opener')!;
  opener.focus();
  act(() => { opener.click(); });
  await frame();
  const sheet = document.querySelector<HTMLElement>('.sheet-wrap:not([data-closing]) .sheet')!;
  sheet.getBoundingClientRect = () => ({ top: 400, height: 400, bottom: 800, left: 0, right: 390, width: 390, x: 0, y: 400, toJSON: () => ({}) });
  return sheet;
}

let clock = 0;
const pointer = (type: string, target: EventTarget, y: number, step = 16) => {
  clock += step;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 200, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'timeStamp', { value: clock });
  act(() => { target.dispatchEvent(e); });
};
const settle = () => act(() => new Promise<void>((r) => queueMicrotask(() => r())));

describe('a closing sheet', () => {
  it('leaves an inert, hidden copy without ids that keeps what was typed, with focus back on the opener at once', async () => {
    render(<Harness />);
    const sheet = await openSheet();
    (sheet.querySelector('input[name="count"]') as HTMLInputElement).value = '12';
    act(() => { (sheet.querySelector('[data-close]') as HTMLButtonElement).click(); });
    await settle();
    const copy = document.querySelector<HTMLElement>('.sheet-wrap[data-closing]')!;
    expect(copy).not.toBeNull();
    expect(copy.inert).toBe(true);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.querySelectorAll('[id]').length).toBe(0);
    expect((copy.querySelector('input[name="count"]') as HTMLInputElement).value).toBe('12');
    expect(document.activeElement?.id).toBe('opener');
    // It goes once its slide has played.
    await act(async () => { ends.forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('.sheet-wrap')).toBeNull();
  });

  it('is gone at once when the sheet is opened again while it leaves', async () => {
    render(<Harness />);
    await openSheet();
    act(() => { (document.querySelector('.sheet [data-close]') as HTMLButtonElement).click(); });
    await settle();
    expect(document.querySelectorAll('.sheet-wrap[data-closing]').length).toBe(1);
    await openSheet();
    expect(document.querySelectorAll('.sheet-wrap').length).toBe(1);
    expect(document.querySelector('.sheet-wrap[data-closing]')).toBeNull();
  });

  it('leaves from where it is drawn when closed while still rising in, whether its owner drops it or closes it', async () => {
    // getComputedStyle stands in for a sheet caught by Cancel part-way up its entry, its scrim still fading in.
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, p?: string | null) => {
      const cs = real(el, p);
      if (!el.isConnected || el.closest('[data-closing]') || !el.matches('.sheet, .sheet-scrim')) return cs;
      const over: Record<string, string> = el.matches('.sheet') ? { transform: 'matrix(1, 0, 0, 1, 0, 250)', opacity: '0.6' } : { opacity: '0.4' };
      return new Proxy(cs, { get: (t, k) => (typeof k === 'string' && k in over ? over[k] : Reflect.get(t, k)) });
    });
    try {
      for (const H of [Harness, Toggled]) {
        cleanup();
        flushClosingSheets();
        animate.mockClear();
        render(<H />);
        await openSheet();
        act(() => { (document.querySelector('.sheet-wrap:not([data-closing]) .sheet [data-close]') as HTMLButtonElement).click(); });
        await settle();
        expect(document.querySelector('.sheet-wrap[data-closing]')).not.toBeNull();
        const kf = animate.mock.calls.map((c) => (c as unknown as [Keyframe[]])[0]);
        // The sheet goes on down from 250 px and 0.6 opacity, the scrim from 0.4, rather than from rest at full.
        expect(kf.find((k) => 'transform' in k[0])?.[0]).toEqual({ transform: 'matrix(1, 0, 0, 1, 0, 250)', opacity: 0.6 });
        expect(kf.find((k) => !('transform' in k[0]))?.[0]).toEqual({ opacity: '0.4' });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('lets a taller sheet slide on out when a shorter one opens before it has gone', async () => {
    // Heights and resting places as a 390x844 phone lays them out: the tall sheet 700 px, the short one 300 px.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const had = ['offsetHeight', 'offsetTop'].map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
    const h = (el: HTMLElement) => (el.classList.contains('sheet') ? (el.querySelector('.tall') ? 700 : 300) : 0);
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return h(this); } });
    Object.defineProperty(proto, 'offsetTop', { configurable: true, get() { return this.classList.contains('sheet') ? 844 - h(this) : 0; } });
    try {
      render(<TwoSheets />);
      act(() => { document.getElementById('open-tall')!.click(); });
      await frame();
      act(() => { (document.querySelector('.sheet [data-close]') as HTMLButtonElement).click(); });
      await settle();
      const ghost = document.querySelector<HTMLElement>('.sheet-wrap[data-closing]')!;
      // Still near the top of the screen, well above where the short sheet rests (544 px).
      ghost.querySelector<HTMLElement>('.sheet')!.getBoundingClientRect = () => ({ top: 200, height: 700, bottom: 900, left: 0, right: 390, width: 390, x: 0, y: 200, toJSON: () => ({}) });
      act(() => { document.getElementById('open-short')!.click(); });
      expect(ghost.isConnected).toBe(true);
      expect(document.querySelectorAll('.sheet-wrap').length).toBe(2);
      // Once it is below where the short sheet rests, the short one takes over from it, as the same sheet would.
      act(() => { (document.querySelector('.sheet-wrap:not([data-closing]) .sheet [data-close]') as HTMLButtonElement).click(); });
      await settle();
      flushClosingSheets();
      act(() => { document.getElementById('open-tall')!.click(); });
      await frame();
      act(() => { (document.querySelector('.sheet [data-close]') as HTMLButtonElement).click(); });
      await settle();
      const low = document.querySelector<HTMLElement>('.sheet-wrap[data-closing] .sheet')!;
      low.getBoundingClientRect = () => ({ top: 600, height: 700, bottom: 1300, left: 0, right: 390, width: 390, x: 0, y: 600, toJSON: () => ({}) });
      act(() => { document.getElementById('open-short')!.click(); });
      expect(document.querySelectorAll('.sheet-wrap').length).toBe(1);
    } finally {
      for (const [k, d] of had) { if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete proto[k]; }
    }
  });

  it('is removed by a route change (flushClosingSheets)', async () => {
    render(<Harness />);
    await openSheet();
    act(() => { (document.querySelector('.sheet [data-close]') as HTMLButtonElement).click(); });
    await settle();
    expect(document.querySelector('.sheet-wrap[data-closing]')).not.toBeNull();
    flushClosingSheets();
    expect(document.querySelector('.sheet-wrap')).toBeNull();
  });
});

describe('dragging a sheet', () => {
  it('clears the scrim with the finger, without its own fade lagging behind, and brings it back on release', async () => {
    render(<Harness />);
    const sheet = await openSheet();
    const scrim = document.querySelector<HTMLElement>('.sheet-wrap:not([data-closing]) .sheet-scrim')!;
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    for (const y of [460, 500, 520]) pointer('pointermove', window, y, 60);
    expect(sheet.style.transform).toBe('translateY(100px)');
    expect(scrim.style.transition).toBe('none');
    expect(Number(scrim.style.opacity)).toBeCloseTo(scrimAt(100, 400), 5);
    pointer('pointerup', window, 520, 200);
    expect(scrim.style.opacity).toBe('');
    expect(scrim.style.transition).toBe('');
  });

  it('closes on a quick flick shorter than 30% of its height, and the exit starts at the finger\'s speed', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const sheet = await openSheet();
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    for (const y of [450, 480, 510]) pointer('pointermove', window, y, 16);
    pointer('pointerup', window, 510, 10);
    expect(onClose).toHaveBeenCalledWith('drag');
    await settle();
    // The copy's slide: from where the finger left it, with a curve that leaves at about 90 px / 48 ms.
    const call = animate.mock.calls.find((c) => (c as unknown as [Keyframe[]])[0]?.[0]?.transform === 'translateY(90px)') as unknown as [Keyframe[], KeyframeAnimationOptions] | undefined;
    expect(call).toBeTruthy();
    expect(call![1].easing).toMatch(/^cubic-bezier\(\.3333, /);
  });

  it('springs back from a short drag that rested before lifting', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const sheet = await openSheet();
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    for (const y of [450, 480, 510]) pointer('pointermove', window, y, 16);
    pointer('pointerup', window, 510, 200);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('stays open when dragged past 30% and flicked back up', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const sheet = await openSheet();
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    for (let y = 470; y <= 700; y += 50) pointer('pointermove', window, y, 60);
    for (const y of [670, 640, 610]) pointer('pointermove', window, y, 16);
    expect(sheet.style.transform).toBe('translateY(190px)');
    pointer('pointerup', window, 610, 8);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('stops under the finger when caught while it springs back, and a drag carries on from there', async () => {
    render(<Harness />);
    const sheet = await openSheet();
    sheet.style.transition = 'transform 320ms';
    sheet.style.transform = 'translateY(60px)'; // mid-spring
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    expect(sheet.style.transition).toBe('none');
    expect(sheet.style.transform).toBe('translateY(60px)');
    pointer('pointermove', window, 440, 40);
    expect(sheet.style.transform).toBe('translateY(80px)');
    pointer('pointerup', window, 440, 200);
    expect(sheet.style.transform).toBe('');
  });

  it('follows from where it was caught above rest (a spring entry overshooting), resisting only beyond that', async () => {
    render(<Harness />);
    const sheet = await openSheet();
    sheet.style.transform = 'translateY(-30px)'; // overshooting its resting place
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    pointer('pointermove', window, 430, 16);
    // 10 px down from where she caught it, not snapped to the rubber band's -7 px.
    expect(sheet.style.transform).toBe('translateY(-20px)');
    pointer('pointermove', window, 400, 16);
    // 20 px above where she caught it: that much resisted, as above rest.
    const y = parseFloat(/translateY\((-?[\d.]+)px\)/.exec(sheet.style.transform)![1]);
    expect(y).toBeLessThan(-30);
    expect(y).toBeGreaterThan(-40);
    pointer('pointerup', window, 400, 200);
    expect(sheet.style.transform).toBe('');
  });

  it('settles again when a sheet caught moving was only tapped', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const sheet = await openSheet();
    sheet.style.transform = 'translateY(30px)'; // still rising in
    pointer('pointerdown', sheet.querySelector('.sheet-grip')!, 420);
    expect(sheet.style.transform).toBe('translateY(30px)');
    pointer('pointerup', window, 421, 80);
    expect(sheet.style.transform).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never starts on a field, a [data-nodrag] surface or one that takes every touch itself', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const sheet = await openSheet();
    for (const sel of ['input[name="count"]', '.stage', '.crop-in']) {
      pointer('pointerdown', sheet.querySelector(sel)!, 430);
      for (const y of [470, 520, 600]) pointer('pointermove', window, y, 40);
      expect(sheet.style.transform).toBe('');
      pointer('pointerup', window, 600, 200);
    }
    expect(onClose).not.toHaveBeenCalled();
  });
});
