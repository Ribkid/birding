// @vitest-environment jsdom
// useMedia redraws photos when the saved photo index is read, when gallery.json arrives and when a new index is
// looked up (v1 waited for the saved index, drew again on gallery.json, and patched photos on onMediaReady).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const gate = vi.hoisted(() => {
  const make = () => { let resolve: (v?: unknown) => void = () => {}; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  return { index: make(), extras: make(), listeners: new Set<(i: unknown) => void>(), loadIndexCalls: 0 };
});
vi.mock('../core/db.js', () => ({ db: { all: async () => [], onChange: () => () => {} } }));
vi.mock('../core/media.js', () => ({
  cachedIndex: () => gate.index.promise,
  loadIndex: () => { gate.loadIndexCalls += 1; return gate.index.promise; },
  onMediaReady: (fn: (i: unknown) => void) => { gate.listeners.add(fn); return () => gate.listeners.delete(fn); },
}));
vi.mock('../core/gallery.js', () => ({ loadExtras: () => gate.extras.promise }));

import { mediaSettled, useMedia } from '../lib/hooks';

let renders = 0;
function Probe() {
  const v = useMedia();
  renders += 1;
  return <span data-v={v} data-settled={String(mediaSettled())} />;
}
afterEach(cleanup);

describe('useMedia', () => {
  it('re-renders when the saved index is read, when gallery.json lands and when a new index arrives', async () => {
    const { container } = render(<><Probe /><Probe /></>);
    const span = () => container.querySelector('span') as HTMLElement;
    expect(span().dataset.settled).toBe('false');
    expect(gate.loadIndexCalls).toBe(1);
    const v0 = Number(span().dataset.v);

    await act(async () => { gate.index.resolve({}); await gate.index.promise; });
    const v1 = Number(span().dataset.v);
    expect(v1).toBeGreaterThan(v0);
    expect(span().dataset.settled).toBe('false');

    await act(async () => { gate.extras.resolve(); await gate.extras.promise; });
    expect(Number(span().dataset.v)).toBeGreaterThan(v1);
    expect(span().dataset.settled).toBe('true');

    const before = renders;
    act(() => gate.listeners.forEach((fn) => fn({ 1: {} })));
    expect(renders).toBe(before + 2);
  });

  it('starts the loads once, however many photos mount', () => {
    render(<><Probe /><Probe /><Probe /></>);
    expect(gate.loadIndexCalls).toBe(1);
    expect(gate.listeners.size).toBe(1);
  });
});
