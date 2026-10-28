// @vitest-environment jsdom
// The shared species photo: v1's birdImg, settleImages and patchSpeciesImages (shimmer, one fade-in, no fade for a
// photo already shown, a better photo swapped in only once decoded, the striped block when a photo won't load).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import type { Species } from '../lib/data';

const media = vi.hoisted(() => {
  const subs = new Set<() => void>();
  const state = { version: 0, settled: true, urls: new Map<number, string | null>() };
  return {
    state,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    bump() { state.version += 1; subs.forEach((fn) => fn()); },
  };
});
vi.mock('../core/media.js', () => ({ sized: (id: number) => media.state.urls.get(id) ?? null }));
vi.mock('../lib/hooks', () => ({
  useMedia: () => useSyncExternalStore(media.subscribe, () => media.state.version),
  mediaSettled: () => media.state.settled,
}));

import { FadeImage, SpeciesImage } from '../components/SpeciesImage';

// jsdom loads no images: which addresses count as loaded (in the memory cache) is set by hand.
const loaded = new Set<string>();
let decodes: { src: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
beforeAll(() => {
  const proto = window.HTMLImageElement.prototype as any;
  Object.defineProperty(proto, 'complete', { configurable: true, get() { return !this.getAttribute('src') || loaded.has(this.getAttribute('src')); } });
  Object.defineProperty(proto, 'naturalWidth', { configurable: true, get() { return loaded.has(this.getAttribute('src')) ? 330 : 0; } });
  proto.decode = function () {
    const src = this.getAttribute('src');
    return new Promise<void>((resolve, reject) => decodes.push({ src, resolve, reject }));
  };
});
beforeEach(() => { loaded.clear(); decodes = []; media.state.settled = true; media.state.urls.clear(); });
afterEach(cleanup);

let nextId = 100;
const species = (url: string | null, name = 'Emu') => {
  const sp = { id: nextId++, name, kind: 'bird' } as unknown as Species;
  media.state.urls.set(sp.id, url);
  return sp;
};
const img = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement;

describe('SpeciesImage', () => {
  it('fades in once it loads, with the name as alt, or alt="" where the name is beside it', () => {
    const sp = species('https://x/a1.jpg');
    const { container } = render(<SpeciesImage sp={sp} />);
    expect(img(container).className).toBe('fade');
    expect(img(container).alt).toBe('Emu');
    expect(img(container).getAttribute('loading')).toBe('lazy');
    loaded.add('https://x/a1.jpg');
    fireEvent.load(img(container));
    expect(img(container).className).toBe('fade in');

    const quiet = render(<SpeciesImage sp={species('https://x/a2.jpg')} alt="" className="chosen-img" />);
    expect(img(quiet.container).getAttribute('alt')).toBe('');
    expect(img(quiet.container).className).toBe('chosen-img fade');
  });

  it('shows a photo already shown this session, or already in the memory cache, at once with no fade', () => {
    const first = render(<SpeciesImage sp={species('https://x/b1.jpg')} />);
    loaded.add('https://x/b1.jpg');
    fireEvent.load(img(first.container));
    cleanup();
    // Drawn again (a filter, a tab): full strength straight away.
    const again = render(<SpeciesImage sp={species('https://x/b1.jpg')} />);
    expect(img(again.container).className).toBe('fade in');
    // Never shown, but complete when drawn: in before the first paint.
    loaded.add('https://x/b2.jpg');
    const cached = render(<SpeciesImage sp={species('https://x/b2.jpg')} />);
    expect(img(cached.container).className).toBe('fade in');
  });

  it('keeps the photo on screen until a better one has decoded, so it never blanks', async () => {
    const sp = species('https://x/c1.jpg');
    const { container } = render(<SpeciesImage sp={sp} />);
    loaded.add('https://x/c1.jpg');
    fireEvent.load(img(container));
    const el = img(container);

    media.state.urls.set(sp.id, 'https://x/c2.jpg');
    act(() => media.bump());
    expect(img(container)).toBe(el);
    expect(el.getAttribute('src')).toBe('https://x/c1.jpg');
    expect(decodes.map((d) => d.src)).toEqual(['https://x/c2.jpg']);

    loaded.add('https://x/c2.jpg');
    await act(async () => { decodes[0].resolve(); });
    expect(el.getAttribute('src')).toBe('https://x/c2.jpg');
    expect(el.className).toBe('fade in');
  });

  it('switches at once when the photo on screen had not loaded yet', () => {
    const sp = species('https://x/d1.jpg');
    const { container } = render(<SpeciesImage sp={sp} />);
    media.state.urls.set(sp.id, 'https://x/d2.jpg');
    act(() => media.bump());
    expect(img(container).getAttribute('src')).toBe('https://x/d2.jpg');
    expect(img(container).className).toBe('fade');
    expect(decodes).toHaveLength(0);
  });

  it('shows the striped no-photo block when a photo will not load, and tries a better one later', () => {
    const sp = species('https://x/e1.jpg');
    const { container } = render(<SpeciesImage sp={sp} />);
    fireEvent.error(img(container));
    const block = container.querySelector('.img-missing') as HTMLElement;
    expect(block.tagName).toBe('SPAN');
    expect(block.getAttribute('role')).toBe('img');
    expect(block.getAttribute('aria-label')).toBe('Emu');
    expect(container.querySelector('img')).toBeNull();

    media.state.urls.set(sp.id, 'https://x/e2.jpg');
    act(() => media.bump());
    expect(img(container).getAttribute('src')).toBe('https://x/e2.jpg');

    const quiet = render(<SpeciesImage sp={species('https://x/e3.jpg')} alt="" />);
    fireEvent.error(img(quiet.container));
    const q = quiet.container.querySelector('.img-missing') as HTMLElement;
    expect(q.getAttribute('aria-hidden')).toBe('true');
    expect(q.getAttribute('role')).toBeNull();
  });

  it('shimmers while the photo index is still being read, then marks a species with no photo as missing', () => {
    media.state.settled = false;
    const sp = species(null);
    const { container } = render(<SpeciesImage sp={sp} alt="" />);
    const waiting = img(container);
    expect(waiting.className).toBe('fade');
    expect(waiting.getAttribute('src')).toBeNull();
    expect(waiting.getAttribute('aria-hidden')).toBe('true');

    media.state.settled = true;
    act(() => media.bump());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span.img-missing')).not.toBeNull();
  });

  it('starts afresh for a different species instead of holding the old one', () => {
    const a = species('https://x/f1.jpg', 'Emu');
    const b = species('https://x/f2.jpg', 'Brolga');
    const { container, rerender } = render(<SpeciesImage sp={a} />);
    loaded.add('https://x/f1.jpg');
    fireEvent.load(img(container));
    rerender(<SpeciesImage sp={b} />);
    expect(img(container).getAttribute('src')).toBe('https://x/f2.jpg');
    expect(img(container).alt).toBe('Brolga');
    expect(decodes).toHaveLength(0);
  });
});

describe('FadeImage', () => {
  it('fades in once, and hides if it cannot load so the card colour shows (v1 is-gone)', () => {
    const { container } = render(<FadeImage src="https://x/g1.jpg" />);
    expect(img(container).className).toBe('fade');
    expect(img(container).getAttribute('alt')).toBe('');
    loaded.add('https://x/g1.jpg');
    fireEvent.load(img(container));
    expect(img(container).className).toBe('fade in');

    const gone = render(<FadeImage src="https://x/g2.jpg" />);
    fireEvent.error(img(gone.container));
    expect(img(gone.container).className).toBe('fade is-gone');
  });
});
