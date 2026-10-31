# eBird spots: more, fresher places to bird

Requested by Rhys on 1 Nov 2026. He has an eBird API key and wants better, more up-to-date Spots data.

Today Spots uses the 220 hotspots in `public/data/seq.json` (from the Atlas of Living Australia), plus OpenStreetMap access ratings. eBird has about 3,200 hotspots across the 11 South East Queensland council areas. About 2,700 of them have 40 or more species, and about 1,200 were birded since 1 October.

Rhys's decisions:
- **Freshness:** a daily snapshot saved in the app (so it works offline), plus live recent sightings fetched from a small private server function when there is signal.
- **Who builds:** kimi builds it; Claude reviews and fixes it.

## The key stays secret (most important rule)

- **Where it lives:** the key is `EBIRD_API_KEY`.
  - Locally, it is in `.env.local`, which git ignores (`.env*` in `.gitignore`).
  - On Vercel, it is a project environment variable that Rhys adds.
- **Who may read it:** only `scripts/build-ebird.mjs` (at build time, in Node) and `api/ebird.js` (the server function).
- **Never in the browser.** Never prefix it with `VITE_`. Never import it into `src/`. Never write it into any file under `public/` or `dist/`, a log line, an error message, a test, a commit or a doc.
- **Never read `.env.local` or print the key.** Load it in the script with a tiny loader that reads `.env.local` into `process.env` and logs nothing about it.
- **Check the bundle.** Before every commit, grep `dist/` and the staged diff for the key's value and for `EBIRD_API_KEY`. Neither may appear outside `scripts/`, `api/` and this doc.

## Rules (as for every branch)

- **Git:** never push. Never touch `main` or `C:\Users\Rhys\Documents\Birdy-React`.
- **Storage:** don't change how sightings, outings or patches are stored or synced (`src/core/db.js`, `sync.js`, `cloud.js`, the migrations).
- **Offline and accountless:** it must keep working offline and without an account. No CDN at runtime. No new npm dependencies.
- **Build and test:** `npm run build` and `npm test` pass before every commit. Write vitest tests for the logic. Make small commits with plain messages.
- **Look:** photo-first and glassy; paper #F4F6F9, ink #121821, dark paper #0B0E12; no green page backgrounds. Light, dark and Outdoor themes, 390 and 320 px, 150% and 200% text, 44 px targets, visible focus, and reduced motion respected.
- **eBird data is not committed to the public repo.** The generated files under `public/data/ebird/` are gitignored and built at build time. Credit eBird wherever its data shows: "Data from eBird (ebird.org), Cornell Lab of Ornithology".
- **No eBird key means no failure.** If the key is missing, the build script logs one line and exits 0. The app then falls back to today's ALA spots, so local builds, tests and preview deploys without the key keep working.

## 1. The build script: `scripts/build-ebird.mjs`

It runs as part of `npm run build`, before `vite build` (so `dist/` gets the files): `"build": "tsc -b && node scripts/build-ebird.mjs && vite build && node scripts/build-sw.mjs"`.

**API basics**
- Base URL: `https://api.ebird.org/v2/`, with the key in the header `X-eBirdApiToken`.
- At most 4 requests a second.
- On 429 or 5xx, retry with backoff (3 tries).
- On anything else, stop and keep the previous files.
- Set a User-Agent: `BirdyDex build (seqbirding.com)`.

**Regions:** `AU-QLD-BRI, AU-QLD-GOL, AU-QLD-IPS, AU-QLD-LOV, AU-QLD-LOG, AU-QLD-MRB, AU-QLD-RED, AU-QLD-SCE, AU-QLD-SOM, AU-QLD-SUN, AU-QLD-TOO`.

**What it fetches**
1. **Taxonomy:** `ref/taxonomy/ebird?fmt=json&cat=species`, mapped to the app's birds by scientific name (`src/core/species.js` `BIRDS`, `sci`).
   - Handle the few name differences with a small explicit alias table. Log the app birds that didn't match.
   - Keep `speciesCode → app id`.
2. **Hotspots:** `ref/hotspot/{region}?fmt=json` for each region.
   - Keep `locId, locName, lat, lng, numSpeciesAllTime, numChecklistsAllTime, latestObsDt, subnational2Code`.
   - Keep only hotspots with 10 or more species.
3. **Species lists:** `product/spplist/{locId}` for the top 500 hotspots by species, mapped to app ids, unknown codes dropped.
4. **Recent sightings per region:** `data/obs/{region}/recent?back=30&hotspot=true`, plus `data/obs/{region}/recent/notable?back=7&detail=simple`. These give "seen lately" and "rare birds around".

**Output:** `public/data/ebird/spots.json`, gitignored and compact:

```json
{
  "built": "ISO date",
  "source": "eBird",
  "spots": [["L123", "Name", -27.4, 153.0, 180, 950, "2026-10-30", "BRI"], ...],
  "lists": { "L123": [ids...] },
  "recent": { "L123": [[speciesId, "2026-10-29"], ...] },
  "notable": [{ "id": 94, "name": "…", "loc": "L123", "where": "…", "lat": 0, "lng": 0, "date": "…", "n": 1 }]
}
```

- Keep it under about 1 MB.
- Add it to `scripts/build-sw.mjs` `EXTRA_SHELL` only when the file exists, so Spots works offline after the first visit.
- Follow the service-worker rule: never rebuild a cached Response.

**Daily refresh:** add `.github/workflows/refresh-ebird.yml`. It runs on a daily cron (17:00 UTC, which is 03:00 Brisbane) and on `workflow_dispatch`. It only `curl -X POST`s the Vercel Deploy Hook URL, stored as the GitHub secret `VERCEL_DEPLOY_HOOK_URL`. No eBird key goes in GitHub.

## 2. The server function: `api/ebird.js` (a Vercel Node function)

Two GET routes. Both send `Cache-Control: s-maxage=3600, stale-while-revalidate=86400`.

| Route | Calls eBird with | Returns |
|---|---|---|
| `/api/ebird?recent=L123` | `data/obs/L123/recent?back=30` | `[{ code, sci, name, date, n }]` |
| `/api/ebird?list=L123` | `product/spplist/L123` | `[codes]` |

**Rules for the function**
- Validate `locId` against `/^L\d{1,10}$/`. Reject anything else with 400.
- GET only.
- Never echo the key or eBird's raw error. Return 502 `{ error: 'eBird unavailable' }` on failure.
- No CORS beyond same origin.

**`vercel.json`:** the catch-all rewrite currently sends every unknown path to `/index.html`. Add `api` to the excluded prefixes, or `/api/ebird` returns the app instead of the function.

**In the app:** call it only when online. A 404, an error or offline (as under `vite dev`, which has no `/api`) quietly falls back to the snapshot. The client maps `sci` to app species.

## 3. The app

`src/lib/spots.ts` and `src/screens/spots/*` already have the rows, sorts, filters, search and spot page.

**Data source**
- Read `/data/ebird/spots.json` when present, and fall back to `seq.json` hotspots when it isn't.
- Spot ids become eBird `locId`s. Routes become `#/spot/L123`; keep `#/spot/<number>` working for the ALA fallback.

**List**
- By default, show spots with 40 or more species. A "Show all spots" switch shows every spot. Search always covers all.
- Sorts:
  - **Most species:** eBird all-time.
  - **Most visited:** checklists, replacing "Most sightings".
  - **Recently birded:** `latestObsDt`.
  - **Nearest.**
  - **New for you:** from the baked lists. Spots without a list sort after those with one.
  - **Easiest access:** see below.
- Filters: today's chips plus "Birded this week".

**Rare birds around:** a section above the list showing this week's notable sightings in SEQ, nearest first when her location is known. Each shows the species (with a link to it in the dex when it's in the app), the place (with a link to the spot), the date and the count.

**Spot page**
- Last birded ("Birded 2 days ago"), all-time species and checklists.
- An "Open in eBird" link to `https://ebird.org/hotspot/L123`.
- **Seen here lately:** live from the function when online, otherwise from the snapshot. Each species is marked seen or not seen in her dex.
- **All birds here:** from the baked list, or the live `list` route.
- The eBird credit.

**Suggested for you:** the same idea as today, using eBird lists and recent activity. A spot birded this month with many birds new for her ranks first. Restricted-access spots still come last.

**Access:**
- Re-run the OpenStreetMap access build for eBird spots: extend `scripts/build-spot-access.mjs` to take the eBird spots and key results by `locId`.
- Cover the top 800 by species, writing `public/data/spot-access-ebird.json`. OSM data may be committed (ODbL, credited as now).
- Spots outside it show "Access not known yet".

**Map:** the hotspot popup's "Spot details" link goes to the nearest eBird spot within 400 m, and is hidden if there's none. Nothing else on the map changes in this round.

## 4. Testing

**vitest**
- Taxonomy mapping and aliases.
- Compacting and decoding `spots.json`.
- Sorts and filters with eBird fields.
- Fallback to ALA data when the file is missing.
- `api/ebird.js` with a fake `fetch`: validation, caching headers, no key in any output, and the error path.
- The client's live call falling back offline and on 404.

**Build:** run `node scripts/build-ebird.mjs` for real with the local key. Report the counts: spots, lists, recent, notable, unmatched app birds. Then check that `dist/` contains no key.

**Playwright** (the helper in `C:\Users\Rhys\AppData\Local\Temp\claude\C--Users-Rhys-Documents-Birding\50bbd68c-99d3-4370-8d9a-7660079d8d87\scratchpad\cli\plib.mjs` can be copied; change its BASE):
- Check `#/spots` and a spot page at 390 and 320 px, in light and dark, offline, and with and without `spots.json`.
- Fake `/api/ebird` with `page.route`.
- Route `**/*supabase.co/**` to an empty 200.

**Report:** finish with the commits, what works, the counts, what was checked, and the exact steps Rhys must do on Vercel and GitHub.
