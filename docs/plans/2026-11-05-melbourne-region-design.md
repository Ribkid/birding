# Adding Greater Melbourne: design

Date: 2026-11-05. Status: design agreed, not started.
Companion: [draft Melbourne bird list](2026-11-05-melbourne-bird-candidates.md).

## Decisions

| Question | Decision |
|---|---|
| Who it's for | New users who bird around Melbourne. BirdyDex stops being SEQ-only. |
| Launch scope | Birds only, at full SEQ quality (gallery, sourced write-up, rates, hotspots, calls, photo ID). Animals and plants in a later round. |
| Boundary | 37 eBird councils: the 31 metro councils plus Greater Geelong, Surf Coast, Bass Coast, Macedon Ranges, Mitchell and Baw Baw. Most of the best hotspots (Western Treatment Plant, You Yangs, Serendip, Phillip Island) are on the fringe. |
| How a user gets Melbourne | Picked on Welcome ("Where do you go birding?"), with the closer region preselected from a rough location if one is already known. Changeable in Settings. One site, one install. |
| Cross-region sightings | A sighting belongs to the user, not a region. Seeing a Noisy Miner in Brisbane ticks it in the Melbourne dex too. |
| Architecture | Region packs on one shared species catalogue (not one build per city, not a live eBird-only dex). |

## What the data says

From eBird (37 councils, pulled 2026-11-05) and the Atlas of Living Australia (bird records since 2016):

- 432 species on the metro councils' all-time lists; 252 reported in the last 30 days; 2,610 hotspots including the fringe.
- ALA has 438 bird species in the Melbourne core box against 530 in SEQ, with similar record volumes (8.8 M vs 9.3 M).
- The draft rule (≥3,000 ALA records, or on 25+ council lists and seen in 10+ this month) gives **181 birds: 103 already in the app, 78 new**. That is the same size as SEQ's dex. The list still needs hand curation; see the companion file.
- New birds are led by Little Raven, Red Wattlebird, Brown Thornbill, Eastern Rosella, New Holland and White-plumed Honeyeaters, Hoary-headed Grebe, Red-rumped Parrot, Long-billed Corella, Musk Lorikeet, Grey Currawong, Gang-gang Cockatoo, Hooded Plover, Cape Barren Goose, Superb Lyrebird and the robins (Flame, Scarlet, Rose).
- About 50 SEQ birds barely occur in Melbourne (brush-turkey, fruit-doves, coucal, Brahminy Kite…). They are left out of the Melbourne dex, not just ranked low.
- Names differ between the three taxonomies. ALA files several shared birds under other names (Australasian Swamphen, Pied Stilt, Brown Goshawk, Cattle Egret), and eBird doesn't match Eastern Osprey (it lumps it into Western Osprey). `SCI_ALIASES` in `scripts/build-ebird.mjs`, empty today, gets real entries.
- Hotspot extent of the 37 councils: lat −38.68…−36.94, lng 143.83…146.45. The ALA rates build uses lat −38.7…−36.9, lng 143.8…146.5.

## 1. Data model: one catalogue, a pack per region

**Catalogue.** Every species in any region stays in `src/core/species.js` (birds) and `public/data/species-new.json` (other kinds). Existing ids 1–335 are untouched. New Melbourne birds take **336 upward**, assigned once in a single pass and never renumbered. Shared per-id files stay single: `info.json`, `gallery.json`, `calls.json`, `lookalikes.json`.

**Region pack.** `src/regions/<code>.json` (plain JSON so the Vercel function and build scripts can import it as well as the app):

```jsonc
{
  "code": "melb",
  "name": "Greater Melbourne",
  "short": "Melbourne",              // fills every "in SEQ" string
  "timeZone": "Australia/Melbourne",
  "map": { "center": [-37.81, 144.96], "zoom": 9, "bbox": [-38.7, 143.8, -36.9, 146.5] },
  "ebird": {
    "state": "AU-VIC",
    "councils": { "MEL": "Melbourne", "WYN": "Wyndham", "...": "..." },
    "zones": { "inner": { "name": "Inner Melbourne", "councils": ["MEL", "YAR", "..."] }, "...": {} },
    "fallbackCouncil": "MEL"
  },
  "species": { "94": 1, "336": 1, "...": 3 },   // id -> rarity 1–5 in this region
  "notes": { "121": "…" }                       // only where the shared note is region-flavoured
}
```

`seq.json` moves to `public/data/regions/seq/rates.json`. Melbourne's `rates.json` is built by the same script with the Melbourne bbox. `spot-access.json` and `spot-access-ebird.json` move under `regions/<code>/` as well.

Rarity moves off each bird (`r` in `species.js`) into the pack, because it is regional: Red Wattlebird is common in Melbourne and scarce in SEQ. `tiers.json` (non-bird rarity) becomes the SEQ pack's entries for those ids.

**Region at boot.** `species.js` reads the chosen region from `localStorage` before anything renders. It builds `SPECIES`, `BIRDS`, `ANIMALS`, `ofKind`, `byId`, `kindsPresent` from that pack's subset, so every screen that imports them is region-aware with no change. `ALL_SPECIES` / `anyById` cover the whole catalogue for sightings, outings, the log, profiles and anything else that shows a record. Changing region saves it and reloads the app: it's rare, and reloading avoids re-plumbing module-level constants.

`seqdata.js` becomes `regiondata.js` and loads `/data/regions/<code>/rates.json`. `lib/seq.ts` keeps its API under a new name (`ensureRegionData`, `regionLanded`…).

## 2. Choosing a region, and what changes on screen

- **Welcome:** a new first step offers two cards. If a rough location is already known, the region whose bbox contains it (or is nearest) is preselected; nothing asks for location just for this. The rest of Welcome reads from the pack ("181 Greater Melbourne birds to find").
- **Existing installs:** anyone with records or a profile and no stored region is set to `seq` silently. Sarah never sees the picker, and her dex is unchanged.
- **Settings:** a Region row opens the same cards; picking the other region saves, reloads and says "Your sightings come with you."
- **Copy:** about 30 strings say SEQ / South East Queensland (Bird, Dex wordmark, dexVoice, WhereToFind, Lists, Targets, Learn, quiz.js, stats.js, mapinfo.js, Welcome). They all read `region.short` / `region.name`. The ALA source line in quizzes names the region.
- **Kinds:** tabs and Learn decks follow `kindsPresent`, so Melbourne shows birds only until its pack lists other kinds. No special-casing.
- **Map:** opens at the pack's centre and zoom (`SEQ_CENTER`/`SEQ_ZOOM` in `MapScreen.tsx` and `LocationPicker.tsx` go).
- **Area badges and Area dexes:** use the pack's zones. SEQ's zones are its 11 councils, so nothing changes there. Melbourne has 8 zones:

| Zone | Councils |
|---|---|
| Inner Melbourne | Melbourne, Yarra, Port Phillip, Stonnington, Maribyrnong, Moonee Valley, Merri-bek, Darebin, Boroondara, Glen Eira |
| West & Werribee | Wyndham, Hobsons Bay, Brimbank, Melton |
| North | Hume, Whittlesea, Banyule, Nillumbik, Mitchell, Macedon Ranges |
| East | Manningham, Whitehorse, Maroondah, Knox, Monash |
| Dandenongs & Yarra Valley | Yarra Ranges, Cardinia, Baw Baw |
| Bayside & South-East | Bayside, Kingston, Greater Dandenong, Casey, Frankston |
| Peninsula & Phillip Island | Mornington Peninsula, Bass Coast |
| Geelong & Surf Coast | Greater Geelong, Surf Coast |

- **This day last year:** nearest council from the pack (historic feeds are per council), falling back to `fallbackCouncil` (BRI / MEL) instead of hard-coded Brisbane.

## 3. eBird: build, proxy, time zones

**Build (`scripts/build-ebird.mjs`).** Loop over packs and write `public/data/regions/<code>/ebird.json` (today: one `public/data/ebird/spots.json`). Councils come from the pack instead of the `REGIONS` constant. The council suffix is stripped per state (`AU-VIC-`, `AU-QLD-`). Snapshots are per region because suffixes collide: `AU-QLD-BRI` is Brisbane and `AU-VIC-BRI` is Brimbank. `mapTaxonomy` maps against the whole catalogue, so shared birds keep one id.

Build time: Vercel caps builds at 45 minutes, and a hotspot list takes ~6–7 s. With `LIST_LIMIT` 150 per region at concurrency 3, a cold build with both regions is roughly 11 minutes of lists. Warm builds stay ~70 calls, because the 7-day list cache already handles this. The daily `refresh-ebird.yml` hook is unchanged.

**Proxy (`api/ebird.js`).**
- `REGIONS` is built from every pack (state codes plus council codes).
- `requireSeqPoint` becomes `requireRegionPoint`: inside any pack's bbox plus a small margin.
- `stats` takes a `state` parameter instead of hard-coded `AU-QLD`.
- `requireDate`'s "today" is the latest local date across the packs' time zones, using `Intl.DateTimeFormat`, not `UTC+10`. Melbourne is UTC+11 in daylight saving, so a Melbourne user after 11 pm UTC would otherwise be refused "today".
- Clients pass the pack's state and council codes everywhere they currently assume QLD.

**Time zones in the app.** Dates in the app are device-local, which is right for someone birding in their own city. The only fixed-offset code is in the proxy.

## 4. Photo ID, BirdNET and calls

- **Photo ID (`photoid.json`/`.bin`, BioCLIP int4):** the 78 new birds need text embeddings and image prototypes. Candidates at inference are limited to the current region's species. The month prior reads the current region's rates. A Melbourne user is never offered a Wompoo Fruit-Dove.
- **BirdNET (`birdnet-map.json`):** maps BirdNET label indices to app ids. Add the new birds; BirdNET's area model is already location-aware. A result outside the region's list shows as "not in your Melbourne dex" instead of being dropped.
- **Calls (`calls.json`, `public/data/calls/`):** add clips for the new birds with `sounds()` in `legacy/scripts/build_ala.py` (ALA/iNaturalist, licensed, credited).

## 5. Accounts, sync and leaderboard (Supabase)

- Sightings already store `species_id` only, so sync needs no change.
- `profiles` gains `home_region text not null default 'seq'`, which is written when the user picks or changes region.
- `get_leaderboard` gains `p_region text default null`. The app passes the user's region, so the board lists birders from that region and counts all of their species (sightings count everywhere). Groups ignore region.
- The leaderboard's `case when s.species_id between 1 and 181 then 'bird'` fallback misclassifies new birds, so `species_kinds` gets rows for 336+ (`legacy/scripts/species-kinds-sql.mjs`). A new migration makes `species_kinds` the only source of kind.

## 6. Content for the new birds

This uses the same split that built the SEQ expansion ([expansion-plan.md](../expansion-plan.md)): one research helper, one photo helper, one integration owner. Only the orchestrator commits.

1. **Curate the list.** Start from the companion file. Drop waders found only at restricted-access sites that hardly anyone will tick (decide per species). Add prized birds below the cut where they're realistic, e.g. Powerful Owl, Pink Robin, Rufous Bristlebird, Swift Parrot (winter), Orange-bellied Parrot only if a fair "rare" tier fits. Target about 180.
2. **Species entries** (`species.js`): name, sci, group, habitats, size, season, nocturnal, and a 1–2 sentence ID note in our own words. Write notes so they work in both regions; anything Melbourne-specific goes in the pack's `notes`.
3. **Rarity per region:** from rates (ALA records in the Melbourne bbox), the same banding as SEQ, then a hand pass. Shared birds get a Melbourne rarity in the Melbourne pack.
4. **Write-ups (`info.json`):** 2–4 sentences, 1–3 sources actually read (BirdLife Australia, ALA, Museums Victoria, Victorian Government / VBA, Wikipedia), paraphrased.
5. **Gallery (`gallery.json`):** 4–6 openly licensed, hotlink-safe photos with credits, as for SEQ.
6. **Look-alikes (`lookalikes.json`):** the new confusion pairs, e.g. Little vs Australian Raven, the thornbills, Red vs Little Wattlebird, Eastern vs Crimson Rosella, Hoary-headed vs Australasian Grebe.
7. **Photo ID, BirdNET, calls** as in section 4.
8. **Spot access:** `scripts/build-spot-access.mjs` for Melbourne hotspots. Many Western Treatment Plant hotspots are "(restricted access)" and need the right score and wording.

## 7. Offline

The service worker is built before anyone has chosen a region, so it can't precache "your" region. `build-sw.mjs` therefore precaches the shared shell and shared data only, and moves `regions/<code>/*` to the cache-on-first-use rule photos already use. The app asks for its region's files at boot, so they are cached on the first run, and a Melbourne user never downloads SEQ's 700 KB of rates. `scripts/offline-check.mjs` gains a `--region` flag and warms that region before going offline.

## 8. Testing

Vitest is already set up (`src/__tests__`). New tests:
- Pack loading: the subset, ordering, rarity from the pack, `anyById` for out-of-region sightings.
- Region choice: existing records with no stored region → `seq`; a fresh install → the picker; switching saves and reloads.
- Area/zone stats and badges against both packs (SEQ's numbers unchanged).
- `api/ebird.js` validation: VIC councils accepted, points inside each bbox accepted and outside refused, "today" accepted in Melbourne during daylight saving at 23:30 UTC.
- `compactSnapshot` with the `AU-VIC-` prefix, and with the BRI collision across regions.
- `mapTaxonomy` with the new `SCI_ALIASES`.
- Photo ID candidates restricted to the region.
- Manual: a full SEQ pass to confirm no regressions (Sarah's install), a Melbourne fresh install, and `offline-check` for both regions.

## 9. Order of work

1. **Plumbing, SEQ only, no visible change.** Region pack type, a SEQ pack generated from today's data, data files moved under `regions/seq/`, `species.js` region subset, strings via the pack, map/zones/badges via the pack, proxy and build parametrised, time-zone fix. Ship. SEQ must look identical.
2. **Melbourne data.** ALA rates for the Melbourne bbox, eBird snapshot for the 37 councils, spot access, zones. A Melbourne pack with the shared 103 birds only, behind a dev-only switch.
3. **Melbourne content.** Curate the list, then add about 78 birds' entries, write-ups, galleries, calls, look-alikes, photo ID, BirdNET mapping and `species_kinds`.
4. **Launch.** Welcome picker, Settings row, `home_region` and the leaderboard migration, store and manifest copy ("Australian birds", not just SEQ), then a Melbourne ad (the existing fairywren spot fits, since Superb Fairywren is common in both).

Steps 1 and 3a (curation and research) can run in parallel. Step 2 needs step 1.

### Step 1 as built (branch `region-packs`)

- `src/regions/seq.js` (generated from the old `r` fields and `tiers.json`, so every rarity is unchanged), `src/regions/index.js` (the region read at boot, plus `regionFile`, `ebirdRegion`, `councilOf`, `zoneOf`, `setRegion`) and the typed facade `src/lib/region.ts`.
- `species.js`: `SPECIES`/`BIRDS`/`ofKind` are the region's dex; `ALL_SPECIES`/`ALL_BIRDS` are the catalogue. `byId` stays a lookup over the whole catalogue, so no separate `anyById` was needed. The `r` fields and `tiers.json` are gone.
- Data moved: `seq.json` → `regions/seq/rates.json`, both spot-access files → `regions/seq/`, and the eBird snapshot is built to `regions/seq/ebird.json` (gitignored like before).
- The snapshot's `regions` are keyed by area. `compactSnapshot` merges council lists into the pack's zones; for SEQ zone = council, so the output is unchanged.
- Proxy: councils, states and point bounds come from the packs. `?in=<code>` picks the region for `stats` and `species` (default `seq`, so cached older clients keep working). "Today" is the latest local date across the packs' time zones (`latestToday`).
- Still SEQ-specific on purpose: module names `seqdata.js` / `lib/seq.ts` (internal only), species notes that mention SEQ (Melbourne overrides them in its pack), the static shell in `index.html` and the manifest (step 4), and `legacy/scripts/build_ala.py` (it still writes the old path; step 2 parametrises it by region).
- The service worker still precaches region files. That changes to cache-on-first-use in step 2, once a second region exists.

## Risks and open questions

- **The photo ID build script isn't in the repo.** `photoid.json` names `scripts/build_photoid.py`, which is not in this repo or `legacy/scripts/`. It has to be found or rewritten before step 3's photo ID work. This is the biggest unknown.
- **Name and branding.** The site is `seq-birddex.vercel.app`, and the app says "Sarah's BirdyDex". A neutral domain and title are needed before launch (decide in step 4; it doesn't block anything earlier).
- **Restricted-access hotspots** dominate Melbourne's top list. Spot pages must not send people to places they can't enter.
- **Build time** doubles for cold eBird builds. It's fine at ~11 minutes, but watch it if a third city is added.
- **The ALA box** in the companion list covers only the metro core. The rates build uses the full 37-council box, so a few fringe birds (e.g. Geelong's waders) may move into or out of the cut.
