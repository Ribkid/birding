// South East Queensland region pack. See docs/plans/2026-11-05-melbourne-region-design.md.
// Plain JS (not JSON) so the app, the Vercel function and the Node build scripts can all import it.
export default {
  code: 'seq',
  name: 'South East Queensland',
  short: 'SEQ',
  timeZone: 'Australia/Brisbane',
  map: {
    center: [-27.47, 153.02],
    zoom: 9,
    // The area the regional records (rates.json) were built from: [south, west, north, east].
    bbox: [-28.35, 151.9, -25.9, 153.6],
  },
  // Points the eBird proxy accepts for nearby-sighting searches: a little wider than the records box.
  pointBounds: [-29.2, 151.0, -25.8, 153.6],
  ebird: {
    state: 'AU-QLD',
    stateName: 'Queensland',
    // eBird subnational2 suffixes (AU-QLD-BRI…) in display order.
    councils: {
      BRI: 'Brisbane',
      GOL: 'Gold Coast',
      IPS: 'Ipswich',
      LOV: 'Lockyer Valley',
      LOG: 'Logan',
      MRB: 'Moreton Bay',
      RED: 'Redland',
      SCE: 'Scenic Rim',
      SOM: 'Somerset',
      SUN: 'Sunshine Coast',
      TOO: 'Toowoomba',
    },
    // Areas for the area dexes and badges. In SEQ every council is its own area.
    areaLabel: 'council area',
    zones: {
      BRI: { name: 'Brisbane', councils: ['BRI'] },
      GOL: { name: 'Gold Coast', councils: ['GOL'] },
      IPS: { name: 'Ipswich', councils: ['IPS'] },
      LOV: { name: 'Lockyer Valley', councils: ['LOV'] },
      LOG: { name: 'Logan', councils: ['LOG'] },
      MRB: { name: 'Moreton Bay', councils: ['MRB'] },
      RED: { name: 'Redland', councils: ['RED'] },
      SCE: { name: 'Scenic Rim', councils: ['SCE'] },
      SOM: { name: 'Somerset', councils: ['SOM'] },
      SUN: { name: 'Sunshine Coast', councils: ['SUN'] },
      TOO: { name: 'Toowoomba', councils: ['TOO'] },
    },
    // Used before a rough location is known.
    fallbackCouncil: 'BRI',
  },
  // Every species in this region's dex, with how often it is reported here: 1 common … 5 rare.
  // Birds: ALA records since 2016 (≥40,000 common, ≥15,000 fairly common, ≥4,000 uncommon, ≥800 scarce).
  // Other kinds are ranked against their own kind.
  species: {
    1: 1, 2: 2, 3: 1, 4: 2, 5: 3, 6: 2, 7: 1, 8: 4, 9: 1, 10: 2, 11: 2, 12: 2, 13: 1, 14: 3, 15: 1, 16: 1,
    17: 2, 18: 3, 19: 3, 20: 1, 21: 1, 22: 1, 23: 2, 24: 3, 25: 3, 26: 3, 27: 3, 28: 2, 29: 4, 30: 4, 31: 3, 32: 4,
    33: 4, 34: 3, 35: 2, 36: 2, 37: 2, 38: 2, 39: 2, 40: 3, 41: 2, 42: 1, 43: 1, 44: 1, 45: 2, 46: 4, 47: 2, 48: 4,
    49: 1, 50: 1, 51: 3, 52: 4, 53: 2, 54: 3, 55: 3, 56: 3, 57: 3, 58: 3, 59: 1, 60: 2, 61: 2, 62: 1, 63: 1, 64: 1,
    65: 2, 66: 1, 67: 4, 68: 1, 69: 1, 70: 1, 71: 4, 72: 4, 73: 2, 74: 4, 75: 3, 76: 1, 77: 1, 78: 1, 79: 2, 80: 2,
    81: 2, 82: 3, 83: 3, 84: 2, 85: 5, 86: 4, 87: 3, 88: 1, 89: 2, 90: 2, 91: 3, 92: 3, 93: 3, 94: 1, 95: 5, 96: 2,
    97: 1, 98: 3, 99: 3, 100: 1, 101: 2, 102: 2, 103: 3, 104: 1, 105: 1, 106: 1, 107: 1, 108: 1, 109: 2, 110: 1, 111: 1, 112: 4,
    113: 5, 114: 3, 115: 3, 116: 2, 117: 3, 118: 2, 119: 3, 120: 3, 121: 1, 122: 1, 123: 1, 124: 1, 125: 2, 126: 1, 127: 1, 128: 2,
    129: 2, 130: 2, 131: 3, 132: 1, 133: 1, 134: 1, 135: 2, 136: 1, 137: 1, 138: 1, 139: 1, 140: 1, 141: 2, 142: 3, 143: 3, 144: 2,
    145: 1, 146: 3, 147: 1, 148: 1, 149: 1, 150: 1, 151: 1, 152: 1, 153: 1, 154: 1, 155: 2, 156: 3, 157: 3, 158: 1, 159: 2, 160: 1,
    161: 1, 162: 1, 163: 1, 164: 1, 165: 1, 166: 2, 167: 2, 168: 1, 169: 1, 170: 2, 171: 2, 172: 1, 173: 1, 174: 4, 175: 1, 176: 1,
    177: 2, 178: 2, 179: 5, 180: 3, 181: 3, 182: 2, 183: 2, 184: 1, 185: 1, 186: 5, 187: 4, 188: 1, 189: 1, 190: 3, 191: 2, 192: 4,
    193: 1, 194: 2, 195: 1, 196: 5, 197: 3, 198: 3, 199: 5, 200: 3, 201: 3, 202: 4, 203: 5, 204: 2, 205: 1, 206: 4, 207: 5, 208: 5,
    209: 3, 210: 3, 211: 4, 212: 4, 213: 2, 214: 5, 215: 3, 216: 1, 217: 4, 218: 5, 219: 1, 220: 1, 221: 5, 222: 5, 223: 1, 224: 2,
    225: 3, 226: 4, 227: 2, 228: 2, 229: 5, 230: 4, 231: 4, 232: 1, 233: 1, 234: 2, 235: 2, 236: 3, 237: 3, 238: 4, 239: 3, 240: 1,
    241: 1, 242: 1, 243: 4, 244: 5, 245: 5, 246: 2, 247: 4, 248: 3, 249: 4, 250: 1, 251: 3, 252: 5, 253: 5, 254: 3, 255: 2, 256: 2,
    257: 2, 258: 3, 259: 4, 260: 3, 261: 1, 262: 1, 263: 5, 264: 4, 265: 3, 266: 4, 267: 2, 268: 2, 269: 2, 270: 2, 271: 3, 272: 5,
    273: 4, 274: 3, 275: 2, 276: 1, 277: 1, 278: 1, 279: 1, 280: 3, 281: 2, 282: 5, 283: 3, 284: 4, 285: 1, 286: 5, 287: 5, 288: 5,
    289: 4, 290: 4, 291: 3, 292: 3, 293: 3, 294: 1, 295: 3, 296: 2, 297: 2, 298: 4, 299: 1, 300: 1, 301: 4, 302: 1, 303: 5, 304: 1,
    305: 1, 306: 4, 307: 2, 308: 5, 309: 5, 310: 4, 311: 3, 312: 2, 313: 2, 314: 3, 315: 4, 316: 4, 317: 4, 318: 3, 319: 1, 320: 3,
    321: 5, 322: 3, 323: 5, 324: 3, 325: 2, 326: 5, 327: 2, 328: 1, 329: 1, 330: 4, 331: 2, 332: 5, 333: 2, 334: 5, 335: 4,
  },
  // Region-specific ID notes that replace the shared note in species.js. None yet.
  notes: {},
};
