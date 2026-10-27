# Port the v1 refresh into Birdy-React

The vanilla app got a large refresh on branch `birdydex-refresh` of Ribkid/birding. A checkout of it is at
`C:\Users\Rhys\Documents\Birding\birding-refresh` (read it, never edit it). This branch, `port-refresh`, brings that
work into the React app. Same rule as the first port: **move logic, rewrite only rendering.**

To see every change: `git -C C:\Users\Rhys\Documents\Birding\birding-refresh diff --stat main...birdydex-refresh`.
The refreshed v1 is the reference for behaviour, markup and copy. Match it.

## Hard rules

- Work only in this repo, on branch `port-refresh`. Never push, never touch `main`, never merge.
- Commit after each numbered step below, with a plain sentence-style message. If a step is too big, commit partway.
- Don't change how sightings are stored (IndexedDB stores and keys in `src/core/db.js`, Supabase tables in
  `src/core/sync.js` / `cloud.js`). Sarah's data must stay safe.
- Must work offline and without an account. Nothing loaded from a CDN at runtime.
- Keep the two integration changes in `src/core/`: asset URLs resolve from the site root (`/data/`, `/models/`,
  `/vendor/`), and runtime dynamic imports are marked `/* @vite-ignore */`.
- `npm run build` and `npm test` must pass at the end of every step.

## Steps

1. **Assets.** Copy into `public/`:
   - `data/photoid.json`, `data/photoid.bin`, `data/lookalikes.json`, `data/calls.json`, and the folder `data/calls/`
     (205 `.m4a` clips).
   - `models/bioclip/manifest.json`, `vision-int4.part1.bin` and `vision-int4.part2.bin`. Delete
     `public/models/bioclip/vision-q8.part*.bin` and `public/data/bioclip-text.json`: the new photo ID replaces them.
   - `supabase/migrations/20261027000000_public_profiles.sql` into `supabase/migrations/` (it is already applied to
     the live database; just keep the file).
2. **Core logic.** Replace `src/core/photoid.js`, `media.js`, `listen.js`, `stats.js`, `seqdata.js`, `species.js`
   and `cloud.js`/`sync.js` if they changed, with the refreshed versions, re-applying the two integration changes.
   Add `quiz.js` (question engine, 19 packs, 10 question types) to `src/core/`. From `js/learn.js`, `js/me.js`,
   `js/account.js` and `js/scan.js`, move the framework-free parts (state in `db.kv`, scoring, pack builders,
   profile and avatar calls, scan pipeline) into `src/core/` modules and leave the HTML-string rendering behind.
   Extend `src/lib/data.ts` typings for anything the screens need.
3. **Styles.** Bring the new token block from `css/app.css` (neutral palette: paper `#F4F6F9`, ink `#121821`,
   dark paper `#0B0E12`; the outdoor theme; `--fs-*`, `--sp-*`, `--r-*`, motion tokens) into `src/styles/app.css`.
   Add `look.css` (glass material, floating tab bar, sky glow on `body::before`) and `motion.css` globally. Per-screen
   CSS (`learn.css`, `me.css`, `scan.css`, `species.css`, `screens.css`, `rest.css`, `calls.css`, `field.css`) goes
   next to the screens that use it. No green page backgrounds anywhere.
4. **Shell.** Tab bar becomes Dex · Learn · + · Map · Me. Routes: `#/learn`, `#/learn/play/:pack`, `#/quiz` redirects
   to `#/learn`, `#/scan`, `#/me`, `#/me/edit`, `#/me/signup`, `#/me/signin`, `#/u/:publicId`. Settings' back link
   goes to `#/me`. Port `js/motion.js` (view transitions, flip, count-up, tile-to-hero morph) and `js/layers.js`
   (sheets: inert background, Escape stack, focus trap) as small hooks/components. Port `js/look.js` photo tinting,
   keeping its readable-host allowlist and contrast loop. Respect `prefers-reduced-motion`.
5. **Screens.** Rewrite as React, matching the refreshed v1:
   - Learn hub and play screen (`js/learn.js` + `css/learn.css`): daily challenge, quiz pack grid, quick play, review
     deck, progress. Replaces `src/screens/progress/Quiz.tsx`.
   - Scan (`js/scan.js`): photo-first scanner on the new photo ID. Replaces `src/screens/field/Scan.tsx`.
   - Me hub, profile edit with photo avatar, sign up / sign in, public profile `#/u/:id`, the leaderboard rows that
     link to profiles (`js/me.js`, `js/account.js`). Badges and Stats are reached from Me.
   - Species page, Dex, Lists, Map, Settings: apply the restyle and any new markup from `js/app.js`
     (e.g. call clips from the offline pack, look-alike compare links).
6. **Offline.** Update `scripts/sw-template.js` / `build-sw.mjs` so the precache includes the new data files, the
   int4 model parts and manifest, the BirdNET worker and audio processor, and the call-clip route
   (see the refreshed `sw.js`). Bump the cache version.
7. **Check.** `npm run build`, `npm test`, then `npm run preview` and click through every tab at 390px wide in light
   and dark. Fix console errors and horizontal overflow. Write what's done and what isn't at the end of this file
   under "Status".

## Status

### Done

- **Assets.** Copied the refreshed `photoid.json` / `photoid.bin`, `lookalikes.json`, `calls.json` and all 205
  call clips, the int4 BioCLIP manifest and both chunks, and the public-profiles migration. Removed the q8 model
  chunks and `bioclip-text.json`.
- **Core.** Replaced `photoid.js`, `media.js`, `listen.js`, `stats.js`, `seqdata.js` and `species.js` with the
  refreshed v1 modules, re-applying the site-root asset URLs and the `@vite-ignore` runtime imports. Added
  `quiz.js` (19 packs, 10 question types). Extracted the framework-free Learn state/scoring/deck logic into
  `core/learn.js`, profile and avatar calls into `core/profile.js`, auth/leaderboard calls into
  `core/account.js`, and the photo-ID pipeline and scan log into `core/scan.js`. The typed facade now covers the
  quiz, learning, profile, leaderboard and scan shapes.
- **Styles.** Replaced `app.css` with the refreshed token block (neutral paper/ink palette, outdoor theme,
  type/space/radius/motion tokens), added `look.css` and `motion.css`, and added `learn.css`, `me.css`,
  `scan.css`, `species.css`, `screens.css`, `rest.css`, `calls.css` and `field.css` beside the screens. A small
  compatibility block at the end of `app.css` keeps the first port's Dex header styling. No green page
  backgrounds.
- **Shell.** Tab bar is Dex · Learn · + · Map · Me. Added `#/learn`, `#/learn/play/:pack`, `#/learn/daily`,
  `#/learn/deck`, `#/scan`, `#/me`, `#/me/edit`, `#/me/signup`, `#/me/signin`, `#/u/:publicId`,
  with `#/quiz` redirecting to `#/learn`. Settings' back link goes to `#/me`. Ported view transitions, FLIP,
  count-up, tile-to-hero names, the sheet layer stack (inert background, Escape, focus trap), the frosted top
  bar and the photo-tint allowlist/contrast loop. Reduced motion is respected throughout.
- **Screens.** Learn hub with daily challenge, 19-pack grid, quick play controls, review deck and progress;
  play screen with every question type, feedback, rapid timer, results and the add/edit review deck; Scan on
  the new photo ID with crop box, whole-photo mode, kinds, progress and comparison cards; Me hub (guest and
  signed-in), photo/species profile edit, Google/email sign-in, public profile, and leaderboard rows that link
  to `#/u/:id`. The species page now plays calls from the offline pack and links look-alikes to Compare; Dex,
  Lists, Map, Badges and Settings inherit the refreshed styles.
- **Offline.** `build-sw.mjs` now precaches the refreshed data files, photo-ID header/bin, int4 model chunks
  and BirdNET worker/audio worklet (36 files, ~94 MB), and `sw-template.js` has a range-aware call-clip route,
  clean cached-response headers, cache version bumps and preserves the call/model caches across releases.
- **Check.** `npm run build` and `npm test` pass (16 tests). Clicked through Dex, Learn, Add, Map, Me, Scan,
  Settings and a species page at 390 px in light and dark: no console errors and no horizontal document
  overflow. Offline launch from the installed worker renders the app with the network disabled.

### Left / caveats

- Dex, Lists, Map, Badges and Settings still use the first port's React markup, restyled with the refreshed
  CSS; the new hero/rail markup from `js/app.js` was not rebuilt for those pages.
- The signed-in Me/edit/public-profile states compile and use the real profile/cloud calls, but could not be
  exercised end-to-end without a test account.
- A Playwright offline *hard reload* left a blank document even though a normal offline launch (`goto`) worked;
  the service worker precache and call/model routes are in place, but this reload path should be rechecked on a
  real phone.
- Still not ported from the first port: the 3D card/confetti, share image, global search overlay and install
  prompt.
