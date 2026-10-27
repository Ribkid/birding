# Brief: lists slice

You are porting screens of Sarah's BirdyDex from vanilla JS to React. Repo:
`C:\Users\Rhys\Documents\Birdy-React`. Work only inside this repo.

## Read first

- `docs/port-plan.md` (layout and rules)
- `src/lib/data.ts` — `SPECIES`, `byId`, `GROUPS`, `HABITATS`, `RARITY`, `KINDS`, `dexCode`
- `src/lib/hooks.ts` — `useSightings`, `useSeen`, `useOutings`, `useMedia`
- `src/components/Icon.tsx`, `SpeciesImage.tsx` (exports `SpeciesImage`, `Band`, `Pips`)
- v1 reference: `legacy/js/app.js` functions `renderLists` (line 1167), `renderList` (1233),
  `renderTargets` (1270), `renderOuting` (1321), `renderLog` (1381), plus `openPlusSheet` (521)
  and the add/edit sighting form around it. `legacy/js/statsview.js` for Stats.
  `legacy/css/app.css` for class names.
- Existing screens for the established style: `src/screens/Dex.tsx`, `src/screens/Bird.tsx`.

## Stack rules

- Vite + React 19 + TypeScript strict. `react-router-dom` v7, hash routing. Keep v1 URLs.
- Own only `src/screens/lists/`. Never edit `src/App.tsx`, `src/main.tsx`, `src/lib/`,
  `src/components/`, `src/core/`, `src/styles/app.css`, `package.json`, `legacy/`, `public/`.
- Reuse v1 CSS classes. New styles go only in `src/screens/lists/lists.css`, imported by your
  components.
- No new dependencies, no `npm install`, no dev server, no git, no `vite build`.
- Typecheck with `npx tsc --noEmit`; ignore errors in files you do not own.
- Persist data through `db` from `src/core/db.js` (`db.put('sightings', …)`, `db.del`, etc.) and
  `stats.js` for calculations. Do not touch IndexedDB directly.

## Deliverables (default exports, exact paths)

1. `src/screens/lists/Lists.tsx` → `/lists`. Life/year/month counts, targets section, patches
   list with create action, outings list with status, past years. Links to the routes below.
2. `src/screens/lists/ListView.tsx` → `/list/:key` and `/patch/:id/:key?`. Params: `key` =
   `life|year|month|<year>`, optional `patchId`. Grouped species list with counts, empty state.
3. `src/screens/lists/Targets.tsx` → `/targets`. Monthly target suggestions from `stats.ts`
   `targets()`; "find targets near me" using `navigator.geolocation` + `haversineKm`.
4. `src/screens/lists/Outing.tsx` → `/outing/:id`. Outing header (place, date, time, duration),
   its sightings, add/finish/edit/delete actions.
5. `src/screens/lists/Log.tsx` → `/log`. All sightings, newest first, grouped by date, with
   edit/delete.
6. `src/screens/lists/AddSighting.tsx` → `/add`. Species picker (searchable), count, date, time,
   place/coords (optional), note; saves a sighting and navigates back to `/lists`.
7. `src/screens/lists/Stats.tsx` → `/stats`. Port `renderStats` from `legacy/js/statsview.js`:
   period filter (all/year/month), totals, species count, top species, year table, badges teaser.

Screens must be keyboard usable, handle "nothing here yet" honestly, and not crash when there
are zero sightings.
