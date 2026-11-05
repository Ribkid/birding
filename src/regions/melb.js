// Greater Melbourne region pack. See docs/plans/2026-11-05-melbourne-region-design.md.
// Not launched: it can only be picked in a dev build (see src/regions/index.js). Step 2 of the design: the 103 birds
// already in the app that are regular around Melbourne. The ~78 Melbourne-only birds come in step 3.
export default {
  code: 'melb',
  name: 'Greater Melbourne',
  short: 'Melbourne',
  launched: false,
  timeZone: 'Australia/Melbourne',
  map: {
    center: [-37.81, 144.96],
    zoom: 9,
    // The area the regional records (rates.json) were built from: [south, west, north, east]. It covers the hotspots of
    // all 37 councils (lat −38.68…−36.94, lng 143.83…146.45).
    bbox: [-38.7, 143.8, -36.9, 146.5],
  },
  // Points the eBird proxy accepts for nearby-sighting searches: a little wider than the records box.
  pointBounds: [-39.2, 143.3, -36.5, 147.0],
  ebird: {
    state: 'AU-VIC',
    stateName: 'Victoria',
    // eBird subnational2 suffixes (AU-VIC-MEL…): the 31 metro councils plus Greater Geelong, Surf Coast, Bass Coast,
    // Macedon Ranges, Mitchell and Baw Baw, grouped by area. Note AU-VIC-BRI is Brimbank, not Brisbane.
    councils: {
      MEL: 'Melbourne',
      YAR: 'Yarra',
      POR: 'Port Phillip',
      STO: 'Stonnington',
      MBY: 'Maribyrnong',
      MVA: 'Moonee Valley',
      MOR: 'Merri-bek',
      DAR: 'Darebin',
      BOR: 'Boroondara',
      GEI: 'Glen Eira',
      WYN: 'Wyndham',
      HOB: 'Hobsons Bay',
      BRI: 'Brimbank',
      MLT: 'Melton',
      HUM: 'Hume',
      WHI: 'Whittlesea',
      BAN: 'Banyule',
      NIL: 'Nillumbik',
      MIT: 'Mitchell',
      MAC: 'Macedon Ranges',
      MAN: 'Manningham',
      WHO: 'Whitehorse',
      MAR: 'Maroondah',
      KNO: 'Knox',
      MON: 'Monash',
      YRA: 'Yarra Ranges',
      CAR: 'Cardinia',
      BAW: 'Baw Baw',
      BAY: 'Bayside',
      KIN: 'Kingston',
      GDA: 'Greater Dandenong',
      CAS: 'Casey',
      FRA: 'Frankston',
      MPE: 'Mornington Peninsula',
      BAS: 'Bass Coast',
      GGE: 'Greater Geelong',
      SUR: 'Surf Coast',
    },
    // Areas for the area dexes and badges: 37 councils are too many to collect, so they are grouped into 8.
    areaLabel: 'area',
    zones: {
      inner: { name: 'Inner Melbourne', councils: ['MEL', 'YAR', 'POR', 'STO', 'MBY', 'MVA', 'MOR', 'DAR', 'BOR', 'GEI'] },
      west: { name: 'West & Werribee', councils: ['WYN', 'HOB', 'BRI', 'MLT'] },
      north: { name: 'North', councils: ['HUM', 'WHI', 'BAN', 'NIL', 'MIT', 'MAC'] },
      east: { name: 'East', councils: ['MAN', 'WHO', 'MAR', 'KNO', 'MON'] },
      ranges: { name: 'Dandenongs & Yarra Valley', councils: ['YRA', 'CAR', 'BAW'] },
      southeast: { name: 'Bayside & South-East', councils: ['BAY', 'KIN', 'GDA', 'CAS', 'FRA'] },
      peninsula: { name: 'Peninsula & Phillip Island', councils: ['MPE', 'BAS'] },
      geelong: { name: 'Geelong & Surf Coast', councils: ['GGE', 'SUR'] },
    },
    // Used before a rough location is known.
    fallbackCouncil: 'MEL',
  },
  // Every species in this region's dex, with how often it is reported here: 1 common … 5 rare.
  // Birds: ALA records since 2016 in the box above, banded as in SEQ (≥40,000 common, ≥15,000 fairly common,
  // ≥4,000 uncommon, ≥800 scarce); scripts/build-rates.mjs prints the bands. Hand pass: Eastern Cattle Egret (74) is
  // uncommon, not rare: ALA splits its records across several names, so its count (729) is far too low.
  species: {
    2: 3, 3: 3, 6: 1, 7: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 2, 15: 1, 16: 1, 19: 1, 20: 1, 28: 2, 31: 3, 32: 3,
    38: 3, 39: 2, 41: 3, 42: 1, 43: 1, 44: 1, 47: 2, 48: 3, 49: 2, 50: 1, 54: 3, 58: 2, 59: 1, 60: 2, 61: 3, 62: 2,
    63: 1, 64: 1, 65: 2, 66: 1, 68: 1, 69: 1, 70: 2, 71: 2, 72: 2, 74: 3, 75: 3, 76: 1, 78: 1, 79: 2, 81: 2, 83: 2,
    84: 2, 86: 1, 87: 2, 88: 2, 91: 2, 92: 3, 93: 3, 94: 1, 97: 2, 102: 2, 104: 1, 105: 1, 106: 1, 107: 1, 109: 1,
    110: 1, 111: 4, 118: 3, 121: 3, 122: 1, 125: 1, 126: 1, 127: 1, 131: 1, 132: 3, 133: 1, 134: 1, 135: 2, 144: 1,
    145: 1, 146: 2, 147: 2, 148: 1, 149: 3, 152: 1, 153: 1, 154: 3, 158: 1, 160: 1, 162: 1, 163: 1, 165: 1, 166: 2,
    167: 1, 169: 1, 170: 2, 171: 3, 172: 1, 173: 1, 174: 1, 175: 2, 176: 1, 180: 1, 181: 2,
  },
  // Region-specific ID notes that replace the shared note in species.js, where the shared one names SEQ places.
  notes: {
    54: 'Long, slightly upturned bill. Arrives from Alaska each spring and flocks at high-tide roosts on Port Phillip and Western Port.',
    59: 'The seagull of every Port Phillip beach and car park. White with grey wings and red bill and legs.',
    65: 'Large black-and-white cormorant with a yellow-orange face patch. Common on Port Phillip piers and around Western Port.',
    83: "Australia's biggest raptor, with a diamond-shaped tail. Soars over the You Yangs and the open country west of Melbourne.",
    174: 'Introduced; glossy black with white spots in winter. Abundant around Melbourne, nesting in roofs and flocking on lawns.',
  },
};
