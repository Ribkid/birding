// @vitest-environment jsdom
// Learn answer dock: answering a photo question keeps the photo, puts the verdict in a footer under it (focused, so
// it is read out), folds the other answers away and raises one dock with Next and the extra actions; coming back to
// an answered question draws that final state without motion, with focus on the verdict.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../core/db.js', () => ({
  db: { kvGet: async () => null, kvSet: async () => {}, all: async () => [], get: async () => null },
}));

const L = await import('../core/learn.js');
const Q = await import('../core/quiz.js');
const { loadSeq } = await import('../core/seqdata.js');
const { SPECIES } = await import('../lib/data');
const { default: LearnPlay } = await import('../screens/learn/LearnPlay');

const errors: string[] = [];
beforeAll(async () => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  window.scrollBy = (() => {}) as typeof window.scrollBy;
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as any;
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
  const err = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); err(...a); };
});
afterEach(() => { cleanup(); L.setActive(null); });

const birds = () => SPECIES.filter((s) => s.kind === 'bird' && Q.hasCall(s.id)).slice(0, 4);
const opt = (s: { id: number; name: string }) => ({ key: String(s.id), label: s.name, sp: s.id });
function round(type = 'photo', n = 2) {
  const b = birds();
  const qs = Array.from({ length: n }, (_, i) => {
    const a = b[i % b.length];
    const rest = b.filter((x) => x !== a);
    return {
      type, prompt: 'Which bird is this?', focus: a.id, answer: String(a.id),
      options: [a, ...rest].map((s) => ({ ...opt(s), ...(type === 'duel' ? { photos: [{ src: `${s.id}.jpg` }] } : {}) })).slice(0, type === 'duel' ? 2 : 4),
      photos: [{ src: `${a.id}.jpg` }], clue: 'A bird with \u0001 feathers.',
    };
  });
  const route = `#/learn/play/${type === 'duel' ? 'duel' : 'photo'}`;
  return { mode: type === 'duel' ? 'duel' : 'photo', pack: null, kind: 'animals', qs, i: 0, score: 0, prefs: { kind: 'animals' }, route } as any;
}
function mount(game: any) {
  window.location.hash = game.route;
  L.setActive(game);
  return render(
    <MemoryRouter initialEntries={[game.route.slice(1)]}>
      <main id="view" tabIndex={-1}>
        <Routes><Route path="/learn/play/:pack" element={<LearnPlay />} /></Routes>
      </main>
    </MemoryRouter>,
  );
}
const ready = async () => {
  for (let i = 0; i < 100 && !document.querySelector('h1.lq-prompt'); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
  await act(() => new Promise((r) => setTimeout(r, 20)));
};
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];

describe('answering under the photo', () => {
  it('keeps the photo, focuses the verdict footer, folds the others and raises the dock', async () => {
    const game = round();
    const [a, b] = birds();
    mount(game);
    await ready();
    const dock = $('.lq-dock')!;
    expect(dock.classList.contains('is-up')).toBe(false);
    expect(dock.hasAttribute('inert')).toBe(true);
    expect($$('.lq-trail i').map((i) => i.className)).toEqual(['is-now', 'is-todo']);

    await act(async () => { fireEvent.click($(`.lq-opt[data-pick="${b.id}"]`)!); });

    const foot = $('.lq-card .lq-photo + .lq-foot .lq-verdictbar')!;
    expect(foot.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(foot);
    expect(foot.textContent).toContain(`Not quite. It's the ${a.name}.`);
    expect(foot.querySelector('a')!.getAttribute('href')).toBe(`/bird/${a.id}`);
    expect(foot.textContent).toContain(Q.fieldMark(a));
    // Her pick and the answer stay; the other two fold away.
    expect($$('.lq-opt-wrap:not(.is-folded) .lq-opt').map((o) => o.dataset.pick)).toEqual([String(a.id), String(b.id)]);
    expect($$('.lq-opt-wrap.is-folded')).toHaveLength(2);
    // No feedback card under the answers for a photo question: only the rest of it, if there is any.
    expect($('.lq-fb')).toBeNull();
    // The dock: up, Next in it, and the calls and Compare as labelled chips.
    expect(dock.classList.contains('is-up')).toBe(true);
    expect(dock.hasAttribute('inert')).toBe(false);
    expect($$('.lq-dock .lq-chip').map((c) => c.getAttribute('aria-label'))).toEqual(['Hear its call', 'Hear the one you picked', 'Compare the two']);
    expect($('.lq-dock a.lq-chip')!.getAttribute('href')).toBe(`/compare/${a.id}/${b.id}`);
    expect($('.lq-dock .lq-next')!.textContent).toBe('Next');
    // The trail fills her answer in; the scoring is learn.js's own.
    expect($$('.lq-trail i').map((i) => i.className)).toEqual(['is-wrong is-new', 'is-todo']);
    expect($('.lq-trail')!.getAttribute('aria-valuetext')).toBe('Question 1 of 2. 0 right, 1 wrong so far.');
    expect(game.score).toBe(0);

    // Next: the dock slips away and the next question's heading takes focus.
    await act(async () => { fireEvent.click($('.lq-dock .lq-next')!); });
    expect(dock.classList.contains('is-up')).toBe(false);
    expect(document.activeElement).toBe($('h1.lq-prompt'));
    expect($$('.lq-trail i').map((i) => i.className)).toEqual(['is-wrong is-new', 'is-now']);
    // The last question's Next says where it goes.
    await act(async () => { fireEvent.click($(`.lq-opt[data-pick="${game.qs[1].answer}"]`)!); });
    expect(game.score).toBe(1);
    expect($('.lq-verdictbar')!.textContent).toContain('Correct.');
    expect($$('.lq-opt-wrap:not(.is-folded)')).toHaveLength(1);
    expect($('.lq-dock .lq-next')!.textContent).toBe('See results');
  });

  it('coming back to an answered question draws it as it was, focused on the verdict', async () => {
    const game = round();
    const [, b] = birds();
    game.qs[0].picked = String(b.id);
    mount(game);
    await ready();
    const foot = $('.lq-verdictbar')!;
    expect(foot).not.toBeNull();
    expect(document.activeElement).toBe(foot);
    expect($('.lq-dock')!.className).toContain('is-up');
    expect($('.lq-dock')!.className).toContain('no-anim');
    expect($$('.lq-opt-wrap.is-folded')).toHaveLength(2);
    // Nothing replays: the trail's segment is drawn filled, the answers without their pop or shake.
    expect($$('.lq-trail i')[0].className).toBe('is-wrong');
    expect($$('.lq-opt-wrap:not(.is-folded) .lq-opt.no-anim')).toHaveLength(2);
  });
});

describe('other questions use the dock and the trail', () => {
  it('a duel puts its verdict line in the dock and keeps the rest in its card', async () => {
    const game = round('duel');
    const [a, b] = birds();
    mount(game);
    await ready();
    await act(async () => { fireEvent.click($(`.lq-side[data-pick="${b.id}"]`)!); });
    const verdict = $('.lq-dock .lq-dock-verdict')!;
    expect(verdict.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(verdict);
    expect(verdict.textContent).toBe(`Not quite. That one is the ${b.name}.`);
    expect($('.lq-fb.lq-fb--rest .lq-name a')!.getAttribute('href')).toBe(`/bird/${a.id}`);
    expect($('.lq-fb .lq-verdict')).toBeNull();
    expect($('.lq-dock .lq-next')).not.toBeNull();
  });

  it("a duel's photos are marked to fit above the dock only once she has answered", async () => {
    const game = round('duel');
    const [, b] = birds();
    mount(game);
    await ready();
    expect($('.lq-duel')!.classList.contains('is-answered')).toBe(false);
    await act(async () => { fireEvent.click($(`.lq-side[data-pick="${b.id}"]`)!); });
    expect($('.lq-duel')!.classList.contains('is-answered')).toBe(true);
    // the dock's and the head's heights are kept on <body> for that fit
    expect(document.body.style.getPropertyValue('--lq-dock-h')).toMatch(/^\d+px$/);
    expect(document.body.style.getPropertyValue('--lq-head-h')).toMatch(/^\d+px$/);
  });

  it('Next only moves on from an answered question, so two clicks at once never skip one', async () => {
    const game = round('photo', 3);
    const [a] = birds();
    mount(game);
    await ready();
    const nextBtn = $('.lq-dock .lq-next')!;
    await act(async () => { nextBtn.click(); });
    expect(game.i).toBe(0);
    await act(async () => { fireEvent.click($(`.lq-opt[data-pick="${a.id}"]`)!); });
    await act(async () => { nextBtn.click(); nextBtn.click(); });
    expect(game.i).toBe(1);
    expect($('.lq-count')!.textContent).toBe('2/3');
  });

  it("Who am I? keeps its feedback card, focused, with Next in the dock", async () => {
    const game = round('whoami');
    const [a, b] = birds();
    mount(game);
    await ready();
    await act(async () => { fireEvent.click($(`.lq-opt[data-pick="${b.id}"]`)!); });
    const card = $('.lq-fb')!;
    expect(document.activeElement).toBe(card);
    expect(card.textContent).toContain(`Not quite. It's the ${a.name}.`);
    expect(card.querySelector('.lq-next')).toBeNull();
    expect($$('.lq-opt-wrap.is-folded')).toHaveLength(0);
    expect($('.lq-dock.is-up .lq-next')).not.toBeNull();
  });
});

describe('rendering', () => {
  // Two children with one key (the media and the answer card once shared game.i) made React draw a second call
  // player beside the first.
  it('draws every question without duplicate keys', () => {
    expect(errors.filter((e) => /same key|unique "key"/i.test(e))).toEqual([]);
  });
});
