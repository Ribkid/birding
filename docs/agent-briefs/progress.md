# Brief: progress slice (badges, quiz, compare, settings, leaderboard)

You are porting the progress/account screens of Sarah's BirdyDex from vanilla JS to React. Repo:
`C:\Users\Rhys\Documents\Birdy-React`. Work only inside this repo.

## Read first

- `docs/port-plan.md` (layout and rules)
- `src/lib/data.ts`, `src/lib/hooks.ts` (`useSightings`, `useSeen`, `useOutings`, `useMedia`)
- `src/core/stats.js` — `badges()`, `totals()`, `yearTotals()`, `periodFilter()`
- `src/core/sync.js`, `src/core/cloud.js`, and `legacy/js/account.js` (v1 account rendering)
- v1 reference: `legacy/js/app.js` `renderBadges` (1625), `renderCompare` (1115),
  `renderSettings` (1643), `legacy/js/quiz.js`, and `legacy/js/account.js`
  `renderLeaderboard` / `renderAccountSection`. `legacy/css/app.css` for class names.
- Existing screens for style: `src/screens/Dex.tsx`, `src/screens/Bird.tsx`.

## Stack rules

- Vite + React 19 + TypeScript strict, `react-router-dom` v7, hash routing.
- Own only `src/screens/progress/`. Never edit `src/App.tsx`, `src/main.tsx`, `src/lib/`,
  `src/components/`, `src/core/`, `src/styles/app.css`, `package.json`, `legacy/`, `public/`.
- Reuse v1 CSS classes; new styles only in `src/screens/progress/progress.css`.
- No new dependencies, no `npm install`, no dev server, no git, no `vite build`.
- Typecheck with `npx tsc --noEmit`; ignore errors outside your files.

## Deliverables (default exports, exact paths)

1. `src/screens/progress/Badges.tsx` → `/badges`. Every badge from `badges()`, earned and locked,
   with progress toward locked ones and a link to `/stats`.
2. `src/screens/progress/Quiz.tsx` → `/quiz`. Port `legacy/js/quiz.js`: guess-the-bird rounds
   using species photos, four answers, score across a round, correct/incorrect feedback, and a
   clean end screen. Keyboard 1–4 selection plus buttons.
3. `src/screens/progress/Compare.tsx` → `/compare/:a/:b`. Side-by-side species comparison as v1
   does (photos, size, habitats, rarity, group), with links back to both species pages.
4. `src/screens/progress/Settings.tsx` → `/settings`. Port `renderSettings`: theme choice,
   colour/contrast options, offline media download with real progress and honest failure,
   backup export/import (via `src/core/backup.js` if present, otherwise `db` + JSON file),
   account section (sign in/out, sync status) and links to privacy/terms.
5. `src/screens/progress/Leaderboard.tsx` → `/leaderboard`. Port `renderLeaderboard`: table of
   ranked birders, the current user highlighted, and an offline/signed-out state.

Rules: never fabricate account state or sync success. If cloud isn't configured
(`cloud.configured`), the account section says so plainly. Settings changes must persist through
`db.kvSet` and apply immediately.
