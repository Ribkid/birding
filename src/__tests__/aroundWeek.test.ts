// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { BIRDS } from '../lib/data';
import type { EbirdSnapshot } from '../lib/ebird';
import { recentWeekSpecies } from '../lib/aroundWeek';
import * as Q from '../core/quiz.js';

const ids = BIRDS.slice(0, 6).map((bird) => bird.id);

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [],
  lists: {},
  recent: {
    L1: [[ids[0], '2026-11-01'], [ids[1], '2026-10-30'], [ids[0], '2026-10-01']],
    L2: [[ids[2], '2026-10-26'], [ids[3], '2026-10-20']],
  },
  notable: [],
  codes: {},
} as unknown as EbirdSnapshot;

afterEach(() => { Q.setAroundSpecies([]); });

describe('around this week', () => {
  it('collects only bird species reported in the last seven days, newest first and once each', () => {
    const recent = recentWeekSpecies(SNAPSHOT, new Date('2026-11-01T10:00:00'));
    expect(recent).toEqual([ids[0], ids[1], ids[2]]);
  });

  it('builds the twentieth Learn pack from the registered recent species only', () => {
    expect(Q.PACKS).toHaveLength(20);
    expect(Q.PACKS.find((pack: { key: string }) => pack.key === 'around')?.name).toBe('Around this week');

    Q.setAroundSpecies([...ids, 999999]);
    const rows = Q.packSpecies('around').map((sp: { id: number }) => sp.id);
    expect(new Set(rows)).toEqual(new Set(ids));

    const round = Q.buildPackRound('around', { n: 2, rng: Q.seeded(4) });
    expect(round.length).toBeGreaterThan(0);
    expect(round.every((q: { pack?: string }) => q.pack === 'around')).toBe(true);
  });

  it('is empty before any recent species are registered', () => {
    expect(Q.packSpecies('around')).toEqual([]);
  });
});
