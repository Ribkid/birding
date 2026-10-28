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
const Q = await import('../core/quiz.js');
const { SPECIES } = await import('../lib/data');
const D = await import('../screens/learn/answerDock');

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

// Learn answer dock: where an answer's verdict goes, what the trail shows, which answers fold away and what the dock
// offers. All read from the question; scoring and stored data stay learn.js's.
describe('learn answer dock', () => {
  const birds = () => SPECIES.filter((s) => s.kind === 'bird' && Q.hasCall(s.id)).slice(0, 4);
  const opt = (s: { id: number; name: string }) => ({ key: String(s.id), label: s.name, sp: s.id });
  const photoQ = (type = 'photo') => {
    const b = birds();
    return { type, prompt: 'Which bird is this?', focus: b[0].id, answer: String(b[0].id), options: b.map(opt), photos: [{ src: 'a.jpg' }] } as any;
  };

  it('puts the verdict under the photo for photo, silhouette, zoom and facts with a photo', () => {
    expect(birds()).toHaveLength(4);
    for (const t of ['photo', 'silhouette', 'zoom']) expect(D.answerLayout(photoQ(t))).toBe('photo');
    expect(D.answerLayout({ ...photoQ(), type: 'fact' })).toBe('photo');
    expect(D.answerLayout({ ...photoQ(), type: 'fact', photos: [] })).toBe('card');
    expect(D.answerLayout({ ...photoQ(), type: 'whoami' })).toBe('card');
    expect(D.answerLayout({ ...photoQ(), type: 'call' })).toBe('card');
    expect(D.answerLayout({ ...photoQ(), type: 'duel' })).toBe('dock');
    expect(D.answerLayout({ ...photoQ(), type: 'odd' })).toBe('dock');
    // Rapid fire is left as it was, whatever the question.
    expect(D.answerLayout(photoQ(), 'rapid')).toBe('rapid');
  });

  it('draws the trail from the round: right, wrong, the one she is on, and the rest', () => {
    const qs = [photoQ(), photoQ(), photoQ(), photoQ()];
    qs[0].picked = qs[0].answer;
    qs[1].picked = qs[1].options[1].key;
    expect(D.trailOf(qs, 2)).toEqual(['right', 'wrong', 'now', 'todo']);
    expect(D.trailText(qs, 2)).toBe('Question 3 of 4. 1 right, 1 wrong so far.');
    expect(D.trailText([photoQ()], 0)).toBe('Question 1 of 1.');
    // Answering the one she is on fills its segment; the count does not move until Next.
    qs[2].picked = qs[2].answer;
    expect(D.trailOf(qs, 2)).toEqual(['right', 'wrong', 'right', 'todo']);
  });

  it('folds away only the answers that were neither hers nor right, and only under a photo', () => {
    const q = photoQ();
    expect(D.foldKeys(q)).toEqual([]);
    q.picked = q.options[2].key;
    expect(D.foldKeys(q)).toEqual([q.options[1].key, q.options[3].key]);
    const r = photoQ();
    r.picked = r.answer;
    expect(D.foldKeys(r)).toHaveLength(3);
    const who = { ...photoQ(), type: 'whoami', picked: photoQ().options[1].key };
    expect(D.foldKeys(who)).toEqual([]);
    expect(D.foldKeys(q, 'rapid')).toEqual([]);
  });

  it('words the verdict as the feedback always has, with the answer named for a link', () => {
    const q = photoQ();
    const [a, b] = birds();
    expect(D.verdictOf(q)).toBeNull();
    q.picked = String(b.id);
    const v = D.verdictOf(q)!;
    expect(v.right).toBe(false);
    expect(v).toMatchObject({ lead: 'Not quite.', rest: "It's the ", name: a.name, nameId: a.id, tail: '.' });
    expect(v.text).toBe(`Not quite. It's the ${a.name}.`);
    expect(v.line).toBe(Q.fieldMark(a));
    q.picked = q.answer;
    expect(D.verdictOf(q)!.text).toBe(`Correct. It's the ${a.name}.`);
    const duel = { ...photoQ(), type: 'duel', options: [opt(a), opt(b)], tell: 'Look at the bill.', picked: String(b.id) };
    expect(D.verdictOf(duel)).toMatchObject({ text: `Not quite. That one is the ${b.name}.`, tell: 'Look at the bill.' });
    const odd = { ...photoQ(), type: 'odd', miss: `Not quite. The odd one out is the ${a.name}.`, picked: String(b.id) };
    expect(D.verdictOf(odd)).toMatchObject({ lead: 'Not quite.', text: `Not quite. The odd one out is the ${a.name}.` });
    const fact = { type: 'fact', ttype: 'Seasons', prompt: 'When?', focus: a.id, answer: 's', options: [{ key: 's', label: 'Spring' }, { key: 'w', label: 'Winter' }], picked: 'w', explain: 'Mostly in spring.' } as any;
    expect(D.verdictOf(fact)).toMatchObject({ text: "Not quite. It's Spring.", line: 'Mostly in spring.', speciesQ: false });
  });

  it('offers the calls and Compare in the dock, each with its own label', () => {
    const q = photoQ();
    const [a, b] = birds();
    q.picked = String(b.id);
    expect(D.dockActions(q).map((x) => [x.kind, x.label, x.tone])).toEqual([
      ['play', 'Hear its call', 'right'], ['play', 'Hear the one you picked', 'wrong'], ['compare', 'Compare the two', 'plain'],
    ]);
    expect(D.dockActions(q).find((x) => x.kind === 'compare')!.to).toBe(`/compare/${a.id}/${b.id}`);
    q.picked = q.answer;
    expect(D.dockActions(q).map((x) => x.label)).toEqual(['Hear its call']);
    // A call question plays its own recording again; a fact has no calls.
    const call = { ...photoQ(), type: 'call', picked: q.answer };
    expect(D.dockActions(call)).toMatchObject([{ which: 'answer', label: 'Hear it again' }]);
    expect(D.dockActions({ ...photoQ(), type: 'fact', picked: q.answer })).toEqual([]);
    expect(D.nextLabel(0, 10)).toBe('Next');
    expect(D.nextLabel(9, 10)).toBe('See results');
  });
});
