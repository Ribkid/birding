# SEQ Birddex

A collectable field guide for the birds of South East Queensland. It's an installable web app: open it in Chrome on Android, then choose **Add to Home screen**.

- 181 SEQ species, with photos and descriptions from Wikipedia and calls from Wikimedia Commons
- Log sightings with photo, GPS and notes, or run eBird-style outings (checklists)
- Life, year, month and patch lists, plus targets for the month and near you
- Hotspots, seasonality and best-spot data from the Atlas of Living Australia (`data/seq.json`, built by `scripts/build_ala.py`)
- Badges, offline mode, backup and restore, and export to eBird Record Format

Sightings are stored only on the device (IndexedDB). Use **Settings → Save backup** now and then.

## Credits
- Sound ID: [BirdNET](https://github.com/birdnet-team/real-time-pwa) (code MIT, models CC BY-SA 4.0), run with TensorFlow.js
- Photo ID: [BioCLIP](https://huggingface.co/imageomics/bioclip) (MIT), run with ONNX Runtime Web
- 3D models: three.js (MIT)
- Recordings: Atlas of Living Australia / iNaturalist contributors and Wikimedia Commons (licences shown in the app)
