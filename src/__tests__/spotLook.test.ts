// How a spot reads: tidied eBird names, the bird a card leads with, and "how long ago".
import { describe, expect, it } from 'vitest';
import { BIRDS } from '../lib/data';
import { birdsToFind, featureBird, seenAgo, tidySpotName } from '../lib/spotLook';

describe('spot names', () => {
  it('turns eBird\'s "--" into a dash and lifts restricted access out of the name', () => {
    expect(tidySpotName('Lake Samsonvale--Golds Scrub Lane')).toEqual({ name: 'Lake Samsonvale – Golds Scrub Lane', restricted: false });
    expect(tidySpotName('Lake Samsonvale: Golds Scrub Lane (some areas restricted access)'))
      .toEqual({ name: 'Lake Samsonvale: Golds Scrub Lane', restricted: true });
    expect(tidySpotName('Anglican Church Grammar School (restricted access)')).toEqual({ name: 'Anglican Church Grammar School', restricted: true });
  });
});

describe('the bird a spot leads with', () => {
  const ids = BIRDS.slice(0, 60).map((b) => b.id);

  it('is one she has not seen, never a bird already in her dex', () => {
    const seen = new Set(ids.slice(0, 50));
    const lead = featureBird(ids, seen, 'L1');
    expect(lead && seen.has(lead.id)).toBe(false);
  });

  it('prefers fairly common and uncommon birds over the commonest and the rarest', () => {
    const list = birdsToFind(ids, new Set(), 'L1');
    const gap = (r: number) => Math.abs(r - 2.5);
    for (let i = 1; i < list.length; i++) expect(gap(list[i - 1].rarity)).toBeLessThanOrEqual(gap(list[i].rarity));
  });

  it('is the same every time for a spot, and varies between spots', () => {
    const a = featureBird(ids, new Set(), 'L100');
    expect(featureBird(ids, new Set(), 'L100')?.id).toBe(a?.id);
    const leads = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'].map((k) => featureBird(ids, new Set(), k)?.id));
    expect(leads.size).toBeGreaterThan(1);
  });

  it('still shows a recorded bird once she has seen them all', () => {
    expect(featureBird(ids, new Set(ids), 'L1')).toBeDefined();
    expect(featureBird([], new Set(), 'L1')).toBeUndefined();
  });
});

describe('how long ago', () => {
  const now = new Date('2026-11-01T10:00:00').getTime();
  it('says today, yesterday, days ago, then the date', () => {
    expect(seenAgo('2026-11-01 07:10', now)).toBe('Today');
    expect(seenAgo('2026-10-31 16:40', now)).toBe('Yesterday');
    expect(seenAgo('2026-10-29 09:00', now)).toBe('3 days ago');
    expect(seenAgo('2026-10-01', now)).toBe('1 Oct');
    expect(seenAgo('not a date', now)).toBe('');
  });
});
