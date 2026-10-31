import { describe, expect, it, vi } from 'vitest';
import {
  decodeEbirdSnapshot,
  fetchLiveEbird,
  liveListIds,
  loadSpotData,
  mapLiveRecent,
  type EbirdSnapshot,
} from '../lib/ebird';
import type { HotspotLike } from '../lib/spots';

const SNAPSHOT: EbirdSnapshot = {
  built: '2026-11-01T00:00:00.000Z',
  source: 'eBird',
  spots: [['L123', 'Rich Park', -27.4, 153, 80, 950, '2026-10-30 08:00', 'BRI']],
  lists: { L123: [1, 2] },
  recent: { L123: [[1, '2026-10-29']] },
  notable: [{ id: 2, name: 'Second Bird', loc: 'L123', where: 'Rich Park', lat: -27.4, lng: 153, date: '2026-10-30', n: 1 }],
  codes: { birpri: 1, birren: 2 },
};

const ALA: HotspotLike[] = [{ name: 'ALA Park', lat: -28, lng: 152, rich: 20, sp: [[1, 10]] }];

describe('eBird snapshot data', () => {
  it('decodes compact spots and joins their baked species lists', () => {
    const result = decodeEbirdSnapshot(SNAPSHOT);
    expect(result.spots[0]).toMatchObject({
      locId: 'L123', name: 'Rich Park', rich: 80, checklists: 950,
      latestObsDt: '2026-10-30 08:00', region: 'BRI', hasList: true,
      sp: [[1, 0], [2, 0]],
    });
    expect(result.notable).toEqual(SNAPSHOT.notable);
  });

  it('uses eBird when the snapshot exists', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(SNAPSHOT), { status: 200 }));
    const result = await loadSpotData(ALA, fetcher);
    expect(result.source).toBe('eBird');
    expect(result.spots[0].locId).toBe('L123');
  });

  it('falls back to the existing ALA rows when the snapshot is missing or unreadable', async () => {
    const missing = await loadSpotData(ALA, vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(missing).toMatchObject({ source: 'ALA', spots: ALA, snapshot: null });
    const broken = await loadSpotData(ALA, vi.fn().mockRejectedValue(new Error('offline')));
    expect(broken).toMatchObject({ source: 'ALA', spots: ALA, snapshot: null });
  });
});

describe('live eBird calls', () => {
  it('does not call the function offline', async () => {
    const fetcher = vi.fn();
    expect(await fetchLiveEbird('recent', 'L123', fetcher, false)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('quietly falls back on a 404 or request failure', async () => {
    expect(await fetchLiveEbird('recent', 'L123', vi.fn().mockResolvedValue(new Response('', { status: 404 })), true)).toBeNull();
    expect(await fetchLiveEbird('list', 'L123', vi.fn().mockRejectedValue(new Error('no signal')), true)).toBeNull();
  });

  it('maps live recent scientific names to app birds', () => {
    const birds = [{ id: 1, name: 'First Bird', sci: 'Birdus primus' }];
    expect(mapLiveRecent([
      { code: 'birpri', sci: 'Birdus primus', name: 'First Bird', date: '2026-10-30', n: 2 },
      { code: 'other', sci: 'Other bird', name: 'Other', date: '2026-10-30', n: 1 },
    ], birds)).toEqual([{ id: 1, date: '2026-10-30', n: 2 }]);
  });

  it('maps live species-list codes through the snapshot taxonomy', () => {
    expect(liveListIds(['birren', 'unknown', 'birpri'], SNAPSHOT)).toEqual([2, 1]);
  });
});
