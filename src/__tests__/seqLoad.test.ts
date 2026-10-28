// The regional data file is asked for by the shell and by each screen as it draws; callers that ask while it is on
// its way share one request, as v1's single boot-time load did.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('loadSeq', () => {
  it('fetches seq.json once for callers that ask while it is loading', async () => {
    let answer: (v: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((r) => { answer = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const { loadSeq, seq } = await import('../core/seqdata.js');
    const a = loadSeq();
    const b = loadSeq();
    answer({ json: async () => ({ species: { 1: { n: 3 } }, hotspots: [], effort: Array(12).fill(1) }) });
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(seq()).toBe(ra);
    await loadSeq();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to empty data once when the file cannot be fetched', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const { loadSeq } = await import('../core/seqdata.js');
    const [a, b] = await Promise.all([loadSeq(), loadSeq()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.hotspots).toEqual([]);
  });
});
