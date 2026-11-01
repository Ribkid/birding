import { describe, expect, it } from 'vitest';
import { boundsKey, buildOverpassQuery, placesFromElements, snapBounds } from '../lib/mapPlaces';

const bounds = { south: -27.50124, west: 152.99456, north: -27.48987, east: 153.01234 };

describe('map Places', () => {
  it('asks Overpass for every supported place in the visible bounds, with a 300-place cap', () => {
    const query = buildOverpassQuery(bounds);

    expect(query).toContain('(-27.50124,152.99456,-27.48987,153.01234)');
    expect(query).toContain('["tourism"~"^(wilderness_hut|alpine_hut)$"]');
    expect(query).toContain('["amenity"="shelter"]');
    expect(query).toContain('["amenity"="toilets"]');
    expect(query).toContain('["amenity"="drinking_water"]');
    expect(query).toContain('["tourism"="picnic_site"]');
    expect(query).not.toContain('picnic_table');
    expect(query).toContain('["amenity"="bbq"]');
    expect(query).toContain('["tourism"="viewpoint"]');
    expect(query).toContain('["leisure"="bird_hide"]');
    expect(query).toContain('["amenity"="parking"]');
    expect(query).toContain('["tourism"="information"]["information"~"^(board|map|office)$"]');
    expect(query).toContain('["tourism"="camp_site"]');
    expect(query).toContain('out center 300;');
  });

  it('grows the visible area out to a 2 km grid, so small pans share one cached answer that covers the screen', () => {
    const box = snapBounds(bounds);
    expect(box).toEqual({ south: -27.52, west: 152.98, north: -27.48, east: 153.02 });
    expect(boundsKey(snapBounds({ ...bounds, south: -27.505, east: 153.015 }))).toBe(boundsKey(box));
  });

  it('turns nodes and way centres into named places with plain fallback labels', () => {
    const places = placesFromElements([
      { type: 'node', id: 1, lat: -27.5, lon: 153, tags: { tourism: 'wilderness_hut', name: 'Hut <1>' } },
      { type: 'way', id: 2, center: { lat: -27.51, lon: 153.01 }, tags: { amenity: 'toilets' } },
      { type: 'relation', id: 3, center: { lat: -27.52, lon: 153.02 }, tags: { leisure: 'bird_hide' } },
    ]);

    expect(places).toEqual([
      { id: 'node/1', lat: -27.5, lng: 153, kind: 'hut', label: 'Wilderness hut', name: 'Hut <1>', details: '' },
      { id: 'way/2', lat: -27.51, lng: 153.01, kind: 'toilets', label: 'Toilets', name: '', details: '' },
      { id: 'relation/3', lat: -27.52, lng: 153.02, kind: 'birdHide', label: 'Bird hide', name: '', details: '' },
    ]);
  });

  it('recognises each place category and its useful fallback label', () => {
    const fixtures = [
      [{ tourism: 'alpine_hut' }, 'hut', 'Alpine hut'],
      [{ amenity: 'shelter' }, 'shelter', 'Shelter'],
      [{ amenity: 'drinking_water' }, 'water', 'Drinking water'],
      [{ tourism: 'picnic_site' }, 'picnic', 'Picnic area'],
      [{ leisure: 'picnic_table' }, 'picnic', 'Picnic table'],
      [{ amenity: 'bbq' }, 'picnic', 'Barbecue'],
      [{ tourism: 'viewpoint' }, 'viewpoint', 'Lookout'],
      [{ amenity: 'parking' }, 'parking', 'Parking'],
      [{ tourism: 'information', information: 'board' }, 'information', 'Information board'],
      [{ tourism: 'information', information: 'map' }, 'information', 'Information map'],
      [{ tourism: 'information', information: 'office' }, 'information', 'Information office'],
      [{ tourism: 'camp_site' }, 'camp', 'Camp site'],
    ] as const;

    const places = placesFromElements(
      fixtures.map(([tags], index) => ({ type: 'node', id: index + 1, lat: -27.5, lon: 153, tags })),
    );

    expect(places.map((place) => [place.kind, place.label])).toEqual(
      fixtures.map(([, kind, label]) => [kind, label]),
    );
  });

  it('keeps only short, useful details', () => {
    const [place] = placesFromElements([
      {
        type: 'node',
        id: 1,
        lat: -27.5,
        lon: 153,
        tags: {
          amenity: 'parking',
          opening_hours: '06:00-18:00',
          fee: 'no',
          wheelchair: 'yes',
          drinking_water: 'yes',
          capacity: '24',
          description: 'A much longer description that is not needed here',
        },
      },
    ]);

    expect(place.details).toBe('Open 06:00-18:00, free, wheelchair accessible, drinking water, 24 spaces');
    expect(place.details).not.toContain('description');
  });

  it('drops unknown or misplaced elements and caps each answer at 300', () => {
    const elements = Array.from({ length: 305 }, (_, index) => ({
      type: 'node',
      id: index + 1,
      lat: -27.5,
      lon: 153,
      tags: { amenity: 'shelter' },
    }));
    elements.push(
      { type: 'node', id: 400, lat: -27.5, lon: 153, tags: { tourism: 'hotel' } },
      { type: 'node', id: 401, lon: 153, tags: { amenity: 'shelter' } } as never,
    );

    const places = placesFromElements(elements);

    expect(places).toHaveLength(300);
    expect(places.at(-1)?.id).toBe('node/300');
  });
});
