// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countUp } from '../lib/motion';

// Frames are run by hand: each call to frame(ms) runs the callbacks queued so far at that time.
let queue: FrameRequestCallback[] = [];
const frame = (now: number) => { const run = queue; queue = []; run.forEach((cb) => cb(now)); };

afterEach(() => { vi.unstubAllGlobals(); queue = []; });

describe('countUp', () => {
  it('ends on the newest value when a count is drawn again while it is still counting', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
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
});
