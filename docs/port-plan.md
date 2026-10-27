# Birdy-React port plan

A full React rewrite of Sarah's BirdyDex v1 (vanilla JS, no build step).

## Layout

- `legacy/` — the v1 source, read-only reference. Every ported screen must match the
  markup and behaviour of the function named in its brief.
- `public/` — unchanged v1 assets: `data/`, `models/`, `vendor/`, `fonts/`, `icons/`,
  `manifest.webmanifest`, `privacy.html`, `terms.html`.
- `src/core/` — v1 logic modules, copied unmodified except for asset base URLs. These are
  framework-free and must not be rewritten: `db`, `stats`, `seqdata`, `media`, `gallery`,
  `photoid`, `listen`, `birdnet-worker`, `audio-processor`, `sync`, `cloud`, `ebird`,
  `mapinfo`, `species`, `palettes`.
- `src/lib/` — typed facade (`data.ts`) and hooks (`hooks.ts`). Shared; do not edit.
- `src/components/` — shared `Icon`, `SpeciesImage`/`Band`/`Pips`, `TabBar`. Shared; do not edit.
- `src/screens/` — React screens, one folder per agent slice.

## House rules for porting agents

1. Own only your folder. Never edit `src/App.tsx`, `src/main.tsx`, `src/lib/`, `src/components/`,
   `src/core/`, `src/styles/app.css`, `package.json`, `legacy/`, or `public/`.
2. Reuse the v1 CSS classes. Add new CSS only in your own `src/screens/<slice>/<name>.css`
   file (import it from your component). Never restyle shared components.
3. No new dependencies, no `npm install`, no dev server, no git commands, no production build.
   Typecheck with `npx tsc --noEmit` only.
4. Use the existing data layer: `src/lib/data.ts`, `src/core/db.js`, and the hooks. Do not read
   IndexedDB or fetch v1 JSON directly.
5. A screen is done when it renders, matches v1's information and actions, handles the empty
   state, and is keyboard-usable.

## Slices

| Slice | Routes | Files |
|---|---|---|
| lists | `/lists`, `/list/:key`, `/patch/:id/:key?`, `/targets`, `/outing/:id`, `/log`, `/add`, `/stats` | `src/screens/lists/` |
| map | `/map`, `/map/sp/:id`, `/map/at/:lat,:lng` | `src/screens/map/` |
| field | `/scan`, `/listen` | `src/screens/field/` |
| progress | `/badges`, `/quiz`, `/compare/:a/:b`, `/settings`, `/leaderboard` | `src/screens/progress/` |

Integration (routes, CSS imports, shared fixes) is done by the parent after the slices land.
