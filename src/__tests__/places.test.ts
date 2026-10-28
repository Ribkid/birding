import { afterEach, describe, expect, it, vi } from 'vitest';
import { knownPlace, localPlaceMatches, myPlaces, nearestPlaceName, outingPlaceChips, recentPlaces, searchAddress } from '../lib/places';

const patches = [{ name: 'Home patch', lat: -27.47, lng: 153.02, radiusKm: 2 }];
const sightings = [
  { place: 'Oxley Creek Common', lat: -27.55, lng: 152.98, createdAt: 3 },
  { place: 'Home', lat: -27.4, lng: 152.95, createdAt: 5 },
  { place: '', lat: -27.4, lng: 152.95, createdAt: 9 },
  { place: 'Oxley Creek Common', lat: -27.551, lng: 152.981, createdAt: 1 },
];
const outings = [{ place: 'Sandy Camp Road Wetlands', lat: -27.44, lng: 153.17 }];

describe('places (v1 start-an-outing form)', () => {
  it('names the patch she is in, else a sighting place within 400 m', () => {
    expect(nearestPlaceName({ lat: -27.4712, lng: 153.0231 }, patches, sightings)).toBe('Home patch');
    expect(nearestPlaceName({ lat: -27.5512, lng: 152.9812 }, patches, sightings)).toBe('Oxley Creek Common');
    expect(nearestPlaceName({ lat: -26.5, lng: 152.5 }, patches, sightings)).toBe('');
  });

  it('offers patches, then recent places, as chips', () => {
    expect(recentPlaces(sightings)).toEqual(['Home', 'Oxley Creek Common']);
    expect(outingPlaceChips(patches, sightings)).toEqual(['Home patch', 'Home', 'Oxley Creek Common']);
  });

  it('knows where a chip is', () => {
    const mine = myPlaces(sightings, outings);
    expect(mine.map(p => p.name)).toEqual(['Oxley Creek Common', 'Home', 'Sandy Camp Road Wetlands']);
    expect(knownPlace('Home patch', patches, mine)).toMatchObject({ lat: -27.47, lng: 153.02 });
    expect(knownPlace('Sandy Camp Road Wetlands', patches, mine)).toMatchObject({ lat: -27.44 });
    expect(knownPlace('Nowhere', patches, mine)).toBeNull();
  });

  it('matches every word typed against patches and her places', () => {
    const mine = myPlaces(sightings, outings);
    expect(localPlaceMatches('creek oxley', patches, mine).map(p => p.name)).toEqual(['Oxley Creek Common']);
    expect(localPlaceMatches('home', patches, mine).map(p => p.kind)).toEqual(['Your patch', 'Your place']);
    expect(localPlaceMatches('  ', patches, mine)).toEqual([]);
  });
});

describe('place search failures', () => {
  afterEach(() => vi.unstubAllGlobals());
  const failWith = (onLine: boolean) => {
    vi.stubGlobal('navigator', { onLine });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  };

  it('says it needs a connection only when the phone is offline', async () => {
    failWith(false);
    await expect(searchAddress('Wynnum Rd')).rejects.toThrow('Searching places needs a connection. Move the map instead.');
  });

  it('online, says the search could not be reached instead of blaming the connection', async () => {
    failWith(true);
    await expect(searchAddress('Wynnum Rd')).rejects.toThrow("Place search couldn't be reached. Try again, or move the map instead.");
  });

  it("keeps v1's busy message for an error answer", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    await expect(searchAddress('Wynnum Rd')).rejects.toThrow('Place search is busy. Try again in a moment.');
  });
});
