# UI improvements, round one

This branch, `ui-improvements`, is `port-fixes` plus nine of the ten improvements in the plan. Five lens agents
proposed 28 ideas, three judges scored them (Sarah in the field, craft and risk), and ten were chosen. Each was built
on its own branch `ui-<slug>` off `ui-improvements`, checked by its own acceptance script, reviewed, and merged back.
Item 10 (larger text) was not finished, so it is not here.

Nothing here changes how sightings are stored. `src/core/db.js`, `sync.js`, `cloud.js`, `supabase/`, the IndexedDB
stores and the sighting record shape are untouched; new code reads and writes only through the existing functions
(`saveSighting`, `writeSighting`, `db.put`, `deleteSighting`, `saveTheme`). Everything works offline and without an
account. There are no new dependencies and nothing loads from a CDN. The service worker is unchanged.

Three small localStorage keys are new. None of them holds sightings:

- `birddex-theme`: a copy of the theme she chose, so the first frame is already dark or outdoor (item 1).
- `birdydex:tally-unsaved`: outing taps not yet stored. It is empty once the writer catches up (item 2).
- `birdydex:sunPrev`: the theme to go back to when she turns Sun off (item 3).

## 1. Fast Dex: the app opens at once and the Dex draws once

**For Sarah.** The app is there the moment she taps its icon. Her real numbers are on the first frame: coming back to
the Dex from the Map never flashes "0 of 291 animals seen", and Lists never shows an empty life list first. Back from
a species page is quick and lands exactly on her tile.

- `index.html` paints the Dex hero and the tab bar before React runs. It is dark from the first frame when the phone
  is dark or she chose a dark theme. React's first draw replaces it with no layout shift.
- One shared store (`src/lib/store.ts`) loads her sightings and outings once at boot and refreshes when they change.
  The screens that show sightings read it, instead of reading IndexedDB again each time they open.
- The Dex draws its 291 tiles once. Tiles are memoised, and the router links are plain links with one click handler.
- Boot waits up to 1.5 s for the store and 0.8 s for the regional data before the first draw, so Bird of the day and
  the hero photo arrive with the first frame.

**See it.** In Chrome DevTools, set CPU to 4x slower and reload `#/dex`: the hero and tab bar appear at once. Go to the
Map, then back to the Dex: the count is right on the first frame. Scroll down, open a bird, press Back.

**Files.** `index.html`, `src/main.tsx`, `src/lib/store.ts` (new), `src/lib/boot.ts` (new), `src/lib/hooks.ts`,
`src/lib/seq.ts`, `src/screens/Dex.tsx`, `src/screens/dexMemory.ts` (new), `src/screens/lists/Stats.tsx`,
`hubParts.tsx`, `shared.tsx`, `src/screens/progress/theme.ts`, `src/screens/screens.css`. Tests: `shell.test.tsx`
(the shell must match TabBar's markup), `store.test.ts`, `dexBack.test.tsx`.

## 2. Count a flock without losing taps

**For Sarah.** Every tap on an outing's + and − counts and shows at once, however fast her thumb goes. Before, taps
made while a save was running were dropped without a word: ten quick taps counted 5 or 6.

- One writer per outing stores the combined taps through `saveSighting`, `db.put` and `deleteSighting`. Taps that
  cancel out write nothing, and a count that reaches 0 deletes the sighting.
- A row counted down to 0 holds its place for 4 s, struck through, with its − resting and its + turned to Undo ringed
  by the time left. Quick taps after the − land on that row, not on the row that used to slide up into its place and
  lose a count. Undo puts it back exactly as it was (nothing was written yet); then the row folds shut and its
  sighting goes. Finish, Discard, Done editing and leaving the outing or the app let it go at once.
- If a save fails, the count comes back off the row and a short toast says "That count didn't save".
- Taps not yet stored are kept when she leaves the outing, the tab goes to the background or the page closes, and they
  are written at the next start.
- Holding + for about half a second opens a glass chooser of 5, 10, 20 and 50 for a big flock.
- The number stamps in with each tap and the phone gives a short buzz. Under reduced motion there is no stamp.

**See it.** Open a live outing and tap + ten times as fast as you can: the count goes up by ten. Hold + to see the
chooser. Tap − three times quickly on a row at 1: that row waits at 0 with Undo and the row below keeps its count.

**Files.** `src/screens/lists/tallyQueue.ts` (new), `useTally.ts` (new), `FlockChooser.tsx` (new), `Outing.tsx`,
`lists.css`, `src/lib/motion.ts`, `src/lib/store.ts` (one small export, `onStoreChange`). Tests: `useTally.test.ts`,
`flockChooser.test.tsx`, and `liveOuting.test.tsx` for the row held at 0.

## 3. Live outing mode

**For Sarah.** A bird that is new for her dex no longer stops the count. Before, the first + on a lifer opened the
full-screen "New for your dex" card, the page went inert and the taps after it were lost.

- On the tally, a lifer's row gets the moment instead: a gold New band clamps onto the photo, its "New for your dex"
  label glows once, the phone buzzes, a screen reader hears "<name>, new for your dex", and focus stays on +.
- The New band stays on the row as a button that opens the full card when she wants it.
- The Finish sheet shows the outing's new species as a row of photos, their names whole. A badge she earns comes as a
  toast; the card the New band opens and the Finish sheet both say it too, and opening either takes the toast down
  at once (no fade over them), so no toast ever sits over the card or the sheet's fields.
- The sign-up nudge waits until the outing is finished or discarded, so it never covers Discard and Finish. It also
  no longer covers the map's Map/Satellite switch.
- A live outing's header has two icon-sized glass toggles. Screen on (a phone with an open eye) keeps the phone awake;
  it is off until she asks and lets go on Finish, on leaving or after two hours, and if the phone takes it back while
  she is looking it asks once more, then turns off and says so. Sun switches to the Outdoor theme and back to the
  theme she had (the one Outdoor took over from, even when she picked Outdoor in Settings). A quick second tap goes
  straight back, and a tap while its circular reveal runs (a + straight after Sun, say) ends the reveal and lands
  where she tapped instead of being lost. The same Sun sits 10 px above locate on the map. Under 380 px the two lie
  flat beside the date line so the title keeps its width.
- "Outing finished" rests above the finished outing's buttons when its usual place would cover them.
- Saves made anywhere else (the species page, the + sheet) still get the full card.

**See it.** Start an outing, search for a bird you have never logged and tap + five times quickly: the count is 5 and
nothing pops up. Tap the New band to see the card. Tap Sun in the outing header.

**Files.** `src/lib/liveOuting.ts` (new), `src/lib/wakeLock.ts` (new), `src/components/SunToggle.tsx` and
`sunToggle.css` (new), `src/lib/toast.ts`, `src/screens/lists/Outing.tsx`, `lists.css`, `shared.tsx`,
`tallyQueue.ts`, `useTally.ts`, `src/screens/map/MapScreen.tsx`, `map.css`, `src/screens/me/nudge.ts`, `me.css`.
Test: `liveOuting.test.tsx`.

## 4. Never a blank species photo

**For Sarah.** The bird she tapped is always there, on patchy signal or none. Before, the species page showed an empty
block until the large photo arrived, and offline it often never did.

- The species hero first draws the small photo (the one on the Dex tile, already in memory or cache), softly
  blurred. The large photo develops in over it once it has decoded. Under reduced motion it is a short fade.
- If the large photo can't load, the small one stays. If neither can, the hero shows a wash of the bird's own colours
  from its plumage palette, never a flat block.
- Dex tiles, rows and cards show the same colour wash while their photo loads.
- Pressing a bird (before the tap lands) starts fetching its large photo, but only with signal and without Data Saver.
- Learn keeps its neutral placeholder, so a photo question never gives the answer away.

**See it.** In DevTools set the network to Slow 3G and tap a Dex tile: the bird is in the hero at once and sharpens.
Browse the Dex, turn the network off, and open a bird you just saw.

**Files.** `src/components/SpeciesImage.tsx`, `src/lib/wash.ts` (new), `src/lib/look.ts`, `src/screens/Bird.tsx`,
`src/screens/species.css`, `src/styles/look.css`, `src/App.tsx` (one line), `src/components/RouteMotion.tsx`. Test:
`speciesImage.test.tsx`.

## 5. Tap a bird and it grows into its page; Back puts her where she was

**For Sarah.** Tapping a bird's photo on the Dex, a list or Lists grows it into the species page, and Back shrinks the
hero into the same tile, row or card. She lands exactly where she was, with focus on the bird she opened, so working
through a long dex never sends her back to the top.

- Each tab keeps her place for the session: Dex scrolled far down, then Learn, then Dex, lands on the same row.
- Tapping the tab she is already on glides to its top.
- Redirects, map moves and the phone's own edge-swipe Back draw without an extra transition.
- Under reduced motion, or in a browser without view transitions, places and focus are kept without the motion.

**See it.** Scroll the Dex well down, tap a bird, press Back. Then tap Learn and Dex again. Tap Dex once more.

**Files.** `src/components/RouteMotion.tsx`, `src/components/RouteFocus.tsx`, `src/components/TabBar.tsx`. Tests:
`routeMotion.test.tsx`, `tabMemory.test.tsx`. It reuses the router `RouteMotion.tsx` already had rather than adding
a second one.

**Different from the plan, for you to rule on.** The plan wanted every replace drawn without a transition. Only
redirects are plain (the ones a screen makes as it draws, such as `#/` and `#/quiz`). A replace from her own tap, such
as Stop in a Learn round, keeps v1's cross-fade, because the port matches v1's `location.replace` on purpose. This is
under "Deliberately different" in `docs/port-fixes.md`. To make those plain too, delete `&& !herMove()` in
`onRouteChange`.

## 6. Full-screen photo viewer

**For Sarah.** She can tap the species photo to see the whole bird, uncropped, with its credit, and check the bill,
eye ring or wing bars. Before, landscape photos showed only about half the bird and tapping did nothing.

- Pinch up to 4x, or double tap for 2.5x. Pan is held to the photo's edges.
- At 1x, swipe sideways for the next photo, or drag down to shrink the photo back into the hero on the one she was
  looking at.
- From the keyboard: Enter or Space on the photo opens it, the arrows move, + and − zoom, Escape closes. A screen
  reader hears "Photo 2 of N, <name>" and the credit. Focus goes back to the photo.
- It fades instead of flying under reduced motion.
- It uses only photos the page already has. Offline, a cached photo shows and an uncached one shows the no-photo
  block.

**See it.** Open `#/bird/120` (Paradise Riflebird, whose hero shows about half of its photo) and tap the hero. On
`#/bird/20` (Crested Pigeon), open the viewer and swipe to photos 2 to 5, which are landscape.

**Files.** `src/components/PhotoViewer.tsx` (new), `photoViewer.css` (new), `photoViewerMath.ts` (new),
`src/screens/Bird.tsx`. Test: `photoViewer.test.tsx`.

## 7. Sheets that follow her thumb

**For Sarah.** With binoculars in one hand, she can flick any sheet away with her thumb. Every sheet (Add, the log
sheet, the outing and Finish sheets, confirms, Edit profile) works the same way.

- She can drag a sheet down by its grip, its top, or anywhere once its content is scrolled to the top. It moves with
  her finger, and the scrim and blur clear with it.
- A flick, or a drag past 30%, closes it from where it is at her finger's speed. Anything less springs back.
- Scrim, Escape and Cancel slide a sheet out instead of making it vanish, and focus goes back to what opened it at
  once. Opening it again while it leaves turns it back.
- Notes, the count field, the patch map and the avatar crop stage never start a drag.
- Under reduced motion the drag still follows her finger, and the release fades in place.

**See it.** On the Dex, tap + and drag the sheet's grip down a little, then let go. Drag it further, or flick it.

**Files.** `src/components/Sheet.tsx`, `src/styles/motion.css`, `src/components/RouteMotion.tsx` (a leaving sheet is
cleared before the next screen's transition). Test: `sheet.test.tsx`.

## 8. Learn: keep the bird in view when she answers

**For Sarah.** When she answers a photo question, the bird stays on screen while the field mark explains it. Before,
the feedback card pushed the photo off screen, and Next moved every question.

- The verdict grows as a glass footer under the mystery photo: a tick or cross, "Not quite. It's the X." with the name
  linking to the species, and the one-line field mark.
- The other answers fold away, so her pick and the right answer sit together under the photo.
- Next, the call buttons and Compare stay in one compact dock above the tab bar, in the same spot every question.
- The header shows a right-and-wrong trail for the round.
- The rest of the feedback (how to tell them apart, safety, the source) settles below as a card.
- A resumed question shows its final state without replaying the motion. The verdict is announced.
- Rapid fire and the review deck are unchanged. Scoring and stored Learn data are unchanged.
- Copy changed on purpose: Next reads "Next" and "See results" on the last question, and the footer leaves out the
  scientific name.

**See it.** Play `#/learn/play/photo` and answer one wrong.

**Files.** `src/screens/learn/LearnPlay.tsx`, `QuizMedia.tsx`, `answerDock.ts` (new), `learn.css`. Tests:
`learnDock.test.tsx`, `learnRound.test.ts`.

## 9. Heard-only and photographed tiles

**For Sarah.** She can tell at a glance which birds she has only heard and which she has photographed. "Heard only"
becomes a list of birds to go and see properly, and "No photo yet" a shot list for her next walk with the camera.

- A heard-only species gets a dashed ring and an ear where the tick would be. A photographed one gets a small frosted
  camera stamp. They differ by shape, so they read in greyscale too.
- The Dex's show filters gain Heard only and No photo yet, with counts for the kind tab. Plants have no Heard only.
- The hero capsule adds a quiet line: "6 photographed · 5 heard only".
- What counts as seen, the badges and every count stay exactly as they were. Heard still counts as seen.
- It reads only the sightings already in the shared store, never the photo blobs.

**See it.** Log a bird with Heard only ticked, and another with a photo, then look at the Dex and its show filters.

**Files.** `src/lib/tiers.ts` (new), `src/screens/Dex.tsx`, `src/screens/dexParts.tsx`, `src/screens/screens.css`.
Test: `tiers.test.ts`.

## What was left out, and why

**Item 10, larger text that still works, is not merged.** It was started on branch `ui-large-text` (worktree
`C:\Users\Rhys\Documents\Birdy-React-ui-large-text`) but never finished: the worktree has uncommitted CSS changes and
no commits, cut from an older `ui-improvements` (d0be3f4), so it was never reviewed. The problem it fixes is still
there: with the phone's text at 150% the tab bar pushes Me off screen, at 200% Map and Me are gone, and on a species
page the Photos / 3D model / Card switch covers Back and Search. It is a small job (container queries only), best done
next on the current `ui-improvements`, keeping `index.html`'s shell in step with TabBar (`shell.test.tsx` enforces
it).

**Runners-up from the plan, for next round:**

- **A one-tap "Likely here" rail and place-ranked search on outings.** The strongest idea left out. It would have been
  a third rewrite of `Outing.tsx` this round. Next time, build `likely.ts`, the rail and the ranking first.
- **Two-tap quick log from +.** It needs `likely.ts` first, risks accidental logs, and its late `db.put` of
  coordinates on an already saved record is a risk to her data.
- **React's own `<ViewTransition>` for route changes.** Item 5 uses the router instead, because it keeps commits
  synchronous and needs no screen changes. Worth another look later for tap latency.
- **The one-time "fresh" stamp on a new Dex tile** is not done. (Scan and Listen logs already celebrate a new species
  as every other save path does: both go through the shared Log a sighting form, and match v1 in the browser.)
- **Map ready for no signal.** Large, and OpenStreetMap and Esri discourage bulk tile downloads. Do v1's "No signal"
  map note first, and the follow-me location dot next.
- **Lazy routes and code splitting.** A tab swap to a chunk that hasn't loaded would draw an empty screen, and it
  touches about 12 files. The static shell in item 1 is most of the launch win.
- **Learn call player (Hear both, Slow).** It edits the same files as item 8, so build it after.
- **Offline readiness marks on Learn tiles,** and a **review deck you can see into.** Small and useful, later.
- **Lower value this round:** On the move, her own photo leading the species page (it would push the clearer ID photo
  away and break item 5's morph), filters in the address, Quiz me on these, an end-of-round ledger, and deferred
  drawing for a Log with thousands of sightings.

**Loose ends from the builds, done afterwards (branch `ui-loose-ends`):**

- The species page's seen line ends "Heard only so far." while every sighting is heard only (the Dex's own rule).
- In the Dex list layout at 320 px, long names (Pygmy-Goose, Oystercatcher) stay in their column: the pips sit under
  the names below 360 px, and a word too long for its line breaks instead of running under the pips.
- Scan and Listen logs were checked against v1: both already raise the "New for your dex" card; a test now holds it.
- A species page's tint from its photo is never green or olive: those hues are pulled to the app's neutral slate
  (`calmTint` in `lib/look.ts`), and other tints are kept.
- A quick second tap on a tab or a species tile while the screen is still changing is no longer lost: it ends the
  transition and goes to what is under her finger. A fumbled double tap still opens one page.
- The phone's Back closes the photo viewer before it leaves the species page (a CloseWatcher close request, so no
  history entry; where CloseWatcher is missing, Back leaves as before).
- The photo viewer has named Previous and Next buttons either side of its count.
- progressive-photo's "develops in" check serves the large photo from a local stub, so it no longer depends on a
  live photo host.

**Loose ends still open:**

- With 6,000 sightings on a slow phone, a rare tally tap waits for the shared store to re-read every sighting after a
  write (about 130 ms at 4x CPU). Making that read cheaper is store work for later.
- In about one Back in four on a slow phone, the shrink waits for the tile's photo to decode (up to about 0.6 s). The
  `port-fixes` build does the same. Every Back still lands exactly.
- Not tried on real hardware: the photo viewer's pinch, double tap, swipe and drag; the sheet flick; the phone's own
  Back swipe. Everything was checked in Chromium under Playwright only, with no real Firefox, WebKit, TalkBack or
  VoiceOver.

## How to check it

1. In this worktree, `npm run build` and `npm test` must both pass.
2. Serve `dist` (for example `npx vite preview --port 4600 --strictPort`) and open it on a phone-sized window, light
   and dark, at 390 and 320 px wide.
3. Each item has a Playwright acceptance script in the session scratchpad,
   `C:\Users\Rhys\AppData\Local\Temp\claude\C--Users-Rhys-Documents-Birding\50bbd68c-99d3-4370-8d9a-7660079d8d87\scratchpad\ui-build\accept\<slug>.mjs`.
   Run one from the scratchpad's `tools` folder with `node ..\ui-build\accept\<slug>.mjs http://127.0.0.1:4600/`.
   Each prints PASS or FAIL lines. The scratchpad is temporary, so copy the scripts if you want to keep them.
4. Every script routes Supabase so only `get_leaderboard`, `get_profile` and public storage reads pass. Nothing signs
   in or writes to the live project.
5. For a full pass, the scratchpad's `tools` folder has `ui-final-routes.mjs`, `ui-final-flows.mjs`,
   `ui-final-sw.mjs`, `ui-final-extra.mjs` and `ui-final-interact.mjs`, which run against 4600.

**Script updates after item 3's review.** `tally-queue.mjs` section 4 now expects what item 3 does on purpose: a + on
a never-seen species saves quietly, focus stays on +, stored [1], and the New band opens the card. Its section 2 waits
for a row counted down to 0 to finish its 4 s hold before checking that the sighting has gone. `live-outing.mjs` has
checks for the badge in the card and the Finish sheet, Finish straight after a lifer, a band tapped before its save,
the narrow header, the Screen on icon, the 48 px map Sun, the wake lock taken back in view, "Outing finished" and the
row held at 0.

### Last check (29 Oct 2026, on bc5fddf)

`npm run build` passed and `npm test` passed (50 files, 362 tests).

| Acceptance script | Result on 4600 |
|---|---|
| fast-dex | 13/13 |
| tally-queue | 17/18 as written; 18/18 with the updated copy |
| live-outing | 25/25 |
| progressive-photo | 44/45, then 45/45 on a second run |
| route-motion | 14/14 |
| photo-viewer | 41/41 |
| sheet-gestures | 17/17 |
| learn-answer-dock | 9/10, then 10/10 on a second run |
| dex-tiers | 26/26 |

The two first-run misses were timing, not the app:

- progressive-photo's "the large photo develops in" waits 4.2 s for a photo from an outside host (held 2.5 s by
  the script). The photo did not arrive in time, so there was nothing to develop. It has missed this way in earlier
  runs too, and passed on the next.
- learn-answer-dock's "announce-and-tab" once timed out waiting 20 s for the first question. It passed in all 16
  later runs, and in 12 more cold loads the round's first question was up in under 0.3 s.

The full regression pass also came back clean:

- Every route (39 of them) in light and dark, at 390 and 320 px, with 0 and 25 sightings: no console errors, no error
  boundary, no sideways scroll, one outing bar and one live region. Focus was on the h1 after every navigation (or in
  the sheet a route opens).
- Logging from a species page, from the + sheet and by a Dex long press: each is stored with v1's record shape and
  shows in the life list and the Log without a reload.
- An outing started from +, tallied and finished: the counts are stored with the outing, it ends, and it shows in
  Lists.
- Photo, Backyard birds and Today's challenge rounds play to their results.
- Escape closes only the top layer: the map picker over the + sheet or the log sheet, the photo viewer, search.
- Focus goes to the h1 after the tab bar and links, and Back gives it to the tile she opened.
- Reduced motion: no view transitions on a tile tap, Back or tabs (four with motion), the photo viewer fades, the
  tally has no stamp, and sheets fade instead of sliding.
- The service worker installs and takes over. With the network off, the Dex, a species page, Lists, Learn and a
  Learn round all load.
- In the route sweep and the flows, no request went to Supabase at all.
