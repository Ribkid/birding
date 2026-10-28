// The species hero keeps the photos it was drawn with when a photo index arrives later, as v1 did, and takes the
// gallery when gallery.json arrives (v1 drew the page again) unless she has touched the gallery.
import { describe, expect, it } from 'vitest';
import { heroShown } from '../screens/heroShown';

const ala = [{ src: 'ala-1' }, { src: 'ala-2' }];
const wiki = { src: 'wiki', wiki: true };

describe('heroShown', () => {
  it('draws what is known first', () => {
    expect(heroShown(null, ala, false).photos).toEqual(ala);
  });

  it('keeps a hero with photos when the photo index arrives later', () => {
    const first = heroShown(null, ala, false);
    expect(heroShown(first, [wiki, ...ala], false).photos).toEqual(ala);
  });

  it('takes the photo index when the hero had no photo', () => {
    const first = heroShown(null, [], false);
    expect(heroShown(first, [wiki], false).photos).toEqual([wiki]);
  });

  it('draws again with the gallery when gallery.json arrives, unless she has touched the gallery', () => {
    const first = heroShown(null, [wiki], false);
    expect(heroShown(first, [wiki, ...ala], false).photos).toEqual([wiki, ...ala]);
    expect(heroShown(first, [wiki, ...ala], true).photos).toEqual([wiki]);
  });

  it('takes the latest copy of a photo on show, such as its credit arriving', () => {
    const first = heroShown(null, [wiki, ...ala], false);
    const credited = { ...wiki, credit: 'JJ Harrison' };
    expect(heroShown(first, [credited, ...ala], false).photos[0]).toBe(credited);
  });
});
