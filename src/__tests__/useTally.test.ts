// @vitest-environment jsdom
// The outing tally's queue (screens/lists/tallyQueue.ts, used through useTally): every tap counts at once, one writer
// per outing stores the combined taps in turn through the app's own save functions, a count that reaches 0 deletes
// the sighting, and a write that fails comes back off the row with one message. Taps not stored yet are noted in a
// journal, and recoverTallies stores them on the next start if the page closed first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  TallyQueue,
  recoverTallies,
  type JournalData,
  type JournalEntry,
  type RecoverIO,
  type TallyIO,
  type TallyJournal,
} from '../screens/lists/tallyQueue';
import type { OutingRow, SightingInput, SightingRow } from '../screens/lists/shared';

const OUTING: OutingRow = { id: 7, date: '2026-10-29', time: '06:40', place: 'Sandy Camp Road Wetlands', lat: -27.44, lng: 153.17, endedAt: null, past: false };

/** A pretend database: every write takes `ms` (fake timers), and records what was written. */
function fakeDb(ms = 40) {
  const rows = new Map<number, SightingRow & { uid: string; updatedAt: number }>();
  const log: string[] = [];
  let next = 100;
  let clock = 1_000;
  let failNext = 0;
  const wait = () => new Promise<void>((r) => setTimeout(r, ms));
  const io: TallyIO = {
    create: vi.fn(async (rec: SightingInput) => {
      await wait();
      if (failNext) { failNext -= 1; throw new Error('quota'); }
      const id = next++;
      // As db.js and saveSighting do: the record object itself gets its uid, updatedAt and id.
      Object.assign(rec, { id, uid: `u${id}`, updatedAt: ++clock });
      rows.set(id, { ...(rec as SightingRow & { uid: string; updatedAt: number }) });
      log.push(`create ${rec.speciesId}=${rec.count}`);
      return id;
    }),
    update: vi.fn(async (rec: SightingRow) => {
      await wait();
      if (failNext) { failNext -= 1; throw new Error('quota'); }
      Object.assign(rec, { updatedAt: ++clock });
      rows.set(rec.id, { ...(rec as SightingRow & { uid: string; updatedAt: number }) });
      log.push(`put ${rec.speciesId}=${rec.count}`);
    }),
    remove: vi.fn(async (rec: SightingRow) => {
      await wait();
      if (failNext) { failNext -= 1; throw new Error('quota'); }
      rows.delete(rec.id);
      log.push(`delete ${rec.speciesId}`);
    }),
    markActive: vi.fn(async () => {}),
    failed: vi.fn(),
    now: () => Date.parse('2026-10-29T07:12:00'),
  };
  /** The store's view of the outing: the stored sighting per species, as Outing.tsx builds it. */
  const stored = () => new Map([...rows.values()].map((r) => [r.speciesId, { ...r }]));
  return { io, rows, log, stored, failOnce: (n = 1) => { failNext = n; } };
}

const shown = (q: TallyQueue, id: number) => q.countOf(id)?.count ?? 0;
/** Lets the pretend writes finish (fake timers) and waits for the queue to be empty. */
async function settle(q: TallyQueue) {
  const done = q.flush();
  await vi.runAllTimersAsync();
  await done;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TallyQueue', () => {
  it('counts ten quick taps on a new species, all of them, with one new sighting and few writes', async () => {
    const f = fakeDb(120);
    const q = new TallyQueue(OUTING, f.io);
    for (let i = 1; i <= 10; i++) {
      q.tap(52, 1);
      expect(shown(q, 52)).toBe(i); // drawn at once, before anything is stored
      await vi.advanceTimersByTimeAsync(80);
    }
    await settle(q);
    expect([...f.rows.values()].map((r) => r.count)).toEqual([10]);
    expect(f.io.create).toHaveBeenCalledTimes(1);
    // The taps that came in during a write went out together, not one write each.
    expect((f.io.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThan(9);
    expect(shown(q, 52)).toBe(10);
  });

  it('writes a new species with the fields the outing has always written, in order', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    q.tap(52, 1);
    q.tap(52, 1);
    await vi.runAllTimersAsync();
    const first = (f.io.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(first).slice(0, 13)).toEqual([
      'speciesId', 'count', 'heard', 'date', 'time', 'lat', 'lng', 'acc', 'place', 'notes', 'photoId', 'outingId', 'createdAt',
    ]);
    expect(first).toMatchObject({
      speciesId: 52, heard: false, date: '2026-10-29', time: '07:12', lat: -27.44, lng: 153.17, acc: null,
      place: 'Sandy Camp Road Wetlands', notes: '', photoId: null, outingId: 7,
    });
    // The first tap went out alone; the second, made while it was written, is a put on the same record.
    expect(f.log).toEqual(['create 52=1', 'put 52=2']);
    const put = (f.io.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(put.uid).toBe(first.uid);
    expect(put.id).toBe(first.id);
  });

  it('a past or finished outing keeps its own time on a new species', async () => {
    const f = fakeDb();
    const q = new TallyQueue({ ...OUTING, endedAt: Date.parse('2026-10-29T09:00:00') }, f.io);
    q.tap(9, 1);
    await vi.runAllTimersAsync();
    expect((f.io.create as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ time: '06:40' });
    // Not live: the outing is not made the running one.
    expect(f.io.markActive).not.toHaveBeenCalled();
  });

  it('a + on a live outing marks it as the running outing', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    q.tap(9, 1);
    await vi.runAllTimersAsync();
    expect(f.io.markActive).toHaveBeenCalledWith(7);
  });

  it('mixed + and − bursts end at the right stored count, and 0 deletes the sighting', async () => {
    const f = fakeDb(60);
    const q = new TallyQueue(OUTING, f.io);
    // Stored already: 3 of species 4.
    f.rows.set(1, { id: 1, speciesId: 4, date: '2026-10-29', time: '06:50', count: 3, outingId: 7, uid: 'u1', updatedAt: 500, createdAt: 1 } as never);
    q.setStored(f.stored());
    const taps = [1, 1, -1, 1, 1, 1, -1, -1, 1];
    for (const d of taps) { q.tap(4, d); await vi.advanceTimersByTimeAsync(25); }
    expect(shown(q, 4)).toBe(6); // 3 + (6 − 3)
    await settle(q);
    expect(f.rows.get(1)?.count).toBe(6);
    // Counting down to nothing deletes it, once.
    for (let i = 0; i < 7; i++) { q.tap(4, -1); await vi.advanceTimersByTimeAsync(10); }
    expect(q.countOf(4)).toBeNull();
    await settle(q);
    expect(f.rows.has(1)).toBe(false);
    expect(f.io.remove).toHaveBeenCalledTimes(1);
    // The store still has the old row for a moment: the tally doesn't bring it back.
    expect(q.view(new Map([[4, { id: 1, speciesId: 4, count: 5, date: '', time: '', updatedAt: 600 } as never]]))).toEqual([]);
  });

  it('a + then − before anything is written stores nothing', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    f.rows.set(1, { id: 1, speciesId: 4, date: '2026-10-29', time: '06:50', count: 2, outingId: 7, uid: 'u1', updatedAt: 500 } as never);
    q.setStored(f.stored());
    q.tap(4, 1);
    q.tap(4, -1);
    await settle(q);
    // The + went out alone (the writer starts at once); the − came after and evened it out.
    expect(f.rows.get(1)?.count).toBe(2);
  });

  it('uses what it wrote until the store reads it back, then the store', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    const old = { id: 1, speciesId: 4, date: '2026-10-29', time: '06:50', count: 2, outingId: 7, uid: 'u1', updatedAt: 500 };
    f.rows.set(1, { ...old } as never);
    q.setStored(f.stored());
    q.tap(4, 1);
    await settle(q);
    // The store hasn't caught up: its stale 2 must not be what the next tap builds on.
    q.setStored(new Map([[4, { ...old } as never]]));
    expect(shown(q, 4)).toBe(3);
    q.tap(4, 1);
    await settle(q);
    expect(f.rows.get(1)?.count).toBe(4);
    // Caught up: an edit made elsewhere afterwards (a newer updatedAt) is what the row shows.
    q.setStored(f.stored());
    q.setStored(new Map([[4, { ...f.rows.get(1)!, count: 9, updatedAt: 99_999 } as never]]));
    expect(shown(q, 4)).toBe(9);
  });

  it('a write that fails comes off the row and says so once; the taps after it still count', async () => {
    const f = fakeDb(50);
    const q = new TallyQueue(OUTING, f.io);
    f.rows.set(1, { id: 1, speciesId: 4, date: '2026-10-29', time: '06:50', count: 2, outingId: 7, uid: 'u1', updatedAt: 500 } as never);
    q.setStored(f.stored());
    f.failOnce();
    q.tap(4, 1);
    expect(shown(q, 4)).toBe(3);
    await vi.advanceTimersByTimeAsync(10);
    q.tap(4, 1); // made while the failing write runs
    expect(shown(q, 4)).toBe(4);
    await settle(q);
    expect(f.io.failed).toHaveBeenCalledTimes(1);
    // The failed + is taken back; the one after it is stored.
    expect(shown(q, 4)).toBe(3);
    expect(f.rows.get(1)?.count).toBe(3);
  });

  it('a failed first save of a new species takes the row away again', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    f.failOnce();
    q.tap(52, 1);
    expect(q.view().map((r) => r.speciesId)).toEqual([52]);
    await settle(q);
    expect(q.view()).toEqual([]);
    expect(f.io.failed).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(0);
  });

  it('flush waits for the last tap; drop forgets the ones not being written', async () => {
    const f = fakeDb(100);
    const q = new TallyQueue(OUTING, f.io);
    q.tap(52, 1);
    q.tap(52, 1);
    q.tap(52, 1);
    let flushed = false;
    void q.flush().then(() => { flushed = true; });
    await vi.advanceTimersByTimeAsync(150);
    expect(flushed).toBe(false);
    await vi.runAllTimersAsync();
    expect(flushed).toBe(true);
    expect([...f.rows.values()][0].count).toBe(3);

    q.tap(52, 1); // being written
    q.tap(52, 1); // waiting
    const dropped = q.drop();
    await vi.runAllTimersAsync();
    await dropped;
    expect([...f.rows.values()][0].count).toBe(4);
    expect(q.busy()).toBe(false);
  });

  it('never counts below zero, and a − on nothing does nothing', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    q.tap(3, -1);
    expect(q.view()).toEqual([]);
    q.tap(3, 2);
    q.tap(3, -5);
    expect(q.countOf(3)).toBeNull();
    await settle(q);
    expect(f.rows.size).toBe(0);
  });

  it('a flock adds through the same queue', async () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    q.tap(52, 1);
    q.tap(52, 20);
    expect(shown(q, 52)).toBe(21);
    await settle(q);
    expect([...f.rows.values()][0].count).toBe(21);
  });

  it('orders the rows newest first, a species not stored yet at the top', () => {
    const f = fakeDb();
    const q = new TallyQueue(OUTING, f.io);
    const stored = new Map<number, SightingRow>([
      [4, { id: 1, speciesId: 4, date: '', time: '', count: 1, createdAt: 200 } as SightingRow],
      [5, { id: 2, speciesId: 5, date: '', time: '', count: 1, createdAt: 100 } as SightingRow],
    ]);
    q.setStored(stored);
    q.tap(52, 1);
    expect(q.view().map((r) => r.speciesId)).toEqual([52, 4, 5]);
  });
});

/** A journal kept in memory, as localStorage keeps it for the app. */
function memJournal() {
  const data: JournalData = {};
  const journal: TallyJournal = {
    read: () => data,
    write: (o, s, e) => {
      const ok = String(o);
      if (e) (data[ok] ??= {})[String(s)] = JSON.parse(JSON.stringify(e));
      else if (data[ok]) { delete data[ok][String(s)]; if (!Object.keys(data[ok]).length) delete data[ok]; }
    },
  };
  return { data, journal };
}

describe('the journal of unsaved taps', () => {
  it('notes what each row should end at while taps wait, and clears once they are stored', async () => {
    const f = fakeDb(100);
    const { data, journal } = memJournal();
    const q = new TallyQueue(OUTING, { ...f.io, journal });
    f.rows.set(1, { id: 1, speciesId: 4, date: '2026-10-29', time: '06:50', count: 2, outingId: 7, uid: 'u1', updatedAt: 500, createdAt: 1 } as never);
    q.setStored(f.stored());
    q.tap(4, 1); // being written: 2 → 3
    q.tap(4, 1);
    q.tap(4, 1); // waiting
    expect(data['7']['4']).toMatchObject({ id: 1, count: 5, safe: [2, 3] });
    q.tap(52, 2); // a new species, nothing stored yet
    expect(data['7']['52']).toMatchObject({ id: null, count: 2, safe: [] });
    await settle(q);
    expect(data).toEqual({});
  });

  it('a failed write takes its note back with it', async () => {
    const f = fakeDb();
    const { data, journal } = memJournal();
    const q = new TallyQueue(OUTING, { ...f.io, journal });
    f.failOnce();
    q.tap(52, 1);
    await settle(q);
    expect(data).toEqual({});
  });

  it('writes wait for the last visit to be recovered first', async () => {
    const f = fakeDb();
    let release: () => void = () => {};
    const ready = new Promise<void>((r) => { release = r; });
    const q = new TallyQueue(OUTING, { ...f.io, ready });
    q.tap(52, 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.io.create).not.toHaveBeenCalled();
    release();
    await settle(q);
    expect(f.io.create).toHaveBeenCalledTimes(1);
  });
});

describe('recoverTallies', () => {
  const rec = (id: number, speciesId: number, count: number | null, extra: Record<string, unknown> = {}) =>
    ({ id, speciesId, date: '2026-10-29', time: '07:00', count, outingId: 7, createdAt: 1000 + id, ...extra }) as SightingRow;
  const run = async (entries: Record<string, JournalEntry>, recs: SightingRow[], outing: OutingRow | undefined = OUTING) => {
    const { data, journal } = memJournal();
    data['7'] = entries;
    const io: RecoverIO = {
      journal,
      getOuting: vi.fn(async () => outing),
      onOuting: vi.fn(async () => recs),
      add: vi.fn(async () => 1),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    await recoverTallies(io);
    return { io, data };
  };
  const entry = (e: Partial<JournalEntry>): JournalEntry => ({ id: null, createdAt: 0, count: 1, safe: [], at: 2000, ...e });

  it('stores the count a closed page never wrote, whether or not its last write landed', async () => {
    // Nothing landed: the stored 2 is where the taps started.
    let r = await run({ 4: entry({ id: 1, count: 6, safe: [2, 3] }) }, [rec(1, 4, 2)]);
    expect(r.io.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1, count: 6, speciesId: 4 }));
    expect(r.data).toEqual({});
    // The write in flight landed (3), the rest didn't.
    r = await run({ 4: entry({ id: 1, count: 6, safe: [2, 3] }) }, [rec(1, 4, 3)]);
    expect(r.io.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1, count: 6 }));
    // Everything landed: nothing to do.
    r = await run({ 4: entry({ id: 1, count: 6, safe: [2, 3] }) }, [rec(1, 4, 6)]);
    expect(r.io.update).not.toHaveBeenCalled();
    expect(r.data).toEqual({});
  });

  it('leaves a count changed anywhere else alone', async () => {
    const r = await run({ 4: entry({ id: 1, count: 6, safe: [2, 3] }) }, [rec(1, 4, 12)]);
    expect(r.io.update).not.toHaveBeenCalled();
    expect(r.io.remove).not.toHaveBeenCalled();
    expect(r.data).toEqual({});
  });

  it('makes a first save that never landed, with the outing\'s fields and no celebration, and finds one that did', async () => {
    let r = await run({ 52: entry({ id: null, createdAt: Date.parse('2026-10-29T07:12:00'), count: 4 }) }, []);
    expect(r.io.add).toHaveBeenCalledWith({
      speciesId: 52, count: 4, heard: false, date: '2026-10-29', time: '07:12', lat: -27.44, lng: 153.17, acc: null,
      place: 'Sandy Camp Road Wetlands', notes: '', photoId: null, outingId: 7, createdAt: Date.parse('2026-10-29T07:12:00'),
    });
    // Its first save landed (found by createdAt) with the 2 that were in flight.
    r = await run({ 52: entry({ id: null, createdAt: 1009, count: 4, safe: [2] }) }, [rec(9, 52, 2)]);
    expect(r.io.add).not.toHaveBeenCalled();
    expect(r.io.update).toHaveBeenCalledWith(expect.objectContaining({ id: 9, count: 4 }));
  });

  it('deletes a sighting counted down to 0, and forgets an outing that is gone', async () => {
    let r = await run({ 4: entry({ id: 1, count: 0, safe: [1] }) }, [rec(1, 4, 1)]);
    expect(r.io.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    r = await run({ 4: entry({ id: 1, count: 5, safe: [2] }) }, [], undefined);
    expect(r.io.update).not.toHaveBeenCalled();
    expect(r.io.add).not.toHaveBeenCalled();
    expect(r.data).toEqual({});
  });

  it('keeps an entry whose write fails, for the next start', async () => {
    const { data, journal } = memJournal();
    data['7'] = { 4: entry({ id: 1, count: 6, safe: [2] }) };
    await recoverTallies({
      journal,
      getOuting: async () => OUTING,
      onOuting: async () => [rec(1, 4, 2)],
      add: async () => 1,
      update: async () => { throw new Error('quota'); },
      remove: async () => {},
    });
    expect(data['7']['4'].count).toBe(6);
  });
});

describe('useTally', () => {
  it('draws a tap at once, follows the writes and writes what is left when the page goes', async () => {
    vi.resetModules();
    const writes: string[] = [];
    vi.doMock('../core/db.js', () => ({
      db: {
        put: vi.fn(async (_store: string, rec: SightingRow) => { await new Promise((r) => setTimeout(r, 30)); writes.push(`put ${rec.count}`); }),
        kvSet: vi.fn(async () => {}),
      },
    }));
    vi.doMock('../screens/lists/shared', () => ({
      saveSighting: vi.fn(async () => 1),
      deleteSighting: vi.fn(async () => {}),
    }));
    vi.doMock('../lib/toast', () => ({ toast: vi.fn() }));
    const { useTally } = await import('../screens/lists/useTally');
    const stored = new Map<number, SightingRow>([[4, { id: 1, speciesId: 4, date: '', time: '', count: 2, outingId: 8, updatedAt: 1 } as SightingRow]]);
    const outing = { ...OUTING, id: 8 };
    const { result, unmount } = renderHook(() => useTally(outing, stored));
    expect(result.current.get(4)?.count).toBe(2);
    act(() => { result.current.tap(4, 1); });
    expect(result.current.get(4)?.count).toBe(3);
    act(() => { result.current.tap(4, 1); });
    expect(result.current.get(4)?.count).toBe(4);
    // Closing the tab: pagehide starts what is still waiting.
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writes.at(-1)).toBe('put 4');
    act(() => { result.current.tap(4, -1); });
    unmount(); // leaving the outing writes it too
    await vi.runAllTimersAsync();
    expect(writes.at(-1)).toBe('put 3');
    vi.doUnmock('../core/db.js');
    vi.doUnmock('../screens/lists/shared');
    vi.doUnmock('../lib/toast');
  });
});
