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
import { saveTheme } from '../screens/progress/theme';
import { liveOutingId } from '../lib/liveOuting';
import { ScreenWake, WAKE_MAX_MS, type WakeEnv } from '../lib/wakeLock';
import { announceSaved, onCelebrate, type SaveOutcome } from '../screens/lists/shared';
import { refreshStore } from '../lib/store';
import { forgetTally } from '../screens/lists/useTally';
import { byId } from '../lib/data';
import { clearOf, toast } from '../lib/toast';

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
  // Each test's records start afresh, ids and all: the outing's tally queue must not remember the last test's writes.
  forgetTally(2);
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
    expect(toastEl.isConnected).toBe(false); // gone at once: it sits above the card, so a fade would draw over it
    fireEvent.click(document.querySelector('.celebrate [data-dismiss]')!);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeNull());
    // A second toast, then Finish: the sheet says the badge and the toast goes at once.
    announceSaved({ speciesId: ON_OUTING, date: today }, { id: 2, isNew: true, newBadges: [{ id: 'garden', name: 'Gardens & parks' }], sightings: [] }, { quiet: true });
    const again = document.querySelector('.toast:not(.toast--out)')!;
    fireEvent.click(document.querySelector('[data-finish]')!);
    expect(document.querySelector('.toast')).toBeNull();
    const line = await waitFor(() => { const el = document.querySelector('.finish-lifers-badges'); if (!el) throw new Error('no badge line'); return el; });
    expect(line.textContent).toBe('Badge earned: Gardens & parks');
    expect(again.classList.contains('toast--out')).toBe(true);
    expect(again.isConnected).toBe(false);
  });

  it('a badge whose save lands with the Finish sheet already open is said in the sheet, not in a toast over its fields', async () => {
    const quiet = (names: string[]) => announceSaved({ speciesId: ON_OUTING, date: today }, { id: 2, isNew: true, newBadges: names.map((n) => ({ id: n, name: n })), sightings: [] }, { quiet: true });
    quiet([]); // no badge from an earlier test
    page();
    await waitFor(() => expect(main('data-lifer', ON_OUTING)).toBeTruthy());
    fireEvent.click(document.querySelector('[data-finish]')!);
    await waitFor(() => expect(document.querySelector('.finish-lifers-h')).toBeTruthy());
    expect(document.querySelector('.finish-lifers-badges')).toBeNull();
    act(() => quiet(['Wetlands']));
    await waitFor(() => expect(document.querySelector('.finish-lifers-badges')?.textContent).toBe('Badge earned: Wetlands'));
    expect(document.querySelector('.toast:not(.toast--out)')).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(document.getElementById('announce')?.textContent).toBe(`${byId.get(ON_OUTING)!.name}, new for your dex. Badge earned: Wetlands`);
  });
});

describe('a row counted down to 0', () => {
  const SEEN = 1; // in her dex from before; here also on the outing at 1, above ON_OUTING (at 2)
  async function withRowAtOne() {
    fake.stores.sightings.push({ id: 3, speciesId: SEEN, count: 1, heard: false, date: today, time: '07:10', lat: -27.44, lng: 153.17, acc: null, place: 'Sandy Camp Road Wetlands', notes: 'kept', photoId: null, outingId: 2, createdAt: 3 });
    await refreshStore();
    page();
    await waitFor(() => expect(main('data-dec', SEEN)).toBeTruthy());
  }
  const rowOf = (id: number) => main('data-inc', id)!.closest('li')!;
  const tap = (el: HTMLElement) => { el.focus(); fireEvent.click(el); };
  const onOuting = (id: number) => fake.stores.sightings.filter((s) => s.speciesId === id && s.outingId === 2).map((s) => s.count);

  it('holds its place at 0 with Undo, so quick taps after it never reach the row below', async () => {
    await withRowAtOne();
    const order = () => [...document.querySelectorAll('.tally-list:not(.tally-list--found) > li')].map((li) => Number(li.getAttribute('data-sp')));
    expect(order()).toEqual([SEEN, ON_OUTING]);
    const minus = main('data-dec', SEEN)!;
    tap(minus);
    tap(main('data-dec', SEEN)!);
    tap(main('data-dec', SEEN)!);
    // Still in its place, at 0: the − rests, the + is Undo, and the bird below kept its 2.
    expect(order()).toEqual([SEEN, ON_OUTING]);
    expect(rowOf(SEEN).classList.contains('tally-row--zero')).toBe(true);
    expect(rowOf(SEEN).querySelector('[data-n0]')?.textContent).toBe('0');
    expect(main('data-dec', SEEN)!.getAttribute('aria-disabled')).toBe('true');
    expect(main('data-inc', SEEN)!.getAttribute('aria-label')).toBe(`Undo, put ${byId.get(SEEN)!.name} back`);
    expect(main('data-n', ON_OUTING)!.textContent).toBe('2');
    expect(document.activeElement).toBe(main('data-dec', SEEN));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(document.getElementById('announce')?.textContent).toBe(`${byId.get(SEEN)!.name} taken off. Undo puts it back.`);
    // Nothing is taken off the stored sighting while it holds.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(onOuting(SEEN)).toEqual([1]);
    // Its time up, it folds away and its sighting goes; the bird below is untouched.
    await waitFor(() => expect(main('data-inc', SEEN)).toBeNull(), { timeout: 6000 });
    await waitFor(() => expect(onOuting(SEEN)).toEqual([]));
    expect(onOuting(ON_OUTING)).toEqual([2]);
  }, 10000);

  it('Undo puts it back as it was, with nothing written', async () => {
    await withRowAtOne();
    tap(main('data-dec', SEEN)!);
    tap(main('data-inc', SEEN)!); // Undo
    expect(rowOf(SEEN).classList.contains('tally-row--zero')).toBe(false);
    expect(main('data-n', SEEN)!.textContent).toBe('1');
    expect(main('data-inc', SEEN)!.textContent).toBe('+');
    expect(document.activeElement).toBe(main('data-inc', SEEN));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    // The same record, notes and all: nothing was deleted and made again.
    expect(fake.stores.sightings.find((s) => s.speciesId === SEEN && s.outingId === 2)).toMatchObject({ id: 3, count: 1, notes: 'kept' });
    // A + after it counts on as usual.
    tap(main('data-inc', SEEN)!);
    await waitFor(() => expect(onOuting(SEEN)).toEqual([2]));
  });

  it('goes at once on Finish, and when she leaves the outing', async () => {
    await withRowAtOne();
    tap(main('data-dec', SEEN)!);
    fireEvent.click(document.querySelector('[data-finish]')!);
    expect(main('data-inc', SEEN)).toBeNull();
    await waitFor(() => expect(onOuting(SEEN)).toEqual([]));
    cleanup();
    forgetTally(2);
    seed();
    await withRowAtOne();
    tap(main('data-dec', SEEN)!);
    cleanup(); // leaving the page
    await waitFor(() => expect(onOuting(SEEN)).toEqual([]));
    expect(onOuting(ON_OUTING)).toEqual([2]);
  });

  it('keeps its place while she counts on the row below, so the rows under her thumb never move, and folds once she stops', async () => {
    await withRowAtOne();
    const order = () => [...document.querySelectorAll('.tally-list:not(.tally-list--found) > li')].map((li) => Number(li.getAttribute('data-sp')));
    tap(main('data-dec', SEEN)!);
    const plusBelow = main('data-inc', ON_OUTING)!;
    // A flock on the row below, one tap a second: past the 4 s a row at 0 would hold on its own.
    for (let k = 0; k < 5; k++) {
      await act(() => new Promise((r) => setTimeout(r, 950)));
      expect(order()).toEqual([SEEN, ON_OUTING]);
      expect(main('data-inc', ON_OUTING)).toBe(plusBelow);
      tap(plusBelow);
    }
    expect(rowOf(SEEN).classList.contains('tally-row--zero')).toBe(true);
    expect(main('data-n', ON_OUTING)!.textContent).toBe('7');
    // She stops: it folds away 4 s after her last tap, and its sighting goes.
    await act(() => new Promise((r) => setTimeout(r, 3000)));
    expect(order()).toEqual([SEEN, ON_OUTING]);
    await waitFor(() => expect(order()).toEqual([ON_OUTING]), { timeout: 3000 });
    await waitFor(() => expect(onOuting(SEEN)).toEqual([]));
    await waitFor(() => expect(onOuting(ON_OUTING)).toEqual([7]));
  }, 20000);
});

describe('a bird found with the search', () => {
  const found = () => [...document.querySelectorAll<HTMLElement>('.tally-list--found [data-inc]')];
  const tap = (el: HTMLElement) => { el.focus(); fireEvent.click(el); };
  const onOuting = (id: number) => fake.stores.sightings.filter((s) => s.speciesId === id && s.outingId === 2).map((s) => s.count);

  it('takes a quick burst of taps on any result, not just the first, and the search clears once she stops', async () => {
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    const box = document.querySelector<HTMLInputElement>('[data-tq]')!;
    fireEvent.change(box, { target: { value: 'honeyeater' } });
    expect(found().length).toBeGreaterThan(3);
    const plus = found()[2]; // the third result: the tally's rows would be under her thumb once the results went
    const id = Number(plus.getAttribute('data-inc'));
    for (let k = 0; k < 5; k++) {
      // Still the same button in the same list after every tap, while she keeps tapping.
      expect(found()[2]).toBe(plus);
      tap(plus);
      await act(() => new Promise((r) => setTimeout(r, 150)));
    }
    expect(box.value).toBe('honeyeater');
    expect(plus.closest('li')?.querySelector('[data-n]')?.textContent).toBe('5');
    // It joins the tally at once (below the results), with its New band on both rows.
    expect(main('data-n', id)?.textContent).toBe('5');
    expect(plus.closest('li')?.querySelector('.lifer-band')).toBeTruthy();
    // She stops: the search clears and focus goes to the bird's + on the tally.
    await waitFor(() => expect(box.value).toBe(''), { timeout: 3000 });
    expect(found()).toEqual([]);
    expect(document.activeElement).toBe(main('data-inc', id));
    await waitFor(() => expect(onOuting(id)).toEqual([5]));
    expect(onOuting(ON_OUTING)).toEqual([2]);
  });

  it('a + on a tally row with the results up keeps them up while she taps, so the tally does not move under her', async () => {
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    const box = document.querySelector<HTMLInputElement>('[data-tq]')!;
    fireEvent.change(box, { target: { value: 'honeyeater' } });
    const plus = main('data-inc', ON_OUTING)!;
    for (let k = 0; k < 3; k++) {
      tap(plus);
      await act(() => new Promise((r) => setTimeout(r, 600)));
      expect(found().length).toBeGreaterThan(0);
    }
    await waitFor(() => expect(box.value).toBe(''), { timeout: 3000 });
    await waitFor(() => expect(onOuting(ON_OUTING)).toEqual([5]));
  });

  it('a result\'s New band opens the card; the results wait for it to close, then focus goes to the band on the tally', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    const box = document.querySelector<HTMLInputElement>('[data-tq]')!;
    fireEvent.change(box, { target: { value: byId.get(LIFER)!.name } });
    tap(document.querySelector<HTMLElement>(`.tally-list--found [data-inc="${LIFER}"]`)!);
    const band = document.querySelector<HTMLElement>(`.tally-list--found [data-lifer="${LIFER}"]`)!;
    tap(band);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeTruthy());
    await act(() => new Promise((r) => setTimeout(r, 2000)));
    expect(box.value).toBe(byId.get(LIFER)!.name); // still there under the card
    fireEvent.click(document.querySelector('.celebrate [data-dismiss]')!);
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeNull());
    expect(document.activeElement).toBe(band);
    await waitFor(() => expect(box.value).toBe(''), { timeout: 3000 });
    expect(document.activeElement).toBe(main('data-lifer', LIFER));
  });

  it('typing a new name after a + keeps what she types', async () => {
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    const box = document.querySelector<HTMLInputElement>('[data-tq]')!;
    fireEvent.change(box, { target: { value: 'honeyeater' } });
    tap(found()[1]);
    fireEvent.change(box, { target: { value: 'cormorant' } });
    await act(() => new Promise((r) => setTimeout(r, 2000)));
    expect(box.value).toBe('cormorant');
    expect(found().length).toBeGreaterThan(0);
  });
});

describe('"Outing finished"', () => {
  it('rests just above the finished outing\'s buttons when its usual place would cover them', () => {
    const vh = 844;
    const rest = { top: 646, bottom: 694 }; // its usual place, above the tab bar
    expect(clearOf(rest, { top: 642, bottom: 746 }, vh)).toBe(vh - 642 + 10); // the foot at the bottom: it steps up
    expect(clearOf(rest, { top: 300, bottom: 400 }, vh)).toBeNull(); // the foot higher up the page: it stays
    expect(clearOf(rest, { top: 700, bottom: 900 }, vh)).toBeNull(); // the foot below it
    expect(clearOf(rest, { top: 100, bottom: 800 }, vh)).toBeNull(); // no room above: it stays (a tap takes it away)
    expect(clearOf(rest, { top: 0, bottom: 0 }, vh)).toBeNull(); // not drawn
  });

  it('is said once the page has drawn the outing as finished', async () => {
    page();
    await waitFor(() => expect(main('data-inc', ON_OUTING)).toBeTruthy());
    fireEvent.click(document.querySelector('[data-finish]')!);
    await waitFor(() => expect(document.querySelector('.sheet-wrap form')).toBeTruthy());
    fireEvent.submit(document.querySelector('.sheet-wrap form')!);
    await waitFor(() => expect(document.querySelector('.toast')?.textContent).toBe('Outing finished'));
    expect(document.querySelector('[data-finish]')?.textContent).toBe('Edit details');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
  });

  it('steps clear of the buttons again when the sign-up nudge comes up under it and lifts it onto them', async () => {
    // jsdom lays nothing out: the toast's places come from these rules, its height and the buttons' box are given.
    const css = document.head.appendChild(document.createElement('style'));
    css.textContent = '.toast { bottom: 100px; } body.has-nudge .toast { bottom: 250px; }';
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('toast') ? 48 : 0; } });
    const foot = document.body.appendChild(document.createElement('div'));
    foot.getBoundingClientRect = () => ({ top: innerHeight - 300, bottom: innerHeight - 220 }) as DOMRect;
    try {
      const down = toast('Outing finished', undefined, { clear: foot });
      const t = document.querySelector<HTMLElement>('.toast')!;
      expect(t.style.bottom).toBe(''); // its usual place, under the buttons, is clear of them
      document.body.classList.add('has-nudge'); // lifted to 250 px up: onto the buttons
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(t.style.bottom).toBe('310px'); // just above them instead
      document.body.classList.remove('has-nudge');
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(t.style.bottom).toBe('');
      down(true);
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
      css.remove();
      foot.remove();
    }
  });

  it('stops watching the page once a newer toast takes its place, not only when it times out', () => {
    const watching = new Set<MutationObserver>();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe').mockImplementation(function (this: MutationObserver, target: Node) {
      if (target === document.body) watching.add(this);
    });
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect').mockImplementation(function (this: MutationObserver) {
      watching.delete(this);
    });
    const foot = document.body.appendChild(document.createElement('div'));
    try {
      toast('Outing finished', undefined, { clear: foot });
      expect(watching.size).toBe(1);
      // Edit details, Save details within its 4.5 s: a second "Outing finished" replaces it.
      const down = toast('Outing finished', undefined, { clear: foot });
      expect(document.querySelectorAll('.toast')).toHaveLength(1);
      expect(watching.size).toBe(1);
      toast('Badge earned: Gardens & parks'); // any other toast replaces it too
      expect(watching.size).toBe(0);
      down(true); // a late take-down of the replaced one does nothing more
      expect(watching.size).toBe(0);
      document.querySelector('.toast')?.remove();
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
      foot.remove();
    }
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

  /** A view transition as the browser runs one: the update a moment later, and finished only when it ends. */
  function liveReveal() {
    const root = document.documentElement as HTMLElement & { animate: unknown };
    const was = root.animate;
    root.animate = vi.fn();
    const runs: { finish: () => void; skip: ReturnType<typeof vi.fn> }[] = [];
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
      let finish = () => {};
      const finished = new Promise<void>((r) => { finish = r; });
      const run = { finish, skip: vi.fn(() => finish()) };
      runs.push(run);
      return { ready: new Promise<void>((r) => setTimeout(r, 5)).then(() => { cb(); }), finished, skipTransition: run.skip };
    };
    return {
      root,
      runs,
      done: () => {
        root.animate = was;
        delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
      },
    };
  }

  it('resolves once the theme is stored, even when the reveal puts it on the page a moment later', async () => {
    const vt = liveReveal();
    fake.kv.settings = { theme: 'dark', mapLayer: 'sat' };
    document.documentElement.dataset.theme = 'dark';
    await act(() => toggleSun({ x: 300, y: 40 }));
    expect(fake.kv.settings).toEqual({ theme: 'outdoor', mapLayer: 'sat' });
    vt.runs.forEach((r) => r.finish());
    vt.done();
  });

  it('a second tap while the reveal still runs takes her straight back, and the reveal after it keeps its look', async () => {
    const vt = liveReveal();
    fake.kv.settings = { theme: 'dark' };
    document.documentElement.dataset.theme = 'dark';
    await act(() => toggleSun({ x: 300, y: 40 }));
    expect(currentTheme()).toBe('outdoor');
    await act(() => toggleSun({ x: 300, y: 40 }));
    expect(currentTheme()).toBe('dark');
    expect(fake.kv.settings).toEqual({ theme: 'dark' });
    expect(localStorage.getItem(SUN_PREV_KEY)).toBeNull();
    // The first reveal ending (the browser skips it for the second) leaves the second its data-nav.
    vt.runs[0].finish();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(vt.root.dataset.nav).toBe('sun');
    vt.runs[1].finish();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(vt.root.dataset.nav).toBeUndefined();
    vt.done();
  });

  it('a press on the page while the reveal runs ends it, and the tap reaches what is under it', async () => {
    const vt = liveReveal();
    document.documentElement.dataset.theme = 'light';
    const plus = document.body.appendChild(document.createElement('button'));
    const icon = plus.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const counted = vi.fn();
    plus.addEventListener('click', counted);
    const doc = document as Document & { elementFromPoint?: unknown };
    const efp = doc.elementFromPoint;
    doc.elementFromPoint = () => icon;
    await act(() => toggleSun({ x: 300, y: 40 }));
    // The browser aims every tap at <html> while the reveal is one picture over the page.
    vt.root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 400 }));
    expect(vt.runs[0].skip).toHaveBeenCalledTimes(1);
    // The click the browser aimed at <html> goes no further (the one handed on bubbles through it from the button).
    const lost = vi.fn();
    const onRoot = (ev: Event) => { if (ev.target === vt.root) lost(); };
    vt.root.addEventListener('click', onRoot);
    vt.root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 400 }));
    expect(counted).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(plus);
    expect(lost).not.toHaveBeenCalled();
    // Once it is over, a click on the page itself is left alone.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    vt.root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    vt.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(counted).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(currentTheme()).toBe('outdoor');
    vt.root.removeEventListener('click', onRoot);
    doc.elementFromPoint = efp;
    plus.remove();
    vt.done();
  });

  it('goes back to the theme Outdoor took over from, however Outdoor came on', async () => {
    fake.kv.settings = { theme: 'light', colourUnseen: true };
    document.documentElement.dataset.theme = 'light';
    await act(() => toggleSun());
    expect(localStorage.getItem(SUN_PREV_KEY)).toBe('light');
    // In Settings: Dark, then Outdoor. Sun off goes to Dark, the theme she picked last.
    await act(() => saveTheme('dark'));
    expect(localStorage.getItem(SUN_PREV_KEY)).toBeNull();
    await act(() => saveTheme('outdoor'));
    expect(localStorage.getItem(SUN_PREV_KEY)).toBe('dark');
    await act(() => toggleSun());
    expect(currentTheme()).toBe('dark');
    expect(fake.kv.settings).toEqual({ theme: 'dark', colourUnseen: true });
    expect(localStorage.getItem(SUN_PREV_KEY)).toBeNull();
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

  it('asks once more when the browser lets go while the page is in view, and turns off if it goes again', async () => {
    const t = env();
    const changes: [boolean, string | undefined][] = [];
    const w = new ScreenWake(t.e, (on, why) => changes.push([on, why]));
    w.start();
    await flush();
    t.sentinels[0].fire(); // battery saver, say, with the page still in view
    await flush();
    expect(t.sentinels).toHaveLength(2);
    expect(w.held()).toBe(true);
    t.sentinels[1].fire();
    await flush();
    expect(w.on).toBe(false);
    expect(t.sentinels).toHaveLength(2);
    expect(changes).toEqual([[true, undefined], [false, 'failed']]);
    // A fresh visit (hidden and back) gets its one more ask again.
    w.start();
    await flush();
    t.doc.visibilityState = 'hidden';
    t.sentinels[2].fire();
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    t.sentinels[3].fire();
    await flush();
    expect(w.on).toBe(true);
    expect(w.held()).toBe(true);
  });

  it('a page shown again while an earlier ask is still out asks once more, rather than turning off when that one is refused', async () => {
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    const asks: { resolve: (s: unknown) => void; reject: (e: unknown) => void }[] = [];
    const request = vi.fn(() => new Promise((resolve, reject) => { asks.push({ resolve, reject }); }));
    const e = {
      wakeLock: { request },
      doc: doc as unknown as WakeEnv['doc'],
      setTimer: () => 1,
      clearTimer: () => {},
    } as unknown as WakeEnv;
    const changes: [boolean, string | undefined][] = [];
    const w = new ScreenWake(e, (on, why) => changes.push([on, why]));
    w.start();
    // She switches away and straight back while the first ask is out.
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);
    asks[0].reject(new Error('NotAllowedError')); // refused: the page was hidden as it was asked
    await flush();
    expect(w.on).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    asks[1].resolve({ released: false, release: async () => {}, addEventListener: () => {} });
    await flush();
    expect(w.held()).toBe(true);
    expect(changes).toEqual([[true, undefined]]);
    // Refused with the page in view and nothing asked since: it turns off and says so, as before.
    w.stop();
    w.start();
    asks[2].reject(new Error('NotAllowedError'));
    await flush();
    expect(w.on).toBe(false);
    expect(changes.at(-1)).toEqual([false, 'failed']);
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
