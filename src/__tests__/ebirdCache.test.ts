import { mkdtemp, readFile, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheIsFresh,
  createPacer,
  migrateLegacyLists,
  pool,
  readCachedList,
  writeCachedList,
  LIST_TTL_MS,
} from '../../scripts/build-ebird.mjs';

const DAY = 24 * 60 * 60 * 1000;
const folders: string[] = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'birdydex-ebird-test-'));
  folders.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the eBird species-list cache', () => {
  it('reuses a list younger than seven days and ignores an older one', async () => {
    const dir = await tempDir();
    const now = Date.now();

    await writeCachedList(dir, 'L1', ['birpri', 'birren']);
    await writeCachedList(dir, 'L2', ['birpri'], now - 8 * DAY);

    expect(await readCachedList(dir, 'L1', now)).toEqual(['birpri', 'birren']);
    expect(await readCachedList(dir, 'L2', now)).toBeNull();
    expect(await readCachedList(dir, 'L3', now)).toBeNull();
    expect(cacheIsFresh(now - 6 * DAY, now)).toBe(true);
    expect(cacheIsFresh(now - 7 * DAY - 1, now)).toBe(false);
    expect(LIST_TTL_MS).toBe(7 * DAY);
  });

  it('treats a corrupt cache file as a miss so it is fetched again', async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'L9.json'), 'not json');
    expect(await readCachedList(dir, 'L9')).toBeNull();
  });

  it('moves the lists left in the old date folders, keeping the newest copy and its age', async () => {
    const legacy = await tempDir();
    const target = await tempDir();
    const now = Date.now();
    const older = join(legacy, '2026-10-30');
    const newer = join(legacy, '2026-10-31');
    await mkdir(older, { recursive: true });
    await mkdir(newer, { recursive: true });

    await writeFile(join(older, 'L1.json'), JSON.stringify(['old']));
    await utimes(join(older, 'L1.json'), new Date(now - 2 * DAY), new Date(now - 2 * DAY));
    await writeFile(join(newer, 'L1.json'), JSON.stringify(['new']));
    await writeFile(join(newer, 'L2.json'), JSON.stringify(['stale']));
    await utimes(join(newer, 'L2.json'), new Date(now - 9 * DAY), new Date(now - 9 * DAY));
    await writeFile(join(newer, 'notes.txt'), 'ignore me');

    expect(await migrateLegacyLists(legacy, target, now)).toBe(1);
    expect(JSON.parse(await readFile(join(target, 'L1.json'), 'utf8'))).toEqual(['new']);
    expect((await stat(join(target, 'L1.json'))).mtimeMs).toBeCloseTo(now, -3);
    await expect(stat(join(target, 'L2.json'))).rejects.toThrow();

    // Running it again changes nothing.
    expect(await migrateLegacyLists(legacy, target, now)).toBe(0);
  });
});

describe('the eBird build pacer and pool', () => {
  it('never keeps more than three requests in flight', async () => {
    let active = 0;
    let peak = 0;
    await pool([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (item) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return item;
    });
    expect(peak).toBe(3);
  });

  it('keeps every request start at least the gap apart, even when they start together', async () => {
    const gap = 40;
    const pace = createPacer(gap);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 4 }, async () => {
      await pace();
      starts.push(Date.now());
    }));
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(gap - 5);
    }
  });
});
