export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type PlaceKind =
  | 'hut'
  | 'shelter'
  | 'toilets'
  | 'water'
  | 'picnic'
  | 'viewpoint'
  | 'birdHide'
  | 'parking'
  | 'information'
  | 'camp';

export interface MapPlace {
  id: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  label: string;
  name: string;
  details: string;
}

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Readonly<Record<string, string>>;
}

export const PLACE_KINDS: PlaceKind[] = [
  'hut',
  'shelter',
  'toilets',
  'water',
  'picnic',
  'viewpoint',
  'birdHide',
  'parking',
  'information',
  'camp',
];

export const PLACE_LABELS: Record<PlaceKind, string> = {
  hut: 'Hut',
  shelter: 'Shelter',
  toilets: 'Toilets',
  water: 'Drinking water',
  picnic: 'Picnic spot',
  viewpoint: 'Lookout',
  birdHide: 'Bird hide',
  parking: 'Parking',
  information: 'Information',
  camp: 'Camp site',
};

// Single picnic tables are left out: a park can have dozens, and they bury the huts and toilets.
export function buildOverpassQuery(bounds: MapBounds): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const selectors = [
    '["tourism"~"^(wilderness_hut|alpine_hut)$"]',
    '["amenity"="shelter"]',
    '["amenity"="toilets"]',
    '["amenity"="drinking_water"]',
    '["tourism"="picnic_site"]',
    '["amenity"="bbq"]',
    '["tourism"="viewpoint"]',
    '["leisure"="bird_hide"]',
    '["amenity"="parking"]',
    '["tourism"="information"]["information"~"^(board|map|office)$"]',
    '["tourism"="camp_site"]',
  ];
  return `[out:json][timeout:25];(\n${selectors.map((selector) => `  nwr${selector}(${box});`).join('\n')}\n);\nout center 300;`;
}

// Places are fetched for the visible area grown out to a 0.02° grid (about 2 km), so small pans reuse one
// answer and a cached answer always covers everything on screen.
export function snapBounds(bounds: MapBounds, step = 0.02): MapBounds {
  const down = (value: number) => Number((Math.floor(value / step) * step).toFixed(4));
  const up = (value: number) => Number((Math.ceil(value / step) * step).toFixed(4));
  return { south: down(bounds.south), west: down(bounds.west), north: up(bounds.north), east: up(bounds.east) };
}

export function boundsKey(bounds: MapBounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(2))
    .join(',');
}

function classify(tags: Readonly<Record<string, string>>): { kind: PlaceKind; label: string } | null {
  if (tags.tourism === 'wilderness_hut' || tags.tourism === 'alpine_hut') {
    return { kind: 'hut', label: tags.tourism === 'alpine_hut' ? 'Alpine hut' : 'Wilderness hut' };
  }
  if (tags.amenity === 'shelter') return { kind: 'shelter', label: 'Shelter' };
  if (tags.amenity === 'toilets') return { kind: 'toilets', label: 'Toilets' };
  if (tags.amenity === 'drinking_water') return { kind: 'water', label: 'Drinking water' };
  if (tags.tourism === 'picnic_site') return { kind: 'picnic', label: 'Picnic area' };
  if (tags.leisure === 'picnic_table') return { kind: 'picnic', label: 'Picnic table' };
  if (tags.amenity === 'bbq') return { kind: 'picnic', label: 'Barbecue' };
  if (tags.tourism === 'viewpoint') return { kind: 'viewpoint', label: 'Lookout' };
  if (tags.leisure === 'bird_hide') return { kind: 'birdHide', label: 'Bird hide' };
  if (tags.amenity === 'parking') return { kind: 'parking', label: 'Parking' };
  if (tags.tourism === 'information' && ['board', 'map', 'office'].includes(tags.information ?? '')) {
    return { kind: 'information', label: `Information ${tags.information}` };
  }
  if (tags.tourism === 'camp_site') return { kind: 'camp', label: 'Camp site' };
  return null;
}

function placeDetails(tags: Readonly<Record<string, string>>, kind: PlaceKind): string {
  const details: string[] = [];
  if (tags.opening_hours) details.push(`Open ${tags.opening_hours}`);
  if (tags.fee === 'yes') details.push('fee applies');
  else if (tags.fee === 'no') details.push('free');
  if (tags.wheelchair === 'yes') details.push('wheelchair accessible');
  else if (tags.wheelchair === 'limited') details.push('limited wheelchair access');
  else if (tags.wheelchair === 'no') details.push('no wheelchair access');
  if (tags.drinking_water === 'yes' && kind !== 'water') details.push('drinking water');
  if (kind === 'parking' && /^\d+$/.test(tags.capacity ?? '')) details.push(`${tags.capacity} spaces`);
  return details.join(', ');
}

export function placesFromElements(elements: readonly OverpassElement[]): MapPlace[] {
  const places: MapPlace[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const classified = classify(tags);
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!classified || lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    places.push({
      id: `${element.type}/${element.id}`,
      lat,
      lng,
      kind: classified.kind,
      label: classified.label,
      name: tags.name?.trim() ?? '',
      details: placeDetails(tags, classified.kind),
    });
    if (places.length === 300) break;
  }
  return places;
}
