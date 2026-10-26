# BirdyDex expansion: shared plan for the three helpers

App: Sarah's BirdyDex, a vanilla-JS installable web app (no build step) in `/home/claude/birddex`,
live at https://seq-birddex.vercel.app (GitHub `Ribkid/birding`, Vercel auto-deploys on push to `main`).
Region: South East Queensland (SEQ), bbox lat −28.35…−25.9, lng 151.9…153.6.
Audience: Sarah, a keen amateur naturalist in Brisbane. Australian natives are the focus.

**Nobody pushes to git except the parent (orchestrator).** Each helper writes only the files it owns (below).

## What is being added
1. **Native animals in the same dex as the birds**, colour-coded by kind: mammals, reptiles, frogs, butterflies.
   Natives only (no introduced pests, except none). Realistic for SEQ (things she could actually see).
   Target sizes: ~30 mammals, ~25 reptiles, ~18 frogs, ~30 butterflies.
2. **A plants section** (native plants and trees of SEQ, ~40). Less prominent than animals, but loggable and mappable.
3. **A photo gallery (4–6 openly licensed photos) for every species**, birds included, with credits.
4. **A short sourced write-up for every species**, birds included: nothing unsourced.
5. UI: satellite/regular map toggle, tidy map search, pretty header font, Eastern Yellow Robin logo.

## Species IDs
- Birds keep ids 1–181 (unchanged; sightings depend on them).
- New species get ids from 182 upward in this order: mammals, reptiles, frogs, butterflies, then plants.
  The research helper assigns ids in `data/species-new.json`; nobody renumbers after that.

## File contracts

### `data/species-new.json` (owner: research helper)
```json
[
  { "id": 182, "kind": "mammal", "name": "Koala", "sci": "Phascolarctos cinereus",
    "group": "koala-wombat", "groupLabel": "Koala",
    "h": "f", "size": "65–80 cm", "nocturnal": true, "season": null,
    "notes": "1–2 sentence ID tip in plain English, our own words.",
    "ala": { "lsid": "https://biodiversity.org.au/afd/taxa/…", "acceptedName": "…", "seqRecords": 12345 } }
]
```
- `kind`: one of `mammal`, `reptile`, `frog`, `butterfly`, `plant`.
- `group`: a short slug for a sensible group within the kind (e.g. `macropods`, `possums-gliders`, `bats`, `monotremes`, `dragons`, `skinks`, `pythons`, `turtles`, `tree-frogs`, `ground-frogs`, `swallowtails`, `whites-yellows`, `nymphs`, `blues`, `eucalypts`, `wattles`, `banksias-grevilleas`, `rainforest-trees`, `wildflowers`…). `groupLabel` is the display name.
- `h`: habitat letters as for birds: g gardens & parks, w wetlands & lakes, c coast & mangroves, f forest & woodland, r rainforest, o open country.
- `size`: a short human string (body length, wingspan for butterflies, height for plants).
- `season`: `"s"` (mainly spring–summer), `"w"` (mainly autumn–winter) or null. For plants, use it for flowering season if clear, else null.
- `ala`: name matched on the Atlas of Living Australia (namematching API: `https://api.ala.org.au/namematching/api/search?q=<sci>`) and the count of records in the SEQ bbox since 2016 (biocache: `https://biocache-ws.ala.org.au/ws/occurrences/search?q=lsid:"<lsid>"&fq=decimalLatitude:[-28.35 TO -25.9]&fq=decimalLongitude:[151.9 TO 153.6]&fq=year:[2016 TO *]&pageSize=0`). Use this to keep the list realistic (prefer species with plenty of SEQ records; include a few prized rarer ones).

### `data/info.json` (owner: research helper)
```json
{ "94": { "text": "2–4 sentences: what it is, how to recognise it, habitat and behaviour, anything notable in SEQ.",
          "status": "Least Concern (Qld)",
          "sources": [ { "title": "Laughing Kookaburra – BirdLife Australia", "url": "https://…" },
                       { "title": "Dacelo novaeguineae – Atlas of Living Australia", "url": "https://bie.ala.org.au/species/…" } ] } }
```
- Every id from 1 to the last new id. Every fact in `text` must be supported by one of the listed sources, which you actually read. Paraphrase; never copy sentences.
- 1–3 sources each, reputable: Atlas of Living Australia, BirdLife Australia bird profiles, Australian Museum, Queensland Museum, Queensland Government (WildNet / environment.des.qld.gov.au), Wikipedia, Butterfly House / Brisbane City Council / Australian Native Plants Society for butterflies and plants.
- `status` optional: conservation status if a source states it (e.g. "Vulnerable (Qld, EPBC)"), else omit.

### `data/gallery.json` (owner: photo helper)
```json
{ "94": [ { "src": "https://… (display size, ~600–1000 px wide)", "thumb": "https://… (~300 px)",
            "credit": "Jane Smith", "license": "CC BY 4.0", "page": "https://… (record or file page)",
            "from": "iNaturalist via ALA" } ] }
```
- 4–6 photos for every species id (birds and new species), openly licensed (CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA), clearly the right species, adults where relevant, varied angles (e.g. male/female, perched/flight; for plants: whole plant, flower, leaf/bark).
- Prefer research-grade iNaturalist photos via ALA (images.ala.org.au; licence from `https://images.ala.org.au/ws/image/<id>`), and Wikimedia Commons. Don't include all-rights-reserved images.
- URLs must load directly in an `<img>` from another site (hotlink-safe) and stay stable.

### Code (owner: integration helper)
Everything under `js/`, `css/`, `index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/`, `scripts/`, `data/seq.json`, `data/bioclip-text.json`, `data/birdnet-map.json`.
