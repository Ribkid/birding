# Outing photos with likes, and a Spots tab

Requested by Rhys on 30 Oct 2026. Decisions he made:
- **Photos are public.** Every photo added to an outing is visible to anyone viewing her profile, and signed-in birders can like it.
- **Spots is its own sixth tab**, next to Map.
- **"Easiest to access" comes from OpenStreetMap**, fetched once at build time and stored in the app so it works offline.

Two branches build this in parallel, in their own worktrees off `main` (06101a3):
- `spots-tab` in `C:\Users\Rhys\Documents\Birdy-React-spots`: the Spots tab (part B).
- `outing-photos` in `C:\Users\Rhys\Documents\Birdy-React-photos`: outing photos and likes (part A).

They are merged afterwards. Only `spots-tab` touches the tab bar. Only `outing-photos` touches `supabase/`, the profile screens and the outing page. Both add routes to `src/App.tsx`; keep those additions small so the merge is easy.

## Rules for both branches

- **Never push.** Never touch `main`, `C:\Users\Rhys\Documents\Birdy-React` or `C:\Users\Rhys\Documents\Birding\birding`.
- **Sightings stay safe.** Don't change how sightings, outings or patches are stored or synced: `src/core/db.js` stores and the IndexedDB version, `src/core/sync.js`, `src/core/cloud.js` and the existing migrations stay as they are. Add new modules instead.
- **No live Supabase.** Never apply migrations, sign in, create accounts or write to the live Supabase project. A new migration file is fine; Rhys applies it himself. In tests and Playwright, fake Supabase: route `**/*supabase.co/**`.
- **Offline and accountless.** It must keep working offline and without an account. Nothing loads from a CDN at runtime. No new npm dependencies.
- **Build and test.** `npm run build` and `npm test` pass before every commit. Write vitest tests for the logic. Commit in small commits with plain messages saying what changed for her.
- **Look and feel.** Match the app: photo-first and glassy. Palette: paper #F4F6F9, ink #121821, dark paper #0B0E12; never a green page background. Light, dark and Outdoor themes. 44 px targets. Visible keyboard focus. Motion respects prefers-reduced-motion. It must work at 390 px and 320 px, and at 150% and 200% text (see `docs/ui-improvements.md` item 10: container queries, nothing cut off).
- **Reuse what's there.** Reuse the app's pieces: `SpeciesImage`, `Sheet`, `PhotoViewer` (src/components/PhotoViewer.tsx), `toast` and `announce` (src/lib/toast.ts), the layer stack (src/lib/layers.ts), the shared store (src/lib/store.ts), route focus, and the species and hotspot data (src/lib/seq.ts, src/core/seqdata.js, `public/data/seq.json` → `hotspots`).

## A. Outing photos and likes (branch `outing-photos`)

### For her

On an outing's page (live or finished) and in the Finish sheet there is an **Add photos** button. It opens the phone's picker with multiple selection.
- The app reads each photo's capture time (EXIF DateTimeOriginal) and preselects the ones taken between the outing's start and end, plus 30 minutes either side.
- It says "12 of 15 were taken during this outing", so she can untick the rest.
- The photos show as a grid on the outing page. Tapping one opens `PhotoViewer`.
- She can remove a photo.
- She can tag a photo with a species. This is optional: a species picker, defaulting to none.

A one-time notice, shown the first time she adds photos, says plainly that "Photos you add to an outing are public on your profile, and other birders can like them." It names her as the owner and says she can remove a photo at any time.

### Local first

- Each picked file is downscaled with `createImageBitmap` and canvas to 2048 px on the long edge (JPEG quality 0.82), plus a 480 px thumbnail. **Re-encoding drops all EXIF, including GPS**, so no photo can reveal her home or a nest. Write a small EXIF date reader with no dependency, and test it with a fixture.
- Store each photo in the existing IndexedDB `photos` store as a new record: `{ uid, kind: 'outing', outingUid, takenAt, w, h, blob, thumb, speciesId?, uploadedAt? }`. Sighting photos keep their shape. Don't bump the DB version.
- Without an account, or offline, the photos stay on the phone and show on her own outing page as normal.

### Sharing (signed in)

A new module, `src/core/outingPhotos.js`, uploads pending outing photos when she is signed in and online.
- It retries later on failure.
- It is idempotent by `uid`.
- It never blocks the outing page.

Its storage paths:

| Bucket | Path |
|---|---|
| `outing-photos` (public) | `{user_id}/{outing_uid}/{uid}.jpg` and `…/{uid}_t.jpg` |

### Supabase

Add one new migration, `supabase/migrations/20261030000000_outing_photos.sql`. Mirror the style and the RLS patterns of the existing migrations.

**Bucket**
- Create the `outing-photos` bucket, public, image/jpeg only, 3 MB limit.
- Owners may insert, update and delete only under their own `user_id` folder. Anyone may read.

**Table `public.outing_photos`**
- Columns:
  - `id uuid pk default gen_random_uuid()`
  - `uid text unique`
  - `user_id uuid references auth.users on delete cascade`
  - `outing_uid text not null`
  - `path text`, `thumb_path text`
  - `taken_at timestamptz`
  - `species_id int null`
  - `w int`, `h int`
  - `like_count int not null default 0`
  - `created_at timestamptz default now()`
- RLS:
  - Owners insert, update and delete their own rows.
  - Select is open to everyone (public).

**Table `public.photo_likes`**
- Columns: `photo_id uuid references outing_photos on delete cascade`, `user_id uuid references auth.users on delete cascade`, `created_at`. The primary key is `(photo_id, user_id)`.
- RLS: a signed-in user may insert and delete only their own like. No one can like their own photo (a check in the RPC). `like_count` is kept by a trigger.

**RPCs**, all `security definer` with `set search_path = ''`, and only expose public columns:
- `toggle_photo_like(p_photo uuid) returns table(liked boolean, like_count int)`.
- `get_public_outing(p_public_id uuid, p_outing_uid text)`. It returns the outing's date, place name, species count, distance and duration, and its photos, with the caller's own `liked` flag per photo. **It never returns the outing's lat/lng.** It only returns outings that have at least one photo.
- Extend what a profile shows. Use a new RPC, `get_profile_photos(p_public_id uuid)`, so `get_profile` stays as it is. It returns:
  - her **most liked photos**: the top 9 by `like_count`, then by newest;
  - her **outings with photos**: date, place, photo count and a cover thumb, newest first.

`delete_my_account` already exists. Make sure the new rows and storage objects go with the account, by cascade or by adding cleanup in this migration.

### Screens

- **Outing page** (`src/screens/lists/Outing.tsx`): the Add photos button, the photo grid with the viewer, and each photo's like count and heart. Likes appear once the photos are shared.
- **Me** and **public profile** (`src/screens/me/Me.tsx`, `PublicProfile.tsx`):
  - a "Most liked" photo grid, where each photo opens the viewer with a like button and the species name if tagged;
  - an "Outings" list. Each item opens `#/u/<publicId>/outing/<outingUid>` (new route), the public outing page.
- **Liking:**
  - It needs sign-in. If she isn't signed in, tapping the heart opens the existing sign-in sheet.
  - It is optimistic: the heart and count change at once and roll back on error.
  - Use `aria-pressed` and an accessible name such as "Like this photo, 12 likes".
  - Add a small heart pop that is off under reduced motion.
- **Owner controls:** she can remove a photo, which deletes the row and both storage objects, and works offline through the pending queue.

### Testing

- vitest: the EXIF reader, the time-window preselection, the downscale size maths, the upload queue (with a fake client), and optimistic like with rollback.
- Playwright, with Supabase routed to fakes: add photos to a seeded outing, check the grid and viewer, liking signed in versus signed out, the profile grids, light and dark, 320 px, and offline.

## B. Spots tab (branch `spots-tab`)

### Tab bar

The tab bar becomes **Dex · Learn · + · Map · Spots · Me**.
- Update `src/components/TabBar.tsx`, `TAB_FOR` (spots and spot routes → 'spots'), the static shell in `index.html` (`src/__tests__/shell.test.tsx` keeps them identical), and the tab bar's large-text CSS and its test (`src/__tests__/largeText.test.tsx`), so all six fit with 44 px targets from 390 px down to 195 px.
- Give Spots a simple icon in the app's tab-icon style: a pin with binoculars, or stacked pins.
- The default 390 px layout may change only as much as adding a tab requires.

### Data: access from OpenStreetMap, baked in

Add the script `scripts/build-spot-access.mjs`, run by hand (`node scripts/build-spot-access.mjs`) and not as part of `npm run build`. It writes `public/data/spot-access.json`, which is committed.
- For each of the 220 hotspots in `public/data/seq.json` (keyed by its index and name), it queries the Overpass API within 400 m.
- Batch it into a few requests, pause between them, and set a descriptive User-Agent.
- It counts:
  - `amenity=parking` (the nearest parking's distance in metres);
  - `amenity=toilets`;
  - `leisure=bird_hide`;
  - `amenity=shelter` and `leisure=picnic_table`;
  - footways and paths with `surface` in paved, asphalt, concrete or compacted, and boardwalks (`bridge=boardwalk` or `boardwalk`);
  - `wheelchair=yes` or `limited`;
  - `access` / `fee`.
- It turns these into an **access score from 1 to 5**, with a short reason list ("Parking 60 m · Toilets · Paved paths · Bird hide"). Write the formula in the script, and test it with a vitest test of the pure scoring function.
- A hotspot whose name says "restricted access" gets capped at 2 and a note.
- Hotspots with no tags get `null`, shown as "Access not known yet". They are not ranked as hard.
- The app shows "Access data © OpenStreetMap contributors" (ODbL) wherever access appears.

### Screens

**`#/spots`**: the list, titled "Spots".
- At the top, **Suggested for you**: up to 3 spots with the most species she hasn't seen yet (her seen set from the store), weighted to nearby when her location is known. Each shows "14 birds new for you".
- **Sort**, a segmented control or menu that is remembered for the session:
  - Most species (`rich`);
  - Most sightings (the sum of record counts in `sp`);
  - Easiest access;
  - Nearest (needs location: ask once, use the last fix; offline is fine);
  - New for you.
- **Filters** as chips: Toilets, Parking, Bird hide, Wheelchair friendly.
- **Search** by name.
- Each card shows:
  - the name;
  - the distance, if location is known;
  - the species count and "N new for you";
  - access badges, or "Access not known yet";
  - a strip of 4 to 5 photos of the most-recorded species there (`SpeciesImage`, small).
- Render 220 cards efficiently, with `content-visibility` or windowing.

**`#/spot/:idx`**: a spot's page.
- The name, and a hero photo of its top species.
- Facts: species count, records, distance, and access with reasons and the OSM credit.
- Buttons:
  - **Show on map**, which goes to the existing `#/map/at/<lat>,<lng>` route and opens that hotspot's popup;
  - **Directions**, which opens `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` in a new tab.
- **Birds here**: the species ranked by records, each marked seen or not seen (the Dex's marks), with a "Not seen yet" filter, linking to `#/bird/:id`.
- **Your sightings near here**: hers within 1 km, from the store.
- The map popup for a hotspot (src/screens/map/MapScreen.tsx) gains a "Spot details" link to `#/spot/:idx`. This is the only Map change.

### Testing

- vitest: the access scoring, the sorts, the suggestions, and the tab bar geometry with six tabs.
- Playwright, against the local preview: every sort and filter, a spot page, the tab bar at 390, 320, 260 and 195 px, light, dark and Outdoor, offline, and 0 and 25 sightings. Seed sightings with the helpers in `C:\Users\Rhys\AppData\Local\Temp\claude\C--Users-Rhys-Documents-Birding\50bbd68c-99d3-4370-8d9a-7660079d8d87\scratchpad\tools\merge-lib.mjs`. Copy them; never edit them.
