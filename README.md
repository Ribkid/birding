# SEQ Birddex

A collectable field guide for the birds of South East Queensland. It's an installable web app: open it in Chrome on Android, then choose **Add to Home screen**.

- 181 SEQ species, with photos and descriptions from Wikipedia and calls from Wikimedia Commons
- Log sightings with photo, GPS and notes, quick-log from the Dex, or run eBird-style outings (checklists)
- Search and filter the full sighting log, with future-date validation and likely-duplicate warnings
- Life, year, month and patch lists, plus targets for the month and near you
- Personalised birder name, remembered Dex preferences, and a persistent Want-to-see list
- Share species summaries, sighting cards, and life-list progress
- Hotspots, seasonality and best-spot data from the Atlas of Living Australia (`data/seq.json`, built by `scripts/build_ala.py`)
- Badges, cancellable offline downloads with failure reporting, backup-age reminders, and export to eBird Record Format
- Keyboard-accessible search and dialogs, larger text, and reduced-motion preferences

Sightings are stored only on the device (IndexedDB). Use **Settings → Save backup** now and then; Settings also shows when the last backup was saved and lets you request persistent browser storage.

## Credits
- Sound ID: [BirdNET](https://github.com/birdnet-team/real-time-pwa) (code MIT, models CC BY-SA 4.0), run with TensorFlow.js
- Photo ID: [BioCLIP](https://huggingface.co/imageomics/bioclip) (MIT), run with ONNX Runtime Web
- 3D models: three.js (MIT)
- Recordings: Atlas of Living Australia / iNaturalist contributors and Wikimedia Commons (licences shown in the app)
