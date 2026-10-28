// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/cloud.js', () => ({ configured: true, user: () => null }));
const kv = new Map<string, unknown>();
vi.mock('../core/db.js', () => ({
  db: { kvGet: async (k: string) => kv.get(k), kvSet: async (k: string, v: unknown) => { kv.set(k, v); } },
}));

import { nudgeAfterSave } from '../screens/me/nudge';

describe('the sign-up nudge', () => {
  afterEach(() => { vi.useRealTimers(); document.querySelectorAll('.me-nudge').forEach((n) => n.remove()); kv.clear(); });

  it("is said through the page's one live region, as v1 did, not a region made with its text", async () => {
    vi.useFakeTimers();
    const done = nudgeAfterSave(3);
    await vi.advanceTimersByTimeAsync(700);
    await done;
    await vi.advanceTimersByTimeAsync(100);
    const banner = document.querySelector('.me-nudge');
    expect(banner?.getAttribute('aria-label')).toBe('Back up your sightings');
    expect(banner?.querySelector('[role=status], [aria-live]')).toBeNull();
    expect(document.querySelectorAll('#announce')).toHaveLength(1);
    expect(document.getElementById('announce')?.textContent).toBe('Back up your sightings: sign up free. Sign up or Not now, above the tab bar.');
    expect(kv.get('me:nudged')).toBe(true);
  });

  it('waits for the third sighting', async () => {
    await nudgeAfterSave(2);
    expect(document.querySelector('.me-nudge')).toBeNull();
  });
});
