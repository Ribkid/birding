# Fix the React port of the v1 refresh

`docs/port-refresh.md` reported the port as done. An independent check found otherwise: every screen was run in a
browser against the refreshed v1, every finding was checked again by a second reviewer, and only confirmed
findings are listed below, with duplicates merged. Some of the bugs were already in the first React port. Most came
in with the refresh port.

The v1 reference is `C:\Users\Rhys\Documents\Birding\birding-refresh` (branch `birdydex-refresh`): read it, never
edit it. Line numbers below were taken from `port-refresh` at commit 8206ad7. `main` has moved on since then (commits
fb329d1, cf70370, a6fc5bc, c19ecd2 by Rhys), so search for the code rather than trusting line numbers.

## Hard rules

- Work only in this worktree, `C:\Users\Rhys\Documents\Birdy-React-fixes`, on branch `port-fixes`. Never push, never
  merge, never touch `main` or the `C:\Users\Rhys\Documents\Birdy-React` checkout (Rhys is working there).
- Before fixing an item, check it still happens on the current code. If it is already fixed, say so in Status and
  move on.
- Work in order: Tier 1 first. Commit after each item, or after a small group of closely related items, with a plain
  sentence-style message naming the item numbers.
- `npm run build` and `npm test` must pass before every commit. Add a vitest test where it is cheap (for example,
  editing a sighting keeps its uid).
- Don't change how sightings are stored: IndexedDB stores, keys and fields (`src/core/db.js`), and the Supabase
  tables and RPCs. Fixes must make React behave like v1, not invent new storage.
- It must work offline and without an account. Nothing may load from a CDN at runtime.
- Service worker: keep the rule from commit cf70370. Never rebuild a cached Response (no `new Response(res.body, …)`)
  and match with `{ ignoreVary: true }`. The one exception is the 206 range slice that callClip already makes.
- Never create accounts, sign in, or write to the live Supabase project.
- Match v1's behaviour, markup and copy. When an item names v1 code, port that code. Don't reinvent it.

## Tier 1: fix first (crashes, data safety, offline, broken features)

### 1. Editing a sighting in the React 'All sightings' screen throws away its uid (and acc). For signed-in users this duplicates the sighting in the cloud.
- **Severity:** high. **Source findings:** data-safety:0, data-safety:1
- **Where:** src/screens/lists/Log.tsx:55-61 + src/screens/lists/shared.tsx:489-531 (buildSighting) + src/core/db.js:65
- **Fix:** Build the edit from the whole stored record, e.g. buildSighting(draft, { ...sighting }), so uid, updatedAt, acc and outingUid survive. Stop writing the duplicate `note` field (see the next finding).
- **Also (React stores the sighting note twice ('note' and 'notes') and reads 'note' first, so a …):** Read and write only `notes` (v1's field). Map `note` into `notes` once on read and delete the `note` key.
- **Note:** Do both: keep every stored field when editing, and read/write only `notes` (map a legacy `note` into `notes` once on read). Add a vitest test that editing a v1-shaped record keeps uid, acc and outingUid.
- **Evidence:** I reproduced this myself and could not refute it. When you edit a sighting in the React "All sightings" screen, the edited record is rebuilt from only five fields. Its uid, acc, outingUid, the old updatedAt and any extra fields are lost, and writeSynced in db.js then gives it a new uid. v1 does not do this: running the same steps there keeps the uid. So it is a real React-port regression against v1. It does not come from port-refresh, though: Log.tsx and shared.tsx are unchanged between main and port-refresh, and Log.tsx was last touched in commit 2a22d0a. Nothing here is environmental. ALA photos are not involved, and the one console warning ("Photo index failed") came from my own blocking …

### 2. Cold load or reload of #/learn (and #/quiz) crashes the whole app to a blank page
- **Severity:** high. **Source findings:** learn-parity:0, code-review:0, runtime-sweep:0, offline-sw:4
- **Where:** src/screens/learn/Learn.tsx:88 (useMemo calls packProgress() on first render, before ready) -> src/core/learn.js:134-137 (reads L.packs[p.key] while L is still null; L is set only when learnReady() resolves, learn.js:26-38). No error boundary in src/main.tsx or src/App.tsx.
- **Fix:** 1) src/screens/learn/Learn.tsx:88: build packs only when ready: `useMemo(() => (ready ? packProgress().filter(p => p.total >= 5) : []), [ready, L?.packs])`. 2) Make src/core/learn.js:135 null-safe: `st = L?.packs?.[p.key] || {}`. 3) After all hooks in Learn(), `if (!ready) return <div className="learn learn--loading" aria-busy="true" />;` so setPrefs (core/learn.js:46, which dereferences L.prefs) can never run before the store loads. This mirrors v1 js/learn.js:296 (renderLearn draws the loading shell and awaits learnReady() before the hub). 4) Add an ErrorBoundary around <Routes> in src/App.tsx so a render error in one screen no longer unmounts the root.
- **Also (Cold load or reload of #/learn (and #/quiz, which redirects there) crashes the whole app …):** Gate the memo: const packs = useMemo(() => ready ? packProgress().filter(...) : [], [ready, L?.packs]); and wrap <Routes> in an error boundary so one screen's render error cannot unmount the shell.
- **Also (Opening or reloading the app on #/learn crashes the whole React tree and leaves a blank …):** 1) src/screens/learn/Learn.tsx:88: change to `const packs = useMemo(() => (ready ? packProgress().filter((p: { total: number }) => p.total >= 5) : []), [ready, L?.packs]);`. 2) src/core/learn.js:135: change `st = L.packs[p.key] || {}` to `st = L?.packs?.[p.key] || {}`, so the helper is safe before load like allCards()/accuracy() already are. 3) Add a top-level React error boundary around the routes in src/App.tsx (or around <App/> in src/main.tsx). It should render a short 'Something went wrong' card with Reload and Back to Dex links, so one screen's exception can no longer leave #root empty. v1 has no equivalent bug: its Learn view awaits its state before rendering (v1 renders #/learn cold).
- **Note:** Also add a top-level error boundary around <Routes> so one screen can never blank the whole app.
- **Evidence:** Browser, fresh profile per route (tools/v2-learn-cold.mjs, output C:/Users/Rhys/AppData/Local/Temp/claude/C--Users-Rhys-Documents-Birding/50bbd68c-99d3-4370-8d9a-7660079d8d87/scratchpad/verify/v2-learn/cold.json + cold-react-_learn.png): React #/learn and #/quiz -> #root has 0 children, body text '', pageerror "Cannot read properties of null (reading 'packs')". v1 cold-loads both into the Learn hub. Warm navigation (Dex first) works in React because learnReady() has resolved by then. All Learn code was added on port-refresh (commit 2e9b45d), and pre-port main 2a22d0a had no Learn screen. src/screens/learn and src/core/learn.js are identical on main and port-refresh.

### 3. Global CSS is bundled after the per-screen CSS, so base .btn rules override same-specificity screen rules (Me join buttons, Learn .lq-act pills)
- **Severity:** medium. **Source findings:** visual-parity:6, me-accounts:1
- **Where:** src/main.tsx:4-9 (App imported before styles/app.css, look.css, motion.css, screens.css, rest.css); src/screens/me/me.css:195-196; src/screens/learn/learn.css:368
- **Fix:** In src/main.tsx move the CSS imports above `import App from './App'` and import every stylesheet there in v1's order (birding-refresh index.html:43-54): './styles/app.css', './screens/field/field.css', './screens/learn/learn.css', './styles/motion.css', './styles/look.css', './screens/screens.css', './screens/species.css', './screens/rest.css', './screens/field/calls.css', './screens/field/scan.css', './screens/me/me.css'. Then add the React-only './screens/lists/lists.css', './screens/map/map.css' and './screens/progress/progress.css'. The per-screen imports can stay; Vite dedupes them and keeps the first position. Rebuild, then check that dist CSS has app.css '.btn{display:inline-flex' before '.me-join-in{', and recheck Lists, Map and Settings, whose CSS moves from before app.css to after it.
- **Also (Screen CSS loads before app.css, so global .acct-av and .btn rules override the Me …):** Import the global CSS (app.css, look.css, motion.css) before App in main.tsx so screen CSS comes later in the cascade, as in v1. Re-check other screens: same-specificity overrides of .btn and .acct-av are probably affected too.
- **Evidence:** dist/assets/index-DVH-BAab.css: '.me-join-in{' at offset 111008 and '.lq-act{' at 87489 come before app.css '.btn{display:inline-flex' at 131987 and look.css '.btn,.chip,.kind-tab' radius at 174138. In v1, me.css and learn.css load after app/look. Browser: Me as a guest, light: 'Sign in' bg rgb(255,255,255) dark text (v1 rgba(255,255,255,0.14) white text). Dark: 'Sign up free' and 'Sign in' are both rgb(23,28,35) (v1 Sign up free is white). Injected <button class="btn lq-act">: React radius 20px, padding 10px 18px; v1 999px, padding 8px 16px 8px 12px (v2-visual-targeted.mjs, rx-light/targeted.json vs v1-light/targeted.json). The port added the global imports after App in main.tsx (pre-port …

### 4. 'Play again' and 'Practise the N you missed' throw a TDZ ReferenceError on every results screen and do nothing
- **Severity:** high. **Source findings:** learn-parity:1, code-review:1
- **Where:** src/screens/learn/LearnPlay.tsx:273-276 (early return renders <Results> with closures calling restart/startWithIds) vs :302-311 (`const restart` / `const startWithIds` are declared after that return, so they are in the temporal dead zone when clicked)
- **Fix:** In src/screens/learn/LearnPlay.tsx, move the declarations of restart, startWithIds (and pick, next, play) above every early return (before `if (isDeck)` at :258), e.g. as useCallback hooks depending on [isDaily, pack, game]. They need only isDaily, pack, seenSet, setGame, setError and setRapidLeft. Mirror v1 js/learn.js:921-926: Play again restarts the route's mode (or the test set), and Practise starts a round on the missed ids. Apply together with the Rapid fire fix (learn-parity:19 / code-review:17).
- **Evidence:** Browser (tools/v2-learn-results.mjs, output verify/v2-learn/results-react.json, results-react-again-after.png, results-react-missed-after.png): finished a Who am I? round. 'Play again' gave pageerror "Cannot access 'ue' before initialization" and 'Practise the 7 you missed' gave "Cannot access 'Ze' before initialization". Both times h1 stayed 'Who am I?' and no new question appeared. In v1 (results-v1.json) 'Play again' started a round at 1/10, and Practise started 'Who am I? / The ones you missed' at 1/9.

### 5. Rapid fire restart is broken under the TDZ bug: 'Play again' would end the new round at once, and 'Practise missed' would start another timed 60-question rapid round
- **Severity:** medium. **Source findings:** learn-parity:19, code-review:17
- **Where:** src/screens/learn/LearnPlay.tsx:209 (rapidLeft state, only updated by the interval at :240-248), :273-274 (Results branch taken when rapidLeft <= 0, and finishRound() is called during render), :302-306 (restart never resets rapidLeft), :308 (startWithIds passes the route pack 'rapid'); src/core/learn.js:174-180 (rapid => n=60 and endsAt); resultMode() at src/core/learn.js:268 is unused
- **Fix:** In LearnPlay.tsx: (a) call setRapidLeft(RAPID_MS) when a new game is set (restart, startWithIds and the init effect), or compute `left = Math.max(0, game.endsAt - Date.now())` during render instead of keeping it in stale state. (b) Move finishRound() out of render into a useEffect that runs when the round-over condition becomes true. (c) In startWithIds use `newPracticeRound(game.mode === 'rapid' ? 'photo' : pack, { ids })` (or resultMode(game.mode) from core/learn.js:268), as v1 js/learn.js:924 does.
- **Note:** Fix together with the item above.
- **Evidence:** Code only. Latent, because the TDZ crash (learn-parity:1) stops both buttons today. Trace: after a rapid round rapidLeft is 0. restart() sets a new game, but the first render still sees rapidLeft 0 and q.picked == null, so it takes the Results branch at :273 and finishRound(newGame, 0) sets done=true and increments L.rounds (core/learn.js:226-255). When the real round ends, `if (!game.done)` skips it, so the best streak is never saved. startWithIds('rapid') builds another 60-question timed round, where v1 learn.js:924 switches to 'photo'.

### 6. Call questions replay the previous question's recording; the old clip keeps playing into the next question
- **Severity:** high. **Source findings:** learn-parity:2, code-review:2
- **Where:** src/screens/learn/QuizMedia.tsx:75-91 (CallPlayer keeps audio.current and state when the call prop changes; a tap while 'loading' creates a second Audio); src/screens/learn/LearnPlay.tsx:334 (<Media q={q} /> has no per-question key), :46, and Deck :410 (consecutive call cards reuse the same CallPlayer); next() at :295 does not stop audio
- **Fix:** 1) LearnPlay.tsx:334: `<Media key={game.i} q={q} />`. Deck :410: key the CallPlayer/PhotoBox by card, e.g. `key={`${c.id}|${c.skill}|${game.n}|${game.queue.length}`}`. 2) QuizMedia.tsx CallPlayer: add `useEffect(() => () => { audio.current?.pause(); audio.current = null; setState('idle'); setProgress(0); }, [call?.src, call?.local])`, and return early in toggle when state === 'loading'. 3) Stop audio when Next is pressed. Mirror v1 js/learn.js:169-176 (stopAudio) and :739 (stopAudio before game.i++). v1 playCall (:178-186) only reuses the audio for the same button.
- **Evidence:** Browser (tools/v2-learn-call.mjs, verify/v2-learn/call-react.json): Call round, Q1 played clip proxyImage?imageId=861a2f3e…. After Next, Q2's status read 'Playing' before any tap. Tap 1 paused it, and tap 2 played the same 861a2f3e clip. Q3 and Q4 did the same, although their answers were Golden Whistler, Australian Pelican and Southern Boobook (Q1 was Magpie Goose). v1 (call-v1.json) shows 'Tap to listen' on each new question, and each plays its own clip (250-1.m4a, 165-1.m4a, a different proxyImage).

### 7. 'Ones I've seen' scope never starts a Quick play round, even with 20 species logged
- **Severity:** high. **Source findings:** learn-parity:3, code-review:3
- **Where:** src/screens/learn/LearnPlay.tsx:211-212 (seenSet comes from useSightings, which starts as [] and loads IndexedDB later, src/lib/hooks.ts:28-46), :232 (the round is built in the mount effect with the first-render empty set), :238 (deps omit seenSet), :304 (restart has the same problem)
- **Fix:** In the LearnPlay init effect (:219-238) and in restart (:302-306), read the sightings directly before building: `const seen = new Set(((await db.all('sightings')) as Sighting[]).map(s => s.speciesId));` and pass `{ seen }` to newPracticeRound. Alternatively, expose a loaded flag from useSightings and wait for it. v1 passes ctx.seenSet() (in-memory, loaded at boot) at js/learn.js:636.
- **Evidence:** Browser (tools/v2-learn-seen.mjs, verify/v2-learn/seen-react.json, seen-react-photo.png): seeded 20 sightings and reloaded, then chose Learn > Ones I've seen. Photo and Who am I? both showed "Not enough of the ones you've seen for this. Log a few more, or choose Everything." The same happened on a second visit to the route. v1 with the same seed (seen-v1.json) started 'Which bird is this? 1/10' and 'Which bird am I? 1/10'.

### 8. Learn rounds don't wait for seq/gallery/photo-index data: cold #/learn/daily and #/learn/play/* fail, and today's set changes with load timing
- **Severity:** medium. **Source findings:** learn-parity:10, code-review:5, runtime-sweep:1, runtime-sweep:2
- **Where:** src/screens/learn/LearnPlay.tsx:219-238 (awaits only learnReady before newDailyRound/newPracticeRound); src/core/quiz.js:697-731 (buildDaily depends on relRate (seq) and galleryFor); src/core/learn.js:189-190 (saved daily picks are re-applied by index)
- **Fix:** In LearnPlay's init effect (and restart), `await Promise.all([learnReady(), loadSeq(), loadExtras(), cachedIndex()])` before building any round (imports: loadSeq from src/core/seqdata.js, loadExtras from src/core/gallery.js, cachedIndex from src/core/media.js), and keep the loading shell until then. Mirror v1 js/app.js:3083-3089 (`if (/^#\/learn\//.test(location.hash)) await extras;`). For extra safety, store the daily question focus ids with D.today and rebuild the same set from them, rather than relying on index order.
- **Also (Cold #/learn/daily always errors ('needs the species data') and cold #/learn/play/rapid …):** In LearnPlay, await ensureSeq()/the media index (or use useSeqReady) before building the round, and include readiness in the effect deps.
- **Also (LearnPlay keeps a stale error across routes: after one failed round, every other play …):** Reset error and game at the start of the effect (setError(''); setGame(null)), or key the element by pack (<LearnPlay key={pack}/>).
- **Note:** Also reset error and game when the play route changes (or key <LearnPlay> by route), so one failed round does not stick.
- **Evidence:** Browser fresh-profile cold loads (verify/v2-learn/cold.json): React #/learn/daily shows "Today's challenge needs the species data. Try again in a moment.", and #/learn/play/photo shows 'Not enough species match that choice. Try a wider one.' with no retry. v1 cold-loads into '1/5' and '1/10'. With gallery.json delayed (vr-code-review-daily2.mjs, verify/v2-learn/daily-slowgallery.json) the daily set differs: Q1 photo->whoami, Q2 duel(333,331)->whoami, and Q3-Q5 have different options. v1 has a smaller version of this race when the gallery is slow during warm navigation, but it waits on cold learn routes.

### 9. The service worker's call-clip cache name ('birdydex-calls') does not match core/media.js and v1 ('birddex-calls'), so a saved call pack does not play offline
- **Severity:** medium. **Source findings:** data-safety:2
- **Where:** scripts/sw-template.js:7 and :96-101 (callClip) vs src/core/media.js:249 (CALLS_CACHE = 'birddex-calls'); related src/core/quiz.js:204 and :214-222, scripts/sw-template.js:133
- **Fix:** Use CALLS = 'birddex-calls' in sw-template.js (or fall back to caches.match in callClip). Cache upload.wikimedia.org and thumb.wikimedia.org photos into 'birddex-images' as v1's sw.js does. Expose the save-calls-for-offline control.
- **Note:** On current main, scripts/sw-template.js (after commit cf70370) uses CALLS = 'birdydex-calls-v1', while core/media.js and v1 use 'birddex-calls'. Make the SW use the app's cache name.
- **Evidence:** I confirmed the finding in the code and in a browser, and it is a regression in the port. v1 does not have it. The port's service worker serves call clips only from the cache 'birdydex-calls' (scripts/sw-template.js:7, :96-101). core/media.js:249 (CALLS_CACHE) and v1 (sw.js:9, js/media.js:249) both use 'birddex-calls'. On main the service worker had no calls route, so the port introduced this.

I ran a control test with the network actually off. A clip in 'birdydex-calls' plays offline (206). A clip only in 'birddex-calls' fails (Failed to fetch, MediaError 4). The same clip in v1 plays offline.

Learn's offline mode counts clips in 'birddex-calls' as saved, because quiz.js:220 uses …

### 10. Call clips are never saved for offline: the SW forwards the audio element's Range header, gets a 206, and the cache.put failure is swallowed
- **Severity:** high. **Source findings:** offline-sw:1
- **Where:** scripts/sw-template.js:73-80 (callClip: cache.match(request) at :75, fetch(request) at :77 forwards 'Range: bytes=0-', cache.put of the 206 at :79 rejects and .catch hides it); scripts/sw-template.js:15 CALLS='birdydex-calls-v1' vs src/core/media.js:249 CALLS_CACHE='birddex-calls'; the copy at src/screens/progress/Settings.tsx:851-852 ('Calls are saved each time you play one') is false
- **Fix:** In scripts/sw-template.js callClip, mirror v1 sw.js:94-101 by fetching and storing the whole file by URL, without the media Range header:
```js
async function callClip(request) {
  const cache = await caches.open(CALLS);
  let res = await cache.match(request.url, MATCH);
  if (!res) {
    res = await fetch(request.url);            // no Range header -> whole-file 200
    if (!res.ok || res.status === 206) return res;
    await cache.put(request.url, res.clone()).catch(() => {});
  }
  ...existing range slicing unchanged...
}
```
Also set `const CALLS = 'birddex-calls'` (sw-template.js:15) to match src/core/media.js:249 and v1 sw.js:9, so a later 'save all calls' (saveCallPack) and the SW share one cache. activate only deletes 'birdydex-*' names, so it survives releases. Re-check: play a clip online, confirm caches.open('birddex-calls') holds it, then open a fresh tab offline and play it.
- **Note:** Still true on current main: callClip fetches `request` with the audio element's Range header, so the response is a 206 and cache.put silently fails. Fetch a new Request for the URL without the Range header.
- **Evidence:** Current 4180 build (the earlier finding's 'never plays online' no longer holds; online playback now works because the bytes=0- 206 carries the whole file). SW-side fetch with Range bytes=0- returns 206 'bytes 0-75378/75379'. cache.put then fails with "TypeError: Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported" (verify/v2-offline/main-react.json rangePut). Played #/bird/1 recording online: canplay and playing, but birdydex-calls-v1 = [] afterwards. Closed the tab, went offline, played in a fresh tab: err 4 'MEDIA_ELEMENT_ERROR: Format error' and NotSupportedError (verify/v2-offline/clip-react.json; tools/v2-offline-clip.mjs). The Learn call round offline …

### 11. First Scan download goes through the SW's catch-all cacheFirst: no progress, aborted after 5 minutes on slow links, and the 93 MB model plus 11 MB wasm are stored twice
- **Severity:** high. **Source findings:** offline-sw:3, scan-photoid:0
- **Where:** scripts/sw-template.js:182-183 (catch-all cacheFirst into RUNTIME now catches /models/bioclip/*.bin and /vendor/ort/*, because the port removed pre-port main's `if (isModel(url)) return;`) + :60-69 (cacheFirst awaits cache.put at :66 before answering the fetch); src/core/photoid.js:186-207 (the app already caches the joined .onnx and the wasm in 'birddex-models')
- **Fix:** In scripts/sw-template.js, before the catch-all route, mirror v1 sw.js:168-177:
```js
if (url.pathname.startsWith('/models/bioclip/') && url.pathname.endsWith('.bin')) return; // photoid.js joins + caches these
if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/vendor/')) {
  event.respondWith(cacheFirst(request, 'birddex-models', event).catch(() => Response.error()));
  return;
}
```
'birddex-models' is the cache photoid.js uses (photoid.js:33), so the ORT wasm becomes a single entry under the same URL key. In cacheFirst, do not await the put before answering, as in v1 sw.js:77-78: `if (res.ok) event.waitUntil(caches.open(cacheName).then(c => c.put(request, res.clone())).catch(() => {})); return res;`. Pass `event` in. This keeps progress live and stops a long body from holding respondWith open past Chrome's 5-minute limit. For existing installs, in activate delete the '/models/bioclip/*.bin' and '/vendor/ort/*' keys from 'birdydex-runtime-v3', or bump RUNTIME. Keep build-sw.mjs EXTRA_SHELL free of the .bin parts, as it is now.
- **Note:** Partly fixed already by commit fb329d1 (the model is no longer precached). What remains on current main: the catch-all cacheFirst(RUNTIME) still stores the model parts a second time. Let /models/bioclip/*.bin go straight to the network as v1 does.
- **Evidence:** The install part of the original finding is already fixed on main (fb329d1). Current install precaches 34 files, 3.8 MB, and fetches no .bin (verify/v2-offline/main-react.json afterInstall, firstVisitModelRequests). A deploy now refetches only photoid.bin, index.html and manifest.json (update-test-upd.json). The rest is still real:
- Storage after one scan: 214 MB. birddex-models has 105 MB (onnx 93.1 + wasm 11.2) and birdydex-runtime-v3 has 105.1 MB (part1 46.6, part2 46.6, wasm 11.2) (storage-react.json, tools/v2-offline-storage.mjs). v1 used 111 MB (offline-sw/storage-v1.json).
- Parts throttled to 3 MB/s (slow proxy :4412): Scan showed '11 of 104 MB' for 17 s, jumped to 58, then sat …

### 12. Any online navigation that is not the app (privacy/terms link, error page, captive portal) is stored as /index.html, so the next offline launch shows that page instead of BirdyDex
- **Severity:** high. **Source findings:** offline-sw:2, offline-sw:12
- **Where:** scripts/sw-template.js:115-117 (every navigation response is put as '/index.html', with no res.ok, path or content check); links at src/screens/progress/Settings.tsx:811-812,961-962 and src/screens/me/SignIn.tsx:66
- **Fix:** In the navigation handler (sw-template.js:113-118), store only good HTML, and store the app shell only for the app's own URL. Mirror v1 sw.js:133-134, which stores under the request and only when res.ok:
```js
const fresh = await fetch(request);
if (fresh.ok && (fresh.headers.get('content-type') || '').includes('text/html')) {
  const isApp = url.pathname === '/' || url.pathname === '/index.html';
  event.waitUntil(caches.open(SHELL).then(c => c.put(isApp ? '/index.html' : request, fresh.clone())).catch(() => {}));
}
return fresh;
```
Optional hardening against captive portals: when isApp, only overwrite '/index.html' if `(await fresh.clone().text()).includes('<div id="root">')`. Pair this with the fallback-order fix (offline-sw:12), so /privacy.html offline serves its own entry.
- **Also (Offline, opening the privacy or terms page shows the app shell instead of the precached …):** Swap the order in the navigation catch block, mirroring v1 savedCopy (sw.js:122-123): `(await caches.match(request, MATCH)) || (await caches.match('/index.html', MATCH)) || new Response(...offline page...)`. Navigations to '/' have no '/' cache entry, so they still fall through to /index.html, and /privacy.html and /terms.html (both in PRECACHE) serve themselves.
- **Note:** Still true on current main: the navigation handler stores every online navigation as /index.html.
- **Evidence:** tools/v2-offline-privacy.mjs http://127.0.0.1:4180/ on the current build:
- Before: cached /index.html has title "Sarah's BirdyDex" and hasRoot true.
- After tapping a[href="/privacy.html"] online: cached /index.html has title "Privacy: Sarah's BirdyDex", hasRoot false, 3677 bytes.
- An offline new tab at / then shows 'Back to the BirdyDex / Privacy / Last updated 27 October 2026' (verify/v2-offline/privacy-react-4180.json, react-4180-privacy-then-offline-launch.png).
The same code and links are on pre-port main (2a22d0a sw-template.js:60-62; Settings.tsx:811,961). v1 stores each navigation under its own request, and only when res.ok (sw.js:133-134).

### 13. Wikimedia photos and map tiles are never cached by the SW, so 'Download for offline', offline photo quizzes and the offline map do not work as in v1
- **Severity:** medium. **Source findings:** offline-sw:8, learn-parity:4, code-review:11, learn-parity:21
- **Where:** scripts/sw-template.js:108 (returns for every cross-origin request); src/core/quiz.js:200-212 (cachedPhotos reads 'birddex-images', which is never filled); src/core/media.js:331-353 (downloadAll's CORS fetches are kept nowhere durable); src/screens/progress/Settings.tsx:849-856 (promises the dex 'works with no signal')
- **Fix:** Port v1's cross-origin routes into scripts/sw-template.js, placed before the same-origin check at :108. Mirror v1 sw.js:158-165, the cacheFirst with cors refetch at :70-86, and trim at :87-91:
- upload.wikimedia.org / thumb.wikimedia.org with request.destination !== 'audio' -> cacheFirst into 'birddex-images'. Fetch `new Request(url, { mode: 'cors', credentials: 'omit' })`, store on res.ok, and fall back to fetch(request) if the CORS fetch throws.
- *.tile.openstreetmap.org and server.arcgisonline.com -> cacheFirst into 'birddex-tiles', trimmed to 3000 entries.
Keep those exact names, because quiz.js:204 reads 'birddex-images'. activate only deletes 'birdydex-*', so they persist across releases. Then update the header comment at sw-template.js:3-4.
- **Also (Offline, Learn finds no saved photos: Photo silently becomes Who am I?, Duels are …):** In scripts/sw-template.js, add a branch before the cross-origin return at :108: `if ((url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') && request.destination !== 'audio') { event.respondWith(cacheFirst(request, 'birddex-images')); return; }`, using CORS fetch and a trim limit, as v1 sw.js:158-161 does with IMAGES='birddex-images' (sw.js:6). cachedPhotos (quiz.js:200-212) then works unchanged. Make newPracticeRound (core/learn.js:170) return a notice when it falls back to whoami, and show it on the play screen as role=status text: 'No photos saved on this phone yet, so this round uses field notes.' (v1 js/learn.js:625-627). This also makes media.js:331 downloadAll actually store photos for offline use.
- **Note:** Offline photos are the point of the app in the field: cache Wikimedia photos and map tiles like v1 so offline quizzes and the offline map work.
- **Evidence:** tools/v2-offline-xorigin.mjs browsed Dex, three species pages and the map online:
- React's caches are only the shell (34) and runtime-v3 (7, same-origin), even though thumb.wikimedia.org and tile.openstreetmap.org were loaded.
- v1 (8765) has birddex-images with 9 thumb.wikimedia.org entries and birddex-tiles with 12 tile.openstreetmap.org entries (verify/v2-offline/xorigin-react.json, xorigin-v1.json).
The same early return is on pre-port main (2a22d0a sw-template.js:52).

### 14. With a photo loaded, the kind chip row is wider than the page: the document overflows sideways and the 'Anything' chip is off-screen and can't be tapped
- **Severity:** high. **Source findings:** scan-photoid:1
- **Where:** src/screens/field/Scan.tsx:185-236. .scan-tools, .scan-kinds, .scan-go and .scan-work sit inside <section className="scan-vf">, and scan.css:50 sets .scan-vf { display:grid; place-items:center } (scan.css is byte-identical to v1).
- **Fix:** In Scan.tsx, end the <section className="scan-vf"> right after the .scan-stage div (after line 215) in the photo branch, and right after .scan-pick in the empty branch. Move .scan-tools (216-222), the .scan-kinds group (223-228), the .scan-go button (229) and .scan-work (232-235) out of the section so they are siblings inside .scan-cam-body, in that order. This mirrors v1 js/scan.js:44-53. Render tools, kinds and go only when a photo is loaded, as v1 does at scan.js:87-89 and 111-112. Give the section className={`scan-vf${!photo ? ' scan-vf--empty' : ''}${busy ? ' scan-vf--busy' : ''}`}, mirroring v1 scan.js:74 and 92. The .scan-kinds negative margins (scan.css:174-178) then bleed to the cam-body edges and the row scrolls inside itself. To verify: at 390 px with a photo loaded, document.documentElement.scrollWidth must be 390 and every chip must be reachable by scrolling the row.
- **Evidence:** I ran C:/Users/Rhys/AppData/Local/Temp/claude/C--Users-Rhys-Documents-Birding/50bbd68c-99d3-4370-8d9a-7660079d8d87/scratchpad/tools/v2-scan-main.mjs at 390x844 (isMobile) with 325_1.jpg loaded. Output: verify/v2-scan/react-main.json and v1-main.json.
React: docW 521 against a visual viewport of 390. .scan-kinds has parent 'scan-vf', x=-131, w=651, scrollWidth 651 = clientWidth (it cannot scroll). 'Anything' is at x=-115 and elementFromPoint misses it (hit=false). window scrollX range is 0..0, so the left overflow can't be reached. Playwright tap() on both 'Plants' and 'Anything' timed out. The kind buttons only set a kind (Scan.tsx:226) and never toggle off, so once a kind is picked the …

### 15. 'This one' drops the scanned photo, the 'Identified from a photo.' note and auto-location, and Cancel goes to Lists instead of back to Scan
- **Severity:** high. **Source findings:** scan-photoid:2, code-review:16, data-safety:3
- **Where:** src/screens/field/Scan.tsx:136-139 (navigate('/add?species=ID', { state: { scan: true, at } }); the state is never read). src/screens/lists/AddSighting.tsx:14-22, 64-95 (reads only ?species, has no photo field, Cancel and Save go to /lists).
- **Fix:** 1) Add a small hand-off module, e.g. src/screens/field/scanHandoff.ts, with setPending({ blob, notes, autoGps }) and takePending(). A module store is safer than putting a Blob in history state.
2) In Scan.tsx chosen(), call setPending({ blob: photo.blob, notes: 'Identified from a photo.', autoGps: true }) before navigate(`/add?species=${id}`, { state: { scan: true } }). This mirrors v1 js/scan.js:429-434.
3) In AddSighting.tsx, when location.state?.scan is set, takePending() on mount. Prefill draft.note with the notes. Show a photo preview (URL.createObjectURL, revoked on unmount) with Replace and Remove buttons, as v1 app.js:651-654 and 672-676 do. In a useEffect on mount, call locate() when autoGps is true (v1 app.js:677).
4) In save(), when a blob is attached, first do `rec.photoId = await db.add('photos', { blob, at: Date.now() })`, mirroring v1 app.js:738-741 or src/screens/field/sighting.ts:30-31. Delete that photo if saveSighting throws (sighting.ts:52-58).
5) When arriving from Scan, make Cancel call navigate(-1) so the user returns to the scan result, as v1's sheet does.
- **Evidence:** Scripts: tools/v2-scan-main.mjs (handoff step, geolocation granted at -27.4705,153.026) and tools/v2-scan-extra.mjs (thisOneCancel). Outputs: verify/v2-scan/{react,v1}-main.json, {react,v1}-extra.json, react-handoff.png and v1-handoff.png.
React after 'This one' on Chestnut Teal: url #/add?species=11, notes [''], the only image is the wikimedia species thumbnail, lat and lng empty, status 'No location yet'. Cancel goes to #/lists; going back from there reaches #/add again, and the scan is gone (photo 0, verdict null).
v1: the sheet opens over #/scan with notes ['Identified from a photo.'], a blob: preview of the user's photo with Replace photo and Remove, and coordinates '-27.4705, 153.0260 …

### 16. Account deletion is unreachable in the React app, but privacy.html and terms.html tell users to use it
- **Severity:** high. **Source findings:** me-accounts:0, data-safety:5
- **Where:** src/screens/progress/Settings.tsx:689-792 (signed-in account body); src/core/account.js:68 deleteAccount() has no callers
- **Fix:** Add the v1 button and confirm sheet ('Delete your account?' with the v1 copy). Call core deleteAccount() and show the v1 toasts, then refresh. Refuse while offline.
- **Note:** privacy.html and terms.html promise this, so it must exist. Refuse while offline, confirm first, use the v1 copy.
- **Evidence:** I confirmed this from three sources: the code, the built bundle and screenshots. The React app has no way to delete an account, but the shipped privacy.html and terms.html tell users to delete it in Settings. v1 has the button and its confirm flow, so this is a real gap against v1. It is not new in port-refresh, though: the React app on main already lacked deletion and already shipped the same privacy text. The port copied deleteAccount() into src/core/account.js but no screen calls it. I rate it high because the only deletion route the privacy notice promises does not work in the shipped app, so a signed-up user cannot remove their account or cloud data. Nothing here is environmental (no …

### 17. Badges screen (and the Badges block at the bottom of Stats) renders broken: medals are bare text, labels run into descriptions, progress meters draw as large yellow blocks
- **Severity:** high. **Source findings:** visual-parity:0, code-review:10
- **Where:** src/screens/progress/Badges.tsx:80-125 (old ul.badges/li.badge/.medal/.badge-txt markup); src/screens/lists/Stats.tsx:451-470 (same markup) and :281; src/screens/screens.css:293 (.badge display:grid; text-align:center); src/styles/app.css:176-178 (.meter); rules removed from pre-port 3819077:src/styles/app.css:351-361
- **Fix:** Rewrite the Badges.tsx render to mirror v1 renderBadges (birding-refresh js/app.js:2413-2464) so screens.css:287-339 applies: sections in v1 order [milestone 'Milestones', kind 'Animals & plants', rarity, habit, learning 'Learning', habitat, group]; each section is <section className="shelf-sec"> with <h2 className="h2 shelf-h"><span>{title}</span><span className="shelf-n" aria-hidden>{done}/{n}</span></h2> and <ul className="shelf shelf--play"> listing earned first; each li is className={`badge badge--${k}${b.done?' badge--done':''}`} containing <span className="emb">{!b.done && <span className="emb-ring"/>}<svg viewBox="0 0 64 64">{EMBLEM[k]}</svg><b className="emb-n">{b.need}</b></span><strong className="badge-name"/><span className="badge-desc"/> (app.js:2420-2444, EMBLEM at app.js:2398). Add the is-in class after mount for the shelf--play animation. Pass learning progress like Me.tsx:65-67 and v1 app.js:2414-2416: await learnReady() then badges(sightings, outings, learnStats()); today Badges.tsx:35 and Stats.tsx:281 omit it, so Learning badges never progress there while Me counts them. Replace the /quiz link at Badges.tsx:63 with /learn. In Stats.tsx delete the bottom 'Badges' block (:451-470); v1 statsview has none. If a quick stopgap is needed first, add to progress.css `.badges{list-style:none;margin:0;padding:0;display:grid;gap:10px} .badges .badge{display:flex;gap:12px;align-items:center;text-align:start;padding:10px 0} .badges .badge-txt{display:grid;flex:1} .badges .meter{display:block}` plus the old .medal rules from 3819077:src/styles/app.css:354-361.
- **Also (Badges and Stats screens never count the Learning badges, so they disagree with Me):** 1) In src/screens/progress/Badges.tsx, import { learnReady, learnStats } from '../../core/learn.js' and add a learn tick: `const [learnTick, bump] = useReducer((n: number) => n + 1, 0); useEffect(() => { let alive = true; learnReady().then(() => { if (alive) bump(); }).catch(() => {}); return () => { alive = false; }; }, []);`. Change the memo to `() => { let learning = {}; try { learning = learnStats() || {}; } catch { /* not loaded */ } return badges(sightings, outings, learning) as Badge[]; }` with deps [sightings, outings, learnTick]. 2) Make the same change in src/screens/lists/Stats.tsx:280-283 so 'You've earned N of 98 badges' matches. These mirror v1 js/app.js:2414-2417 (learnStats() plus a learnReady() redraw) and React Me.tsx:55-67. 3) Optional: add ['learning', 'Learning'] to SECTIONS in Badges.tsx:19-26, between 'habit' and 'habitat', to match the v1 section order …
- **Evidence:** Browser (tools/v2-visual-probe.mjs rx light, verify/v2-visual/rx-light/badges.png and probe.json). li.badge is display:grid with text-align:center. The .meter is an inline span with a 216x48 rgb(245,197,24) inner block. The strong label and its description sit on the same line ('Half centuryS24 of 25' overlap visible). The page is 8998px tall; v1 is 7027px with ul.shelf grid of 103x135 badge cards (v1-light/probe.json). The Stats bottom block shows a bare '24' over 'Quarter century' with no medal (rx-light/stats-badges.png; .medal 18x24 transparent). Badges.tsx is byte-identical to pre-port 3819077; the port replaced app.css, dropping .badges/.medal/.badge-txt (pre-port app.css:351-361), …


## Tier 2: wrong behaviour and parity gaps with v1

### 18. A precache file that fails during an update is dropped and the old shell is deleted, so the next offline launch can fail
- **Severity:** medium. **Source findings:** offline-sw:5
- **Where:** scripts/sw-template.js:29-31 (cache.add(...).catch(() => {}) silently drops a failed file) and :41-43 (activate deletes every other birdydex-shell-*)
- **Fix:** In install (sw-template.js:29-31), mirror v1 sw.js:33-38, which carries the previous release's copy forward:
```js
await Promise.all(PRECACHE.map(async (url) => {
  try { await cache.add(new Request(url, { cache: 'reload' })); }
  catch { const old = await caches.match(url, MATCH); if (old) await cache.put(url, old).catch(() => {}); }
}));
const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
if (PRECACHE.some(u => (u === '/index.html' || u.startsWith('/assets/')) && !have.has(u))) throw new Error('shell incomplete');
await self.skipWaiting();
```
New content-hashed /assets/* files have no older copy to carry forward. Failing the install for a missing index.html or asset keeps the old worker and shell in charge, and the browser retries the update later.
- **Evidence:** Simulated deploy through tools/vr-offline-sw-updproxy.mjs on :4407 with FAIL_RE '^/index\.html$' (503 during the B install), driven by tools/v2-offline-update.mjs:
- The proxy log shows 'FAIL503 /index.html'.
- After activation, shell-B has 34 entries but shellBHasIndex is false and caches.match('/index.html') is false.
- The offline launch shows 'Offline. BirdyDex has not been opened online yet.' (verify/v2-offline/update-test-upd3.json, update-upd3-offline-launch.png).
The identical install/activate code is on pre-port main (2a22d0a sw-template.js:15-17,27-30). v1 copies the old file forward (sw.js:33-38).

### 19. A new SW activates mid-session and deletes the old shell, so the running page can no longer load its lazy photoid chunk and Scan shows a misleading 'needs a download' error
- **Severity:** medium. **Source findings:** offline-sw:10
- **Where:** scripts/sw-template.js:32 (skipWaiting unconditionally in install), :41-43 (old shell deleted on activate), :186-188 ('skip-waiting' handler that no page code posts); lazy chunk src/core/scan.js:12 (new in the port); src/screens/field/Scan.tsx:129-131 (maps 'Failed to fetch dynamically imported module' to the download message)
- **Fix:** Simplest robust fix, in the activate handler (sw-template.js:37-47): before deleting an old 'birdydex-shell-*', copy each of its '/assets/' entries that the new SHELL lacks into SHELL. This is about 1 MB, so a page still running the previous release can lazy-load its chunk. Alternatively, keep the newest previous shell until the next activation. Also, in src/screens/field/Scan.tsx:129, detect /dynamically imported module|Importing a module script failed/ and show 'BirdyDex was updated. Reload to use Scan.' with a reload button, instead of the 104 MB download message. Optionally, remove skipWaiting from install and post 'skip-waiting' from src/main.tsx on the next launch, then reload on controllerchange. v1 avoids the problem with stable file names and a caches.match fallback across caches (v1 sw.js:121-127).
- **Evidence:** Reproduced with tools/v2-offline-midproxy.mjs (deploy B renames the photoid chunk and makes the old name 404, as on Vercel) and tools/v2-offline-midsession.mjs:
- Page A was open on #/dex with Scan not yet opened. reg.update() activated B (controllerchange), shell-A was deleted, and shell-B holds only photoid-NEWHASH0.js.
- Opening #/scan in the same page and pressing Identify: online, /assets/photoid-vG07EOoi.js returned 404; offline, net::ERR_FAILED.
- Both times the UI said 'Photo ID needs a one-time download of about 104 MB. Connect to the internet (Wi-Fi is best) and try again.', even online (verify/v2-offline/midsession-online.json, midsession-offline.json, midsession-*.png).
grep …

### 20. After a deploy, data reads return the previous release's files: birdydex-runtime-v3 is older than the new shell and wins caches.match
- **Severity:** medium. **Source findings:** offline-sw:6
- **Where:** scripts/sw-template.js:140-157 (data route: caches.match(request, MATCH) at :143 searches caches in creation order, so the persistent RUNTIME beats the new SHELL; the background refresh writes only to RUNTIME at :147-148)
- **Fix:** In the data route, prefer this release's shell, mirroring v1's own-shell-first lookup (v1 sw.js:71-72):
```js
const own = await (await caches.open(SHELL)).match(request, MATCH);
const cached = own || (await caches.match(request, MATCH));
```
When `own` hits, skip the RUNTIME background refresh (the file is per release). Keep the refresh only for data not in PRECACHE. The v1-equivalent alternative is network-first with a ~1.5 s timeout into SHELL (v1 FILE_WAIT sw.js:29, networkFirst :129-152).
- **Evidence:** Simulated deploy (tools/vr-offline-sw-updproxy.mjs on :4405 + tools/v2-offline-update.mjs, where tiers.json gains '__release':'new'):
- Cache order after the update: [birdydex-runtime-v3, birdydex-calls-v1, birddex-models, birdydex-photos-v3, birdydex-shell-B].
- shell-B holds 'new' and runtime-v3 holds 'old'.
- The first fetch('/data/tiers.json') after the deploy returns 'old'; the second returns 'new' (verify/v2-offline/update-test-upd.json).
Until an online read refreshes runtime-v3, offline launches run the new bundle on the old data. On pre-port main, data lived only in RUNTIME with the same stale-while-revalidate behaviour (2a22d0a sw-template.js:73-88), so the stale first read is not …

### 21. No navigation timeout: on weak signal the installed app waits for the network instead of opening from cache (20.2 s vs 4.4 s in v1)
- **Severity:** medium. **Source findings:** offline-sw:7
- **Where:** scripts/sw-template.js:111-131 (await fetch(request) at :115 with no timer; the cache is used only when fetch throws)
- **Fix:** Mirror v1 sw.js:28 (NAV_WAIT 4000) and :129-152 (networkFirst). In the navigation handler, start `const net = fetch(request)`, race it against a 4000 ms timer, and when the timer wins return the saved copy: `(await caches.match(request, MATCH)) || (await caches.match('/index.html', MATCH))`. Keep `event.waitUntil(net.then(res => { if (res.ok && isApp) return caches.open(SHELL).then(c => c.put('/index.html', res.clone())); }).catch(() => {}))` so a late answer still refreshes the cache. If nothing is saved, keep awaiting `net`.
- **Evidence:** HTML navigations held for 20 s by tools/vr-offline-sw-updproxy.mjs (HANG_HTML_MS=20000) with the SW installed, via tools/v2-offline-liefi.mjs: React (:4408 -> 4180) took 20203 ms to content and v1 (:4409 -> 8765) took 4361 ms (verify/v2-offline/liefi-react.json, liefi-v1.json). The same handler is on pre-port main (2a22d0a sw-template.js:56-69).

### 22. No way to prepare for the field: v1's 'Ready for the field' card and the SW shell-status/shell-fill messages were not ported, and the calls cache names disagree
- **Severity:** medium. **Source findings:** offline-sw:11
- **Where:** src/screens/progress/Settings.tsx:848-875 ('Use it offline': photos only); scripts/sw-template.js:186-188 (no 'shell-status'/'shell-fill' handler); src/core/media.js:249 CALLS_CACHE='birddex-calls' vs scripts/sw-template.js:15 CALLS='birdydex-calls-v1' (callClip at :74-75 reads only its own cache); unused helpers media.js:277-312 (callPackStatus, saveCallPack)
- **Fix:** 1) scripts/sw-template.js: add v1's message handler (v1 sw.js:50-66). shellStatus() compares caches.open(SHELL).keys() against PRECACHE, and 'shell-fill' re-runs the per-file precache (with the carry-forward from offline-sw:5) for missing entries, replying on e.ports[0] with {version, total, saved}. 2) Use one calls cache name: set sw-template.js:15 to 'birddex-calls' (same as media.js:249 and v1 sw.js:9). 3) src/screens/progress/Settings.tsx: replace the photos-only 'Use it offline' block with v1's 'Ready for the field' card. Port v1 js/app.js:2479-2489 (markup), :2574-2581 (FIELD rows app/photos/calls/maps/listen/scan), :2591-2682 (askWorker, listenSaved, checkField, FIELD_GET, fieldJob) and :2684+ (wireField). FIELD_GET.calls uses saveCallPack, maps counts 'birddex-tiles', listen uses loadListenModel from src/core/listen.js:15, and scan uses loadPhotoModel/isPhotoModelCached from src/core/photoid.js. The maps and photos rows depend on offline-sw:8.
- **Evidence:** grep over src: nothing calls saveCallPack or callPackStatus, nothing posts 'shell-status'/'shell-fill', and loadPhotoModel is reached only from Scan. Settings has only 'Download for offline' for photos (Settings.tsx:848-875). v1 Settings has the 'Ready for the field' card with six rows (v1 js/app.js:2482, FIELD at :2574). Offline Learn call rounds say 'Calls need a connection, and none are saved on this phone yet.' even after a clip was played online (verify/v2-offline/cold-react.json). With the SW reading only 'birdydex-calls-v1', clips saved by saveCallPack into 'birddex-calls' would not be served offline. The refreshed media.js and the SW calls cache both arrived with the port, and the …

### 23. Silhouettes never regain their colour and Zoom-in never pulls back after answering
- **Severity:** medium. **Source findings:** learn-parity:5
- **Where:** src/screens/learn/LearnPlay.tsx:42-45 (cls is fixed and 'is-revealed' is never added); the CSS that expects it is at src/screens/learn/learn.css:524-525, 534
- **Fix:** In Media (LearnPlay.tsx:42-45) append `${q.picked != null ? ' is-revealed' : ''}` to the lq-photo--sil and lq-photo--zoom class strings. Optionally add ' no-anim' when restoring an answered question. Mirror v1 js/learn.js:792-793.
- **Evidence:** Browser (tools/v2-learn-modes.mjs, verify/v2-learn/modes-react.json vs modes-v1.json): after answering in React, the silhouette figure class is 'lq-photo lq-photo--sil' with the fg filter still url("#lq-sil"), and the zoom fg transform is still matrix(2.8,…). In v1 the class is 'is-revealed', the filter is none and the transform is none. Screenshots: modes-react-silhouette-answered.png, modes-v1-silhouette-answered.png.

### 24. Answer feedback is not focused, announced or scrolled into view; options get no '(right answer)' text; focus drops to <body>
- **Severity:** medium. **Source findings:** learn-parity:6
- **Where:** src/screens/learn/LearnPlay.tsx:53/61/76 (options become `disabled`, so the focused button drops focus to body), :76-79 (no sr-only suffix), :107 (Feedback has tabIndex -1 but is never focused or scrolled), :331 (h1 not focused on a new question), :138 (results h1 not focused), Deck reveal :411-413 (.ld-back not focused)
- **Fix:** Options: replace `disabled={disabled}` with `aria-disabled={disabled || undefined}` (pick() already ignores repeat picks) and add `<span className="sr-only">{disabled ? (o.key === q.answer ? ' (right answer)' : o.key === picked ? ' (your answer)' : '') : ''}</span>`, as v1 js/learn.js:779-783 does. Feedback: give it a ref and, in a mount effect, `ref.current.focus({ preventScroll: true }); requestAnimationFrame(() => ref.current.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }))`, as v1 :800-803 does. On each new question and on results, focus the h1 if focus was inside the view (v1 :273-277 focusWithin/focusHead). In Deck, focus .ld-back on reveal (v1 :1073-1074).
- **Evidence:** Browser keyboard run (tools/v2-learn-results.mjs, verify/v2-learn/results-react.json vs results-v1.json): in React, after pressing Enter on an option, activeElement is BODY, the option sr text is empty, and the feedback bottom is 1021-1334 with viewport 844 (not scrolled into view). After Next, focus is on BODY. In v1, focus is on DIV.lq-fb, the feedback bottom is 714, options read ' (right answer)' / ' (your answer)', and focus moves to H1.lq-prompt after Next and H1.lh-title on results. Deck reveal: React active BODY vs v1 DIV.ld-back (seeded-react.json / seeded-v1.json deckBack).

### 25. Results screen opens scrolled half-way down (score ring off screen); new questions are not explicitly scrolled to top
- **Severity:** medium. **Source findings:** learn-parity:18, code-review:8
- **Where:** src/screens/learn/LearnPlay.tsx:295 (next) and :290 (rapid advance) and :273-276 (Results): nothing calls scrollTo. App.tsx:34-41 ScrollReset only fires on pathname change, and Next/Results keep the same route.
- **Fix:** In LearnPlay add `useEffect(() => { window.scrollTo(0, 0); }, [game?.i, isOver])`, where isOver is the Results condition. Do the same in Deck for queue changes and the done screen. Mirror v1 js/learn.js:277 (drawn() calls window.scrollTo(0,0) for every question, results and card).
- **Evidence:** Browser (verify/v2-learn/results-react.json): after 'See how you went', React results opened at scrollY 461 and 372, with the score ring above the fold (results-react-again-before.png). v1 is at 0. For Next question React ended at scrollY 0 in all 37 measured transitions (modes-react.json, results-react.json), because the shorter page clamps scroll. So the Next-question part only shows when the next page is long, e.g. with the stale call player (code-review saw 776->156). The Results part reproduces every time.

### 26. Look-alike duel and odd-one-out photos are never named after answering
- **Severity:** medium. **Source findings:** learn-parity:7
- **Where:** src/screens/learn/LearnPlay.tsx:61-63 (side name and aria-label use o.label only when q.named)
- **Fix:** In Options (LearnPlay.tsx:58-66): `const named = q.named || disabled; const suffix = disabled ? (o.key === q.answer ? ' (right answer)' : o.key === picked ? ' (your answer)' : '') : '';` then `aria-label={named ? `${o.label}${suffix}` : SIDES[n]?.[i] || `Photo ${i + 1}`}` and `<span className="lq-side-name">{named ? o.label : ''}</span>`. Mirror v1 js/learn.js:784-785.
- **Evidence:** Browser (verify/v2-learn/modes-react.json, duel): after answering, React sides are [{name:'', aria:'Photo on the left'},{name:'', aria:'Photo on the right'}]. In v1 (modes-v1.json) they are [{name:'Sacred Kingfisher'},{name:'Forest Kingfisher', aria:'Forest Kingfisher (right answer)'}]. Odd-one-out uses the same branch (q.options[0].photos).

### 27. Leaving a round through the feedback's species or Compare link and pressing Back throws the round away
- **Severity:** medium. **Source findings:** learn-parity:8
- **Where:** src/screens/learn/LearnPlay.tsx:203 (game is component state, lost on unmount) and :219-238 (the mount effect always builds a new round)
- **Fix:** Keep the active practice round in a module-level store with its route, as v1 does (js/learn.js:292 `let game`, :297 `if (game && game.route !== hash) game = null`, :305-307 reuse unless done). For example, add to src/core/learn.js `let active = null; export const getActive = () => active; export const setActive = g => { active = g; };`, and store `route: location.hash` on the game in newPracticeRound/newDailyRound. In the LearnPlay init effect, reuse `getActive()` when its route matches location.hash, before calling newPracticeRound. Clear it on Stop, Back to Learn, Play again and hub mount (v1 renderHub sets game = null at :455).
- **Evidence:** Browser (tools/v2-learn-midround.mjs, verify/v2-learn/midround-react.json vs midround-v1.json): at Q2 '2/10' (answered, feedback shown), tapped the species name (#/bird/7), then Back. React showed '1/10', a different clue and no answer. v1 restored '2/10' with the same clue and the feedback.

### 28. Quick-play mode cards never show the saved best score or best streak
- **Severity:** medium. **Source findings:** learn-parity:9, code-review:20
- **Where:** src/screens/learn/Learn.tsx:203-218 (mode card markup has no .lh-best); bestKey is private in src/core/learn.js:141
- **Fix:** Export bestKey from src/core/learn.js:141. In Learn.tsx:204-216 compute `const b = L?.best?.[bestKey(m, prefs)]` and, inside .lh-mode-top after the icon, render `{b != null && <span className="lh-best">{m === 'rapid' ? 'Best streak' : 'Best'} <b>{b}</b>{m === 'rapid' ? null : <span>/{ROUND}</span>}</span>}`. Mirror v1 js/learn.js:544, 550.
- **Evidence:** Browser with seeded kv 'learn'.best {photo:7, whoami:6, rapid:12} (tools/v2-learn-seeded.mjs, verify/v2-learn/seeded-react.json vs seeded-v1.json): React mode cards show no best at all. v1 shows 'Photo: Best 7/10', 'Who am I?: Best 6/10' and 'Rapid fire: Best streak 12'.

### 29. 'Test me on this' is missing: #/learn/test/:id is Not found and the species page has no link or mastery mark
- **Severity:** medium. **Source findings:** learn-parity:11, code-review:20, runtime-sweep:3
- **Where:** src/App.tsx:72-76 (no learn/test route); src/screens/learn/LearnPlay.tsx:9 (testSet imported but unused); src/screens/Bird.tsx:103-128 (no Test me button or mastery mark)
- **Fix:** Add `<Route path="/learn/test/:id" element={<LearnPlay fixedPack="test" />} />` in App.tsx. In LearnPlay, when pack === 'test', build `newPracticeRound('quick', { ids: testSet(Number(params.id)), testId: Number(params.id) })`, redirect to /learn for an unknown id, and use the same for Play again (v1 js/learn.js:300-305, :921). In src/screens/Bird.tsx after the facts <dl> (~:128) add `<Link className="btn spot-test" to={`/learn/test/${sp.id}`}>Test me on this</Link>` (v1 js/app.js:1512) and the mastery mark from masteryOf() (v1 js/app.js:1443, 1578).
- **Also (The v1 route #/learn/test/:id ('Test me on this') has no React route or species-page …):** Add <Route path="/learn/test/:id"> that starts a testSet(id) round, and add the 'Test me on this' button to Bird.tsx.
- **Evidence:** Browser (verify/v2-learn/cold.json): React #/learn/test/57 renders 'Not found. This screen is still being ported to React.' v1 starts 'Test me / Grey-tailed Tattler and its look-alikes' 1/5. midround-react.json: on #/bird/7 there is no a[href*=learn/test] and no [data-mastery]. v1 (midround-v1.json) has 'Test me on this' and data-mastery.

### 30. Big call player's play/pause button has no icon (bare <path> outside an <svg>)
- **Severity:** medium. **Source findings:** learn-parity:12, code-review:19, runtime-sweep:10
- **Where:** src/screens/learn/QuizMedia.tsx:100 (`<span>{state === 'playing' ? QI.pause : QI.play}</span>`)
- **Fix:** QuizMedia.tsx:100: `<span><svg viewBox="0 0 24 24" aria-hidden="true">{state === 'playing' ? QI.pause : QI.play}</svg></span>`, matching how the feedback buttons wrap QI.play (LearnPlay.tsx:115). v1 renders I.play as a full svg (js/learn.js:213).
- **Also (Quiz call player's play/pause glyph never renders (bare <path> inside a <span>, not an …):** <span><svg viewBox="0 0 24 24" aria-hidden="true">{...}</svg></span>
- **Evidence:** Browser (verify/v2-learn/call-react.json icon): innerHTML '<span><path d="M8 5v14l11-7z" …></path></span>', with no svg. The path's namespaceURI is http://www.w3.org/1999/xhtml and its box is 0x0. v1 (call-v1.json) has an svg and an 18x23 path. Screenshot call-react-q1.png shows a plain disc.

### 31. Review deck card always says 'Box 1' and shows raw habitat codes
- **Severity:** medium. **Source findings:** learn-parity:13, code-review:7
- **Where:** src/screens/learn/LearnPlay.tsx:407 (c.box, but newDeckRound at src/core/learn.js:196-201 drops box) and :420 (sp.habitats.map(h => h))
- **Fix:** LearnPlay.tsx:407: `Box {getLearn()?.cards?.[c.id]?.[c.skill]?.box || 1}` (getLearn is already imported). :420: `sp.habitats.map((h) => HABITATS[h]).join(', ')`, importing HABITATS from '../../lib/data' (lib/data.ts:29). Mirror v1 js/learn.js:1037 and :1047.
- **Evidence:** Browser with a due box-3 card for species 57 (verify/v2-learn/seeded-react.json vs seeded-v1.json): React kicker 'Review deckBox 1, by sight' and 'Where: c'. v1 'Box 3, by sight' and 'Where: Coast & mangroves'. Screenshot seeded-react-deckcard.png.

### 32. A failed photo's fallback index carries over, so later questions never try their own photos
- **Severity:** medium. **Source findings:** learn-parity:14, code-review:4
- **Where:** src/screens/learn/QuizMedia.tsx:24-26 (useState(0) is never reset when photos change) + src/screens/learn/LearnPlay.tsx:334 (<Media> is not keyed, so PhotoBox is reused across same-type questions); same in Deck :410 and duel options :62
- **Fix:** Key per question: `<Media key={game.i} q={q} />` (LearnPlay.tsx:334), plus keys on the Deck PhotoBox (:410) and the duel PhotoBox (:62, e.g. key={`${game.i}-${o.key}`}). Also make PhotoBox self-resetting: `useEffect(() => setI(0), [photos?.[0]?.src])`, or have callers pass `key={photos?.[0]?.src}`. v1 redraws each question and photoHTML/wireImages starts every question's chain at its first photo (js/learn.js:233-262).
- **Evidence:** Browser (tools/v2-learn-photobox.mjs, verify/v2-learn/photobox-react.json vs photobox-v1.json): remote images were aborted during Q1 only (64 requests). After allowing them, React Q2 made 0 image requests and showed 'This photo needs a connection…' at once. v1 Q2 made 2 requests and showed its photo.

### 33. 'Hear its call' / 'Hear it again' adds a second full player that stays for the rest of the round
- **Severity:** medium. **Source findings:** learn-parity:15, code-review:9
- **Where:** src/screens/learn/LearnPlay.tsx:296-301 (play sets quickCall), :339 (renders a second CallPlayer at the bottom of the screen), :295 / :290 / :302-311 (never cleared)
- **Fix:** Play inline from the feedback button as v1 does (js/learn.js:728-735 call playCall on the pressed [data-play] button; feedback buttons at :823-824). For example, a small usePlayer hook in QuizMedia that plays/pauses one Audio and swaps the button icon. At minimum, call setQuickCall(null) in next(), in the rapid advance, in restart/startWithIds and on unmount, and stop its audio.
- **Evidence:** Browser (verify/v2-learn/call-react.json): after 'Hear it again' on Q1 there are 2 .lq-call players, still 2 on Q2-Q4 (playersOnNext 2), and the extra player did not start playing (newPlays []). v1 (call-v1.json) keeps 1 player, and the button plays the clip at once.

### 34. Pack completion ring and 'N got right' count species that are not in the pack
- **Severity:** medium. **Source findings:** learn-parity:16
- **Where:** src/core/learn.js:136 (`got: (st.got || []).filter(id => byId.has(id)).length`); answer() at :211 adds odd-one-out/duel option species from any group to got
- **Fix:** src/core/learn.js:134-137: `const list = Q.packSpecies(p.key), ids = new Set(list.map(s => s.id)); … got: (st.got || []).filter(id => ids.has(id)).length`. Mirror v1 js/learn.js:583-584 (`list.filter(s => got.has(s.id))`).
- **Evidence:** Browser with packs.backyard.got=[1,2,3,5,8] (verify/v2-learn/seeded-react.json vs seeded-v1.json): React aria 'Backyard birds. 73 species, 5 got right…' with ring 7%. v1 says '1 got right' with ring 1%.

### 35. Learn hub hides the review deck when cards exist but none are due
- **Severity:** medium. **Source findings:** code-review:6, learn-parity:21
- **Where:** src/screens/learn/Learn.tsx:66 (`cards = dueCards()`), :222-233 (tile, 'Open/Set up' link and text all keyed on due cards; is-due always on; no aria-label)
- **Fix:** Learn.tsx:66: `const cards = ready ? allCards() : []; const due = ready ? dueCards().length : 0;` (import allCards). Link text `{cards.length ? 'Open' : 'Set up'}`. Tile shown when cards.length, with className `lh-deck${due ? ' is-due' : ''}` and aria-label `${due} ${due === 1 ? 'card' : 'cards'} due. Open the review deck`. Strong text: `due ? `${due} ${due === 1 ? 'card' : 'cards'} to review` : 'Nothing due right now'`. Mirror v1 js/learn.js:463 and :478-483.
- **Evidence:** Browser with 2 cards due in 3 and 5 days (verify/v2-learn/seeded-react.json vs seeded-v1.json): React hub link 'Set up', no tile, and the empty text 'Species you miss in a round land here…'. v1 link 'Open', tile 'Nothing due right now' with aria '0 cards due. Open the review deck'.

### 36. A call clip that fails to play fails silently: no 'would not play / needs a connection' message and no field-notes hint
- **Severity:** medium. **Source findings:** learn-parity:22, code-review:12
- **Where:** src/screens/learn/QuizMedia.tsx:80-91 (onerror and play() rejection just reset to 'idle'); src/screens/learn/LearnPlay.tsx:46 (no field-notes hint for call questions)
- **Fix:** In CallPlayer add an onFail prop and a message state. On a.onerror or a play() rejection set the status to `navigator.onLine ? 'That recording would not play.' : 'This recording needs a connection.'` and call onFail. In LearnPlay Media for type 'call', render a hidden `<p className="lq-hint">Field notes: {cleanClue(Q.blankNotes(sp, q.wrong || []))}</p>` and reveal it from onFail while q.picked == null. Mirror v1 js/learn.js:191-198 (fail), :681 (data-callhint) and :734. The audioUrl() part of code-review:12 is not needed for current data (see evidence).
- **Evidence:** Browser with call clips aborted (tools/v2-learn-callfail.mjs, verify/v2-learn/callfail-react.json vs callfail-v1.json): after tapping play, React status is 'Tap to listen' with no hint. v1 status is 'That recording would not play.' and the hint shows 'Field notes: Grey hood and clean white underparts…'. Refuted sub-claim: every remote clip in public/data/seq.json is images.ala.org.au (527/527). media.js:313-315 audioUrl streams ALA directly and never caches it, and the SW callClip (sw-template.js:72-80) caches local clips on play. So no remote clip is counted as saved and then fails offline.

### 37. Changing the photo while a scan runs shows the old photo's result under the new photo, and picks never revoke their object URLs
- **Severity:** medium. **Source findings:** scan-photoid:3, code-review:15
- **Where:** src/screens/field/Scan.tsx:77-97 (pick: no 'latest pick wins' ticket, and the previous photo.url is never revoked; the only revoke is in the catch at :94). :105-134 (identify: no check that the photo is still current before setResult, setLogAt or setYours; makeYours(photo, …) uses the stale closure). :220 (the Change photo input stays active while busy). src/core/scan.js:38-43 (identifyScan logs the scan before the caller can check).
- **Fix:** In Scan.tsx, add `const picks = useRef(0)` and `const currentFile = useRef<File | null>(null)`.
In pick(): `const ticket = ++picks.current`. After img.decode(), `if (ticket !== picks.current) { URL.revokeObjectURL(url); return; }`. Then revoke the previous photo.url before setPhoto and set currentFile.current = file. This mirrors v1 js/scan.js:223, 236-237 and 460-462. In the catch, only set the error status when ticket === picks.current (v1 scan.js:233).
In identify(): `const file = photo.file`. In onProgress, return early when currentFile.current !== file (v1 scan.js:278). After identifyScan resolves, `if (currentFile.current !== file) return;` before setResult, setLogAt and setYours (v1 scan.js:285). Move the logScan call out of identifyScan (core/scan.js:41) and call it after that check, so a stale run is not logged (v1 logs at scan.js:290, after the check).
Revoke the URL when the session is reset or expires (see the persistence item). Do not revoke on every unmount if the session is kept.
- **Evidence:** Script tools/v2-scan-main.mjs, race step: pick 11_4.jpg, Identify, then after 200 ms set 306_3.jpg on 'label.scan-change input' and wait 15 s. Output: verify/v2-scan/{react,v1}-main.json, react-race.png and v1-race.png.
React: stage dims went from 650x434 (duck) to 488x650 (fig), stageIsDuck false, but the verdict is 'Likely: Chestnut Teal' with cards Chestnut Teal, Grey Teal and Hardhead. The Change input was not disabled while busy (busyAtChange.changeDisabled false). The screenshot shows a fig leaf in the viewfinder, a 99% Chestnut Teal ring and duck 'Yours' tiles on every card, so 'This one' would log a teal against the fig photo.
v1: verdict null, cards [], status 'Photo ready…', …

### 38. Scan forgets the photo and result on any navigation (species link, tab switch, This one → Cancel); the 30-minute KEEP_MS check is dead code
- **Severity:** medium. **Source findings:** scan-photoid:4, code-review:14
- **Where:** src/screens/field/Scan.tsx:13, 32-44 (all session state is per-mount useState), 55-58 (the KEEP_MS check reads `at`, which is always 0 on mount)
- **Fix:** Add a module-level session in Scan.tsx, or in a new src/screens/field/scanSession.ts: `let S = { kind: '' } as { at?, file?, blob?, url?, W?, H?, box?, whole?, kind, result?, yours?, logAt? }`. Initialise every useState from S, and write each change back to S (or keep the session in a useSyncExternalStore). On mount, `if (S.at && Date.now() - S.at > KEEP_MS) resetScan()`, where resetScan revokes S.url and keeps only S.kind. This mirrors v1 js/scan.js:8, 12, 24 and 460-463. When the screen mounts with a stored result, render it without the rise animation and without moving focus (v1 drawResult(false), scan.js:454-456). Remove the dead check at Scan.tsx:55-56.
- **Evidence:** tools/v2-scan-main.mjs: result → species link #/bird/11 → Back. React shows photo 0 and verdict null. v1 shows photo 1 and verdict 'Likely: Chestnut Teal'.
tools/v2-scan-extra.mjs: #/scan → #/dex → #/scan. React photo 0 and verdict null; v1 photo 1 and verdict 'Likely: Chestnut Teal'. After This one → Cancel, React is on #/lists with the scan lost, while v1 stays on #/scan with photo and verdict.
Outputs: verify/v2-scan/{react,v1}-main.json and {react,v1}-extra.json.
Code: `at` is component state initialised to 0 (line 44), so `if (at && …)` at line 56 can never be true.
The pre-port React Scan did not keep state either. The port's rewrite added KEEP_MS but never wired it, so I classify …

### 39. Reference photo credits (iNaturalist/ALA attribution) are missing from the comparison cards
- **Severity:** medium. **Source findings:** scan-photoid:5
- **Where:** src/screens/field/Scan.tsx:256-273. scanRefs() at src/core/scan.js:74-78 returns credit and from, but the card never renders them.
- **Fix:** In the card map in Scan.tsx, after `const refs = scanRefs(sp.id)`, add `const credits = refs.filter(p => p.credit).map(p => String(p.credit).slice(0, 40))`. Render this as the first child of .scan-card-body: {credits.length > 0 && <p className="scan-credit">Photos: {words(credits, 'and')}{refs.some(p => p.from && p.credit) ? ` (${refs.find(p => p.credit)?.from || ''})` : ''}</p>}. This mirrors v1 js/scan.js:358 and 366. The .scan-credit style already exists (scan.css:275).
- **Evidence:** tools/v2-scan-main.mjs, run.after for 11_4.jpg. v1 credits: ['Photos: Ron Dowling and Ashton Curtis (iNaturalist via ALA)', 'Photos: Alexander Gibson and Lochran Doherty (iNaturalist via ALA)', 'Photos: brits_walking and Connor Wyllie (iNaturalist via ALA)']. React credits: [] for the same three cards (verify/v2-scan/{react,v1}-main.json).
Code: there is no scan-credit anywhere in Scan.tsx. The data is available, because scanRefs maps credit and from (core/scan.js:75). The photos are licensed and need attribution, so this is more than polish.

### 40. Result is not focused or scrolled into view, the 'Also worth comparing' heading is missing, download progress isn't announced, and 'Pick a kind' / 'Try a tighter box' don't move the user
- **Severity:** medium. **Source findings:** scan-photoid:6
- **Where:** src/screens/field/Scan.tsx:105-127 (no scrollIntoView on start, no quarter statuses in the ensureModel callback at :114, no focus or scroll after setResult at :124-127). :255-277 (one flat card list, no .scan-also). :281-282 ('Try a tighter box' and 'Pick a kind' only set status).
- **Fix:** 1) In identify(), right after setStatus('Starting photo ID…'), scroll .scan-work into view with block 'nearest' (smooth unless reduced motion), as v1 js/scan.js:255 does.
2) In the ensureModel progress callback, keep a `said` variable and, when f - said >= 0.25 && f < 1, set said = Math.floor(f * 4) / 4 and setStatus(`Downloading photo ID: ${Math.round(said * 100)}% done.`). This mirrors v1 scan.js:263-268.
3) Add a fresh-result flag set in identify(). In a useEffect on it: document.getElementById('scan-verdict')?.focus({ preventScroll: true }) and resultRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }) on the .scan-result section. This mirrors v1 scan.js:408-412.
4) In .scan-cards, render top.slice(0, lead), then, when top.length > lead, <h3 className="scan-also">{lead ? 'Also worth comparing' : 'Closest matches'}</h3>, then top.slice(lead). This mirrors v1 scan.js:396-399.
5) 'Pick a kind': give .scan-kinds a ref, scrollIntoView({ block: 'center' }) and focus its [aria-pressed="true"] chip, as v1 scan.js:445-449 does.
6) 'Try a tighter box': scroll the stage into view with block 'center' and focus it with preventScroll, as v1 scan.js:440-441 does.
- **Evidence:** tools/v2-scan-main.mjs, 390x844, first run with model download (verify/v2-scan/{react,v1}-main.json).
After the result, React has focus on BODY, scrollY 0, and #scan-verdict top at 619 of 844, under the sticky Identify button and tab bar. v1 has focus on #scan-verdict, scrollY 569 and the verdict top at 100.
React .scan-also is null; v1 shows 'Also worth comparing'.
Statuses seen: React only 'Getting photo ID ready…' then 'Looking closely…'. v1 also shows 'Downloading photo ID: 50% done.' and '75% done.'.
React clears the status and does not move focus, so a screen reader hears nothing when the result arrives.
tools/v2-scan-extra.mjs pickKind: React focus stays on BODY, kinds are not in …

### 41. Crop-box gestures differ from v1: corner resize is centred and doubled, there is no pinch or small-box handling, and 'Try a tighter box' from Whole photo shrinks the box
- **Severity:** medium. **Source findings:** scan-photoid:7
- **Where:** src/screens/field/Scan.tsx:142-168 (single-pointer handlers; resize = |p - centre| * 2 around a fixed centre; no pointer map, so no pinch; no is-active or scan-stage--drag classes). :281 ('tighter' always multiplies s by 0.75 and always says 'Move the box'). The box at :209 never gets scan-box--small.
- **Fix:** Port v1 wireStage (js/scan.js:151-210) into Scan.tsx's pointer handlers.
Keep a `pts = useRef(new Map<number, {x, y}>())`. With two pointers, mode = 'pinch' with start { d: hypot, s }, and s = start.s * hypot / start.d (v1 163-165, 181-183).
On a handle, anchor the opposite corner: sx = c.includes('e') ? 1 : -1, sy = c.includes('s') ? 1 : -1, ax = cx - sx*s/2, ay = cy - sy*s/2. On move, s = max((p.x - ax)*sx, (p.y - ay)*sy), clamped to the photo edge, then cx = ax + sx*s/2 and cy = ay + sy*s/2. Work in image pixels (v1 166-170, 184-188). When one pinch finger lifts, fall back to move (v1 194).
Toggle .is-active on the grabbed handle and .scan-stage--drag on the stage (v1 170, 175, 195).
Add scan-box--small when the box is under 110 px on screen (v1 144-146).
'Try a tighter box': `const wasWhole = whole; if (!wasWhole) shrink s by 0.75; setWhole(false); setStatus(`Move the ${wasWhole ? '' : 'smaller '}box onto just the part you want named, then choose Identify.`)` (v1 436-443).
Keyboard: step = 5% of the short side, or 1% with Shift (v1 201).
- **Evidence:** tools/v2-scan-main.mjs gesture step: drag the SE handle 40 px up and left. React box {x 85.5 → 125.5, w 219 → 139}: the top-left moved and the width shrank by 80. v1 {x 85.5 → 85.5, y fixed, w 219 → 179}: the anchor stays put.
Compared with v1's tighter.fromWhole: React's box went from width 56.3077% to 42.2308%, and v1 kept 56.3077%. tools/v2-scan-extra.mjs tighterFromBox: React status 'Move the box onto…', v1 'Move the smaller box onto…'.
Outputs: verify/v2-scan/{react,v1}-main.json and {react,v1}-extra.json.
Pinch and small-box handling: proven from code. Scan.tsx tracks one pointer id (drag.current.id) and has no scan-box--small; v1 scan.js:152-165 and 146 have both. Without them, a …

### 42. Opening a profile link (#/u/<id>) on a cold start while signed in shows 'Sign in to see other people's profiles' and never recovers
- **Severity:** medium. **Source findings:** me-accounts:2, code-review:13
- **Where:** src/screens/me/PublicProfile.tsx:21-31 (signedIn() checked once in an effect keyed on publicId)
- **Fix:** Subscribe to onAuth (or re-run the effect when user() changes), or wait for initAccount/accountStarted before deciding the visitor is signed out.
- **Also (A shared profile link opened cold by a signed-in user is stuck on 'Sign in to see other …):** Make PublicProfile re-run its load when auth settles or changes. In src/core/account.js, add `let settleAuth; export const authSettled = new Promise(r => { settleAuth = r; });` and call settleAuth() after `restoring = false` (account.js:34), and also at the end of initAccount when !configured. In PublicProfile.tsx, add `const [authTick, setAuthTick] = useState(0); useEffect(() => { let alive = true; const off = onAuth(() => { if (alive) setAuthTick(t => t + 1); }); authSettled.then(() => { if (alive) setAuthTick(t => t + 1); }); return () => { alive = false; off(); }; }, []);` (onAuth comes from core/cloud.js). In the load effect, keep state 'loading' (not 'signedout') while auth has not settled and nobody is signed in, and add authTick to the deps: [publicId, authTick]. Leaderboard.tsx:91-110 already handles this case with onAuth plus startAuth. This mirrors v1 js/account.js:25-34, …
- **Evidence:** Confirmed in code and in a browser run. This is a port regression: v1 recovers, React does not. On a cold start, PublicProfile.tsx checks signedIn() once, in an effect that only re-runs when publicId changes (src/screens/me/PublicProfile.tsx:21-31; the check is line 24). That effect runs before the session has been restored. In fact it runs before initAccount() has even been called: React runs child effects before parent effects, and App calls initAccount() from its own effect (src/App.tsx:58-61). initAccount() is also called there with no onChange, so nothing in the React tree re-renders when startAuth() restores the session (src/core/account.js:33-35, src/core/cloud.js:30-46). …

### 43. The cached profile row (me:cloud) is written but never read back, so offline or cold starts lose the photo avatar, 'Member since', the public-profile link and the show_dex state
- **Severity:** medium. **Source findings:** me-accounts:3, data-safety:4, code-review:21
- **Where:** src/core/profile.js:14-35 (cloud starts null; initProfile never does db.kvGet('me:cloud')); src/screens/me/Me.tsx:169
- **Fix:** In initProfile, load cloud = await db.kvGet('me:cloud') as v1 initMe does. Port openMyProfile, using myPublicId() from profile.js, for the no-publicId case.
- **Also (Cached profile row (me:cloud) is never restored, so 'View my public profile' is a dead …):** 1) In src/core/profile.js initProfile, before the signedIn()/fetchCloud step, load the cache once: `if (!cloud) cloud = (await db.kvGet('me:cloud').catch(() => null)) || null;`. getMyCloud() already checks the uid, so a cached row from another account is ignored. This mirrors v1 js/me.js:56. 2) In src/screens/me/Me.tsx:169, when m?.publicId is missing, render a button (or a Link whose onClick calls preventDefault) that runs an openMyProfile like v1 js/me.js:350-356. It should call `if (!navigator.onLine) { show 'Your public profile needs a connection.'; return; }`, then `const id = await myPublicId();` (profile.js:135), then `id ? navigate(`/u/${id}`) : show "Your profile hasn't reached the cloud yet. Try again in a minute."`. Use the useNavigate that Me.tsx already imports (Me.tsx:50) and show the message in a small role=status line. v1 references: js/me.js:225 and :276. 3) Optional, …
- **Evidence:** I confirmed this in the code and in the browser, and it is a regression introduced by the port. In src/core/profile.js, line 15 starts `cloud` as null. initProfile (lines 25-35) loads only localProfile() and then calls fetchCloud. fetchCloud returns early when navigator.onLine is false (line 50) and keeps `cloud` null when the request fails (line 57). The only use of 'me:cloud' anywhere in src/ is the db.kvSet write at line 64. Nothing reads it back. v1 reads it on start: js/me.js line 56 does `[prof, cloud, notNow] = await Promise.all([localProfile(), db.kvGet('me:cloud'), ...])`. So whenever the profiles fetch cannot run, the React Me hub and Edit profile lose the cached photo avatar, the …

### 44. The sign-up nudge after the third saved sighting (nudgeAfterSave) was not ported
- **Severity:** medium. **Source findings:** me-accounts:4
- **Where:** src/screens/lists/shared.tsx:182 saveSighting (no nudge call); 'nudge' does not appear anywhere in src
- **Fix:** Port nudgeAfterSave, including the me:nudged kv flag, waiting for the celebration or open sheet, the 20 s auto-hide and the announce. Call it after every save.
- **Evidence:** Confirmed by code and by my own run through the real UI of both apps. In v1, a guest's third save shows a one-time "Back up your sightings" banner. The React port has no code for it. The banner was added in the refresh: it is not on v1 main, so the React main never had it. js/me.js was in scope for the port brief (docs/port-refresh.md step 5), and the status report neither lists it as done nor as left out. Nothing here is environmental: Supabase was blocked in both runs, there were no console errors, and v1 needs no network to show the banner because `configured` is just a check that the URL and key constants are set. The sign-up path itself still works in React through the Me join card …

### 45. The guest invitation has no 'Not now' and no slim 'Back up your dex' card, and the Me tab has neither the guest dot nor the signed-in avatar
- **Severity:** medium. **Source findings:** me-accounts:5, visual-parity:14
- **Where:** src/screens/me/Me.tsx:127-138; src/components/TabBar.tsx:38-71 (me:notnow and tab-dot do not appear anywhere in src)
- **Fix:** Port joinCard's notNow branch with the me:notnow kv flag, and paintTab (dot, aria-label, avatar) in TabBar.
- **Also (Me (guest): the 'Not now' button on the sign-up card is missing, so the slim card and dot …):** In Me.tsx load the kv flag with db.kvGet('me:notnow'). Under .me-join-acts add <button type="button" className="btn btn--quiet me-join-later" onClick={async()=>{await db.kvSet('me:notnow', true); setNotNow(true);}}>Not now</button>, mirroring birding-refresh js/me.js:334 and :275. When notNow is true, render the slim card from js/me.js:319-326 (section.me-join.me-join--slim with mini fan, 'Back up your dex', '{n} species saved on this phone only.' and a small 'Sign up' button). Have TabBar read the same flag to hide the tab dot (see the Tab bar item). The medal strip needs no change.
- **Evidence:** I reproduced it in both the code and the browser, and it is a port regression. In v1 a guest can dismiss the invitation with 'Not now'. That choice is saved, the card shrinks to 'Back up your dex' and the guest dot and aria-label leave the Me tab. v1 also shows the user's avatar in the tab once they sign in. The React port has none of this: its TabBar is a fixed icon that ignores account state, and Me.tsx has no notNow branch. The cause is in the code, not the environment: the photo blocks and timing are unrelated. It is not a crash or data risk, but it is a clear behaviour gap with v1 that every guest sees, so medium is right. The fan order and filler-pick differences are real but minor …

### 46. Profile photos never show on leaderboard rows or in the Settings account card
- **Severity:** medium. **Source findings:** me-accounts:6, me-accounts:8, code-review:22
- **Where:** src/screens/progress/Leaderboard.tsx:24-35 (LeaderRow has no avatar_path), 57-68 and 303 (LeaderAvatar uses speciesId only); src/screens/progress/Settings.tsx:126-144 and 693 (AccountAvatar ignores the photo)
- **Fix:** Add avatar_path to LeaderRow and render <img src={avatarUrl(path)}> with the acct-av--photo class, as Me.tsx's Avatar does. Do the same in Settings using getMyCloud()?.avatarPath.
- **Also (Public profile rings are always about 3% full and lose the 'of N' total):** Reuse the Me hub ring markup: total = ofKind(k).length, p = Math.max(n ? .03 : 0, n/total), plus the 'of {total}' span and the 'n of total kind' sr-only text.
- **Also (Public profile rings are stuck at 3% and leaderboard rows never show profile photos):** PublicProfile.tsx: import ofKind from '../../lib/data'. In the rings map, use `const total = ofKind(k).length; const p = total ? Math.max(n ? 0.03 : 0, n / total) : 0;`, set style `'--p': p.toFixed(4)`, change the sr-only text to `{n} of {total} {KINDS[k]?.label.toLowerCase()}`, and add `<span className="me-ring-of" aria-hidden="true">of {total}</span>` after .me-ring-l. This copies Me.tsx:146-156, which mirrors v1 js/me.js:167-175. Leaderboard.tsx: add `avatar_path?: string | null` to LeaderRow, give LeaderAvatar a `path` prop, and when it is set render `<span className="acct-av acct-av--photo"><img src={avatarUrl(path)} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.remove()} /></span>`, otherwise the current species or letter. avatarUrl comes from core/profile.js:87. Pass path={row.avatar_path} at :303. This mirrors v1 js/account.js:41-46 (avatarHtml) and :322.
- **Note:** Also fix the public profile rings (stuck at 3%, missing "of N").
- **Evidence:** I confirmed it in the code and in a browser run against both apps. When get_leaderboard returns an avatar_path, v1 shows the photo on leaderboard rows and in the Settings account card. The React port never shows it there and falls back to the species picture or a letter. The bug is in the React port only. It is not caused by the ALA photo blocks or by the test harness: the mocked photo URL loaded fine in v1 and on the React Me page in the same run. It is not a crash or a data risk, but it is a clear parity gap with v1 and it breaks a promise the port makes on screen, so medium.

### 47. Photo avatar upload has no 'Frame your photo' step; React silently centre-crops
- **Severity:** medium. **Source findings:** me-accounts:7
- **Where:** src/screens/me/EditProfile.tsx:68-86
- **Fix:** Port the crop sheet as a Sheet component: same transform maths, then squareJpeg(img, -tx/sc, -ty/sc, S/sc).
- **Evidence:** I confirmed this from the code and the built bundle. In v1, picking a file runs openCrop (birding-refresh js/me.js:399-402). That opens a "Frame your photo" sheet where you can drag, pinch, scroll the wheel, use the arrow and +/- keys, or move a zoom slider, with a circular mask, Cancel and "Use this photo". It then uploads squareJpeg(img, -tx/sc, -ty/sc, S/sc) (js/me.js:447-543). The React upload() in src/screens/me/EditProfile.tsx:68-86 resizes the file and then crops it straight away. Lines 78-79 take the centred min(w,h) square and upload it immediately. There is no preview, no way to adjust and no cancel. The port's own brief (docs/port-refresh.md:50) lists "profile edit with photo …

### 48. The sync line in the Me hero never updates, and the first-sign-in backup banner is missing
- **Severity:** medium. **Source findings:** me-accounts:9
- **Where:** src/screens/me/Me.tsx:73 and 122 (syncStatus() read at render, with no onStatus subscription); account.js paintBanner was not ported (no .sync-banner in src)
- **Fix:** Subscribe Me (and EditProfile's status line) to onStatus. Render a global sync banner in App while state === 'migrating'.
- **Evidence:** I confirmed both halves, in the code and in a side-by-side browser run against v1.

1. The Me hero sync line goes stale. src/screens/me/Me.tsx:73 calls syncStatus() once per render, and line 122 prints the result. Nothing in Me subscribes to onStatus. App.tsx:60 calls initAccount() with no onStatusChange callback, so App never re-renders on a status change either. Me only re-renders when the profile changes, when sightings or outings change, or when it remounts. EditProfile has the same pattern at src/screens/me/EditProfile.tsx:45 and :135. In my run the React hero kept saying "Checking your account…" (state migrating) after the real status had moved to "Offline, will sync". v1 updated in …

### 49. Tab bar: no span.tab-ico (so no active pill), different Learn icon, no Me 'not signed in' dot or avatar, and no tab marked current on sub-routes (#/bird, #/scan, #/lists, #/stats, #/badges, #/settings)
- **Severity:** medium. **Source findings:** visual-parity:8, runtime-sweep:8
- **Where:** src/components/TabBar.tsx:4-75; src/styles/app.css:496-501 (.tab-ico pill CSS unused); src/screens/me/me.css:254 (.tab-dot CSS unused)
- **Fix:** In TabBar.tsx wrap each non-plus icon in <span className="tab-ico"><svg/></span>, per birding-refresh index.html:60-75. Replace the Learn icon paths with v1's single path 'M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10' (index.html:63). Replace NavLink's automatic aria-current with useLocation() and v1's tabFor map (app.js:941): bird, dex, compare, listen, scan to dex; learn, quiz to learn; map to map; me, u, lists, list, patch, targets, outing, log, stats, badges, settings, leaderboard to me; default dex. Set aria-current='page' on the match and 'false' elsewhere, including the plus. Port paintTab (birding-refresh js/me.js:104-114): when configured && !signedIn && !notNow render <i className="tab-dot" aria-hidden/> in the Me tab-ico and set aria-label 'Me, not signed in'; when signed in show the avatar. notNow is the db kv 'me:notnow' flag set by the Me 'Not now' button (see the Me item).
- **Also (Tab highlight does not follow v1's section mapping; no tab is current on species, …):** Compute the active tab from the first path segment with v1's tabFor table and set aria-current yourself.
- **Evidence:** Browser (probe.json, rx light): every tab has ico:false and no tab-dot. On #/bird/1, #/lists and #/settings all tabs have aria-current null. v1: Dex is current on #/bird/1 and #/scan, Me on #/lists, #/settings and #/me, each with a tab-ico, and Me has the dot (configured, guest). The React Learn path is 'M4 6.5A2.5 2.5 0 0 1 6.5 4H11v16…' (open book); v1 is stacked cards. No src file renders tab-dot (grep finds only the me.css rule). The port changed TabBar (tabs now Dex/Learn/+/Map/Me), which moved Lists, Badges and Settings under Me without marking Me current there.

### 50. Tab view transitions animate the old page, then the new page cuts in; quick taps throw unhandled 'Transition was skipped' rejections
- **Severity:** medium. **Source findings:** code-review:18
- **Where:** src/main.tsx:16 (HashRouter without useTransitions={false}); src/components/Motion.tsx:46-62 (useViewTransitionNavigate). The reported Motion.tsx:156-171 does not exist because the file has 67 lines. src/components/TabBar.tsx:51-56
- **Fix:** 1) In src/main.tsx, render `<HashRouter useTransitions={false}>`. react-router 7.18.4's HashRouter wraps every history update in React.startTransition unless that prop is false (node_modules/react-router/dist/development/chunk-OB3PAWPO.mjs:10545-10553). flushSync cannot flush a transition-lane update, so the route does not commit inside the view-transition callback. App.tsx has no lazy routes or Suspense, so synchronous route updates are safe. 2) In src/components/Motion.tsx, rewrite useViewTransitionNavigate on top of lib/motion.ts vt() instead of calling startViewTransition directly: `return useCallback((to, options) => { const { nav = 'forward', ...rest } = options ?? {}; void vt(() => flushSync(() => navigate(to, rest)), { nav }); }, [navigate]);`. vt() (lib/motion.ts:31-55) already skips a running transition, catches t.ready and t.updateCallbackDone, clears data-nav, and falls back under reduced motion or a hidden tab. This mirrors v1 js/motion.js:37-59 and its use in js/app.js:1009. To check the fix, re-run tools/v2-misc-vt.mjs (h1AtReady should be the destination page) and tools/v2-misc-vt-rapid.mjs (no rejections).
- **Evidence:** Browser run: C:/Users/Rhys/AppData/Local/Temp/claude/C--Users-Rhys-Documents-Birding/50bbd68c-99d3-4370-8d9a-7660079d8d87/scratchpad/tools/v2-misc-vt.mjs records #view h1 when the callback returns, when updateCallbackDone fires, at t.ready (new state captured, animation starts) and at t.finished (verify/v2-misc/vt.json). With no CPU throttle, 3 of 4 tab taps still showed the OLD page at ready (Dex->Learn, Learn->Map, Me->Dex). With 6x throttling, 4 of 4 were old at ready, and Dex->Learn and Learn->Map were still old at finished, so the whole animation ran on the old page and the new page cut in afterwards. v1 had the destination h1 at ready in 4 of 4 taps at both rates. …

### 51. No welcome screen: v1's first-run 'Hi Sarah' card (and Settings 'Show the welcome screen') was not ported; kv 'welcomed' is never read
- **Severity:** medium. **Source findings:** runtime-sweep:7
- **Where:** v1 birding-refresh/js/app.js:3018-3046 (showWelcome), :3128 (shown when !kvGet('welcomed')), :2497/2551 (Settings row); React has only the CSS (src/screens/rest.css:394-402) and no component (grep 'welcom' finds no tsx/ts usage)
- **Fix:** Port showWelcome as a layer (with the account CTA) gated on db.kvGet('welcomed'), plus the Settings row.
- **Evidence:** Confirmed in the code and in a browser run. The React port has no welcome screen. Nothing reads or writes kv 'welcomed', and Settings has no "Show the welcome screen" row. Refreshed v1 shows the "Hi Sarah" card on first run, with the account CTA. Settings there has the re-open row, and dismissing the card sets kv 'welcomed'.

This is not a regression introduced by port-refresh. The first React port on main never had the welcome either (`git grep welcom main -- src` finds only CSS). The brief still says refreshed v1 is the reference to match. port-refresh even added the refreshed welcome CSS (src/screens/rest.css:394-424) but no component. The status's "Still not ported from the first port" …

### 52. Centre + navigates to the old full-page 'Log a sighting' form instead of the 'Add a sighting' sheet; Start an outing / Listen / Scan are not offered, and React has no way to start an outing at all
- **Severity:** medium. **Source findings:** visual-parity:4, runtime-sweep:5, data-safety:6, visual-parity:5
- **Where:** src/components/TabBar.tsx:27 and :54-71 (NavLink to /add); src/App.tsx:84; Lists.tsx:316 copy 'Start an outing with the + button'
- **Fix:** In TabBar.tsx render the plus as a <button type="button" className="tab-plus" aria-label="Add a sighting"> (or a Link whose onClick calls preventDefault). It opens a <Sheet cls="sheet-wrap--plus" label="Add a sighting"> (components/Sheet.tsx) with <h2 className="sheet-title">Add a sighting</h2><div className="plus-grid"> and four .plus-tile entries, mirroring openPlusSheet in birding-refresh js/app.js:751-769. The tiles: 'Log one sighting' (plus-tile--main, navigate('/add')); 'Start an outing' or 'Back to your outing' when one is active (navigate('/outing/:id')); 'Listen' to /listen; 'Scan a photo' to /scan. Add the 'Earlier outings can be added too' note. Port openStartOuting (js/app.js:770+) as a sheet that creates the outing record with the same fields v1 writes, then navigates to /outing/:id. No React code creates an outing (no db.add/put('outings') outside Outing.tsx edits or Settings restore), yet Lists.tsx:316 tells the user to use +. Toggle body.has-sheet while open so app.css:508 rotates the plus. The CSS already exists (screens.css:344-383). Keep #/add as the 'Log one sighting' target. Wire it like v1 js/app.js:3092.
- **Also (The + tab opens a full-page form instead of v1's Add sheet; Listen, Scan and Start an …):** Port openPlusSheet as a Sheet (Log one sighting / Start or resume an outing / Listen / Scan) and the start-outing form.
- **Also (The + glyph disappears while on #/add: azure stroke on the azure button):** Never mark the plus current, as in v1, where the plus has no data-tab and app.js:941-942 sets aria-current='false' (index.html:66-67). Render the plus with a plain Link or button instead of NavLink (the + sheet fix above does this), or add `.tabbar .tab-plus[aria-current=page] svg{stroke:currentColor}` to app.css after line 509.
- **Note:** Includes the start-an-outing form, since no code path can create an outing today.
- **Evidence:** Browser: tapping .tab-plus on #/dex goes to hash '#/add' with no sheet (rx probe.json plus). In v1 the hash stays '#/dex' and a sheet opens with 'Add a sighting / Log one sighting / Start an outing / Listen / Scan a photo'. git grep at 3819077 shows the same /add NavLink and no outing-creation code, so the gap predates the port. The refresh added the sheet and the port did not bring it over.

### 53. Selected 'All animals' kind chip on Dex is unreadable: transparent background with white text (contrast 1.08 light, 1.00 dark)
- **Severity:** medium. **Source findings:** visual-parity:2, runtime-sweep:4
- **Where:** src/screens/Dex.tsx:205-221 (button className lacks kind--all); src/screens/screens.css:90 (.kind--all sets --kc) and :103 (.kind-tab[aria-selected=true]{background:var(--kc);color:var(--on-kind)})
- **Fix:** In Dex.tsx:209 change className to {`kind-tab kind--all ${kind === 'animals' ? 'on' : ''}`} so --kc resolves to var(--ink). Better, port v1 kindRail (birding-refresh js/app.js:1171-1184): each tab gets class kind-tab kind--{all|k}, inner <svg className="ring kind-ring" viewBox="0 0 36 36"> track/fill circles, and <span className="kind-tab-txt"><span className="kind-tab-l">label</span><span className="kind-tab-n" aria-hidden><b>got</b>/n</span></span>; Plants uses kind-tab--quiet. The .on class can then go, since screens.css keys off aria-selected.
- **Also (Default Dex filter chip 'All animals' is invisible in light and dark (missing kind--all …):** className={`kind-tab kind--all ${kind==='animals'?'on':''}`}
- **Evidence:** Browser: React light, selected chip class 'kind-tab on', bg rgba(0,0,0,0), text rgb(255,255,255) on body rgb(244,246,249), contrast 1.08. React dark: text rgb(11,14,18) on rgb(11,14,18), contrast 1.00 (verify/v2-visual/rx-*/probe.json). v1: class 'kind-tab kind--all', bg rgb(18,24,33), contrast 17.82 light and 17.07 dark. Dex.tsx is unchanged from pre-port; the port swapped the CSS to the aria-selected/--kc rules, which need the kind--all class.

### 54. Scan empty state uses Unicode placeholder glyphs (◱ ◉ ▣) instead of the v1 SVG icons, and lacks scan-vf--empty so the frame and controls shrink
- **Severity:** medium. **Source findings:** visual-parity:7
- **Where:** src/screens/field/Scan.tsx:185 (className 'scan-vf'), :190 (◱), :193 (◉), :194 (▣); src/screens/field/scan.css:50-51
- **Fix:** In Scan.tsx:185 use className={`scan-vf${photo ? (busy ? ' scan-vf--busy' : '') : ' scan-vf--empty'}`}, mirroring birding-refresh js/scan.js:74 and :89. Replace the glyphs with the shared icons: line 190 <span className="scan-entry-icon"><Icon name="scan" /></span>, line 193 <span className="scan-shutter"><Icon name="cam" /></span> (both exist in src/components/Icon.tsx, matching v1 app.js:154/163), and line 194 the v1 galleryIcon SVG from js/scan.js:10 (rect 3.5,4.5 17x15 rx2 + path 'M6.5 16.5l4-4.5 3 3 2-2 2.5 3.5' + circle 15.5,9 r1.5). Also hide the kind chips while no photo is picked, as v1 does (scan.js:84).
- **Evidence:** Browser (v2-visual-targeted.mjs): React .scan-frame is at left 41, width 308 and .scan-pick at 44/303, against v1 16/358 for both. The React entry icon is the text '◱' in a 13x24 box against a 52x52 SVG in v1. The shutter innerHTML is '◉' against an <svg> in v1 (rx-light/scan-vf.png). The React .scan-vf class is 'scan-vf'; v1 uses 'scan-vf scan-vf--empty'. The port rewrote Scan.tsx.

### 55. Species page still uses the first port's markup: refreshed hero, 'Log another sighting', How to spot it, When and where, About and sticky Log bar are missing; species.css never applies; More photos gallery shows bullets and spilling credits
- **Severity:** medium. **Source findings:** visual-parity:1
- **Where:** src/screens/Bird.tsx:77-236 (no <article class="bird">); src/screens/species.css (all rules scoped to .bird, so dead); Bird.tsx:192-212 gallery; .credit rule dropped (pre-port 3819077:src/styles/app.css:177-179)
- **Fix:** Port renderBird from birding-refresh js/app.js:1532-1768 into Bird.tsx, wrapped in <article className={`bird kind--${sp.kind}`}> so species.css and the look.ts tint (#view --tint is already set, e.g. hsl(21 28% 36%) on #/bird/182) apply. Include .bird-hero with data-hero-box and an h1.bird-name over the photo (1553-1576); .bird-body > .bird-sum rarity line and .bird-actions with 'Log another sighting' linking /add?species={id} (AddSighting already reads ?species=) (1577-1594); the spot section (facts, habitats, 'Test me on this', around 1490-1513); confuseSection (1516-1530), which merges curated lookalikesOf(id) with tellFor plus similar-by-size species so species with no curated pair (e.g. #/bird/1) still get 'Easy to confuse with' cards linking /compare; When and where with the month chart and best places; Calls; About; the hist list (1595-1597); and the sticky .logbar (1607). Remove the duplicate h2 name, the facts grid, 'More photos' and 'Similar species', which v1 does not have. If the gallery is kept for now, add `.gallery{list-style:none;margin:0;padding:0;gap:8px}` and restore the .credit overlay styles from 3819077:src/styles/app.css:177-179.
- **Note:** Larger job: port v1 renderBird.
- **Evidence:** Browser (v2-visual-probe.mjs). React #/bird/1 has no #view .bird element. Headings: H1 name, H2 name, Calls, Your sightings, More photos, Similar species. There is no Log button and the page is 1821px tall. v1 has the .bird wrapper, the How to spot it / Easy to confuse with / When and where / Best places / Calls / Your sightings headings, 'Log another sighting' and 'Log it' buttons, and is 3256px tall. Gallery li are list-style disc and 105/59/61px wide, with credits wrapping under the photos (rx-light/bird-gallery.png). The look-alike data does load (v2-visual-lookalike.mjs: #/bird/47 shows 'Easily confused with' on a cold load). #/bird/1 shows none only because React uses curated pairs …

### 56. Dex home keeps the old header (logo wordmark, metal tally band, black Listen/Scan buttons) instead of the refreshed photo hero, Today rail and ring kind rail; group headings stick
- **Severity:** medium. **Source findings:** visual-parity:3
- **Where:** src/screens/Dex.tsx:158-262; compatibility block src/styles/app.css:828-850; src/screens/screens.css:160 (.dex-sheet un-sticks group heads)
- **Fix:** Port renderDex from birding-refresh js/app.js:1273+ into Dex.tsx: the dex-hero header (bird-of-the-day photo, pick link, round search/settings, seen-count ring pill; dexHero at app.js:1120-1140), the Today rail section.today with Listen / Scan a photo / Today's challenge cards (app.js:1158-1165), and kindRail (app.js:1171-1184). Wrap the tools and grid in the .dex-sheet container so screens.css:160 makes .dex-group-h static as in v1. Then delete the compatibility block at app.css:828-850 (.dex-head, .wordmark, .tally, .id-buttons, .idbtn).
- **Note:** Larger job: port v1 renderDex.
- **Evidence:** Browser: React #/dex has .tally and no .dex-hero or .today. v1 has .dex-hero and .today, and no .tally (probe.json both apps). The earlier compare/01-dex.png shows the layout difference. Dex.tsx has no changes between 3819077 and HEAD. docs/port-refresh.md 'Left / caveats' lists Dex as not rebuilt.

### 57. Settings is still the first-port page: no 'Ready for the field' offline checklist, Your profile, On this phone (Install, Show the welcome screen) or Start over (Delete everything); flat sections instead of grouped cards
- **Severity:** medium. **Source findings:** visual-parity:9
- **Where:** src/screens/progress/Settings.tsx:803-960 (headings Account, Colour & contrast, Use it offline, Send to eBird, Backup, About)
- **Fix:** Port renderSettings from birding-refresh js/app.js:2465-2640 into Settings.tsx using the rest.css set-card markup. Include the .set-card.set-ready 'Ready for the field' card (2479-2494): a summary, a .meter and one row per pack (The app / Species photos / Call clips / Maps / Listen), each with status and 'Get it now'. Include 'Your profile', the Account card, the 'On this phone' card (theme rows, Install row 2495-2496, 'Show the welcome screen' 2497), Send to eBird, Backup and About. Add 'Start over' (2521) with the Delete everything confirm and handler (2563): wipe sightings, outings, patches and photos locally only via the existing db API, and never touch Supabase unless the existing signed-in code path already does. The current single 'Download for offline' button (Settings.tsx:849-879) says calls are 'saved each time you play one', which no longer matches the precached 205-clip pack.
- **Note:** Larger job: port v1 renderSettings, including Ready for the field (pairs with the offline shell-status item).
- **Evidence:** Browser: React headings are Settings, Account, Colour & contrast, Use it offline, Send to eBird, Backup, About; page 1881px. v1 headings are Settings, Ready for the field, Account, On this phone, Send to eBird, Backup, About, Start over; page 2896px (probe.json both apps). Settings.tsx changed by only 2 lines since 3819077 (the back link). docs/port-refresh.md lists Settings as not rebuilt.

### 58. Lists keeps the first-port layout: no back link to Me, no Life-list photo tile bento, targets as rows instead of photo cards, and stale 'Guess the bird' links to /quiz
- **Severity:** medium. **Source findings:** visual-parity:10, runtime-sweep:9
- **Where:** src/screens/lists/Lists.tsx:150-320 ('Guess the bird' link at :176); src/screens/progress/Badges.tsx:63
- **Fix:** Port renderLists from birding-refresh js/app.js:1851-1949: a back link to #/me in the page head, the bento (Life-list tile with the newest species photo plus the year and month tiles), Stats and All sightings buttons, 'Targets for {month}' as .tcard photo cards with chance meters (rest.css:122 already styles .tcard), then 'Find targets near me', Patches and Outings. Replace the /quiz links at Lists.tsx:176 and Badges.tsx:63 with Link to='/learn' labelled 'Learn'. /quiz only redirects (App.tsx:76), so this is copy and markup, not a dead link.
- **Also (Lists and Badges have no back link to Me (they are no longer tabs); Lists/Badges 'Guess …):** Add page-head--back links to /me on Lists and Badges, and point 'Guess the bird' at /learn.
- **Note:** Larger job: port v1 renderLists. Point every "Guess the bird" at /learn.
- **Evidence:** Browser: React #/lists has no back link and 0 .tcard; the 'Guess the bird' href is '#/quiz'. v1 has a back link and 9 .tcard target cards (probe.json). Section headings match in both (Lists, Targets for October, Patches, Outings). Lists.tsx has no changes since 3819077. The back-link gap matters more since the port moved Lists from its own tab to under Me, and no tab is marked current on #/lists.


## Tier 3: polish

### 59. Fact feedback drops the 'Source:' line and the snake safety reminder
- **Severity:** low. **Source findings:** learn-parity:17, code-review:20
- **Where:** src/screens/learn/LearnPlay.tsx:106-120 (Feedback renders no q.source and no q.safety)
- **Fix:** In Feedback after the tell line add `{q.safety && <p className="lq-safety"><svg viewBox="0 0 24 24">{QI.warn}</svg><span>{q.safety}</span></p>}` and `{q.type === 'fact' && q.source?.title && <p className="lq-source">Source: {q.source.url ? <a href={q.source.url} target="_blank" rel="noopener">{q.source.title}</a> : q.source.title}</p>}`, extending QuizQuestion in lib/data with source?: {title: string; url?: string}. .lq-source CSS already exists (learn.css:366). Mirror v1 js/learn.js:830 and :832.
- **Evidence:** Browser (verify/v2-learn/modes-react.json vs modes-v1.json, facts): the React source line is '' for all 6 fact answers. v1 shows 'Source: BirdyDex field notes' and 'Source: Bar-shouldered Dove records, Atlas of Living Australia'. React still shows the snake rule above each snakes-pack question (LearnPlay.tsx:280,333), so only the in-feedback repeat is missing.

### 60. Offline field-notes fallback shows a tofu box (raw \u0001) instead of the blank
- **Severity:** low. **Source findings:** learn-parity:20
- **Where:** src/screens/learn/LearnPlay.tsx:40 (missing is a plain string containing Q.blankNotes output with \u0001) and :410 (deck card fallback, same); PhotoBox prop typed string at src/screens/learn/QuizMedia.tsx:22
- **Fix:** Change PhotoBox's `missing` prop to ReactNode (QuizMedia.tsx:21-27) and pass `<>This photo needs a connection. Here are its field notes instead: {cleanClue(Q.blankNotes(sp, q.wrong || []))}</>` at LearnPlay.tsx:40, and `<>This photo needs a connection. Its field notes: {cleanClue(Q.blankNotes(sp))}</>` at :410. Mirror v1 js/learn.js:677 and :1030, which use clueHTML.
- **Evidence:** Browser with remote images blocked (verify/v2-learn/photobox-react.json q1): the .lq-nophoto text contains \u0001 ('Smaller than the \u0001, with a shorter kinked bill…'), and photobox-react-q1-blocked.png shows a tofu box. v1 renders .lq-blank.

### 61. Learn hub polish gaps vs v1: 'Show all packs' not saved, off Call card gives no message, idle-kinds wording, duel card single photo and covers, deck add wording
- **Severity:** low. **Source findings:** learn-parity:21, data-safety:7
- **Where:** src/screens/learn/Learn.tsx:52,178-181 (allPacks is local state); :210 (off card only preventDefault); :261 (join(', ')); :93-99 packCover (no cross-pack dedupe or framed preference) and :100-114 modeFaces (no look-alike pair for duel); src/screens/learn/LearnPlay.tsx:467 (deck add label) and :376 (toast texts)
- **Fix:** (1) Replace allPacks state with prefs.allPacks and toggle via `set({ allPacks: !prefs.allPacks })` (v1 js/learn.js:499-507). (2) Off Call card: show a role=status note 'Calls are for birds and frogs. Choose All animals, Birds or Frogs.' (v1 :514). React has no global toast, so reuse a local status line like Deck's toast state. (3) Idle text: join all but the last with ', ' and add ' or ' before the last (v1 :604). (4) modeFaces: pick a Q.lookalikePairs() pair in-kind for duel and render both images with 'is-split' (v1 :364-376, :548). packCover: prefer tintable (framed) photos and skip species already used on another cover (v1 :558-572). (5) Deck add label `Add 10 ${prefs.kind === 'animals' ? 'animals' : KINDS[prefs.kind].label.toLowerCase()} around in ${monthName()}` (v1 :988), and for the seen toast use 'Everything you have seen is already in the deck.' / 'Nothing logged yet. Log a sighting and it can go in the deck.' (v1 :1012-1014). The deck-tile part moved to the code-review:6 item, and the offline toast part to the offline item.
- **Evidence:** Browser (verify/v2-learn/seeded-react.json vs seeded-v1.json): with prefs.allPacks=true React shows 6 packs ('Show all 19 packs') and v1 shows 19. Tapping the off Call card for reptiles gives no message in React; v1 toasts 'Calls are for birds and frogs…'. Duel card images: React 1, v1 2. Deck add: React 'Add 10 species around in October', v1 'Add 10 animals around in October'. The idle wording was confirmed from code only (Learn.tsx:261 vs v1 :604).

### 62. Viewfinder polish gaps: the dim covers the inside of the box, there is no busy sweep or empty-state class, glyphs replace the icons, kind chips lack dots, and 'Anything' takes the selected kind's class
- **Severity:** low. **Source findings:** scan-photoid:8
- **Where:** src/screens/field/Scan.tsx:185 (no scan-vf--empty or scan-vf--busy class), 204 (.scan-dim never gets the box position), 190/193/194/229 (glyphs ◱ ◉ ▣; no .scan-go-ico), 220 (Change photo has no icon), 209 (no scan-box--land on a fresh pick), 225-226 (Anything gets kind--${kind}; kind chips have no <i> dot)
- **Fix:** In Scan.tsx:
- Pass style={boxAt} to <span className="scan-dim"> as well as to .scan-box (v1 js/scan.js:142-143). scan.css:98 then shades only outside the box.
- Add the scan-vf--empty and scan-vf--busy classes on .scan-vf (v1 74, 92, 252, 304); this enables the sweep at scan.css:132-133.
- Use <Icon name="scan" /> (src/components/Icon.tsx:8) in .scan-entry-icon and inside <span className="scan-go-ico"> on Identify, and <Icon name="cam" /> (Icon.tsx:4) in .scan-shutter. Copy v1's galleryIcon SVG (scan.js:10) into .scan-pickicon and into the Change photo label (v1 109).
- Add scan-box--land to the box for a fresh pick (v1 102).
- Render the Anything chip with className="scan-chip" only, and add <i aria-hidden="true" /> before each kind label (v1 215).
- **Evidence:** tools/v2-scan-main.mjs (verify/v2-scan/{react,v1}-main.json).
empty.vfClass: React 'scan-vf', v1 'scan-vf scan-vf--empty'.
During the run, React's vf class stays 'scan-vf'; v1 shows 'scan-vf scan-vf--busy'.
vis.dim: React style '' with size 0x0, so its 100vmax shadow dims the whole photo including the box (react-layout-390-mobile.png). v1 style 'left:12.5%…' at 219x219.
Icons: React '◱', '◉', '▣'; v1 SVGs. vis.changeIcon: React false, v1 true.
Chips: React dots=0 on every kind chip, v1 dots=1.
After picking Reptiles, React's Anything chip has class 'scan-chip kind--reptile'; v1's has 'scan-chip '.
All cosmetic; none blocks a task.

### 63. Result-card polish gaps: the ring fills under '?' when unsure, the headline is flat text, failed reference photos show a broken-image icon and shimmer forever, and there is no rise or count-up
- **Severity:** low. **Source findings:** scan-photoid:9
- **Where:** src/screens/field/Scan.tsx:174 and 245-248 (band class and --p use the raw band and `sure` even when unsure), 251 (headline is the plain string from scanHeadline), 264 (ref <img> has no onLoad/.in and no onError fallback), 245/261/278 (no scan-rise or --i)
- **Fix:** In Scan.tsx:
- Compute `const band = result.band === 'possibly' && top.length < 2 ? 'unsure' : result.band` (v1 js/scan.js:333). Use it for the scan-verdict-wrap--, scan-verdict-- and ring choices, and set '--p': band === 'unsure' ? 0 : sure (v1 387).
- Render the headline as JSX spans. Likely: <span className="scan-band">Likely<span className="sr-only">:</span></span> <span className="scan-verdict-name">{a}</span>. Possibly: <span className="scan-band">Possibly</span> <span className="scan-verdict-name">{a} or {b}</span>. Otherwise: <span className="scan-verdict-name">Can't tell from this photo</span>. This mirrors v1 335-337.
- For reference images, onLoad={e => e.currentTarget.classList.add('in')}, plus per-tile failed state so onError renders <span className="scan-tile-missing" /> (v1 359).
- On a fresh result only, add scan-rise with style --i (0, 1, 2…) to the verdict wrap, each card, .scan-also and .scan-none (v1 352-355, 386, 398, 400). Call countUp (src/lib/motion.ts:89) on the ring number with { delay: 260, duration: 820 } (v1 413).
- **Evidence:** tools/v2-scan-main.mjs, unsure step with a 2x2 PNG and ALA/wikimedia images forced to 404 (verify/v2-scan/{react,v1}-main.json, react-unsure.png and v1-unsure.png).
React: ring '--p: 24;' under the '?', 6 broken <img>, 0 .scan-tile-missing. v1: ring '--p:0', 0 imgs, 6 .scan-tile-missing.
First run on 11_4.jpg: React verdictHTML 'Likely: Chestnut Teal' (plain text), ref img classes '' (so the shimmer at scan.css:262 keeps running) and scan-rise count 0. v1 has band and name spans, 'in' on every ref image and 6 scan-rise elements.
The broken-image case matters offline, when the reference photos can't load. It is still cosmetic, because the 'Yours' tile and the names still work.

### 64. Box clamp lacks v1's 24 px floor, so on photos under about 32 px on the short side a smaller region is analysed
- **Severity:** low. **Source findings:** scan-photoid:10
- **Where:** src/screens/field/Scan.tsx:22-26 (clampBox: s = min(1, max(0.08, s)) as a fraction of the short side, with no pixel floor)
- **Fix:** In clampBox (Scan.tsx:23), use `const min = Math.min(1, Math.max(0.08, 24 / shortOf(photo))); const s = Math.min(1, Math.max(min, b.s));`. This mirrors v1 js/scan.js:129-130, min = max(24, short * 0.08) clamped to the short side.
- **Evidence:** tools/v2-scan-main.mjs, tiny2x2.box: React 'left: 12.5%; top: 12.5%; width: 75%; height: 75%', v1 'left: 0%; top: 0%; width: 100%; height: 100%' (verify/v2-scan/{react,v1}-main.json). The earlier lens saw the same on 400x12 (React 2.25% x 75%, v1 3% x 100%).
The difference only shows when 0.75 × the short side is under 24 px (photos under 32 px), or when shrinking the box with the keyboard on small photos. Verdicts matched in both apps, so this is low.

### 65. The Listen worker and /vendor files are cached forever in the persistent runtime cache: the precached worker is never used and updates never reach existing users
- **Severity:** low. **Source findings:** offline-sw:9
- **Where:** scripts/sw-template.js:182-183 + :60-62 (catch-all cacheFirst into RUNTIME, exact-URL match, no revalidation; RUNTIME survives releases per :40); worker URL with query at src/core/listen.js:18; /vendor/supabase/supabase.js at src/core/cloud.js:15
- **Fix:** In scripts/sw-template.js, before the catch-all, mirror v1 savedCopy (sw.js:121-127) plus networkFirst (sw.js:129-152) for app scripts. For request.destination === 'worker' or url.pathname.startsWith('/js/'), use network-first with a short timeout. On fallback use `hit = await (await caches.open(SHELL)).match(request, { ignoreVary: true, ignoreSearch: true })`, and if hit.url differs from request.url return `new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers })`, so the classic worker keeps its ?tf=&root=&lang= query. The 'never rebuild' rule at sw-template.js:7-10 concerns CORS module scripts, not this classic worker. For /vendor/supabase/supabase.js, precache it per release as v1 does (sw.js:14), or serve /vendor/ with this release's SHELL first, as v1 cacheFirst does at sw.js:71.
- **Evidence:** tools/v2-offline-liefi.mjs:
- The worker URL as listen.js:18 builds it is in no cache after install, even though /js/birdnet-worker.js is precached.
- After one online fetch it sits in birdydex-runtime-v3 (React). In v1 it lands in birddex-shell-v12-d (verify/v2-offline/liefi-react.json, liefi-v1.json).
cacheFirst never revalidates, so a changed worker or supabase.js reaches nobody who already has it until RUNTIME is renamed. The same routing is on pre-port main (2a22d0a sw-template.js:125-138, listen.js:18). Rated low because nothing breaks until one of those files changes.

### 66. SW and build comments, and the Settings copy, describe caching that does not happen
- **Severity:** low. **Source findings:** offline-sw:13
- **Where:** scripts/sw-template.js:3-5 ('photos, map tiles and call clips are cached on first use'; 'model is deliberately left out') and :182 ('fonts, vendor, models'); scripts/build-sw.mjs:3-5 ('BioCLIP / BirdNET model files are managed by the app itself'); src/screens/progress/Settings.tsx:851-852 ('Calls are saved each time you play one')
- **Fix:** Once offline-sw:1, :3 and :8 are fixed, rewrite the comments to match. Cross-origin photos go to 'birddex-images' and tiles to 'birddex-tiles'. Call clips are stored whole in 'birddex-calls'. BioCLIP .bin parts bypass the SW and are joined and cached by photoid.js. BirdNET files and /vendor go to 'birddex-models'. Until offline-sw:1 is fixed, the Settings sentence at Settings.tsx:851-852 should not claim calls are saved.
- **Evidence:** Current behaviour contradicts the text. Cross-origin requests return early (sw-template.js:108; xorigin-react.json shows no image or tile caches). Played clips are not stored (clip-react.json). The BioCLIP parts and the ORT wasm are stored by the SW in birdydex-runtime-v3 (storage-react.json). The BirdNET worker fetches its model with plain fetch and does no caching of its own (public/js/birdnet-worker.js), so the SW runtime cache holds it. The build-sw.mjs comment was accurate on pre-port main, which skipped /models/ (2a22d0a sw-template.js:53). The port made it false.

### 67. Map is not full screen: the Leaflet map is 540px tall with a visible 'Map details' text list below; locate is a small 'Me' chip rather than v1's floating button
- **Severity:** low. **Source findings:** visual-parity:11
- **Where:** src/screens/map/map.css:17-28 (.mapwrap.mapwrap--page height:min(64vh,620px)); src/screens/map/MapScreen.tsx:1296-1298 (locate chip), :1402-1570 (map-summary section)
- **Fix:** Make the map fill the viewport as v1 does: in map.css set .mapwrap.mapwrap--page to v1's geometry (birding-refresh css/app.css:441 `position:fixed; inset:0 0 calc(var(--tabbar-h) + env(safe-area-inset-bottom)) 0` plus look.css:69-71 `bottom:0` and `.leaflet-bottom{bottom:calc(var(--chrome-bottom) - 6px)}`). Keep z-index:0/isolation so the patch sheet stays above the tiles. Keep the accessible 'Map details' summary but move it off-screen (give .map-summary the sr-only pattern, as the map-sr headings already are) or into a sheet. Replace the 'Me' chip with v1's <button className="map-fab" aria-label="Go to where I am"> (js/app.js:2218) wired to locate(), and add <span className="map-patch-ring" aria-hidden/> inside 'New patch here' (js/app.js:2217).
- **Evidence:** Browser: React leaflet-container top/height 0/540 at a 844px viewport; scrollHeight 1516; visible headings Map details, Your patches (0), Your sightings on the map (4), Birding hotspots, Place details (rx-light/map.png). v1: 0/844, scrollHeight 844, no visible headings. One claim is refuted: React does have a locate control, a 'Me' chip (MapScreen.tsx:1296) that calls locate(). map.css has no changes since 3819077; the half-height map plus text summary was a deliberate first-port accessibility layout.

### 68. Stats summary repeats each number: 'Life list: 25 25 species across 25 25 sightings'
- **Severity:** low. **Source findings:** visual-parity:12
- **Where:** src/screens/lists/Stats.tsx:413-416 with src/screens/lists/shared.tsx:68-69 (plural() already prefixes the number)
- **Fix:** In Stats.tsx:414-415 drop the leading numbers: `Life list: {plural(lifeSeen.size, 'species')} across {plural(all.length, 'sighting')}.` To match v1 (birding-refresh js/statsview.js has no such line), remove the paragraph and the All time/year/month period chips.
- **Evidence:** Browser: React #/stats first paragraph is 'Showing all time. Life list: 25 25 species across 25 25 sightings.' (rx-light/probe.json). v1's first paragraph is 'The last 26 weeks…'. Code: Stats.tsx:414 renders {lifeSeen.size} {plural(lifeSeen.size,'species')}, and plural returns `${n} ${word}`. Stats.tsx and shared.tsx are unchanged since 3819077.

### 69. Stats keeps first-port styling: flat sections, extra period chips, 'By year' and 'Badges' sections, Most logged without photos, no per-kind ring subheads in Dex progress
- **Severity:** low. **Source findings:** visual-parity:13
- **Where:** src/screens/lists/Stats.tsx (whole render; By year :419-442, Badges :444-470)
- **Fix:** Port renderStats markup from birding-refresh js/statsview.js:9+: each section on a surface card, the 'Days out' title (React says 'Birding days'), Most logged with photo thumbnails, and Dex progress by group with H3 per-kind subheads carrying kind rings (Birds 20/181, Mammals 2/32, ...). Remove 'By year' and 'Badges' (absent in v1; the Badges block is also visibly broken, covered in the Badges item) and the period chips.
- **Evidence:** Browser: React stats headings are Life list growth, Species each month in 2026, Birding days, Top places, Most logged, Dex progress by group, By year, Badges. v1: Life list growth, Species each month in 2026, Days out, Top places, Most logged, Dex progress by group, then H3 Birds/Mammals/Reptiles/Frogs/Butterflies/Plants with counts (probe.json both apps). Page heights are similar (3687 vs 3683). Stats.tsx is unchanged since 3819077.

### 70. Species page keeps 'Pause' state (and the old clip list) when moving to another species; late clips and blob URLs are not cleaned up
- **Severity:** low. **Source findings:** code-review:23
- **Where:** src/screens/Bird.tsx:30-59 (the [sp?.id] effect never resets clips or playing; playClip has no staleness check after await audioUrl); src/screens/me/EditProfile.tsx:75-80 (object URL not revoked when decode or squareJpeg throws)
- **Fix:** Bird.tsx: at the start of the [sp?.id] effect, before the bird/frog check so other kinds also clear, call `setClips([]); setPlaying(-1);`. In its cleanup, pause and set `audioRef.current = null`. Add `const ticket = useRef(0)` and bump it in that cleanup. In playClip, take `const my = ++ticket.current` before `await audioUrl(...)`, and afterwards `if (my !== ticket.current) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return; }`. This mirrors v1 js/app.js:1748 (`if (playing !== i) return;`) and the Learn player guard in js/learn.js:202. Revoke blob: URLs from audioUrl in onended, onerror, when a new clip replaces the old one, and in the effect cleanup. Use a dropUrl helper like v1 js/learn.js:147, :171 and :208. EditProfile.tsx upload: create the URL before try and call URL.revokeObjectURL(url) in a finally block, as v1 js/me.js:454 revokes when decode fails.
- **Evidence:** Browser run: C:/Users/Rhys/AppData/Local/Temp/claude/C--Users-Rhys-Documents-Birding/50bbd68c-99d3-4370-8d9a-7660079d8d87/scratchpad/tools/v2-misc-bird.mjs played recording 1 on #/bird/5 ('Pause recording 1'), then tapped the in-page link to #/bird/3 (Magpie Goose; Bird stays mounted). The first button still read 'Pause recording 1' at 0.3 s and 4 s, although the effect cleanup had paused the audio. The first tap made no new play() call and only flipped the label to 'Play recording 1' (verify/v2-misc/bird.json, bird-stale-label.png). v1 tears the player down on route change (js/app.js:1764, audioStops) and re-renders fresh state. Partly v1-too: the species-page blob URLs are never revoked …

### 71. Catch-all route shows developer copy 'This screen is still being ported to React. Owner: —'
- **Severity:** low. **Source findings:** runtime-sweep:11
- **Where:** src/App.tsx:111 -> src/screens/Placeholder.tsx:14-16
- **Fix:** Use a real not-found message ('That page isn't in BirdyDex') or redirect to #/dex as v1 effectively does.
- **Evidence:** Confirmed in both code and a live run. Every route the React port doesn't match falls through to `<Route path="*" element={<Placeholder title="Not found" owner="—" />}>` at src/App.tsx:111. Placeholder.tsx:14-16 then shows the user developer text: "This screen is still being ported to React." and "Owner: —". This is not environmental: there are no console errors, ALA has nothing to do with it, and timing doesn't matter. It happens both on a cold load and on in-app hash navigation.

The catch-all was not added by the refresh port. It is already on main (main:src/App.tsx:68, from commit f7372f1), so it is older debt, but it is still a gap against v1.

v1 does not behave the way the finding's …

### 72. Document title never changes per route (always "Sarah's BirdyDex")
- **Severity:** low. **Source findings:** runtime-sweep:12
- **Where:** no document.title assignment in src (grep); v1 birding-refresh/js/app.js:953-959 sets '<h1> – BirdyDex'
- **Fix:** Set document.title from the view h1 in TopBar's lookAfterDraw effect, like v1 afterDraw.
- **Evidence:** The finding holds up in both the code and the running apps. The React port never sets document.title, so the tab title stays "Sarah's BirdyDex" on every route. v1 sets it per screen from the view's h1 ("<h1> – BirdyDex"), so this is a parity regression the port introduced. It does not come from the environment: it does not depend on ALA photos, timing or the harness, and it happens both on in-app hash navigation and on a direct load. Low severity is right. The feature still works. What is lost is the per-screen title that screen readers, browser history, tab switchers and the PWA task switcher show.

### 73. Modal sheets on Lists, Log and Outing don't use the layer stack: the page behind is not inert
- **Severity:** low. **Source findings:** runtime-sweep:13
- **Where:** src/screens/lists/shared.tsx:260-325 (Modal: own Escape and focus trap, no openLayer); compare src/components/Sheet.tsx:29 and v1 js/layers.js
- **Fix:** Build Modal on the shared Sheet/openLayer so the background is inert and Escape follows the stack.
- **Evidence:** I reproduced this. On Edit sighting (#/log) and Finish outing (#/outing/:id), the React Modal never joins the layer stack, so nothing behind it is made inert. v1 makes #view, the tab bar, the top bar and the outing bar inert for these same two sheets, so it is a real a11y gap against v1.

The practical effect is smaller than the finding implies:
- Pointer input is already blocked: hit tests at the top bar and upper page land on the scrim or the dialog.
- Keyboard focus is already trapped: 30 Tab presses never left the dialog.
- Escape closes the sheet. No openLayer layer can stack over a Modal in the port (only EditProfile's Sheet uses openLayer), so "Escape follows the stack" makes no …

### 74. #/u/:publicId accepts any string; signed in, a malformed id would reach get_profile(uuid) and show a raw error
- **Severity:** low. **Source findings:** runtime-sweep:14, me-accounts:13
- **Where:** src/App.tsx:97 (no id format check; v1 app.js:913 only matches 36-char hex); src/core/profile.js:128 rpc get_profile; supabase/migrations/20261027000000_public_profiles.sql:103 (p_public_id uuid); src/screens/me/PublicProfile.tsx:29 maps only /not found/
- **Fix:** Validate the id against /^[0-9a-f-]{36}$/ and show the 'This profile isn't available' state otherwise.
- **Also (Signed-in #/u/not-a-uuid sends get_profile an invalid uuid and would show the raw …):** Validate publicId with /^[0-9a-f-]{36}$/ before calling and show the 'This profile isn't available...' message.
- **Evidence:** Confirmed. The React route `/u/:publicId` (src/App.tsx:98) accepts any string and sends it straight to `rpc('get_profile', { p_public_id })` (src/core/profile.js:126-133). The SQL parameter is uuid (public_profiles.sql:103), so Postgres rejects a malformed id with error 22P02 before the function body runs. The 'Profile not found' message is never reached, and `PublicProfile.tsx:29` only maps /not found/. Everything else goes through `problem()` (profile.js:118-122), which only rewrites network and size errors. So a signed-in user sees the raw Postgres text: `invalid input syntax for type uuid: "not-a-uuid"`. I reproduced this in the browser.

This is not a clean port regression. v1 never …

### 75. initProfile keeps the first caller's onChange forever; App.tsx calls it with none, so Me and Edit profile miss later auth or remote-profile changes
- **Severity:** low. **Source findings:** me-accounts:10
- **Where:** src/core/profile.js:25-30; src/App.tsx:59
- **Fix:** Keep a Set of subscribers: initProfile(onChange) adds one and returns an unsubscribe for the component's effect cleanup. Or expose a useProfile() hook.
- **Evidence:** Confirmed in code and in the browser, and it is a port regression: v1 re-renders Me in every case I tried, and the React port does not.

**Code.** `src/core/profile.js:25-30` binds the onAuth and onRemoteChange handlers once, behind `bound`, and keeps whatever `onChange` the first caller passed. Three callers pass none:
- `src/App.tsx:59` calls `initProfile()`.
- `src/screens/me/PublicProfile.tsx:22` calls `initProfile()`.
- `src/App.tsx:60` calls `initAccount()` with no callbacks, so the UI callbacks in `src/core/account.js:24` and `:26-31` do nothing either.

Me (`Me.tsx:54`) and EditProfile (`EditProfile.tsx:36`) pass a callback, but it is used only once, at the end of that one call. …

### 76. Sign-in entry points and copy differ from v1
- **Severity:** low. **Source findings:** me-accounts:11
- **Where:** src/screens/progress/Leaderboard.tsx:374, 479-480 and 291-296; src/screens/me/Me.tsx:171; src/screens/me/PublicProfile.tsx:51-57; src/screens/progress/Settings.tsx:622-624 and 723
- **Fix:** Point the leaderboard links at /me/signin and /me/edit. Handle ?groups=1 by scrolling the Groups section into view. Port profileRow and the Edit profile row to Settings. Reuse the googleMark SVG and the KINDS one/label wording.
- **Evidence:** I confirmed every sub-item, both by reading the code and by running it in a browser. The ALA photo block and the test harness play no part in any of them, and v1 behaves differently in each case, so these are real parity gaps in the port. The port brief (docs/port-refresh.md:8) says "The refreshed v1 is the reference for behaviour, markup and copy. Match it." No feature is broken, though. The leaderboard's Sign in link still lands on a working sign-in form in Settings. The "Show me on the leaderboard" toggle really is in the React Settings page, so the "in Settings" note is accurate; it just has no link. Copy and navigation differences like these are low severity. Part of the gap is already …

### 77. /me/signup and /me/signin share one SignIn instance, so the error, email and sent state carry over
- **Severity:** low. **Source findings:** me-accounts:12
- **Where:** src/App.tsx:96-97; src/screens/me/SignIn.tsx:12-17
- **Fix:** Add key={mode} to the two route elements. Redirect to /me when signedIn().
- **Evidence:** Confirmed, and it is a port regression. SignIn.tsx is new in main..port-refresh (+70 lines), and v1 does not behave this way.

In App.tsx:96-97 both routes render the same <SignIn> type at the same tree position with no key. React Router 7.18.4 reuses that instance across the two routes, so the state from SignIn.tsx:12-16 (email, sent, code, err, busy) carries over when the hash changes straight from /me/signup to /me/signin. Only the mode prop changes: the h1 and lead text update correctly.

I reproduced this in a browser. v1 opens a new sheet with a fresh renderSignIn (me.js:291, account.js:119) and shows an empty form.

Why it is only low:
- No in-app path triggers it. Every link into …

### 78. Public profile uses getMyCloud() rather than row.is_me for 'is this me', and keeps the previous row when the id changes in place
- **Severity:** low. **Source findings:** me-accounts:14
- **Where:** src/screens/me/PublicProfile.tsx:17-18, 34, 255-257
- **Fix:** Use row.is_me for the heading, buttons and back link. Reset row/state when publicId changes, or key the route element by publicId.
- **Evidence:** I reproduced both parts in a mocked browser run. Every Supabase request was answered locally, so nothing reached the live project. v1 handles both cases correctly, so both are port regressions. The triggers are narrow, so I am keeping the severity at low.

(1) "Is this me" is wrong when the cached cloud row is missing. PublicProfile.tsx:33-35 works out isMe from getMyCloud(), then uses it for the heading (line 107), the "You have both found" text (line 110), the Edit profile button (line 105) and the "You too" badges (line 115). v1 uses r.is_me for all of these (js/me.js:617-634). React only fills `cloud` from a successful network fetchCloud (src/core/profile.js:48-65). Nothing in src ever …

### 79. Leaderboard row key can collide on tied ranks
- **Severity:** low. **Source findings:** me-accounts:15
- **Where:** src/screens/progress/Leaderboard.tsx:321
- **Fix:** key={row.public_id ?? `${row.rank}-${row.display_name}`}.
- **Evidence:** I confirmed this by reading the code. I could not reproduce it in a browser, because the leaderboard needs a signed-in Supabase account and the rules forbid signing in.

Duplicate keys can happen:
- The row key is `${row.rank}-${row.display_name}` (src/screens/progress/Leaderboard.tsx:321).
- `get_leaderboard` ranks with `rank() over (order by b.species desc)`, so people with the same species count share a rank (supabase/migrations/20261027000000_public_profiles.sql:90).
- It returns `coalesce(display_name, 'Birder')` (line 94), and display_name is nullable with no unique constraint (20261026000000_accounts.sql:34). Email sign-ups get a NULL name (handle_new_user, accounts.sql:52-53).
- So …

### 80. The Me hero cover is letterboxed ('whole') where v1 crops full-bleed
- **Severity:** low. **Source findings:** me-accounts:16
- **Where:** src/screens/me/Me.tsx:117; src/screens/me/PublicProfile.tsx:222
- **Fix:** Drop the whole prop on both hero covers.
- **Evidence:** I reproduced it in code and in the browser. In the React port, both hero covers pass `whole` to SpeciesImage: src/screens/me/Me.tsx:117 and src/screens/me/PublicProfile.tsx:72. The finding cited PublicProfile.tsx:222, but the line is 72. v1's shared hero() at js/me.js:157 calls `ctx.birdImg(cover, 'large')` with no `{whole:true}`, so it renders one cropped <img>. The CSS is identical in both apps (me.css:13 sets `.me-cover img` to width/height 100% and object-fit: cover). Because of `whole`, React wraps the photo in `span.whole`. That span has no height rule (app.css `.whole` only sets position, display and overflow), so it takes the photo's own 3:2 height instead of filling the hero. The …

### 81. Small offline and error-copy gaps in Edit profile
- **Severity:** low. **Source findings:** me-accounts:17
- **Where:** src/screens/me/EditProfile.tsx:68-80 and 126
- **Fix:** Match v1: check onLine before fileRef.click(), catch decode errors with the v1 message, revoke in finally, show the offline message for show_dex, and use placeholder={myName()}.
- **Evidence:** Three of the four sub-claims hold up in the code and are real low-severity gaps against v1. The decode-failure claim is mostly wrong: an undecodable file already shows v1's exact message. All of this is new code in the port (git diff main..port-refresh shows EditProfile.tsx as 150 added lines), so these are port regressions, not v1 behaviour. None of them breaks a feature, risks data or blocks offline use, so the severity stays low.

### 82. The map layer toggle can overwrite the whole settings object if it is tapped before settings have loaded
- **Severity:** low. **Source findings:** data-safety:8
- **Where:** src/screens/map/MapScreen.tsx:401, :595-601, :1104-1106
- **Fix:** In MapScreen.tsx never write a partial settings object: inside the layer toggle handler read the current value first (`const cur = (await db.kvGet('settings')) || {}`) and save `{ ...cur, mapLayer }`, or disable the toggle until settings have loaded.
- **Evidence:** The race is real: I reproduced it in the browser. When the Satellite tap lands before the settings read finishes, the stored settings object is replaced by {mapLayer:'sat'}, and theme and colourUnseen are lost. The window is very narrow, though. Taps at human pace never triggered it, even with the CPU slowed 4x or 6x. Only a synthetic click fired in the same frame the button mounts, or a settings read I delayed on purpose, caused the loss. It is not a port-refresh regression: MapScreen.tsx is byte-identical on main and port-refresh, and it dates from main commit 2a22d0a. It is a gap compared with v1, which reads settings into state before its first render, so v1 has no window. What is lost …


## Status

Working tree is on `port-fixes`; nothing was pushed or merged. Every listed item was checked against the current code before being changed. `npm run build` and `npm test` pass at HEAD, and a production preview was smoke-tested on `#/dex`, cold `#/learn`, cold `#/learn/daily`, `#/badges`, `#/map`, `#/settings` and `#/scan` with no console errors.

### Fixed

- Tier 1, items 1–17: `6d6e167`, `ca001d5`, `4b3d6ae`, `0ba446c` (4+5), `e876342`, `1f0280f` (7+8), `a5b23cc` (9+10), `135b5ec`, `1f4e24e`, `2ed4fcb`, `6b7d042`, `3b84b54`, `626e666`, `4524735`.
  Sighting edits keep every stored field and use only `notes`; Learn cold-load and render errors are guarded; CSS follows v1 order; results controls and rapid fire work; call questions reset audio; seen rounds and regional data load before a round; the service worker shares the app's calls cache, stores whole clips, keeps model parts single-copy, stores only real app HTML, opens from cache after 4 s, and caches Wikimedia photos/map tiles; Scan's controls no longer overflow, scan hand-off keeps the photo/notes/location, account deletion exists, and Badges uses v1's shelf.
- 18 — `9ab1e0a`: failed precache files carry forward; a missing index/asset fails the install instead of leaving an empty shell.
- 19 — `0a824a6`: old release `/assets/` are copied into the new shell before deletion, and a lazy chunk failure tells the user to reload.
- 20 — `8f2d815`: data reads prefer the current release's shell over the older runtime cache.
- 21 — `b0839f7`: navigations race the network against a 4 s cache fallback while a late response still refreshes the shell.
- 22 — `9b1cc4b`: added the service worker `shell-status` / `shell-fill` messages and the "Ready for the field" card with six rows; calls use the shared cache name.
- 23 — `1ff1e51`: silhouettes and zoom questions gain `is-revealed` after answering.
- 24 — `ac9a52e`: options use `aria-disabled`, announce right/your answer, feedback is focused and scrolled, question/result headings and the deck back get focus.
- 25 — `beea41c`: new questions, results and deck cards scroll to the top.
- 26 — `a98de14`: duel and odd-one-out sides are named after answering.
- 27 — `fec5463`: the active practice round is held at module level and reused when returning from a species page.
- 28 — `5f71249`: mode cards show saved best scores/streaks.
- 29 — `f352964`: added `/learn/test/:id`, the species "Test me on this" link and the mastery mark.
- 30 — `4623951`: the big call player's glyph is inside an `<svg>`.
- 31 — `fb33e5b`: deck cards show the real box and habitat names.
- 32 — `abdfa18`: photo fallback indexes reset for every question/card.
- 33 — `3187a29`: feedback calls play inline instead of adding a second player.
- 34 — `db41396`: pack progress only counts species in that pack.
- 35 — `61e6044`: the deck tile shows when cards exist even if none are due.
- 36 — `909919a`: a failed recording reports why and reveals the field-notes hint.
- 37 — `36f1d51`: the newest scan photo wins, stale runs never set a result or log, old object URLs are revoked, and Change photo is disabled while busy.
- 38 — `e27d028`: Scan keeps its photo and result for 30 minutes across navigation; the dead expiry check is replaced by a real session reset.
- 39 — `e03afc8`: reference photo credits appear on scan cards.
- 40 — `cc0902f`: scan result focus/scroll, quarter download statuses, the "Also worth comparing" heading, and Pick a kind / tighter-box movement.
- 41 — `6b7abfd`: ported v1 crop gestures (anchored corner resize, pinch, small-box class, keyboard steps, whole-photo tightening).
- 42 — `163404c`: public profiles wait for `authSettled` and re-run on auth changes.
- 43 — `5c6c7e3`: `me:cloud` is restored from IndexedDB, and a missing public id opens via `myPublicId()`.
- 44 — `211bc57`: the one-time third-sighting sign-up nudge is ported (`me:nudged`, 20 s hide, announce).
- 45 and 49 — `eeb71d2`: Me has Not now and the slim "Back up your dex" card; TabBar has the dot, avatar, `tab-ico` wrappers, v1 Learn icon and v1 route→tab mapping with manual `aria-current`.
- 46 — `0ce8cca`: leaderboard/Settings show profile photos; public profile rings use real totals and "of N".
- 47 — `28a8090`: avatar upload now opens v1's "Frame your photo" crop sheet; the crop maths feed `squareJpeg`.
- 48 — `0b2d9e5`: Me and Edit profile subscribe to `onStatus`, and App renders the migrating sync banner.
- 50 — `2f6a46d`: `HashRouter` disables router transitions and tab navigation runs through `lib/motion.vt()`.
- 51 — `f03da9c`: added the first-run "Hi Sarah" welcome card, `welcomed` gating and the Settings re-open row.
- 52 — `57fe300`: the + tab opens v1's Add sheet (Log one sighting / start or resume an outing / Listen / Scan), with a working start-outing form.
- 53 — `009ff5c`: the "All animals" chip carries `kind--all`.
- 54 — `6f78805`: Scan's empty state and controls use real SVG icons and the `scan-vf--empty` class.
- 59 — `ad4423a`: fact feedback shows the source and snake safety line.
- 60 — `555d446`: offline photo fallback renders field notes as React nodes, not a tofu character.
- 61 — `7c848e1`: Learn prefs save Show all packs, the off Call card explains itself, idle wording, duel split faces, cover dedupe/framing, and deck add/toast copy.
- 62 — `3b08c36`: dim follows the box, busy/empty classes, icons, small-box/land classes, kind dots and a plain Anything chip.
- 63 — `29464be`: the unsure ring, JSX headline spans, `scan-rise`, count-up and reference-image `in`/missing states.
- 64 — `8944b0f`: clamp keeps a 24 px crop floor.
- 65 — `9a9fefd`: worker and `/js/` scripts revalidate; Supabase vendor is per-release shell.
- 66 — `6b25cb1`: cache comments now describe the actual caches.
- 67 — `8f4d41c`: the map fills the viewport, the text summary is screen-reader-only, and locate is v1's floating button; "New patch here" has its ring.
- 68 — `a1f29bd`: the repeated "Life list: 25 25" line and period chips are gone.
- 70 — `5255837`: Bird resets its player/clip state per species, guards late `audioUrl` results, and revokes blob URLs.
- 71 — `ca4b16f`: the catch-all route shows a real "That page isn't in BirdyDex" message.
- 72 — `e5f4564`: document title follows the screen h1.
- 73 — `f08b69e`: Log/Outing dialogs now render on the shared `Sheet`/layer stack.
- 74 — `5891ab1`: malformed public profile ids are rejected before the UUID RPC.
- 75 — `85507cb`: profile changes notify every subscriber, not just the first caller.
- 77 — `543c762`: sign-up/sign-in routes have distinct keys and redirect signed-in users.
- 78 — `dd09ffc`: Public profile uses `row.is_me` and resets its row when the id changes.
- 79 — `f8ffb34`: leaderboard row keys prefer `public_id`.
- 80 — `920fc05`: Me and Public profile hero covers crop full-bleed.
- 81 — `7959ba7`: Edit profile checks online before the file picker and uses `myName()` as the placeholder.
- 82 — `2661a9c`: the map layer toggle merges into the latest settings object.

### Merged branches (second round)

Twelve branches, each forked from `fd537c7`, were merged into `port-fixes` with `--no-ff`; `npm run build` and `npm test` passed after each one, and the merged build was smoke-tested on every route (light and dark, 390 and 320 px, 0 and 25 sightings) with no console errors.

- `05bb1c6` fixes-sw, `de12269` fixes-brand, `55e2be7` fixes-data, `fc4eeb2` fixes-learn, `51a2c86` fixes-scan, `fdb90dd` fixes-map, `a98aafb` fixes-shell: the re-run fixes for items 11–13, 15, 17, 24, 27, 33, 38, 41, 47, 51, 52, 64–67, 72, 73, 75 and 81, and the re-run's new findings.
- `e7f06d3` pages-stats: item 69 (v1's Stats page).
- `d4075ba` pages-settings: items 57 and 76 (v1's Settings, sign-in entry points and copy, Me join card).
- `44c7637` pages-dex: item 56 (v1's Dex home).
- `85c2935` pages-lists: item 58 (v1's Lists hub, list view and targets).
- `b8d5529` pages-species: item 55 (v1's species page).
- Shared pieces kept once: `lib/toast.ts` (toast, announce and the one `#announce`), `lib/install.ts` (one install offer for the welcome card, Settings and the Dex), `components/OutingBar.tsx` (one `#outing-bar`, `body.has-outing`), `components/RouteFocus.tsx` (heading focus after navigation), `screens/DexSearch.tsx` (search from the Dex and the species hero), `lib/layers.ts`' single Escape/Tab listener, and `components/Sheet.tsx` (open class, labelledBy, step, focus into the sheet, solid surface). The + tab is v1's `<a href="#/add" id="plus">`.
- `3207bc1`: the manifest's `theme_color` is the paper colour `#F4F6F9`. `b906aef`: the species page's Group link filters the dex.

### Leftovers: Settings, Dex filter and search (branch `left-settings-dex-search`)

- 16 and 22, checked against v1 with nothing to change. Account deletion refuses while offline before any sheet opens. A failed request closes the sheet and shows v1's `Couldn't delete the account: <message>`, which replaces "Deleting your account…". The Ready ring's fill has `pathLength="100"`. With the service worker running, every row reports what v1 reports, and the App row's total is the build's precache count (39 on this build, all saved).
- `1118733`: search. `SearchHost` in `DexSearch.tsx` is mounted once in App. `/` opens it on every screen, as in v1. The Dex hero, the Dex's empty state, the species hero and Scan's 'Search the dex' all open it through `openSearch()`.
- `9da0cfb`: item 76's remainder.
  - The sign-in page uses the shared `SignInForm`.
  - Signed-out Edit profile goes to Sign in once the saved sign-in has been checked.
  - Me's public-profile messages and the group outcomes are toasts, and Leave asks in a confirm sheet.
  - Letter avatars use her shown name.
  - Public profile tiles read "You too Australian Brush-turkey".
- Checked: the Group link (`b906aef`) filters the dex the way v1's does. The species page shows the rarity line once.
- Second comparison with v1, checked in the browser on both apps:
  - `18d0740`: Sign up free, Sign in and Edit profile are sheets over the screen that asked for them, as in v1, not pages.
    - `#/me/signup`, `#/me/signin` and `#/me/edit` land on Me, put the address back to `#/me` and open the sheet once the saved sign-in has been checked. Signed in, `#/me/edit` opens Edit profile and `#/me/signin` is just Me; v1 offered Sign in in both cases.
    - Me's join card buttons, Edit profile (Me and your own public profile) and Groups are v1's buttons, and "View my public profile" is v1's `#/me` link until the public id is known.
    - Choosing a species and framing a photo are steps of the Edit profile sheet. Closing the species list or Cancel on the photo come back to Edit profile, as v1 reopened it.
    - Groups scrolls the leaderboard to its Groups section once the groups have loaded, through v1's one-shot `openGroups` instead of `?groups=1`.
    - Every sheet slides away (fades under reduced motion) when dismissed, and goes at once on a route change, as v1's closeSheet did.
    - The tab bar's avatar follows Edit profile.
  - `68b20a2`: `/` opens search over a sheet, as in v1. Escape closes search first and gives focus back to the sheet. Modal and confirm sheets are named by their heading (`aria-labelledby`), and each Ready row carries v1's `data-field`.
  - Kept on purpose: Ctrl, Alt and Cmd with `/` stay the browser's and screen readers' (AltGr's `/` still counts), spaced accessible names on Me's medals, `type="button"` on buttons, `row.is_me` for the public profile's back link, and the not-found page (item 71).
  - Environment, not code: the storage figure under Backup, the species carousel count and credit, Me's fan photos, and the "Photo index failed" warning (v1 logs it too) depend on what Wikipedia and the ALA return.

### Partial

- None.

### Skipped

- None of the numbered items. Items 55–58 and 69 were done on the page branches above, and 76 on pages-settings.
