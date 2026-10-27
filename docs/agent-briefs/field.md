# Brief: field-tools slice (photo scan + listening)

You are porting the two on-device identification screens of Sarah's BirdyDex from vanilla JS to
React. Repo: `C:\Users\Rhys\Documents\Birdy-React`. Work only inside this repo.

## Read first

- `docs/port-plan.md` (layout and rules)
- `src/core/photoid.js` — `loadPhotoModel(onProgress)`, `isPhotoModelCached()`,
  `identifyPhoto(src, opts)`, `PHOTO_MODEL_MB`. This is the exact phone pipeline; do not change it.
- `src/core/listen.js` — `loadListenModel(onProgress)`, `startListening(...)`, `stopListening()`,
  `isListening()`, `setLocation(lat, lng)`. Worker files: `src/core/birdnet-worker.js`,
  `src/core/audio-processor.js`.
- v1 reference: `legacy/js/app.js` `renderScan` (line 1848) and `renderListen` (line 1775),
  plus `legacy/css/app.css` for `.scan-*` / `.listen-*` classes.
- Existing screens for style: `src/screens/Dex.tsx`, `src/screens/Bird.tsx`.

## Stack rules

- Vite + React 19 + TypeScript strict, `react-router-dom` v7, hash routing.
- Own only `src/screens/field/`. Never edit `src/App.tsx`, `src/main.tsx`, `src/lib/`,
  `src/components/`, `src/core/`, `src/styles/app.css`, `package.json`, `legacy/`, `public/`.
- Reuse v1 CSS classes; new styles only in `src/screens/field/field.css`.
- No new dependencies, no `npm install`, no dev server, no git, no `vite build`.
- Typecheck with `npx tsc --noEmit`; ignore errors outside your files.
- Models are large. Load lazily when the screen opens, show real download progress, and never
  load them twice or on app start.

## Deliverables (default exports, exact paths)

1. `src/screens/field/Scan.tsx` → `/scan`.
   - Pick or capture a photo (`<input type="file" accept="image/*" capture="environment">`).
   - Warm the model as soon as the screen mounts; show cached/download progress using
     `PHOTO_MODEL_MB`.
   - Identify with `identifyPhoto`, showing top candidates with confidence bands exactly as v1
     does (`likely` / `possibly`), plus the honest "not sure" case.
   - Offer "add to dex" for the chosen species (writes a sighting via `src/core/db.js`), with the
     photo kept as a blob record if v1 did so.
   - Revoke object URLs on unmount; no state updates after unmount.
2. `src/screens/field/Listen.tsx` → `/listen`.
   - Request the mic only on an explicit tap, show a live level meter, list live detections with
     confidence, and stop the microphone on Stop, unmount, route change, and errors.
   - Allow logging a detection to the dex; show the model download state before first use.
   - Location (for the region filter) is optional and only requested on demand.

Both screens must work with `prefers-reduced-motion`, be usable one-handed, and degrade honestly
when the model or permission is unavailable — never fake a confidence score.
