// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../lib/sw';

// A stand-in for navigator.serviceWorker: register() resolves with a registration whose update() is counted, and
// controllerchange is fired by hand, as the browser does when a new release's worker claims the page.
function fakeContainer(controlled: boolean) {
  const target = new EventTarget();
  const update = vi.fn(() => Promise.resolve());
  const register = vi.fn(() => Promise.resolve({ update }));
  const sw = Object.assign(target, { controller: controlled ? {} : null, register });
  return { sw: sw as unknown as ServiceWorkerContainer, register, update, fire: () => target.dispatchEvent(new Event('controllerchange')) };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.querySelectorAll('.update-bar').forEach((el) => el.remove());
  vi.useRealTimers();
});

describe('service worker registration (v1 boot)', () => {
  it('checks for a new release at start and every 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const f = fakeContainer(true);
    registerServiceWorker(f.sw);
    expect(f.register).toHaveBeenCalledWith('/sw.js');
    await flush();
    expect(f.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(f.update).toHaveBeenCalledTimes(2);
  });

  it('says a new version is ready, once, with Reload, when a new release takes over a page', async () => {
    const f = fakeContainer(true);
    registerServiceWorker(f.sw);
    await flush();
    f.fire();
    f.fire();
    const bars = document.querySelectorAll('.update-bar');
    expect(bars).toHaveLength(1);
    const bar = bars[0];
    expect(bar.getAttribute('role')).toBe('status');
    expect(bar.querySelector('span')?.textContent).toBe('A new version is ready.');
    const button = bar.querySelector('button');
    expect(button?.className).toBe('btn btn--small btn--primary');
    expect(button?.textContent).toBe('Reload');
  });

  it('says nothing when the first install claims the page', async () => {
    const f = fakeContainer(false);
    registerServiceWorker(f.sw);
    await flush();
    f.fire();
    expect(document.querySelector('.update-bar')).toBeNull();
  });
});
