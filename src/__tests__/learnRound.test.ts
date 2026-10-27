// @vitest-environment jsdom
// Item 27: a practice round is kept with the route it started on, so Back from a species page resumes it.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../core/db.js', () => ({
  db: { kvGet: async () => null, kvSet: async () => {}, all: async () => [] },
}));

const L = await import('../core/learn.js');
const { loadSeq } = await import('../core/seqdata.js');

describe('learn round store', () => {
  beforeAll(async () => {
    const pub = (...parts: string[]) => join(process.cwd(), 'public', ...parts);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const file = url.includes('seq.json') ? pub('data', 'seq.json')
        : url.includes('lookalikes.json') ? pub('data', 'lookalikes.json')
        : url.includes('calls.json') ? pub('data', 'calls.json') : '';
      if (!file) return new Response('{}', { status: 404 });
      return new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await loadSeq();
    await L.learnReady();
  });

  it('keeps the round for its own hash route only', async () => {
    window.location.hash = '#/learn/play/whoami';
    const { game, error } = await L.newPracticeRound('whoami');
    expect(error).toBe('');
    expect(game.route).toBe('#/learn/play/whoami');
    L.setActive(game);
    game.i = 1;
    // Back on the same route: the very same round, at the same question.
    expect(L.activeFor('#/learn/play/whoami')).toBe(game);
    expect(L.activeFor()).toBe(game);
    // Another mode, the deck, or an empty router hash never pick it up.
    expect(L.activeFor('#/learn/play/photo')).toBeNull();
    expect(L.activeFor('')).toBeNull();
    expect(L.activeFor('#/learn/play/whoami', { deck: true })).toBeNull();
    L.setActive(null);
    expect(L.activeFor('#/learn/play/whoami')).toBeNull();
  });

  it('keeps a review deck apart from practice rounds', () => {
    const deck = { deck: true, route: '#/learn/deck', mode: 'card', game: L.newDeckRound([]), revealed: true };
    L.setActive(deck);
    expect(L.activeFor('#/learn/deck', { deck: true })).toBe(deck);
    expect(L.activeFor('#/learn/deck')).toBeNull();
    L.setActive(null);
  });
});
