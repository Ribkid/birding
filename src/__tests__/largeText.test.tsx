// @vitest-environment jsdom
// Larger text (ui-improvements item 10). Chrome on Android narrows the CSS viewport as the phone's text grows: 300 px
// at 130%, 260 at 150%, 195 at 200%. These tests hold the tab bar's geometry to its promise at every width from 195
// to 420 px, by working the stylesheets' own numbers: the default layout is the same as before (12 px side gap, 6 px
// padding, a 58 px + and labels under the icons), every tab keeps a 44 px target while the width allows it, the labels
// go only when it doesn't, and all four tabs and the + always fit. They also keep the narrow rules out of the default
// layout, and check that the labels still name the links.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/data', () => ({ byId: new Map() }));
vi.mock('../core/db.js', () => ({ db: { kvGet: async () => null, onChange: () => () => {} } }));
vi.mock('../core/cloud.js', () => ({ onAuth: () => () => {} }));
vi.mock('../core/profile.js', () => ({
  configured: false,
  signedIn: () => false,
  getMyCloud: () => null,
  getProfile: () => ({ avatarSpeciesId: null }),
  initProfile: () => () => {},
  myName: () => '',
  avatarUrl: () => '',
}));
vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => null }));
vi.mock('../components/PlusSheet', () => ({ PlusSheet: () => null }));

import { TabBar } from '../components/TabBar';

afterEach(cleanup);

const css = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every style rule in a stylesheet with the at-rules (@media, @container, @supports) it sits in, outermost first. */
function rules(text: string) {
  const out: { sel: string; body: string; at: string[] }[] = [];
  const walk = (s: string, at: string[]) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < s.length) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const inner = s.slice(open + 1, j - 1);
      if (head.startsWith('@')) walk(inner, [...at, head]);
      else out.push({ sel: head.replace(/\s+/g, ' '), body: inner.replace(/\s+/g, ' ').trim(), at });
      i = j;
    }
  };
  walk(text, []);
  return out;
}
const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();

/** A shorthand's parts, split at the spaces outside parentheses: "0 clamp(2px, 4px, 6px)" is ["0", "clamp(2px, 4px, 6px)"]. */
function parts(value: string) {
  const out = [''];
  let depth = 0;
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && !depth) { if (out[out.length - 1]) out.push(''); } else out[out.length - 1] += ch;
  }
  return out;
}

/** A CSS length expression (px numbers, + - * /, parentheses, clamp/min/max/calc) worked out for one page width. */
function px(expr: string, vw: number, vars: Record<string, number> = {}): number {
  let e = expr.replace(/var\((--[\w-]+)\)/g, (_, v) => `${vars[v]}px`).replace(/100vw/g, `${vw}px`).replace(/calc\(/g, '(');
  e = e.replace(/(\d*\.?\d+)px/g, '$1');
  if (!/^[\d\s.+\-*/(),a-z]*$/.test(e) || /[a-z]/.test(e.replace(/clamp|min|max/g, ''))) throw new Error(`can't work out ${expr}`);
  const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi));
  return new Function('clamp', 'min', 'max', `return (${e});`)(clamp, Math.min, Math.max) as number;
}

describe('the tab bar at every text size', () => {
  const app = rules(css('styles/app.css'));
  const look = rules(css('styles/look.css'));
  const root = app.find((r) => r.sel === ':root' && !r.at.length && decl(r.body, '--tabbar-h'))!;
  const float = px(decl(rules(css('styles/look.css')).find((r) => r.sel === ':root' && !r.at.length)!.body, '--tabbar-float')!, 0);
  const bar = look.filter((r) => r.sel === '.tabbar' && !r.at.length).find((r) => decl(r.body, 'left'))!;
  const steps = look.filter((r) => r.at.some((a) => a.startsWith('@container tabbar')));
  const stepWidth = (r: { at: string[] }) => Number(r.at.find((a) => a.startsWith('@container tabbar'))!.match(/width < (\d+)px/)![1]);
  const plusDefault = Number(decl(look.find((r) => r.sel === '.tabbar .tab-plus' && !r.at.length)!.body, 'width')!.replace('px', ''));
  const plusSteps = steps.filter((r) => r.sel === '.tabbar .tab-plus').map((r) => ({ below: stepWidth(r), size: Number(decl(r.body, 'width')!.replace('px', '')) }));
  const labelStep = steps.find((r) => r.sel === '.tabbar .tab-label')!;

  /** The bar at a page width: its gap from the screen edges, its padding, the width inside it, the + and each tab. */
  function geometry(vw: number) {
    const vars = { '--tabbar-float': float };
    const gap = px(decl(bar.body, 'left')!, vw, vars);
    const pad = px(parts(decl(bar.body, 'padding')!)[1], vw, vars);
    const inner = Math.min(vw - 2 * gap, 560) - 2 * pad;
    const plus = plusSteps.filter((s) => inner < s.below).reduce((size, s) => Math.min(size, s.size), plusDefault);
    return { gap, pad, inner, plus, tab: (inner - plus) / 4, labels: !(inner < stepWidth(labelStep)) };
  }

  it('keeps --tabbar-h at 64 px', () => {
    expect(decl(root.body, '--tabbar-h')).toBe('64px');
  });

  it('draws the default layout as before: 12 px from the edges, 6 px padding, a 58 px +, labels', () => {
    for (const vw of [420, 390, 375, 360, 320, 300, 276]) {
      const g = geometry(vw);
      expect([g.gap, g.pad, g.plus, g.labels], `${vw} px`).toEqual([12, 6, 58, true]);
    }
    // The gap and padding hold down to 256 px; only the + and the labels give way between 256 and 276.
    for (let vw = 256; vw <= 420; vw += 0.5) expect([geometry(vw).gap, geometry(vw).pad], `${vw} px`).toEqual([12, 6]);
    expect(geometry(390).tab).toBe(74);
    expect(geometry(320).tab).toBe(56.5);
  });

  it('gives every tab and the + a 44 px target down to 232 px, labels and all at 150%', () => {
    for (let vw = 232; vw <= 420; vw += 0.5) {
      const g = geometry(vw);
      expect(g.tab, `${vw} px`).toBeGreaterThanOrEqual(44);
      expect(g.plus, `${vw} px`).toBeGreaterThanOrEqual(44);
    }
    expect(geometry(260)).toMatchObject({ plus: 48, tab: 44, labels: true });
  });

  it('keeps labels only while a tab is 44 px wide, and fits all five on the screen down to 200%', () => {
    for (let vw = 195; vw <= 420; vw += 0.5) {
      const g = geometry(vw);
      if (g.labels) expect(g.tab, `${vw} px`).toBeGreaterThanOrEqual(44);
      expect(2 * g.gap + 2 * g.pad + 4 * g.tab + g.plus, `${vw} px`).toBeLessThanOrEqual(vw + 0.001);
      expect(g.tab, `${vw} px`).toBeGreaterThanOrEqual(34);
    }
    // 200%: 4 px from the edges, 2 px padding, a 44 px + and four 34.75 px tabs, icons only.
    expect(geometry(195)).toMatchObject({ gap: 4, pad: 2, plus: 44, tab: 34.75, labels: false });
  });

  it('hides the labels only inside the narrow container query, visually (not display: none)', () => {
    const hiding = [...app, ...look].filter((r) => /\.tab-label/.test(r.sel));
    expect(hiding.length).toBeGreaterThan(0);
    for (const r of hiding) {
      expect(r.at.some((a) => /@container tabbar \(width < \d+px\)/.test(a)), r.sel).toBe(true);
      expect(r.body).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
      expect(r.body).toMatch(/clip-path: inset\(50%\)/);
    }
  });

  it('is a size container, with tabs that may shrink and pills that follow them', () => {
    const base = app.find((r) => r.sel === '.tabbar' && !r.at.length)!;
    expect(decl(base.body, 'container')).toBe('tabbar / inline-size');
    expect(decl(app.find((r) => r.sel === '.tabbar a' && !r.at.length)!.body, 'min-width')).toBe('0');
    expect(decl(app.find((r) => r.sel === '.tab-ico' && !r.at.length)!.body, 'width')).toBe('min(56px, 100%)');
  });
});

describe('the narrow rules stay out of the default layout', () => {
  // Each of these changes the layout, so it may only live inside a query for a narrow page or component.
  const narrowOnly: [string, RegExp, RegExp][] = [
    ['screens/species.css', /^\.bird \.hero-cap$/, /position: relative/],
    ['screens/species.css', /^\.bird \.bird-hero$/, /height: auto/],
    ['screens/species.css', /^\.bird \.hero-credit$/, /white-space: normal/],
    ['screens/screens.css', /^\.dex-cap-sub$/, /white-space: normal/],
    ['screens/screens.css', /^\.dex-hero-actions$/, /order: -1/],
    ['screens/learn/learn.css', /^\.lh-seg-thumb$/, /translateY/],
    ['screens/learn/learn.css', /^\.lh-modes$/, /minmax\(0, 1fr\)/],
    ['screens/lists/lists.css', /^\.page-head--tools h1$/, /grid-column: 1 \/ -1/],
    ['screens/rest.css', /^\.tally-foot--live \.spacer$/, /display: none/],
    ['screens/rest.css', /^\.tally-foot--live \.btn$/, /flex: 1 1 auto/],
    ['screens/species.css', /^\.bird \.bird-hero--model:has\(\.model-(hint|loading)\) \.hero-cap$/, /margin-top/],
    ['styles/app.css', /^\.grid2$/, /grid-template-columns: minmax\(0, 1fr\)/],
    ['screens/screens.css', /^\.rows--dex \.row--sp$/, /"main main main"/],
    ['styles/app.css', /^\.gbars \.meter$/, /grid-row: 2/],
    ['screens/screens.css', /^\.trophy-top$/, /flex-direction: column/],
    ['screens/screens.css', /^\.shelf$/, /columns: (repeat\(2, )?minmax\(0, 1fr\)/],
    ['screens/species.css', /^\.compare \.cmp$/, /columns: minmax\(0, 1fr\)/],
  ];
  it.each(narrowOnly)('%s: %s', (file, sel, body) => {
    const found = rules(css(file)).filter((r) => sel.test(r.sel) && body.test(r.body));
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) expect(r.at.some((a) => /\((?:max-)?width\s*[<:]\s*\d+px\)/.test(a)), `${r.sel} { ${r.body} }`).toBe(true);
  });

  it('gives the species switch 44 px segments at every size, the chosen pill still 38 px', () => {
    const sp = rules(css('screens/species.css'));
    expect(decl(sp.find((r) => r.sel === '.bird .hero-tabs button' && !r.at.length)!.body, 'min-height')).toBe('var(--tap)');
    expect(decl(sp.find((r) => r.sel === '.bird .hero-tabs button::before' && !r.at.length)!.body, 'inset')).toBe('3px 0');
  });
});

describe('the tab labels', () => {
  it('sit in .tab-label spans and still name the links', () => {
    const { container } = render(<MemoryRouter initialEntries={['/dex']}><TabBar /></MemoryRouter>);
    expect([...container.querySelectorAll('.tabbar .tab-label')].map((s) => s.textContent)).toEqual(['Dex', 'Learn', 'Map', 'Me']);
    for (const name of ['Dex', 'Learn', 'Add a sighting', 'Map', 'Me']) expect(screen.getByRole('link', { name })).toBeTruthy();
  });
});
