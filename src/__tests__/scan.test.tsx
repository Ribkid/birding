// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as scan from '../core/scan.js';
import { resizeImage } from '../core/profile.js';
import Scan from '../screens/field/Scan';
import { S, resetScan } from '../screens/field/scanSession';

vi.mock('../core/scan.js', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    photoIdInfo: vi.fn(async () => ({ kinds: ['bird', 'mammal'], metrics: null })),
    modelCached: vi.fn(async () => true),
    ensureModel: vi.fn(async () => ({})),
    identifyScan: vi.fn(),
    logScan: vi.fn(async () => 1234),
    markChosen: vi.fn(async () => {}),
  };
});
vi.mock('../core/profile.js', () => ({ resizeImage: vi.fn() }));
vi.mock('../lib/hooks', () => ({ useSeen: () => new Set<number>() }));
vi.mock('../lib/motion', () => ({ countUp: vi.fn() }));

const LIKELY = { res: { results: [{ id: 11, p: 0.93 }, { id: 12, p: 0.04 }], band: 'likely', bands: { likely: 0.8 } } };
const file = new File(['photo'], 'teal.jpg', { type: 'image/jpeg', lastModified: Date.UTC(2026, 9, 1) });
let photoSize = [400, 300];

beforeAll(() => {
  window.matchMedia = ((media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = () => {};
  URL.createObjectURL = () => 'blob:new';
  URL.revokeObjectURL = () => {};
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
  // pick() decodes the resized photo; pickPhoto() sets the size it decodes to.
  HTMLImageElement.prototype.decode = async () => {};
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { get: () => photoSize[0] });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { get: () => photoSize[1] });
});

// A scan kept in the session, as after a species page, a tab switch or This one → Cancel.
beforeEach(() => {
  resetScan();
  vi.mocked(scan.identifyScan).mockReset();
  vi.mocked(scan.logScan).mockClear();
  vi.mocked(scan.markChosen).mockClear();
  S.at = Date.now();
  S.photo = { file, blob: file, url: 'blob:kept', W: 400, H: 300 };
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter initialEntries={['/scan']}><Scan /></MemoryRouter>);
const identifyButton = () => screen.getByText('Identify').closest('button') as HTMLButtonElement;
// Pick a W x H photo through the Change photo input.
async function pickPhoto(w: number, h: number) {
  vi.mocked(resizeImage).mockResolvedValueOnce(new Blob(['x'], { type: 'image/png' }));
  photoSize = [w, h];
  const input = document.querySelector('.scan-change input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Photo ready/));
}

describe('Scan', () => {
  it('identifies a photo restored from the session (item 38, new 0)', async () => {
    vi.mocked(scan.identifyScan).mockResolvedValue(LIKELY);
    mount();
    fireEvent.click(identifyButton());
    await waitFor(() => expect(scan.identifyScan).toHaveBeenCalledWith(file, expect.anything()));
    expect(await screen.findByRole('heading', { level: 2 })).toHaveProperty('textContent', expect.stringContaining('Chestnut Teal'));
    expect(scan.logScan).toHaveBeenCalledTimes(1);
  });

  it.each(['Try a tighter box', 'Pick a kind', 'Search the dex'])('%s marks the scan log entry none (item 41, new 3)', async (label) => {
    vi.mocked(scan.identifyScan).mockResolvedValue(LIKELY);
    mount();
    fireEvent.click(identifyButton());
    await screen.findByRole('heading', { level: 2 });
    await screen.findByText('Pick a kind'); // the kind chips come from photoIdInfo
    expect(scan.markChosen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(label));
    expect(scan.markChosen).toHaveBeenCalledWith(1234, 'none');
  });

  it.each([
    [2, 2, { left: '0%', top: '0%', width: '100%', height: '100%' }],
    [30, 30, { left: '10%', top: '10%', width: '80%', height: '80%' }],
    [400, 12, { left: '48.5%', top: '0%', width: '3%', height: '100%' }],
    [1600, 1200, { left: '21.875%', top: '12.5%', width: '56.25%', height: '75%' }],
  ])('a fresh %ix%i photo gets the same box as v1, never under 24 px (item 64)', async (w, h, at) => {
    mount();
    await pickPhoto(w, h);
    const box = document.querySelector('[data-box]') as HTMLElement;
    expect({ left: box.style.left, top: box.style.top, width: box.style.width, height: box.style.height }).toEqual(at);
  });

  it('neither logs nor shows a run that finishes after leaving Scan (new 6)', async () => {
    let finish!: (value: typeof LIKELY) => void;
    vi.mocked(scan.identifyScan).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { unmount } = mount();
    fireEvent.click(identifyButton());
    await waitFor(() => expect(scan.identifyScan).toHaveBeenCalled());
    unmount();
    finish(LIKELY);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scan.logScan).not.toHaveBeenCalled();
    expect(S.result).toBeNull();
  });

  it('focuses the stage without scrolling after a photo is picked (new 8)', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    mount();
    expect(document.activeElement).toBe(document.body);
    await pickPhoto(400, 300);
    await waitFor(() => expect(document.activeElement?.classList.contains('scan-stage')).toBe(true));
    expect(focus.mock.contexts.at(-1)).toBe(document.querySelector('.scan-stage'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it('puts the Change photo icon beside its label, as v1 does (new 5)', () => {
    mount();
    const chip = document.querySelector('.scan-change') as HTMLElement;
    expect([...chip.children].map((e) => e.tagName.toLowerCase())).toEqual(['svg', 'span', 'input']);
    expect(chip.querySelector(':scope > span')?.textContent).toBe('Change photo');
  });

  describe('a module that will not load (offline-sw new 3)', () => {
    const DOWNLOAD = 'Photo ID needs a one-time download of about 104 MB. Connect to the internet (Wi-Fi is best) and try again.';
    const page = (entry: string) => `<!doctype html><head><script type="module" crossorigin src="${entry}"></script></head><body><div id="root"></div></body>`;
    beforeEach(() => {
      const script = document.createElement('script');
      script.type = 'module'; script.src = '/assets/index-OLD.js';
      document.head.append(script);
      vi.mocked(scan.modelCached).mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/vendor/ort/ort.wasm.min.mjs'));
    });
    afterEach(() => { document.head.querySelectorAll('script').forEach((s) => s.remove()); vi.unstubAllGlobals(); });

    it.each([
      ['offline, nothing reachable', () => Promise.reject(new TypeError('Failed to fetch')), DOWNLOAD, false],
      ['the same release', async () => new Response(page('/assets/index-OLD.js')), DOWNLOAD, false],
      ['a new release', async () => new Response(page('/assets/index-NEW.js')), 'BirdyDex was updated. Reload to use Scan.', true],
    ])('%s', async (_, fetcher, message, reload) => {
      vi.stubGlobal('fetch', vi.fn(fetcher));
      mount();
      fireEvent.click(identifyButton());
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(screen.queryByText('Reload BirdyDex') !== null).toBe(reload);
      expect(fetch).toHaveBeenCalledWith('/index.html', { cache: 'no-store' });
    });
  });
});
