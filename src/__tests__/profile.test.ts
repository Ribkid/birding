// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: [] as Array<() => Promise<void>>,
  remote: [] as Array<() => Promise<void>>,
}));

vi.mock('../core/cloud.js', () => ({
  configured: true,
  client: async () => ({}),
  user: () => null,
  onAuth: (fn: () => Promise<void>) => { h.auth.push(fn); return () => {}; },
}));
vi.mock('../core/sync.js', () => ({
  localProfile: async () => ({ displayName: 'Kim', avatarSpeciesId: null, showOnLeaderboard: true }),
  saveProfile: async (p: unknown) => p,
  syncNow: async () => {},
  onRemoteChange: (fn: () => Promise<void>) => { h.remote.push(fn); return () => {}; },
}));
vi.mock('../core/db.js', () => ({ db: { kvGet: async () => null, kvSet: async () => {} } }));
vi.mock('../core/species.js', () => ({ BIRDS: [], byId: new Map() }));
vi.mock('../core/stats.js', () => ({ MONTHS: [] }));
vi.mock('../core/config.js', () => ({ SUPABASE_URL: 'https://example.supabase.co' }));

import { initProfile } from '../core/profile.js';

describe('initProfile subscriptions', () => {
  it('resolves ready with the local profile and binds the auth and remote listeners once', async () => {
    const offA = initProfile();
    const offB = initProfile();
    await expect(offA.ready).resolves.toMatchObject({ displayName: 'Kim' });
    await offB.ready;
    expect(h.auth).toHaveLength(1);
    expect(h.remote).toHaveLength(1);
  });

  it('returns an unsubscribe, so an unmounted screen stops hearing about changes', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = initProfile(a);
    const offB = initProfile(b);
    await Promise.all([offA.ready, offB.ready]);
    a.mockClear();
    b.mockClear();

    await h.remote[0]();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    await h.remote[0]();
    await h.auth[0]();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(3);

    offB();
    await h.remote[0]();
    expect(b).toHaveBeenCalledTimes(3);
  });

  it('does not pile up subscribers across remounts', async () => {
    const calls: number[] = [];
    for (let i = 0; i < 5; i++) {
      const off = initProfile(() => calls.push(i));
      await off.ready;
      off();
    }
    calls.length = 0;
    await h.remote[0]();
    expect(calls).toEqual([]);
  });
});
