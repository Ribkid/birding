# Birdy-React

A React rewrite of Sarah's BirdyDex — the field guide to the birds, native animals and plants of
South East Queensland.

The v1 app remains in `legacy/` as the reference for behaviour and markup. It is not built or
served; it exists so the port can be compared against the original.

## Stack

- Vite 7, React 19, TypeScript (strict)
- `react-router-dom` v7 with hash routing, so every v1 URL (`#/dex`, `#/bird/1`, `#/map/sp/12`…)
  still works
- Leaflet for the map, Three.js and the BioCLIP/BirdNET models stay on the existing v1 code paths
- No CSS framework: the v1 stylesheet is carried over in `src/styles/app.css`

## Layout

```
legacy/          v1 source, read-only reference (app.js, quiz.js, card3d.js, …)
public/          unchanged assets: data, models (140 MB), vendor, fonts, icons
src/core/        v1 logic modules, framework-free: db, sync, stats, seqdata, media,
                 photoid, listen, birdnet-worker, cloud, ebird, mapinfo, species
src/lib/         typed facade (data.ts), hooks (hooks.ts), regional data loader (seq.ts)
src/components/  Icon, SpeciesImage/Band/Pips, TabBar
src/screens/     Dex, Bird, lists/, map/, field/, progress/
scripts/         build-sw.mjs + sw-template.js (offline shell generator)
docs/            port-plan.md and the agent briefs used for the parallel port
```

The rule that made the port tractable: **only rendering was rewritten.** Anything to do with
IndexedDB, sync, scoring, the regional dataset or on-device inference was moved, not
reimplemented. Two integration-only changes were needed in `src/core/`:

- asset base URLs now resolve from the site root (`/data/`, `/models/`, `/vendor/`) instead of
  relative to the module file
- `photoid.js` and `cloud.js` mark their runtime dynamic imports `@vite-ignore`, because those
  URLs are only known at run time

## Scripts

```
npm run dev       # dev server on :5173
npm run build     # typecheck, bundle, generate dist/sw.js
npm run preview   # serve the production build
```

## Offline behaviour

`npm run build` writes a service worker with a precache list of the built shell plus the regional
data (34 files, ~3.5 MB). Photos, map tiles, call clips and vendor bundles are cached on first
use. The 88 MB int4 photo model is deliberately **not** precached — `src/core/photoid.js`
downloads it on demand with progress and keeps it in its own `birddex-models` cache, so it is
never fetched before she asks for it and never stored twice.

A navigation is network-first so deploys land promptly, then falls back to the cached shell.
Cached responses are served exactly as stored: rebuilding them, or matching without
`ignoreVary`, makes module scripts fail offline while CSS still loads. Verified with
`node scripts/offline-check.mjs warm`, stopping the server, then `… offline`.

## Deploying

`vercel.json` builds with `npm run build`, serves `dist`, and marks `/assets` and `/models`
immutable. The app is hash-routed, so all non-asset paths rewrite to `index.html`.

This repo has no remote yet. To publish:

```
gh auth login
gh repo create Birdy-React --private --source . --remote origin --push
```

## Status

Ported and rendering: Dex, species page, Learn (including play/daily/deck), Lists, list views,
patches, targets, outings, sighting log, add sighting, Stats, Map, Scan, Listen, Me (profile,
sign-in, public profile), Badges, Compare, Settings, Leaderboard.

Not yet ported from v1: the 3D collectable card and confetti, the card share image, the global
search overlay, the persistent outing bar, and the install prompt. There are no automated tests
yet (Vitest is installed; v1's node/Playwright suites were not carried over).
