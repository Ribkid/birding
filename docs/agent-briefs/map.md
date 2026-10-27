# Brief: map slice

You are porting the map screens of Sarah's BirdyDex from vanilla JS to React. Repo:
`C:\Users\Rhys\Documents\Birdy-React`. Work only inside this repo.

## Read first

- `docs/port-plan.md` (layout and rules)
- `src/lib/data.ts`, `src/lib/hooks.ts` (`useSightings`, `useSeen`, `useOutings`)
- `src/components/Icon.tsx`, `SpeciesImage.tsx`
- v1 reference: `legacy/js/app.js` `renderMap` (line 1433) — this is the whole map screen:
  Leaflet setup, SEQ bounds, species dots, hotspots, patches, "map at lat,lng", place search
  and the `describeArea` popup. Also `legacy/js/mapinfo.js`, `legacy/js/seqdata.js`
  and `legacy/css/app.css` for `.map-*` classes.
- Existing screens for style: `src/screens/Dex.tsx`, `src/screens/Bird.tsx`.

## Stack rules

- Vite + React 19 + TypeScript strict, `react-router-dom` v7, hash routing.
- `leaflet` is installed. Import `'leaflet/dist/leaflet.css'` from your component.
- Own only `src/screens/map/`. Never edit `src/App.tsx`, `src/main.tsx`, `src/lib/`,
  `src/components/`, `src/core/`, `src/styles/app.css`, `package.json`, `legacy/`, `public/`.
- Reuse v1 CSS classes; new styles only in `src/screens/map/map.css`.
- No new dependencies, no `npm install`, no dev server, no git, no `vite build`.
- Typecheck with `npx tsc --noEmit`; ignore errors outside your files.

## Deliverable (default export, exact path)

`src/screens/map/MapScreen.tsx` → serves `/map`, `/map/sp/:id` and `/map/at/:lat,:lng`.

Requirements:

- Create and destroy the Leaflet map inside `useEffect`; the map instance must never leak
  between route changes, and must resize correctly.
- Start within the SEQ bounds used by v1 and show: the user's patches (circles), hotspots from
  `seqdata.hotspots()`, and, when `:id` is present, that species' report points
  (`seqdata.pointsFor`) with a "reported here" popup.
- `/map/at/:lat,:lng` centres on the coordinate and opens the area description from
  `mapinfo.describeArea`.
- A place search box that is throttled and cancels stale requests (see `legacy/js/places.js`),
  bounded to SEQ, with results as a tappable list.
- Links to species pages (`/bird/:id`) and a "new patch" action that saves to `db.put('patches', …)`
  (name + radius + centre), matching v1 behaviour.
- Handle denied geolocation quietly: the map still works centred on SEQ, no blocking dialog.

Accessibility: the map container needs an accessible name, controls must be real buttons, and all
information shown in map popups must also be reachable as text (e.g. a summary list under the map).
