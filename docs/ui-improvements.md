# UI improvements, round one

This branch, `ui-improvements`, is `port-fixes` plus the ten improvements in the plan. Five lens agents proposed 28
ideas, three judges scored them (Sarah in the field, craft and risk), and ten were chosen. Each was built on its own
branch `ui-<slug>` off `ui-improvements`, checked by its own acceptance script, reviewed, and merged back.

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
- A row counted down to 0 holds its place, struck through, with its − resting and its + turned to Undo ringed by the
  time left, until 4 s after her last tap on the outing: a tap on any row starts the 4 s again. Quick taps after the −
  land on that row, not on the row that used to slide up into its place, and while she counts a flock on another row
  no row folds away and moves the rows under her thumb. Undo puts it back exactly as it was (nothing was written
  yet); once she stops, the row folds shut and its sighting goes. Finish, Discard, Done editing and leaving the
  outing or the app let it go at once.
- If a save fails, the count comes back off the row and a short toast says "That count didn't save".
- Taps not yet stored are kept when she leaves the outing, the tab goes to the background or the page closes, and they
  are written at the next start. A write that lands after she has left builds on the one before it, so a lifer tapped
  twice just before Back is one sighting of 2, not two of 1.
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
- The outing page starts afresh for each outing, so nothing held for one outing (a row at 0, a search) carries over
  when she opens another.
- Saves made anywhere else (the species page, the + sheet) still get the full card.
- A + on a bird found with the tally's search keeps the results up until 1.5 s after her last tap (and while a card, a
  sheet or the flock chooser is up), so a quick burst on any result counts on that bird, not on the tally row that
  would have moved under her thumb when the results went. A result not on the tally yet keeps room for its − and
  count, so its first + moves nothing around the +, at any width (at 320 px such a result is two lines tall, with its
  + on the second). Its moment and New band show on that result. Then
  the search clears, and focus that was on the result goes to the bird's row on the tally.

**See it.** Start an outing, search for a bird you have never logged and tap + five times quickly, on the first
result or any other: the count is 5 and nothing pops up. Tap the New band to see the card. Tap Sun in the outing header.

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
- A fumbled double tap (a second tap within 400 ms on the spot of a first that changed the screen) opens one screen,
  with or without motion: it no longer opens a species page's photo viewer, or takes a tab back to its top.

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
- Previous and Next sit either side of the count, each a 44 px target. At 200% text the capsule starts clear of
  Close rather than running under it.
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
- A resumed question shows its final state without replaying the motion. The verdict is announced and takes focus;
  from the keyboard it shows a ring inside its edge, drawn over the photo footer's glass.
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

## 10. Larger text that still works

**For Sarah.** If she turns her phone's text up, to read in sun or without her glasses, she still has every tab, the
+, Back and Search, and nothing runs off the screen. Chrome on Android shows larger text by narrowing the page: 300 px
wide at 130%, 260 at 150%, 195 at 200%.

- Tab bar: the tabs share the bar's width. At 150% the + shrinks from 58 to 48 px, so each tab keeps a 44 px target
  and its label. From about 175% the bar sits 4 px from the screen edges, the labels are hidden from sight (screen
  readers still read them as the tabs' names), each icon gets a target the bar's full height, and the + is 44 px. At
  200% a tab is 34.75 by 64 px, the most there is: five 44 px targets need 220 px, and the screen has 195.
- Species page: once the Photos / 3D model / Card switch would touch Back and Search (below 316 px), it moves to its
  own row under them and the name follows both rows. The hero is held to 45% of the screen unless the name needs more,
  so the summary and Log come up into view at 130% and 150%; at 200% the hero fills the first screen and Log is one
  short scroll down. The photo credit wraps. In 3D the name starts under "Drag to turn" (or a loading note). Every
  segment of the switch is a 44 px target at every size (it was 38 px tall), drawn as before.
- Dex: Bird of the day runs to a second line instead of an ellipsis, at every size. From 175% the pick sits under the
  search and settings buttons. The count capsule's lines wrap inside it, and from 150% "photographed" and "heard only"
  take a line each.
- Learn no longer widens the page at 200%, which had pushed the tab bar off the bottom. Today's pips wrap, the quiz
  packs stand one to a row, and Quick play's three-way choices stack. In a round, when a call question's chips and
  Next don't fit one line (from 150%), Next drops under them, still at the right, instead of running off the screen.
- A live outing below 300 px: Back and the Screen on and Sun toggles share the top row, above the outing's name and
  date line at full width, so the name breaks between words. "In progress" drops under the count, lined up with it,
  and Discard and Finish outing take a row each.
- Sheets: from 130% the log sheet's and the Finish sheet's date and time (and count and heard only) stack instead of
  pushing the whole form, and its Save, past the right edge. The map's search box shrinks to fit at 200% instead of
  running off the screen.
- The live outing's flock chooser sits two by two under 258 px (175% and 200%), so +5, where focus lands, is on the
  screen. The photo viewer's Previous / count / Next capsule starts clear of Close at 200%.
- Found in the last check, which swept every route at 130%, 150%, 175% and 200%, and fixed. These screens were the
  same in `port-fixes`:
  - A page's title steps down below 300 px (27 px at 150%, 18 px at 200%), so Leaderboard, Compare and All sightings
    stay on the screen.
  - Lists: Stats and All sightings take a line each (they pushed the page 13 px sideways at 150%, 78 px at 200%).
  - Dex in list layout: the photo and band share the top line and the name runs the row's full width under them (at
    200% the name had 12 px, one letter to a line).
  - Stats: the number tiles go one to a row at 200%, and each group's bar takes its own line under its name.
  - Badges: the trophy card's words go under its ring, and a shelf holds two badges to a row (one at 200%).
  - Compare: the two photos stay side by side, and each bird's facts take the full width, one card under the other.
  At 390, 320 and 300 px these screens are the same as before, box for box, in light and dark.
- At 390 and 320 px every screen and sheet draws as before. The changes sit in container queries, in sizes worked
  out from the page's width that only change below 300 px (the tab bar's gap, a page's title, Stats' tiles), or wrap
  only when the line no longer fits (the outing's count line, Learn's answer dock, a search box, Lists' buttons).

**See it.** In Chrome DevTools, use a phone viewport of 195 x 422 (200%), 260 x 563 (150%) or 300 x 649 (130%) and
open `#/dex`, `#/bird/42`, `#/learn` and a live outing. On an Android phone, turn up the font size in Settings.

**Files.** `index.html`, `src/components/TabBar.tsx`, `src/styles/app.css`, `src/styles/look.css`,
`src/screens/species.css`, `src/screens/screens.css`, `src/screens/learn/learn.css`, `src/screens/lists/lists.css`,
`src/screens/rest.css`, and `src/screens/map/MapScreen.tsx` (its search names the results list only while the list
is there, which axe had flagged). Tests: `largeText.test.tsx` (the tab bar's sizes at every width from 195 to 420 px,
and the narrow rules, the Dex's stacked list row among them, kept inside their queries), `shell.test.tsx`.

## What was left out, and why

**What larger text (item 10) leaves as it was.** At 175% and 200% the map's controls (Sun, locate, zoom, Map /
Satellite, New patch here) overlap each other and Leaflet's two-line credit, as before, and more with an outing
running: 195 x 422 px has no room for all of them, so they want a different arrangement, such as a tools menu. Each
can still be tapped. At 200% the place picker's map is a short strip with its zoom over the search's close button
(Cancel below does the same). The outing bar's "Outing in progress" is cut short from 150%. A few links in running
text are under 44 px, as before: the group link and the xeno-canto and ALA links on a species page, and Leaflet's
credit. Chrome 146's `<meta name="text-scale">` would let the text grow in place instead of the page narrowing, but
only Chrome has it so far.

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
  (`calmTint` in `lib/look.ts`), and other tints are kept. Khaki between brown and olive (38° to 48°, which reads
  olive at the page's depth) keeps the brown it borders and fades toward grey, so a khaki photo such as the Paradise
  Riflebird's gives a warm grey page rather than an olive one.
- A quick second tap on a tab, a species tile or the arriving screen's Back link while the screen is still changing
  is no longer lost: it ends the transition and goes to what is under her finger. A fumbled double tap still opens
  one page.
- The phone's Back closes the photo viewer before it leaves the species page (a CloseWatcher close request, so no
  history entry; where CloseWatcher is missing, Back leaves as before). Checked with a real close request from
  Chromium (an Escape the app never sees, which runs the same path as Android's Back), not yet on a phone.
- The photo viewer has named Previous and Next buttons either side of its count. Their keyboard focus ring is drawn
  inside the button, so it never covers the count beside it.
- progressive-photo's "develops in" check serves the large photo from a local stub, so it no longer depends on a
  live photo host.

**From the live-outing review, left as they are for you to confirm:**

- A finished outing still shows the gold New band (and its card) on the species that were new for her dex. The brief
  said "for the rest of the outing", so you may want the band on live outings only.
- While a row is held at 0, the header's species count leaves it out, as Finish and Discard would.
- "Outing finished" rests above the buttons, so it can sit over the last row's "New for your dex" line for 4.5 s. No
  button is covered.
- A row held at 0 keeps its sighting until the 4 s are up. If the phone kills the page inside those 4 s, the bird
  stays at 1 (the safe way round), and she taps − again.
- Under 380 px the live outing's header is about 30 px taller than before the Screen on and Sun toggles (151 against
  121 px at 320 px). The title keeps two lines.

**Loose ends still open:**

- With 6,000 sightings on a slow phone, a rare tally tap waits for the shared store to re-read every sighting after a
  write (about 130 ms at 4x CPU). Making that read cheaper is store work for later.
- At 200% text (195 px) a "Badge earned" toast from a lifer's quiet save sits over the middle of the screen, so the
  next tap or two of a burst on a + under it take the toast down instead of counting (found while checking the
  search fix; the toast is item 3's, and a tap on a toast has always taken it down).
- In about one Back in four on a slow phone, the shrink waits for the tile's photo to decode (up to about 0.6 s). The
  `port-fixes` build does the same. Every Back still lands exactly.
- Your call: a replace from her own tap (Stop in a Learn round) still cross-fades, as v1 did, where the plan wanted
  every replace plain. Item 5 says how to change it.
- Seen, not changed (it was so before this round): the Lists bento's three tiles run in one row from edge to edge of
  the screen, without the 16 px margin the rest of the page has, in v1, `port-fixes` and here alike. Learn's
  `.lh-stats` rule (three columns, no padding) wins over the Lists one in `rest.css` (two columns, the life tile two
  rows tall). `docs/port-fixes.md` says the bento follows `rest.css`; it doesn't.
- One unit test, "follows the heading" in `routeFocus.test.tsx`, waits 120 ms. It failed once while the machine was
  busy and passed on every run after. If it fails again, give it a longer wait.
- Not tried on real hardware: the photo viewer's pinch, double tap, swipe and drag; the sheet flick; the phone's own
  Back swipe, and Android's Back closing the photo viewer. Everything was checked in Chromium under Playwright only,
  with no real Firefox, WebKit, TalkBack or VoiceOver.

## Fixes from the round's review (branch `ui-round-fixes`)

Three reviewers read the whole round. Each finding was reproduced on the build before it was fixed:

1. **Taps made just before leaving an outing.** The tally's writer could build a write on the copy of the outing's
   rows she left: a lifer tapped twice just before Back became two sightings of 1, and a stored species lost a tap.
   When the store reads a write back with the outing off screen, its record now takes the write's place in that
   copy (`tallyQueue.ts` `catchUp`). Tests in `useTally.test.ts`.
2. **A toast's watch on the page.** "Outing finished" watches `<body>` to stay clear of the outing's buttons; a newer
   toast that replaced it left that observer running. It now lets go (`toast.ts`). Test in `liveOuting.test.tsx`.
3. **A row at 0 folding under her thumb.** It folded 4 s after its own last −, whatever she was doing on the rows
   below it, and the rest of a flock landed on the species that slid up. It now waits for 4 s with no tap on the
   outing at all (item 2). Test in `liveOuting.test.tsx`.
4. **A flock found with the search.** The first + cleared the search and the rest of a quick burst landed on the tally
   row under her thumb, unless the bird was the first result. The results now wait for her to stop (item 3). Tests
   in `liveOuting.test.tsx`.
5. **A fumbled double tap under reduced motion** opened the species page and then its photo viewer (item 5). Test in
   `secondTap.test.tsx`.
6. **Learn's photo verdict had no visible focus ring**: its glass and glow covered the ring (item 8).
7. **The flock chooser ran off the left edge** at 175% and 200% (item 10). Test in `flockChooser.test.tsx`.
8. **The photo viewer's Previous lay over Close** at 200% (items 6 and 10).
9. **The viewer's Previous and Next were 40 px wide**; they are 44 px (item 6).

Rows 6, 8 and 9 are CSS, checked in the browser at 390, 320, 260, 223 and 195 px, light and dark (and Outdoor for 6).

## How to check it

1. In this worktree, `npm run build` and `npm test` must both pass.
2. Serve `dist` (for example `npx vite preview --port 4600 --strictPort`) and open it on a phone-sized window, light
   and dark, at 390 and 320 px wide.
3. Each item has a Playwright acceptance script in the session scratchpad,
   `C:\Users\Rhys\AppData\Local\Temp\claude\C--Users-Rhys-Documents-Birding\50bbd68c-99d3-4370-8d9a-7660079d8d87\scratchpad\ui-build\accept\<slug>.mjs`.
   Run one from the scratchpad's `tools` folder with `node ..\ui-build\accept\<slug>.mjs http://127.0.0.1:4600/`.
   Each prints PASS or FAIL lines. The scratchpad is temporary, so copy the scripts if you want to keep them.
   `large-text.mjs` also takes a second address, a build without item 10, and then compares the 390 and 320 px
   screens with it pixel for pixel and element by element.
4. Every script routes Supabase so only `get_leaderboard`, `get_profile` and public storage reads pass. Nothing signs
   in or writes to the live project.
5. For a full pass, the scratchpad's `tools` folder has `ui-final2-routes.mjs`, `ui-final2-flows.mjs`,
   `ui-final2-sw.mjs`, `ui-final2-extra.mjs`, `ui-final2-interact.mjs`, `ui-final2-large.mjs` (every route at 150%
   and 200% text) and `ui-final2-large2.mjs` (130% and 175%), which run against 4600. `sh ui-final2-run.sh` runs the
   first six in turn, and `sh ui-final2-accept.sh <name>` runs every acceptance script and writes
   `ui-build\accept\summary.<name>.txt`.

**Script updates after item 3's review.** `tally-queue.mjs` section 4 now expects what item 3 does on purpose: a + on
a never-seen species saves quietly, focus stays on +, stored [1], and the New band opens the card. Its section 2 waits
for a row counted down to 0 to finish its 4 s hold before checking that the sighting has gone. `live-outing.mjs` has
checks for the badge in the card and the Finish sheet, Finish straight after a lifer, a band tapped before its save,
the narrow header, the Screen on icon, the 48 px map Sun, the wake lock taken back in view, "Outing finished" and the
row held at 0.

**Script update after the round's review.** `tally-queue.mjs`'s check "focus stays on the + she pressed" now expects
focus on the search result's + while the results stay up after three Enters on it, then on the bird's + on the tally
once they have gone (finding 4 above). Before, the results went with the first +. The script as it was is kept beside
it as `tally-queue.before-round-fixes.mjs`.

### Check after the review fixes (30 Oct 2026, branch `ui-round-fixes`)

`npm run build` passed and `npm test` passed (54 files, 437 tests). Every acceptance script was run against the
branch's build:

| Acceptance script | Result |
|---|---|
| fast-dex | 13/13 |
| tally-queue | 18/18 with the updated focus check (17/18 as it was written: the check above). One later full run had a tap drawn after 128 ms in the stress check; three reruns of that check passed |
| live-outing | 36/36 |
| progressive-photo | 45/45 |
| route-motion | 14/14 |
| photo-viewer | 41/41 |
| sheet-gestures | 17/17 |
| learn-answer-dock | 10/10 |
| dex-tiers | 26/26 |
| loose-ends | 26/26 |
| large-text | 54/54 (without a reference build) |

The reviewers' own repro scripts, run on the branch: two taps on a lifer and Back with 6,000 sightings at 6x CPU give
one sighting of 2 (it was two of 1); "Outing finished" twice leaves no observer; 20 taps on the row below a row at 0
all count there, at 300 and 500 ms and under reduced motion; five quick taps on the 2nd or 3rd search result give 5 to
that bird, at 390, 320 and 300 px and at 4x CPU (at 195 px, see the badge toast under "Loose ends still open"); a
fumbled double tap on a Dex tile opens the viewer 0 times in 4 (reduced motion, light and dark, 390 and 320, 0
sightings, and with motion); Learn's verdict ring is drawn in light, dark and Outdoor; the flock chooser is 126 px
wide and fully on screen at 223 and 195 px; and the viewer's capsule is clear of Close at every width, with 44 x 44
Previous and Next.

### Last check (30 Oct 2026, on 99c079d)

This is `ui-improvements` with all ten items, the live-outing review, the loose ends and the round's review fixes,
plus the larger-text fixes above. `npm run build` passed and `npm test` passed (54 files, 442 tests).

Every acceptance script passed against 4600 on its first run, before and after the larger-text fixes:

| Acceptance script | Result on 4600 |
|---|---|
| fast-dex | 13/13 |
| tally-queue | 18/18 |
| live-outing | 36/36 |
| progressive-photo | 45/45 |
| route-motion | 14/14 |
| photo-viewer | 41/41 |
| sheet-gestures | 17/17 |
| learn-answer-dock | 10/10 |
| dex-tiers | 26/26 |
| loose-ends | 26/26 |
| large-text | 54/54 |

The full regression pass also came back clean:

- Every route (39 of them) in light and dark, at 390 and 320 px, with 0 and 25 sightings: no console errors, no error
  boundary, no sideways scroll, one outing bar and one live region. Focus was on the h1 after every navigation (or in
  the sheet a route opens).
- Every route (34 of them) with larger text: 130% (300 px) light, 150% (260 px) light, 175% (223 px) dark, and 200%
  (195 px) light and dark, with 25 sightings, and 200% light with none. No sideways scroll, no console errors, and
  all five tab bar targets on the screen. Before the fixes above, Lists, the Log, Stats, Badges, Compare and the
  Leaderboard scrolled sideways at 150% or 200%, and the Dex's list layout put one letter on a line.
- At 390, 320 and 300 px, Lists, the Log, Stats, Badges, Compare, the Leaderboard, Settings, Targets and the Dex's
  list layout have every element in the same place and size as before those fixes, in light and dark.
- Logging from a species page, from the + sheet and by a Dex long press: each is stored with v1's record shape and
  shows in the life list and the Log without a reload.
- An outing started from +, tallied and finished: a seen species found by search counts 2 and the search clears once
  she stops; five quick taps on the second honeyeater result, new for her dex, count 5 with its New band and no card;
  three quick − taps from 2 hold the row at 0 with Undo, and Undo puts back 1; one more − and the row folds 4 s later
  and its sighting goes; Finish keeps the counts with v1's record shape, ends the outing, and it shows in Lists.
- Photo, Backyard birds and Today's challenge rounds play to their results.
- Escape closes only the top layer: the map picker over the + sheet or the log sheet, the photo viewer, search.
- Focus goes to the h1 after the tab bar and links, and Back gives it to the tile she opened.
- Reduced motion: no view transitions on a tile tap, Back or tabs (four with motion), the photo viewer fades, the
  tally has no stamp, and sheets fade instead of sliding.
- The service worker installs and takes over. With the network off, the Dex, a species page, Lists, Learn, a cold
  load of a species page and a Learn round all load.
- No request went to Supabase in any of these runs.
