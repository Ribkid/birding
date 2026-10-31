# eBird round 2: every useful feature the eBird API allows

Requested by Rhys on 1 Nov 2026: "add as many features as possible utilizing the ebird api". This builds on round 1 (`docs/plans/2026-11-01-ebird-spots-design.md`): eBird spots, `scripts/build-ebird.mjs`, `api/ebird.js` and the snapshot. Every rule in round 1 still applies. Above all, the key stays secret: only the build script and `api/ebird.js` read `process.env.EBIRD_API_KEY`, and nothing ever prints, logs, commits or bundles it.

## Ground rules for every feature

- **Location privacy.** Her location only ever leaves the phone rounded to 2 decimal places (about 1 km). It is sent only to our own `/api/ebird`, never logged, and used only for features she opens. Where a feature uses her location, say so in one plain line ("Uses your rough location, never saved").
- **Offline.**
  - Live features show only with signal and hide or fall back quietly without it.
  - Anything in the daily snapshot works offline.
  - No feature may block the screen it's on while it loads; use a skeleton row, and treat a timeout as "not available right now".
- **The function grows by routes, not by a free proxy.**
  - `api/ebird.js` accepts only the named routes below.
  - Each route validates its own parameters:
    - locId `/^L\d{1,10}$/`;
    - speciesCode `/^[a-z0-9]{4,8}$/`;
    - region from an allowlist of `AU-QLD` and the 11 SEQ codes;
    - dates must be real, from 2000 to today;
    - lat/lng must be inside SEQ's box, -29.2 to -25.8 and 151.0 to 153.6;
    - `dist` is 1 to 50; `back` is 1 to 30.
  - Each route returns a compact, mapped shape, never eBird's raw response.
  - Cache at the edge: `s-maxage` 600 to 3600 s by route, with `stale-while-revalidate`.
- **Credit.** Show "Data from eBird (ebird.org), Cornell Lab of Ornithology" on every screen that shows eBird data, and link eBird pages where useful (a hotspot, a checklist).
- **Names.** Map species codes to app species through the round-1 taxonomy map. Birds that aren't in the app show their eBird common name, not linked.

## The features, in build order (build, test and commit each before the next)

### 1. Where to find it now (species page)
- **Nearest recent sighting:** route `nearest?sp=CODE&lat&lng`, calling `data/nearest/geo/recent/{code}?lat&lng&back=30&maxResults=5`. Example: "Seen 3.2 km away at Oxley Creek Common, 2 days ago". It has Directions and the spot link, and only shows with her location.
- **Recent in SEQ:** route `species?sp=CODE`, calling `data/obs/{region}/recent/{code}?back=30` for the SEQ regions, merged and newest first. Show "Reported 42 times in SEQ in the last 30 days" and the latest 5 places, each linking to its spot.
- Both sit in a "Where to find it now" card under How to spot it, and are hidden offline.

### 2. Hunt list: birds near you that you haven't seen
- **Route** `near?lat&lng&dist=25&back=7`, calling `data/obs/geo/recent?lat&lng&dist&back&hotspot=false`. Cut that down to the birds missing from her dex, ranked by distance, then most recent.
- **Where:** on Targets (`src/screens/lists/Targets.tsx`) as a new top section, "Reported near you this week", with each row linking to the species and its nearest place. Also on Spots as a "Hunt" chip that filters the list to spots where one of those birds was reported.

### 3. Rare birds near you
- **Route** `notable?lat&lng&dist=50&back=7`, calling `data/obs/geo/recent/notable`. Round 1 covers rare birds SEQ-wide; this makes it "near you, nearest first" when her location is known.
- Mark which ones would be new for her dex.

### 4. Your council-area dexes (collection)
- **Snapshot:** the build fetches `product/spplist/{region}` for each of the 11 regions and maps them to app ids, giving `regions: { BRI: { name: 'Brisbane', ids: [...] } }`.
- **Assigning sightings:** each of her sightings counts towards the council area of the nearest eBird hotspot within 3 km, using the hotspots' `subnational2Code`. Sightings without coordinates count only towards her overall dex.
- **Where:**
  - a "Your areas" section on Lists (`src/screens/lists/Lists.tsx`) with rings, e.g. "Brisbane 47 / 405", where each ring opens a filtered dex showing that area's birds, seen and not seen;
  - three new badges in `src/core/stats.js` badges(): "100 in one area", "Five areas" and "Every SEQ area". Check how badges are defined, and keep earned badges stable for existing users.

### 5. A spot's latest visits (spot page)
- **Route** `visits?loc=L123`, calling `product/lists/{locId}?maxResults=10`: the latest checklists there, with date, time and species count. Don't show observer names on our screen; link each to `https://ebird.org/checklist/{subId}` instead.
- **Route** `checklist?sub=S123`, calling `product/checklist/view/{subId}` and validating subId `/^S\d{4,12}$/`: the species on that visit, mapped and marked seen or not seen. It opens in a sheet.

### 6. Today in SEQ
- **Snapshot plus live:** route `stats?date`, calling `product/stats/AU-QLD/{y}/{m}/{d}`, for today and yesterday. It returns the number of checklists, birders and species reported in Queensland.
- **Where:** a small glass card on Spots, e.g. "Today in Queensland: 212 checklists, 287 species". Hide it when there's no data.

### 7. On this day
- **Route** `historic?region&date`, calling `data/obs/{region}/historic/{y}/{m}/{d}?rank=mrec&detail=simple` for the same date last year, in her nearest SEQ region, or Brisbane without her location.
- **Where:** Spots and the Dex's Today rail get "This day last year: 164 species reported around Brisbane", with up to 6 of them she hasn't seen. Tapping it opens the list.

### 8. Learn: birds around this week
- A new Learn pack, "Around this week". Its round is made from the birds reported near her (feature 2's data) or in SEQ (the round-1 snapshot) in the last 7 days. It uses the existing round engine in `src/core/learn.js` and `quiz.js`; read how packs are defined and add one without changing scoring or stored data.
- Offline, it uses the snapshot.

### 9. Likely here: outing quick-add
- When an outing has a place near an eBird spot (within 1 km), the outing page (`src/screens/lists/Outing.tsx`) shows a "Likely here" rail. It lists the birds reported at that spot in the last 30 days, from the snapshot or the live `recent` route, with the ones she hasn't counted yet first. One tap adds the bird to the tally through the existing tally path (`useTally`).
- Keep the tally rules from `docs/ui-improvements.md` items 2 and 3: quiet new birds, no lost taps.

### 10. SEQ eBirders today (optional, last)
- **Route** `top?region&date`, calling `product/top100/{region}/{y}/{m}/{d}?rankedBy=spp&maxResults=10`.
- **Where:** a small "Top eBirders in Brisbane today" list on the Leaderboard screen, below the app's own leaderboard, showing names exactly as eBird publishes them, a "via eBird" credit, and no links to people.
- Build this only if everything above is done and checked.

## What the eBird API can't do (say so in the docs; don't fake it)

- **No submitting.** It can't submit checklists to eBird; there's no write API. Settings already has "Export for eBird".
- **No seasonal frequency.** There are no bar-chart frequencies, so "likely" comes from recent reports.
- **No media.** It has no photos or sounds (Macaulay Library isn't in this API).
- **No alerts.** There are no push alerts. Rare-bird alerts appear in the app; notifications would need a separate push service.

## Testing

- **vitest:**
  - every function route's validation, including bad lat/lng, a region outside the allowlist and a bad date;
  - mapped output, cache headers, and no key in any output;
  - region assignment by nearest hotspot;
  - the hunt-list cut-down;
  - the new badges, and that badges already earned don't change;
  - the new Learn pack;
  - the Likely here rail adding through the tally.
- **Playwright,** faking `/api/ebird` per route with `page.route`: each feature at 390 and 320 px, light and dark, offline (it must hide or fall back), and with location allowed and denied.
- **Finally:** `npm run build`, `npm test`, a check that the key is in nothing under `dist/` or the diff, and a report.
