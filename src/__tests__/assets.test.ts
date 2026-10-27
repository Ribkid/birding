import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pub = (...parts: string[]) => join(root, 'public', ...parts);

describe('refreshed assets', () => {
  it.each([
    ['data/photoid.json'],
    ['data/photoid.bin'],
    ['data/lookalikes.json'],
    ['data/calls.json'],
    ['models/bioclip/manifest.json'],
    ['models/bioclip/vision-int4.part1.bin'],
    ['models/bioclip/vision-int4.part2.bin'],
  ])('has %s', (file) => {
    expect(existsSync(pub(file))).toBe(true);
  });

  it('ships the 205 offline call clips', () => {
    expect(readdirSync(pub('data/calls')).filter((f) => f.endsWith('.m4a'))).toHaveLength(205);
  });

  it('points the manifest at the int4 chunks', () => {
    const manifest = JSON.parse(readFileSync(pub('models/bioclip/manifest.json'), 'utf8'));
    expect(manifest.chunks.map((c: { file: string }) => c.file)).toEqual([
      'vision-int4.part1.bin',
      'vision-int4.part2.bin',
    ]);
  });

  it('removed the superseded q8 model and text embeddings', () => {
    expect(existsSync(pub('models/bioclip/vision-q8.part1.bin'))).toBe(false);
    expect(existsSync(pub('data/bioclip-text.json'))).toBe(false);
  });
});
