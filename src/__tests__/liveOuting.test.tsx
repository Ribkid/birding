// @vitest-environment jsdom
// Live outing mode: a + that makes a species new for her dex gets its moment on the row and no card (the card made the
// page inert and lost the taps after it), the row keeps a New band that opens the card, the Finish sheet shows the
// outing's new species, the sign-up nudge waits for Finish, Screen on holds a wake lock only while asked and lets go
// by itself, and Sun switches to the Outdoor theme and back through saveTheme, keeping every other setting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// An in-memory db.js with change events, as the real one sends them.
const fake = vi.hoisted(() => {
  type Row = { id: number } & Record<string, unknown>;
  const f = {
    stores: { sightings: [] as Row[], outings: [] as Row[], patches: [] as Row[], photos: [] as Row[] } as Record<string, Row[]>,
    kv: {} as Record<string, unknown>,
    next: 100,
    listeners: new Set<(name: string) => void>(),
    emit(name: string) { for (const fn of f.listeners) fn(name); },
  };
  return f;
});
vi.mock('../core/db.js', () => {
  const tick = () => new Promise((r) => setTimeout(r, 2));
  const copy = <T,>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  return {
    db: {
      all: async (name: string) => { await tick(); return copy(fake.stores[name] ?? []); },
      get: async (name: string, key: unknown) => { await tick(); return name === 'kv' ? copy(fake.kv[String(key)]) : copy(fake.stores[name]?.find((r) => r.id === key)); },
      add: async (name: string, value: Record<string, unknown>) => {
        await tick();
        const id = fake.next++;
        Object.assign(value, { id, uid: `u${id}`, updatedAt: Date.now() });
        fake.stores[name].push(copy(value) as never);
        fake.emit(name);
        return id;
      },
      put: async (name: string, value: Record<string, unknown>, key?: string) => {
        await tick();
        if (name === 'kv') { fake.kv[String(key)] = copy(value); fake.emit(`kv:${key}`); return key; }
        value.updatedAt = Date.now();
        const list = fake.stores[name];
        const i = list.findIndex((r) => r.id === value.id);
        if (i >= 0) list[i] = copy(value) as never; else list.push(copy(value) as never);
        fake.emit(name);
        return value.id;
      },
      del: async (name: string, key: number) => { await tick(); fake.stores[name] = fake.stores[name].filter((r) => r.id !== key); fake.emit(name); },
      byIndex: async (name: string, index: string, value: unknown) => { await tick(); return copy(fake.stores[name].filter((r) => r[index] === value)); },
      kvGet: async (key: string) => { await tick(); return copy(fake.kv[key]); },
      kvSet: async (key: string, value: unknown) => { await tick(); fake.kv[key] = copy(value); fake.emit(`kv:${key}`); },
      onChange: (fn: (name: string) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn); },
    },
  };
});
vi.mock('../core/sync.js', () => ({ onRemoteChange: () => () => {}, onStatus: () => () => {} }));
vi.mock('../core/media.js', () => ({ sized: () => null }));
vi.mock('../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../lib/hooks')>()), useMedia: () => {} }));

import Outing from '../screens/lists/Outing';
import { SightingSheetHost } from '../components/SightingSheet';
import { SUN_PREV_KEY, SunToggle, currentTheme, sunStep, toggleSun } from '../components/SunToggle';
import { liveOutingId } from '../lib/liveOuting';
import { ScreenWake, WAKE_MAX_MS, type WakeEnv } from '../lib/wakeLock';
import { announceSaved, onCelebrate, type SaveOutcome } from '../screens/lists/shared';
import { refreshStore } from '../lib/store';
import { byId } from '../lib/data';

// layers.ts finds the control to give focus back to with CSS.escape, which jsdom lacks.
const g = globalThis as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...g.CSS, escape: (s: string) => s.replace(/["\\]/g, '\\$&') };

const today = '2026-10-29';
const LIFER = 94; // never logged in these records
const ON_OUTING = 5; // logged only on the live outing: new for her dex on it
const seed = ({ nudged = true } = {}) => {
  fake.stores = {
    sightings: [
      { id: 1, speciesId: 1, count: 1, heard: false, date: '2026-01-10', time: '07:00', lat: null, lng: null, acc: null, place: 'Home', notes: '', photoId: null, outingId: null, createdAt: 1 },
      { id: 2, speciesId: ON_OUTING, count: 2, heard: false, date: today, time: '07:05', lat: -27.44, lng: 153.17, acc: null, place: 'Sandy Camp Road Wetlands', notes: '', photoId: null, outingId: 2, createdAt: 2 },
    ],
    outings: [{ id: 2, date: today, time: '07:00', startedAt: Date.now() - 1800000, past: false, place: 'Sandy Camp Road Wetlands', lat: -27.44, lng: 153.17, endedAt: null, complete: false, notes: '' }],
    patches: [],
    photos: [],
  };
  fake.kv = { activeOuting: 2, ...(nudged ? { 'me:nudged': true } : {}) };
  fake.next = 100;
};

/** The outing page in the app's #view, with the host that draws the card. */
function page() {
  const view = document.createElement('div');
  view.id = 'view';
  return render(
    <MemoryRouter initialEntries={['/outing/2']}>
      <Routes><Route path="/outing/:id" element={<Outing />} /></Routes>
      <SightingSheetHost />
    </MemoryRouter>,
    { container: document.body.appendChild(view) },
  );
}
const main = (attr: string, id: number) => document.querySelector<HTMLElement>(`.tally-list:not(.tally-list--found) [${attr}="${id}"]`);
const stored = (speciesId: number) => fake.stores.sightings.filter((s) => s.speciesId === speciesId).map((s) => s.count);

beforeEach(async () => {
  seed();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
  await refreshStore();
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('.me-nudge, .celebrate, .toast, .confetti').forEach((n) => n.remove());
  document.body.className = '';
  vi.unstubAllGlobals();
});

describe('the live outing flag', () => {
  it('is the activeOuting while it has no endedAt', () => {
    const outings = [{ id: 2, endedAt: null }, { id: 3, endedAt: 5 }] as never[];
    expect(liveOutingId({ activeOuting: 2, outings })).toBe(2);
    expect(liveOutingId({ activeOuting: 3, outings })).toBeNull();
    expect(liveOutingId({ activeOuting: null, outings })).toBeNull();
    expect(liveOutingId({ activeOuting: 9, outings })).toBeNull();
  });
});

describe('a lifer on the tally', () => {
  it('counts every tap, opens no card, plays its moment, keeps focus on + and says it once', async () => {
    const cards = vi.fn();
    const off = onCelebrate(cards);
    const proto = HTMLElement.prototype as HTMLElement & { animate: unknown };
    const hadAnimate = Object.prototype.hasOwnProperty.call(proto, 'animate');
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, finish() {} }));
    proto.animate = animate;
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    const name = byId.get(LIFER)!.name;
    fireEvent.change(document.querySelector('[data-tq]')!, { target: { value: name } });
    const found = document.querySelector<HTMLElement>(`.tally-list--found [data-inc="${LIFER}"]`)!;
    // The search row already says it would be new, and has no band until it is on the tally.
    expect(found.closest('li')?.querySelector('.lifer')?.textContent).toBe('New for your dex');
    expect(found.closest('li')?.querySelector('.lifer-band')).toBeNull();
    // A tap focuses the button it lands on, as a phone's does.
    const tap = (el: HTMLElement) => { el.focus(); fireEvent.click(el); };
    tap(found);
    for (let k = 0; k < 4; k++) tap(main('data-inc', LIFER)!);
    expect(main('data-n', LIFER)?.textContent).toBe('5');
    // The moment, once: the New band clamps on and the label glows (500 ms each).
    const moved = (animate.mock.contexts as HTMLElement[]).map((el, i) => [el.className, (animate.mock.calls[i] as unknown[])[1]]);
    expect(moved.filter(([c]) => c === 'lifer-band')).toEqual([['lifer-band', { duration: 500, easing: 'cubic-bezier(.2, 1.4, .4, 1)' }]]);
    expect(moved.filter(([c]) => c === 'lifer')).toHaveLength(1);
    if (hadAnimate) proto.animate = animate; else delete (proto as { animate?: unknown }).animate;
    await waitFor(() => expect(stored(LIFER)).toEqual([5]), { timeout: 3000 });
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(cards).not.toHaveBeenCalled();
    expect(document.querySelector('.celebrate')).toBeNull();
    expect(document.activeElement).toBe(main('data-inc', LIFER));
    expect(document.getElementById('announce')?.textContent).toContain(`${name}, new for your dex`);
    // The band stays on the row and is a button that opens the card.
    const band = main('data-lifer', LIFER)!;
    expect(band.tagName).toBe('BUTTON');
    expect(band.getAttribute('aria-label')).toBe(`See ${name}'s card, new for your dex`);
    expect(band.textContent).toBe('New');
    // The species she had before the outing gets no band; the one first logged on it does.
    expect(main('data-lifer', ON_OUTING)).toBeTruthy();
    off();
  });

  it('the New band opens the full card, and focus comes back to it', async () => {
    // The card asks about reduced motion (no feathers then); jsdom has no matchMedia.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    page();
    await waitFor(() => expect(main('data-lifer', ON_OUTING)).toBeTruthy());
    const band = main('data-lifer', ON_OUTING)!;
    fireEvent.click(band);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeTruthy());
    expect(document.querySelector('.celebrate-kicker')?.textContent).toBe('New for your dex');
    expect(document.querySelector('.celebrate h2')?.textContent).toBe(byId.get(ON_OUTING)!.name);
    fireEvent.click(document.querySelector('.celebrate [data-dismiss]')!);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeNull());
    expect(document.activeElement).toBe(main('data-lifer', ON_OUTING));
  });

  it('the Finish sheet shows the outing\'s new species as photos', async () => {
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    fireEvent.click(document.querySelector('[data-finish]')!);
    const h = await waitFor(() => { const el = document.querySelector('.finish-lifers-h'); if (!el) throw new Error('no row'); return el; });
    expect(h.textContent).toBe('New for your dex today: 1');
    expect([...document.querySelectorAll('.finish-lifer-name')].map((n) => n.textContent)).toEqual([byId.get(ON_OUTING)!.name]);
  });

  it('a band tapped before its bird\'s first save has landed opens the card once the save is in, counting the bird', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const cards = vi.fn();
    const off = onCelebrate(cards);
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    fireEvent.change(document.querySelector('[data-tq]')!, { target: { value: byId.get(LIFER)!.name } });
    fireEvent.click(document.querySelector<HTMLElement>(`.tally-list--found [data-inc="${LIFER}"]`)!);
    // At once, while the save is still on its way: one card, and only once it is stored.
    const band = main('data-lifer', LIFER)!;
    fireEvent.click(band);
    fireEvent.click(band);
    expect(cards).not.toHaveBeenCalled();
    await waitFor(() => expect(cards).toHaveBeenCalledTimes(1));
    expect(stored(LIFER)).toEqual([1]);
    const c = cards.mock.calls[0][0] as { speciesId: number; sightings: { speciesId: number }[] };
    expect(c.speciesId).toBe(LIFER);
    expect(c.sightings.some((s) => s.speciesId === LIFER)).toBe(true);
    off();
  });

  it('a badge the lifer earned goes with it: its band\'s card and the Finish sheet say it, and take the toast down', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    page();
    await waitFor(() => expect(main('data-lifer', ON_OUTING)).toBeTruthy());
    announceSaved({ speciesId: ON_OUTING, date: today }, { id: 2, isNew: true, newBadges: [{ id: 'garden', name: 'Gardens & parks' }], sightings: [] }, { quiet: true });
    const toastEl = document.querySelector('.toast')!;
    expect(toastEl.textContent).toBe('Badge earned: Gardens & parks');
    fireEvent.click(main('data-lifer', ON_OUTING)!);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeTruthy());
    expect(document.querySelector('.celebrate-badges')?.textContent).toBe('Badge earned: Gardens & parks');
    expect(toastEl.classList.contains('toast--out')).toBe(true);
    fireEvent.click(document.querySelector('.celebrate [data-dismiss]')!);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeNull());
    // A second toast, then Finish: the sheet says the badge and the toast goes.
    announceSaved({ speciesId: ON_OUTING, date: today }, { id: 2, isNew: true, newBadges: [{ id: 'garden', name: 'Gardens & parks' }], sightings: [] }, { quiet: true });
    const again = document.querySelector('.toast:not(.toast--out)')!;
    fireEvent.click(document.querySelector('[data-finish]')!);
    const line = await waitFor(() => { const el = document.querySelector('.finish-lifers-badges'); if (!el) throw new Error('no badge line'); return el; });
    expect(line.textContent).toBe('Badge earned: Gardens & parks');
    expect(again.classList.contains('toast--out')).toBe(true);
  });
});

describe('saves outside the tally', () => {
  const outcome = (isNew: boolean, badges: string[] = []): SaveOutcome => ({ id: 9, isNew, newBadges: badges.map((n) => ({ id: n, name: n })), sightings: [] });

  it('still get the card; a quiet save only toasts a badge, read out with the species', async () => {
    const cards = vi.fn();
    const off = onCelebrate(cards);
    announceSaved({ speciesId: LIFER, date: today }, outcome(true));
    expect(cards).toHaveBeenCalledTimes(1);
    announceSaved({ speciesId: LIFER, date: today }, outcome(true, ['Gardens & parks']), { quiet: true });
    expect(cards).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')?.textContent).toBe('Badge earned: Gardens & parks');
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(document.getElementById('announce')?.textContent).toBe(`${byId.get(LIFER)!.name}, new for your dex. Badge earned: Gardens & parks`);
    off();
  });
});

describe('the sign-up nudge on a live outing', () => {
  it('waits for Finish, then shows once, and Not now puts the page back', async () => {
    seed({ nudged: false });
    await refreshStore();
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    // The third sighting, from the tally.
    fireEvent.change(document.querySelector('[data-tq]')!, { target: { value: byId.get(1)!.name } });
    fireEvent.click(document.querySelector('.tally-list--found [data-inc="1"]')!);
    await waitFor(() => expect(fake.stores.sightings).toHaveLength(3));
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    expect(document.querySelector('.me-nudge')).toBeNull();
    expect(fake.kv['me:nudged']).toBeUndefined();
    fireEvent.click(document.querySelector('[data-finish]')!);
    await waitFor(() => expect(document.querySelector('.sheet-wrap form')).toBeTruthy());
    fireEvent.submit(document.querySelector('.sheet-wrap form')!);
    await waitFor(() => expect(document.querySelector('.me-nudge')).toBeTruthy(), { timeout: 5000 });
    expect(document.querySelectorAll('.me-nudge')).toHaveLength(1);
    expect(fake.kv['me:nudged']).toBe(true);
    expect(document.body.classList.contains('has-nudge')).toBe(true);
    expect(document.body.style.getPropertyValue('--nudge-h')).toMatch(/px$/);
    fireEvent.click(document.querySelector('.me-nudge [data-nno]')!);
    expect(document.body.classList.contains('has-nudge')).toBe(false);
  }, 15000);
});

describe('Sun', () => {
  it('goes to Outdoor and back to the theme she had, or to Match my phone', () => {
    expect(sunStep('dark', null)).toEqual({ to: 'outdoor', remember: 'dark' });
    expect(sunStep('auto', null)).toEqual({ to: 'outdoor', remember: 'auto' });
    expect(sunStep('outdoor', 'light')).toEqual({ to: 'light', remember: null });
    expect(sunStep('outdoor', null)).toEqual({ to: 'auto', remember: null });
    expect(sunStep('outdoor', 'outdoor')).toEqual({ to: 'auto', remember: null });
    expect(sunStep('outdoor', 'nonsense')).toEqual({ to: 'auto', remember: null });
  });

  it('writes only the theme into the stored settings, and the button follows the theme', async () => {
    fake.kv.settings = { theme: 'dark', mapLayer: 'sat', colourUnseen: true };
    document.documentElement.dataset.theme = 'dark';
    const { getByRole } = render(<SunToggle />);
    const btn = getByRole('button', { name: 'Outdoor theme for bright sun' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await act(() => toggleSun());
    expect(currentTheme()).toBe('outdoor');
    expect(fake.kv.settings).toEqual({ theme: 'outdoor', mapLayer: 'sat', colourUnseen: true });
    expect(localStorage.getItem(SUN_PREV_KEY)).toBe('dark');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    await act(() => toggleSun());
    expect(currentTheme()).toBe('dark');
    expect(fake.kv.settings).toEqual({ theme: 'dark', mapLayer: 'sat', colourUnseen: true });
    expect(localStorage.getItem(SUN_PREV_KEY)).toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('spreads in a circle from the button when it can, and switches at once when it can\'t', async () => {
    const animate = vi.fn();
    const root = document.documentElement as HTMLElement & { animate: unknown };
    const was = root.animate;
    root.animate = animate;
    let navDuring = '';
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
      navDuring = root.dataset.nav ?? '';
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    };
    await act(() => toggleSun({ x: 300, y: 40 }));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(navDuring).toBe('sun');
    expect(currentTheme()).toBe('outdoor');
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as [{ clipPath: string[] }, { pseudoElement: string }];
    expect(frames.clipPath[0]).toBe('circle(0px at 300px 40px)');
    expect(opts.pseudoElement).toBe('::view-transition-new(root)');
    expect(root.dataset.nav).toBeUndefined();
    // Without the API: no reveal.
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    await act(() => toggleSun({ x: 300, y: 40 }));
    expect(currentTheme()).toBe('auto');
    expect(animate).toHaveBeenCalledTimes(1);
    root.animate = was;
  });
});

describe('Screen on', () => {
  function env() {
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    const sentinels: { released: boolean; release: () => Promise<void>; fire: () => void }[] = [];
    let fail = false;
    let timer: (() => void) | null = null;
    const e: WakeEnv = {
      wakeLock: {
        request: vi.fn(async () => {
          if (fail || doc.visibilityState !== 'visible') throw new Error('NotAllowedError');
          let onRelease = () => {};
          const s = {
            released: false,
            release: vi.fn(async () => { s.released = true; onRelease(); }),
            addEventListener: (_t: 'release', fn: () => void) => { onRelease = fn; },
            fire: () => { s.released = true; onRelease(); },
          };
          sentinels.push(s);
          return s;
        }),
      },
      doc: doc as unknown as WakeEnv['doc'],
      setTimer: (fn, ms) => { expect(ms).toBe(WAKE_MAX_MS); timer = fn; return 1; },
      clearTimer: () => { timer = null; },
    };
    return { e, doc, sentinels, failNext: () => { fail = true; }, expire: () => timer?.() };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('holds the screen only while on, asks again when the page comes back, and lets go on stop', async () => {
    const t = env();
    const changes: [boolean, string | undefined][] = [];
    const w = new ScreenWake(t.e, (on, why) => changes.push([on, why]));
    expect(t.e.wakeLock!.request).not.toHaveBeenCalled(); // off by default
    w.start();
    await flush();
    expect(w.held()).toBe(true);
    // The page is hidden: the browser lets go; coming back asks again.
    t.doc.visibilityState = 'hidden';
    t.sentinels[0].fire();
    expect(w.held()).toBe(false);
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(t.sentinels).toHaveLength(2);
    expect(w.held()).toBe(true);
    w.stop();
    expect(t.sentinels[1].release).toHaveBeenCalled();
    expect(w.held()).toBe(false);
    // Off: coming back asks for nothing.
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(t.sentinels).toHaveLength(2);
    expect(changes).toEqual([[true, undefined], [false, undefined]]);
  });

  it('turns itself off after two hours, or when the browser says no', async () => {
    const t = env();
    const changes: [boolean, string | undefined][] = [];
    const w = new ScreenWake(t.e, (on, why) => changes.push([on, why]));
    w.start();
    await flush();
    t.expire();
    expect(w.on).toBe(false);
    expect(t.sentinels[0].release).toHaveBeenCalled();
    t.failNext();
    w.start();
    await flush();
    expect(w.on).toBe(false);
    expect(changes.map((c) => c[1])).toEqual([undefined, 'timeout', undefined, 'failed']);
  });

  it('is not offered where the browser has no wake lock, and is in the header where it has', async () => {
    page();
    await waitFor(() => expect(document.querySelector('.outing-tools')).toBeTruthy());
    expect(document.querySelector('[data-wake]')).toBeNull();
    expect(document.querySelector('.outing-tools [data-sun]')).toBeTruthy();
    cleanup();
    const request = vi.fn(async () => ({ released: false, release: async () => {}, addEventListener: () => {} }));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { wakeLock: { request } }));
    page();
    const btn = await waitFor(() => { const b = document.querySelector<HTMLElement>('[data-wake]'); if (!b) throw new Error('none'); return b; });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    expect(request).toHaveBeenCalledWith('screen');
  });
});
