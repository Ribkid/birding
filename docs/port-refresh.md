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

(deepcode: fill in as you go.)
