// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { countOnTo, countUp } from '../lib/motion';
import { CountKey } from '../screens/lists/hubParts';

// Frames are run by hand: each call to frame(ms) runs the callbacks queued so far at that time.
let queue: FrameRequestCallback[] = [];
let clock = 0;
const frame = (now: number) => { clock = now; const run = queue; queue = []; run.forEach((cb) => cb(now)); };

// Every number the element shows once a task is done (what could be painted), in order, without repeats.
const watch = (el: HTMLElement) => {
  const seen: string[] = [el.textContent ?? ''];
  new MutationObserver(() => { if (seen[seen.length - 1] !== el.textContent) seen.push(el.textContent ?? ''); })
    .observe(el, { childList: true, characterData: true, subtree: true });
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const rising = (seen: string[]) => seen.map(Number).every((n, i, all) => i === 0 || n >= all[i - 1]);

beforeEach(() => {
  queue = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('countUp', () => {
  it('ends on the newest value when a count is drawn again while it is still counting', async () => {
    const el = document.createElement('b');
    document.body.append(el);
    // Targets draws "177 to find", then 180 once the regional data is in: the first count is still running.
    const first = countUp(el, 0, 177);
    frame(0);
    frame(100);
    const second = countUp(el, 177, 180);
    for (let t = 116; t <= 2000; t += 16) frame(t);
    await Promise.all([first, second]);
    expect(el.textContent).toBe('180');
  });

  it('sent on to a newer number before it moves, counts from 0 straight to it, as v1 draws Targets once', async () => {
    const el = document.createElement('b');
    document.body.append(el);
    const done = countUp(el, 0, 177, { delay: 120 });
    const seen = watch(el);
    frame(0);
    frame(16);
    expect(countOnTo(el, 180)).toBe(true);
    for (let t = 32; t <= 2000; t += 16) frame(t);
    await done;
    await settle();
    expect(seen[0]).toBe('0');
    expect(seen).not.toContain('177');
    expect(rising(seen)).toBe(true);
    expect(seen[seen.length - 1]).toBe('180');
  });

  it('sent on to a newer number while it moves, carries on from the number shown and never starts again', async () => {
    const el = document.createElement('b');
    document.body.append(el);
    const done = countUp(el, 0, 177);
    const seen = watch(el);
    frame(0);
    frame(100);
    frame(200);
    const shown = Number(el.textContent);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(177);
    expect(countOnTo(el, 180)).toBe(true);
    expect(el.textContent).toBe(String(shown));
    for (let t = 216; t <= 2000; t += 16) frame(t);
    await done;
    await settle();
    expect(rising(seen)).toBe(true);
    expect(seen[seen.length - 1]).toBe('180');
  });

  it('has nothing to send on once the count has landed', async () => {
    const el = document.createElement('b');
    document.body.append(el);
    const done = countUp(el, 0, 5);
    for (let t = 0; t <= 2000; t += 16) frame(t);
    await done;
    expect(countOnTo(el, 9)).toBe(false);
    expect(el.textContent).toBe('5');
  });
});

describe('CountKey', () => {
  it('never shows the final number before counting, and a newer number while counting stays one count', async () => {
    const { container, rerender } = render(createElement(CountKey, { k: 'test/targets', value: 177 }));
    const b = container.querySelector('b') as HTMLElement;
    // Drawn and started in one go, as v1 countIn does: 0 is what gets painted, not 177.
    expect(b.textContent).toBe('0');
    const seen = watch(b);
    frame(0);
    frame(16);
    // The regional data arrives: React draws 180, and the count goes on to it in the same commit.
    rerender(createElement(CountKey, { k: 'test/targets', value: 180 }));
    expect(b.textContent).toBe('0');
    for (let t = 32; t <= 2000; t += 16) frame(t);
    await settle();
    expect(seen).not.toContain('177');
    expect(rising(seen)).toBe(true);
    expect(b.textContent).toBe('180');
  });

  it('counts a changed number up from the number it was, once the first count has landed (v1 countIn)', async () => {
    const { container, rerender } = render(createElement(CountKey, { k: 'test/log', value: 3 }));
    const b = container.querySelector('b') as HTMLElement;
    for (let t = 0; t <= 2000; t += 16) frame(t);
    expect(b.textContent).toBe('3');
    rerender(createElement(CountKey, { k: 'test/log', value: 4 }));
    expect(b.textContent).toBe('3');
    for (let t = 2016; t <= 4000; t += 16) frame(t);
    expect(b.textContent).toBe('4');
  });
});
