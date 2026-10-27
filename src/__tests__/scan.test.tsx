// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as scan from '../core/scan.js';
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

beforeAll(() => {
  window.matchMedia = ((media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = () => {};
  URL.createObjectURL = () => 'blob:new';
  URL.revokeObjectURL = () => {};
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0);
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
});
