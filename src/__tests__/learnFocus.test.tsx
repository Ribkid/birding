// @vitest-environment jsdom
// Learn sweep, finding 1: opening a round's address cold leaves focus where the browser put it, as v1 did (its
// drawQuestion only focuses the heading when focus was already in the screen). Arriving from another screen, with the
// route's focus parked on the screen while the round loads, the question's heading takes it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../core/db.js', () => ({
  db: { kvGet: async () => null, kvSet: async () => {}, all: async () => [], get: async () => null },
}));

const L = await import('../core/learn.js');
const { default: LearnPlay } = await import('../screens/learn/LearnPlay');

beforeAll(() => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  const pub = (...parts: string[]) => join(process.cwd(), 'public', ...parts);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = url.includes('seq.json') ? pub('data', 'seq.json')
      : url.includes('lookalikes.json') ? pub('data', 'lookalikes.json')
      : url.includes('calls.json') ? pub('data', 'calls.json') : '';
    if (!file) return new Response('{}', { status: 404 });
    return new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => { cleanup(); L.setActive(null); });

function mount() {
  window.location.hash = '#/learn/play/whoami';
  return render(
    <MemoryRouter initialEntries={['/learn/play/whoami']}>
      <main id="view" tabIndex={-1}>
        <Routes><Route path="/learn/play/:pack" element={<LearnPlay />} /></Routes>
      </main>
    </MemoryRouter>,
  );
}
const prompt = async () => {
  for (let i = 0; i < 100 && !document.querySelector('h1.lq-prompt'); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
  return document.querySelector<HTMLElement>('h1.lq-prompt');
};

describe('round heading focus', () => {
  it('a cold load leaves focus on the page', async () => {
    mount();
    const h = await prompt();
    expect(h).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('arriving with focus on the screen moves it to the question', async () => {
    mount();
    // RouteFocus parks focus on #view while the round's data loads.
    document.getElementById('view')!.focus();
    const h = await prompt();
    expect(h).not.toBeNull();
    expect(document.activeElement).toBe(h);
  });
});
