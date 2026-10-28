// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Learning progress that loads after the first render, as on a slow cold start.
const learn = vi.hoisted(() => {
  let stats: Record<string, number> = {};
  let done = () => {};
  const ready = new Promise<void>((resolve) => { done = resolve; });
  return { ready, stats: () => stats, load(next: Record<string, number>) { stats = next; done(); } };
});
vi.mock('../core/learn.js', () => ({ learnReady: () => learn.ready, learnStats: () => learn.stats() }));
vi.mock('../core/cloud.js', () => ({ configured: true }));
// No sightings or outings: Badges reads them itself, so it knows when they are in before the count stamps up.
vi.mock('../core/db.js', () => ({ db: { all: async () => [], onChange: () => () => {} } }));
vi.mock('../lib/hooks', () => ({ normaliseSighting: <T,>(row: T) => row }));

import Badges from '../screens/progress/Badges';

describe('Badges', () => {
  afterEach(cleanup);

  it('recounts the Learning shelf when learning progress loads after the first render', async () => {
    render(<MemoryRouter><Badges /></MemoryRouter>);
    const learning = () => screen.getByText('Learning').parentElement?.textContent;
    expect(learning()).toBe('Learning0/9');

    await act(async () => {
      learn.load({ rounds: 3, perfect: 1, duelsWon: 21, bestStreak: 7, dailyDone: 4, packsDone: 1, packPerfect: 1, mastered: 0, callsMastered: 0 });
      await learn.ready;
    });
    expect(learning()).toBe('Learning6/9');
  });

  it("writes the earned count into v1's [data-earned] once her sightings are read", async () => {
    const { container } = render(<MemoryRouter><Badges /></MemoryRouter>);
    const earned = () => container.querySelector('[data-earned]')?.textContent;
    await act(async () => { await Promise.resolve(); });
    expect(earned()).toMatch(/^\d+$/);
  });

  it('puts v1 trophy icon on the Leaderboard link', () => {
    render(<MemoryRouter><Badges /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Leaderboard' });
    expect(link.querySelector('svg path')?.getAttribute('d')).toMatch(/^M8 4h8v5a4 4 0 0 1-8 0z/);
  });

  it('puts v1 learn icon on the Learn link', () => {
    render(<MemoryRouter><Badges /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Learn' });
    expect(link.querySelector('svg path')?.getAttribute('d')).toMatch(/^M7 7\.5h11a1\.5 1\.5 0 0 1 1\.5 1\.5v10/);
  });
});
