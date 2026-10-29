// @vitest-environment jsdom
// Scan and Listen log through the shared Log a sighting form, so a species new for her dex gets the same "New for your
// dex" card as every other save path (v1's saveSighting then celebrate). Listen's Log it opens the sheet over Listen;
// Scan hands its photo to the #/add page, which goes back to the scan result and raises the card there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
  const copy = <T,>(x: T): T => (x === undefined || x instanceof Blob ? x : JSON.parse(JSON.stringify(x)));
  return {
    db: {
      all: async (name: string) => { await tick(); return copy(fake.stores[name] ?? []); },
      get: async (name: string, key: unknown) => { await tick(); return name === 'kv' ? copy(fake.kv[String(key)]) : copy(fake.stores[name]?.find((r) => r.id === key)); },
      add: async (name: string, value: Record<string, unknown>) => {
        await tick();
        const id = fake.next++;
        Object.assign(value, { id, uid: `u${id}`, updatedAt: Date.now() });
        fake.stores[name].push({ ...value } as never);
        fake.emit(name);
        return id;
      },
      put: async (name: string, value: Record<string, unknown>, key?: string) => {
        await tick();
        if (name === 'kv') { fake.kv[String(key)] = copy(value); fake.emit(`kv:${key}`); return key; }
        const list = fake.stores[name];
        const i = list.findIndex((r) => r.id === value.id);
        if (i >= 0) list[i] = { ...value } as never; else list.push({ ...value } as never);
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
vi.mock('../core/media.js', () => ({ sized: () => null, loadCallPack: async () => ({}), callPackStatus: async () => ({ saved: 0, total: 0 }), localCalls: async () => [] }));
vi.mock('../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../lib/hooks')>()), useMedia: () => {} }));
vi.mock('../screens/me/nudge', () => ({ nudgeAfterSave: async () => {} }));
let detect: ((d: unknown[]) => void) | null = null;
vi.mock('../core/listen.js', () => ({
  loadListenModel: async () => {},
  setLocation: () => {},
  stopListening: () => {},
  startListening: async ({ onDetections }: { onDetections: (d: unknown[]) => void }) => { detect = onDetections; },
}));

import { SightingSheetHost } from '../components/SightingSheet';
import { byId } from '../lib/data';
import { refreshStore } from '../lib/store';
import Listen from '../screens/field/Listen';
import { setPending } from '../screens/field/scanHandoff';
import AddSighting from '../screens/lists/AddSighting';

// layers.ts finds the control to give focus back to with CSS.escape, which jsdom lacks.
const g = globalThis as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...g.CSS, escape: (s: string) => s.replace(/["\\]/g, '\\$&') };

const KOOKABURRA = 94; // never logged in these records
const TOPKNOT = 26; // never logged either
const stored = (speciesId: number) => fake.stores.sightings.filter((s) => s.speciesId === speciesId);

beforeEach(async () => {
  fake.stores = {
    sightings: [{ id: 1, speciesId: 1, count: 1, heard: false, date: '2026-01-10', time: '07:00', lat: null, lng: null, acc: null, place: 'Home', notes: '', photoId: null, outingId: null, createdAt: 1 }],
    outings: [], patches: [], photos: [],
  };
  fake.kv = { 'me:nudged': true };
  fake.next = 100;
  // The card asks about reduced motion (no feathers then); jsdom has no matchMedia.
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  URL.createObjectURL = () => 'blob:scan';
  URL.revokeObjectURL = () => {};
  await refreshStore();
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('.celebrate, .toast, .confetti, .sheet-wrap').forEach((n) => n.remove());
  vi.unstubAllGlobals();
  detect = null;
});

function Where() {
  return <p data-where="">{useLocation().pathname}</p>;
}
/** Routes in the app's #view, with the host that draws the sheet and the card. */
function app(entries: (string | { pathname: string; search?: string; state?: unknown })[], routes: React.ReactNode) {
  const view = document.createElement('div');
  view.id = 'view';
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>{routes}</Routes>
      <Where />
      <SightingSheetHost />
    </MemoryRouter>,
    { container: document.body.appendChild(view) },
  );
}

describe('a species new for her dex, logged from the field tools', () => {
  it("Listen's Log it: the sheet over Listen saves it, then the card comes up for it", async () => {
    app(['/listen'], <Route path="/listen" element={<Listen />} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start listening' })); });
    await act(async () => {
      detect?.([{ index: 1838, name: 'Laughing Kookaburra', sci: 'Dacelo novaeguineae', confidence: 0.91, dexId: KOOKABURRA }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    const save = await screen.findByRole('button', { name: 'Save sighting' });
    expect(document.querySelector<HTMLTextAreaElement>('.sheet textarea, textarea')?.value).toBe('Identified by call with BirdNET.');
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelector('.celebrate-kicker')?.textContent).toBe('New for your dex');
    expect(document.querySelector('.celebrate h2')?.textContent).toBe(byId.get(KOOKABURRA)!.name);
    // Still on Listen, the record as v1 writes it, and no "saved" toast in place of the card.
    expect(document.querySelector('[data-where]')?.textContent).toBe('/listen');
    const [rec] = stored(KOOKABURRA);
    expect(rec).toMatchObject({ speciesId: KOOKABURRA, heard: false, notes: 'Identified by call with BirdNET.', outingId: null });
    expect(document.querySelector('.toast')?.textContent ?? '').not.toMatch(/saved/);
  });

  it("Scan's hand-off: the #/add page saves it, goes back to the scan result, and the card comes up there", async () => {
    setPending({ blob: new Blob(['x'], { type: 'image/jpeg' }), notes: 'Identified from a photo.', autoGps: false });
    app(
      ['/scan', { pathname: '/add', search: `?species=${TOPKNOT}`, state: { scan: true } }],
      <>
        <Route path="/scan" element={<h1>Scan a photo</h1>} />
        <Route path="/add" element={<AddSighting />} />
      </>,
    );
    const save = await screen.findByRole('button', { name: 'Save sighting' });
    expect(screen.getByRole('button', { name: 'Back to the scan result' })).toBeTruthy();
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(document.querySelector('[data-where]')?.textContent).toBe('/scan'));
    await waitFor(() => expect(document.querySelector('.celebrate')).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelector('.celebrate h2')?.textContent).toBe(byId.get(TOPKNOT)!.name);
    const [rec] = stored(TOPKNOT);
    expect(rec).toMatchObject({ speciesId: TOPKNOT, heard: false, notes: 'Identified from a photo.' });
    expect(rec.photoId).toBeTypeOf('number');
  });

  it('a species she already has gets the toast instead, as from anywhere else', async () => {
    app(['/listen'], <Route path="/listen" element={<Listen />} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start listening' })); });
    await act(async () => { detect?.([{ index: 5, name: byId.get(1)!.name, sci: byId.get(1)!.sci, confidence: 0.8, dexId: 1 }]); });
    // Listen keeps what it heard for the session, so the kookaburra from before may still be listed.
    fireEvent.click(document.querySelector<HTMLElement>('[data-loghit="1"]')!);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Save sighting' })); });
    await waitFor(() => expect(stored(1)).toHaveLength(2));
    await waitFor(() => expect(document.querySelector('.toast')?.textContent).toBe(`${byId.get(1)!.name} saved`));
    expect(document.querySelector('.celebrate')).toBeNull();
  });
});
