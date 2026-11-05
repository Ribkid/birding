import { test } from 'vitest';
import assert from 'node:assert/strict';
import { allowedLicense, selectPhotos, formatJSON, build } from './build-gallery.mjs';
import { extendMap } from './build-birdnet-map.mjs';

test('photo licence filtering rejects ND and unknown rights', () => {
  for (const value of ['CC BY-ND 4.0', 'CC BY-NC-ND 3.0', '', 'All rights reserved']) assert.equal(allowedLicense(value), null);
  assert.equal(allowedLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/'), 'CC BY-NC-SA 4.0');
  assert.equal(allowedLicense('CC0'), 'CC0');
});

test('photo selection checks images, deduplicates observers, and uses image rights', async () => {
  const occurrences = [
    { uuid: 'a', recordedBy: ['Alice'], images: ['nd', 'ok'] },
    { uuid: 'b', recordedBy: ['Alice'], images: ['duplicate'] },
    { uuid: 'c', recordedBy: ['Bob'], images: ['broken'] },
    { uuid: 'd', recordedBy: ['Carol'], images: ['good'] },
  ];
  const photos = await selectPhotos(occurrences, async id => ({ creator: id === 'good' ? 'Carol' : 'Alice', recognisedLicence: { acronym: id === 'nd' ? 'CC BY-ND 4.0' : 'CC BY 4.0' }, mimeType: 'image/jpeg' }), async src => !src.endsWith('broken'));
  assert.deepEqual(photos.map(p => p.page), ['https://biocache.ala.org.au/occurrences/a', 'https://biocache.ala.org.au/occurrences/d']);
  assert.equal(photos[0].from, 'iNaturalist via ALA');
});

test('mapping preserves old indices and handles genus, gender, and common-name variants', () => {
  const birds = [
    { id: 1, sci: 'Zanda funerea', name: 'Yellow-tailed Black-Cockatoo' },
    { id: 2, sci: 'Tachyspiza fasciata', name: 'Brown Goshawk' },
    { id: 3, sci: 'Unknown bird', name: 'Grey Shrike-thrush' },
    { id: 4, sci: 'Absent bird', name: 'Unmatched' },
  ];
  const result = extendMap({ 9: 99 }, ['Calyptorhynchus funereus_Other', 'Accipiter fasciatus_Other', 'Other bird_Gray Shrikethrush', 'Absent bird_Unmatched'], birds);
  assert.deepEqual(result.map, { 0: 1, 1: 2, 2: 3, 3: 4, 9: 99 });
  assert.deepEqual(extendMap({ 0: 99 }, ['Zanda funerea_Other'], birds.slice(0, 1)).unmatched, birds.slice(0, 1));
  assert.deepEqual(extendMap({ 8: 1 }, ['Zanda funerea_Other'], birds.slice(0, 1)).map, { 8: 1 });
});

test('serialization retains minified files and CRLF indentation', () => {
  assert.equal(formatJSON({ 1: [] }, '{"1":[]}'), '{"1":[]}');
  assert.equal(formatJSON({ 1: [] }, '{\r\n  "1": []\r\n}\r\n'), '{\r\n  "1": []\r\n}\r\n');
});

test('replacement must explicitly name catalogue ids', async () => {
  await assert.rejects(build(['--force', '--dry-run']), /--force requires --ids=/);
  await assert.rejects(build(['--ids=']), /Expected --ids=/);
});
