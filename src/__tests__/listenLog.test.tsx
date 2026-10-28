// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const opened: unknown[] = [];
vi.mock('../components/SightingSheet', () => ({ openSightingSheet: (req: unknown) => { opened.push(req); } }));
vi.mock('../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../lib/hooks')>()), useMedia: () => {}, useSeen: () => new Set<number>() }));
vi.mock('../core/media.js', () => ({ sized: () => null, loadCallPack: async () => ({}), callPackStatus: async () => ({ saved: 0, total: 0 }), localCalls: async () => [] }));
let detect: ((d: unknown[]) => void) | null = null;
vi.mock('../core/listen.js', () => ({
  loadListenModel: async () => {},
  setLocation: () => {},
  stopListening: () => {},
  startListening: async ({ onDetections, onStatus }: { onDetections: (d: unknown[]) => void; onStatus: (s: string) => void }) => {
    detect = onDetections;
    onStatus('listening');
  },
}));

import { MemoryRouter } from 'react-router-dom';
import { SPECIES } from '../lib/data';
import Listen from '../screens/field/Listen';

beforeAll(() => {
  window.matchMedia = ((media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('Listen', () => {
  afterEach(() => { cleanup(); opened.length = 0; detect = null; });

  it("opens the Log a sighting sheet from a heard call's Log it, finding her and noting BirdNET, as v1 did", async () => {
    const kooka = SPECIES.find((s) => s.name === 'Laughing Kookaburra')!;
    render(<MemoryRouter><Listen /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start listening' })); });
    await act(async () => { detect?.([{ index: 7, name: 'Laughing Kookaburra', sci: 'Dacelo novaeguineae', confidence: 0.82, dexId: kooka.id }]); });
    const log = screen.getByRole('button', { name: 'Log it' });
    expect(log.className).toBe('btn btn--small hit-log');
    expect(log.getAttribute('data-loghit')).toBe(String(kooka.id));
    expect(document.getElementById(log.getAttribute('aria-describedby')!)?.textContent).toBe('Laughing Kookaburra');
    fireEvent.click(log);
    expect(opened).toEqual([{ speciesId: kooka.id, autoGps: true, notes: 'Identified by call with BirdNET.' }]);
    // Nothing is saved behind her back: the button stays, ready for another.
    expect(screen.getByRole('button', { name: 'Log it' })).toBe(log);
  });
});
