// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import * as Q from '../core/quiz.js';
import { SPECIES, parseSize } from '../core/species.js';
import { loadSeq } from '../core/seqdata.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('quiz engine', () => {
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
    await Q.loadLookalikes();
  });

  it('ships 19 packs, each with a name and question types', () => {
    expect(Q.PACKS).toHaveLength(19);
    for (const pack of Q.PACKS) {
      expect(pack.key).toBeTruthy();
      expect(pack.name).toBeTruthy();
      expect(pack.types.length).toBeGreaterThan(0);
    }
  });

  it('builds a deterministic seeded round', () => {
    const a = Q.seeded(Q.hashStr('today'));
    const b = Q.seeded(Q.hashStr('today'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('offers three distractors that are not the answer', () => {
    const answer = SPECIES.find((s: { id: number }) => s.id === 1)!;
    const picks = Q.pickDistractors(answer, { n: 3, rng: Q.seeded(1) });
    expect(picks).toHaveLength(3);
    expect(picks.every((s: { id: number }) => s.id !== 1)).toBe(true);
  });

  it('builds a quick round whose questions all have an answer among the options', () => {
    const qs = Q.buildRound({ mode: 'quick', kind: 'animals', n: 10, rng: Q.seeded(42) });
    expect(qs.length).toBeGreaterThanOrEqual(3);
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThan(1);
      expect(q.options.some((o: { key: string }) => o.key === q.answer)).toBe(true);
    }
  });

  it('builds today’s challenge for a date', () => {
    const qs = Q.buildDaily('2026-10-27', 10);
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.every((q: { type: string }) => q.type)).toBe(true);
  });

  it('parses sizes in mm, cm and m', () => {
    expect(parseSize('1–2 m with tail')).toEqual({ cm: 150, measure: 'length' });
    expect(parseSize('Wingspan to 16 cm')).toEqual({ cm: 16, measure: 'wingspan' });
    expect(parseSize('Tree to 45 m')).toEqual({ cm: 4500, measure: 'length' });
  });
});
