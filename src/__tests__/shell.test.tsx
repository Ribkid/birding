// @vitest-environment jsdom
// index.html paints a static shell before React runs: the Dex hero and TabBar's markup, with an inline script that
// marks the current tab. React's first draw replaces it in place, so the two must never drift: the shell's tab bar is
// TabBar's first render exactly, and the script marks the same tab TabBar does on every route.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';

vi.mock('../lib/data', () => ({ byId: new Map() }));
vi.mock('../core/db.js', () => ({ db: { kvGet: async () => null, onChange: () => () => {} } }));
vi.mock('../core/cloud.js', () => ({ onAuth: () => () => {} }));
// A visitor who has not signed in, with accounts set up as in the real config (the Me tab then carries its dot).
vi.mock('../core/profile.js', async () => {
  const { SUPABASE_URL, SUPABASE_KEY } = await import('../core/config.js');
  return {
    configured: !!(SUPABASE_URL && SUPABASE_KEY),
    signedIn: () => false,
    getMyCloud: () => null,
    getProfile: () => ({ avatarSpeciesId: null }),
    initProfile: () => () => {},
    myName: () => '',
    avatarUrl: () => '',
  };
});
vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => null }));
vi.mock('../components/PlusSheet', () => ({ PlusSheet: () => null }));

import { TabBar } from '../components/TabBar';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');
const shellRoot = page.getElementById('root')!;
const script = [...page.querySelectorAll('script:not([src])')].map((s) => s.textContent || '').join('\n');

/** Tag, attributes (sorted) and children, ignoring whitespace between tags. */
function norm(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ');
  const kids = [...el.childNodes].map(norm).filter(Boolean).join('');
  return `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${kids}</${el.tagName.toLowerCase()}>`;
}

const drawTabBar = (hash: string) => {
  window.location.hash = hash;
  return render(<HashRouter><TabBar /></HashRouter>).container.querySelector('nav.tabbar')!;
};

/** The shell as the browser has it after the inline script ran, on `hash`. */
function shellOn(hash: string) {
  window.location.hash = hash;
  document.body.innerHTML = `<div id="root">${shellRoot.innerHTML}</div>`;
  new Function(script)();
  const root = document.getElementById('root')!;
  document.body.innerHTML = '';
  return root;
}
const marks = (nav: Element) => [...nav.querySelectorAll('a')].map((a) => `${a.getAttribute('href')} ${a.getAttribute('aria-current')}`);

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the static shell', () => {
  it("has TabBar's markup exactly", () => {
    const shell = shellRoot.querySelector('nav.tabbar');
    expect(shell).not.toBeNull();
    expect(norm(shell!)).toBe(norm(drawTabBar('#/dex')));
  });

  it('marks the tab TabBar marks, on every kind of address', () => {
    for (const hash of ['', '#/', '#/dex', '#/bird/94', '#/compare/1/2', '#/listen', '#/scan', '#/add', '#/learn', '#/learn/daily',
      '#/quiz', '#/map', '#/map/at/-27.4,153', '#/me', '#/me/edit', '#/u/abc', '#/lists', '#/list/life', '#/patch/1', '#/targets?near=1',
      '#/outing/2', '#/log', '#/stats', '#/badges', '#/settings', '#/leaderboard', '#/nope']) {
      const shell = shellOn(hash).querySelector('nav.tabbar')!;
      const app = drawTabBar(hash || '#/');
      expect(marks(shell), hash).toEqual(marks(app));
      cleanup();
    }
  });

  it('keeps the Dex hero only on the Dex', () => {
    for (const hash of ['', '#/', '#/dex', '#/dex?x=1']) expect(shellOn(hash).querySelector('[data-shell] .dex-hero'), hash).not.toBeNull();
    for (const hash of ['#/bird/94', '#/map', '#/settings', '#/learn']) {
      const main = shellOn(hash).querySelector('[data-shell]')!;
      expect(main.children.length, hash).toBe(0);
    }
  });

  it('is the screen React draws over: #view, before the tab bar, inside #root', () => {
    const main = shellRoot.querySelector('main#view[data-shell]');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(main?.nextElementSibling?.matches('nav.tabbar')).toBe(true);
    // Its heading is the Dex's own wordmark, and the capsule waiting for her count is hidden from screen readers.
    expect(main?.querySelector('h1.wordmark')?.textContent).toBe("Sarah's BirdyDexSouth East Queensland");
    expect(main?.querySelector('.dex-cap')?.getAttribute('aria-hidden')).toBe('true');
  });
});
