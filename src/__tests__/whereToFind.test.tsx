// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLastPos } from '../lib/lastPos';
import { resetEbirdSnapshotCache } from '../lib/useEbird';
import { byId } from '../lib/data';
import WhereToFind from '../components/WhereToFind';

vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => <span data-testid="species-photo" /> }));

const SNAPSHOT = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [['L123', 'Oxley Creek Common -- South', -27.54, 153.01, 80, 400, '2026-10-30', 'BRI']],
  lists: {},
  recent: {},
  notable: [],
  codes: { chbcuc2: 94 },
};

beforeEach(() => {
  resetEbirdSnapshotCache();
  setLastPos({ lat: -27.53, lng: 153.01, acc: 10 });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/data/regions/seq/ebird.json')) return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    if (url.includes('species=')) {
      return new Response(JSON.stringify({
        total: 12,
        sightings: [{
          code: 'chbcuc2', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo',
          loc: 'L123', where: 'Oxley Creek Common -- South', lat: -27.54, lng: 153.01,
          date: '2026-10-30 08:15', n: 2, sub: 'S12345678',
        }],
      }), { status: 200 });
    }
    if (url.includes('nearest=')) {
      return new Response(JSON.stringify([{
        code: 'chbcuc2', sci: 'Scythrops novaehollandiae', name: 'Channel-billed Cuckoo',
        loc: 'L123', where: 'Oxley Creek Common -- South', lat: -27.54, lng: 153.01,
        date: '2026-10-30 08:15', n: 2, sub: 'S12345678',
      }]), { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Where to find it now', () => {
  it('shows the nearest sighting, SEQ count and tidy place links', async () => {
    const sp = byId.get(94)!;
    const { container } = render(<MemoryRouter><WhereToFind sp={sp} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Where to find it now' })).toBeTruthy();
    expect(await screen.findByText(/Reported 12 times in SEQ in the last 30 days/)).toBeTruthy();
    await waitFor(() => {
      expect(container.querySelector('.where-find-nearest')?.textContent)
        .toMatch(/Seen .* away at Oxley Creek Common – South, 2 days ago\./);
    });
    expect(screen.queryAllByText('Restricted')).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /Oxley Creek Common – South/ })[0].getAttribute('href')).toBe('/spot/L123');
    expect(screen.getByText(/Uses your rough location, never saved/)).toBeTruthy();
  });

  it('renders nothing offline rather than leaving a blank card behind', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const sp = byId.get(94)!;
    const { container } = render(<MemoryRouter><WhereToFind sp={sp} /></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });
});
