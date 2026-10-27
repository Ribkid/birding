#!/usr/bin/env python3
"""Build SEQ hotspot + seasonality data for Birddex from the Atlas of Living Australia (open data).
Output: birddex/data/seq.json
"""
import json, re, subprocess, sys, time, urllib.parse
from collections import defaultdict

OUT = '/home/claude/birddex/data/seq.json'
CACHE = '/home/claude/scripts/ala_cache.json'
BBOX = ['decimalLatitude:[-28.35 TO -25.9]', 'decimalLongitude:[151.9 TO 153.6]']
YEARS = 'year:[2016 TO *]'
BIO = 'https://biocache-ws.ala.org.au/ws/occurrences/search'
NM = 'https://api.ala.org.au/namematching/api'

# Older / alternative scientific names ALA may use
SYNONYMS = {
    'Synoicus ypsilophorus': ['Coturnix ypsilophora'],
    'Chalcophaps longirostris': ['Chalcophaps indica'],
    'Hypotaenidia philippensis': ['Gallirallus philippensis'],
    'Himantopus leucocephalus': ['Himantopus himantopus'],
    'Anarhynchus ruficapillus': ['Charadrius ruficapillus'],
    'Ardea coromanda': ['Bubulcus coromandus', 'Ardea ibis', 'Bubulcus ibis'],
    'Ardea intermedia': ['Ardea plumifera', 'Egretta intermedia'],
    'Pandion cristatus': ['Pandion haliaetus'],
    'Tachyspiza fasciata': ['Accipiter fasciatus'],
    'Tachyspiza novaehollandiae': ['Accipiter novaehollandiae'],
    'Icthyophaga leucogaster': ['Haliaeetus leucogaster'],
    'Tyto javanica': ['Tyto alba', 'Tyto delicatula'],
    'Todiramphus sordidus': ['Todiramphus chloris'],
    'Zanda funerea': ['Calyptorhynchus funereus'],
    'Parvipsitta pusilla': ['Glossopsitta pusilla'],
    'Caligavis chrysops': ['Lichenostomus chrysops'],
    'Gavicalis fasciogularis': ['Lichenostomus fasciogularis'],
    'Symposiachrus trivirgatus': ['Monarcha trivirgatus'],
    'Cincloramphus timoriensis': ['Megalurus timoriensis'],
    'Stizoptera bichenovii': ['Taeniopygia bichenovii'],
    'Spilopelia chinensis': ['Streptopelia chinensis'],
    'Cyclopsitta diophthalma': ['Opopsitta diophthalma'],
    'Chrysococcyx lucidus': ['Chalcites lucidus'],
    'Microcarbo melanoleucos': ['Phalacrocorax melanoleucos'],
    'Thalasseus bergii': ['Sterna bergii'],
    'Hydroprogne caspia': ['Sterna caspia'],
    'Chroicocephalus novaehollandiae': ['Larus novaehollandiae'],
    'Eudynamys orientalis': ['Eudynamys scolopaceus'],
    'Ninox boobook': ['Ninox novaeseelandiae'],
    'Petrochelidon ariel': ['Hirundo ariel'],
    'Petrochelidon nigricans': ['Hirundo nigricans'],
    'Lonchura punctulata': ['Lonchura punctulata'],
    'Acrocephalus australis': ['Acrocephalus stentoreus'],
    'Rhipidura albiscapa': ['Rhipidura fuliginosa'],
    'Colluricincla harmonica': ['Colluricincla harmonica'],
    'Platalea regia': ['Platalea regia'],
}

try:
    cache = json.load(open(CACHE))
except Exception:
    cache = {}

def get(url, params):
    q = urllib.parse.urlencode(params, doseq=True)
    full = f'{url}?{q}'
    if full in cache:
        return cache[full]
    for attempt in range(4):
        r = subprocess.run(['curl', '-s', '--max-time', '60', full], capture_output=True, text=True)
        try:
            data = json.loads(r.stdout)
            cache[full] = data
            if len(cache) % 20 == 0:
                json.dump(cache, open(CACHE, 'w'))
            time.sleep(0.15)
            return data
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f'failed {full}')

def resolve(sci, name):
    """Try every candidate name; keep the taxon with the most SEQ records."""
    found = {}
    for cand in [sci] + SYNONYMS.get(sci, []) + [' '.join(sci.split()[:2])]:
        d = get(f'{NM}/search', {'q': cand})
        if d.get('success') and d.get('classs') == 'Aves' and d.get('rank') in ('species', 'subspecies'):
            found[d['taxonConceptID']] = d
            if d.get('rank') == 'subspecies' and d.get('speciesID'):
                found[d['speciesID']] = {**d, 'taxonConceptID': d['speciesID'], 'scientificName': d.get('species', d['scientificName']), 'rank': 'species'}
    d = get(f'{NM}/searchByVernacularName', {'vernacularName': name})
    if d.get('success') and d.get('classs') == 'Aves':
        found[d['taxonConceptID']] = d
    best = None
    for lsid, d in found.items():
        total, _ = facets(f'lsid:"{lsid}"', fields=('month',), flimit=1)
        if not best or total > best[0]:
            best = (total, lsid, d['scientificName'], d['rank'])
    return (best[1], best[2], best[3]) if best else (None, None, None)

def facets(q, extra_fq=(), fields=('point-0.01', 'month'), flimit=1000):
    d = get(BIO, {'q': q, 'fq': BBOX + [YEARS] + list(extra_fq), 'pageSize': 0,
                  'facets': list(fields), 'flimit': flimit})
    out = {f['fieldName']: [(x['label'], x['count']) for x in f['fieldResult']] for f in d.get('facetResults', [])}
    return d.get('totalRecords', 0), out

IMG = 'https://images.ala.org.au'
AUDIO_PREF = {'audio/mpeg': 0, 'audio/mp3': 0, 'audio/mp4': 1, 'audio/x-m4a': 1, 'audio/aac': 1, 'audio/ogg': 2, 'audio/vnd.wave': 3, 'audio/wav': 3, 'audio/x-wav': 3}

def sounds(lsid, want=3):
    """Openly licensed recordings (mostly iNaturalist) attached to ALA records, Australia-wide."""
    d = get(BIO, {'q': f'lsid:"{lsid}"', 'fq': ['multimedia:Sound'], 'pageSize': 25, 'sort': 'eventDate', 'dir': 'desc'})
    cands = []
    for o in d.get('occurrences', []):
        for sid in (o.get('sounds') or [])[:1]:
            m = get(f'{IMG}/ws/image/{sid}', {})
            lic = (m.get('recognisedLicence') or {}).get('acronym')
            mime = m.get('mimeType') or ''
            if not lic or not mime.startswith('audio') or mime not in AUDIO_PREF:
                continue
            cands.append({'src': f'{IMG}/image/proxyImage?imageId={sid}', 'mime': mime, 'artist': m.get('creator') or 'Unknown',
                          'license': lic, 'page': f'https://biocache.ala.org.au/occurrences/{o.get("uuid")}',
                          'from': o.get('dataResourceName') or 'Atlas of Living Australia', 'size': m.get('fileSize') or 0})
        if len([c for c in cands if AUDIO_PREF[c['mime']] < 3]) >= want:
            break
    cands.sort(key=lambda c: AUDIO_PREF[c['mime']])
    return [{k: v for k, v in c.items() if k != 'size'} for c in cands[:want]]

MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

def month_vec(pairs):
    m = dict(pairs)
    return [m.get(x, 0) for x in MONTHS]

def main():
    species = json.loads(subprocess.run(['node', '-e',
        "import('/home/claude/birddex/js/species.js').then(m=>console.log(JSON.stringify(m.SPECIES)))"],
        capture_output=True, text=True).stdout)

    # all-bird effort per month (for frequency normalisation)
    aves_total, af = facets('class:Aves', fields=('month',), flimit=20)
    aves_month = month_vec(af.get('month', []))
    print('All bird records in SEQ since 2016:', aves_total, file=sys.stderr)

    cells = defaultdict(dict)   # cell -> {speciesId: count}
    sp_out = {}
    unresolved = []
    for s in species:
        lsid, accepted, rank = resolve(s['sci'], s['name'])
        if not lsid:
            unresolved.append(s['name']); continue
        total, f = facets(f'lsid:"{lsid}"')
        pts = f.get('point-0.01', [])
        for label, c in pts:
            cells[label][s['id']] = c
        sp_out[s['id']] = {'ala': accepted, 'lsid': lsid, 'n': total, 'm': month_vec(f.get('month', [])),
                           'pts': [[float(l.split(',')[0]), float(l.split(',')[1]), c] for l, c in pts[:40]],
                           'calls': sounds(lsid)}
        print(f"{s['id']:3} {s['name']:32} {accepted:40} {total:7}", file=sys.stderr)
    json.dump(cache, open(CACHE, 'w'))

    # hotspots: cells richest in dex species
    ranked = sorted(cells.items(), key=lambda kv: (-len(kv[1]), -sum(kv[1].values())))
    hotspots = []
    for label, spmap in ranked[:320]:
        lat, lng = map(float, label.split(','))
        _, lf = facets('class:Aves', extra_fq=[f'point-0.01:"{label}"'], fields=('locality',), flimit=6)
        locs = [clean(l) for l, c in lf.get('locality', []) if usable(l)]
        hotspots.append({'name': locs[0] if locs else None, 'lat': lat, 'lng': lng,
                         'rich': len(spmap), 'sp': sorted(spmap.items(), key=lambda kv: -kv[1])})
    json.dump(cache, open(CACHE, 'w'))

    # merge neighbouring cells with the same name
    merged = []
    for h in hotspots:
        twin = next((m for m in merged if m['name'] and m['name'] == h['name']
                     and abs(m['lat'] - h['lat']) <= 0.025 and abs(m['lng'] - h['lng']) <= 0.025), None)
        if twin:
            d = dict(twin['sp'])
            for k, v in h['sp']:
                d[k] = d.get(k, 0) + v
            twin['sp'] = sorted(d.items(), key=lambda kv: -kv[1]); twin['rich'] = len(d)
        else:
            merged.append(h)
    merged = [h for h in merged if h['name']][:220]
    for h in merged:
        h['sp'] = [[int(k), v] for k, v in h['sp']]

    out = {'built': time.strftime('%Y-%m-%d'), 'years': '2016–present',
           'source': 'Atlas of Living Australia occurrence records (includes eBird and BirdLife Australia Birdata)',
           'effort': aves_month, 'species': sp_out, 'hotspots': merged}
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('unresolved:', unresolved, file=sys.stderr)
    print('hotspots:', len(merged), file=sys.stderr)

PRIVATE = re.compile(r'^\d|^AU-|house|home|yard|residence|property|my |our |street|st\.? ?$|\d+ [a-z]+ (st|rd|ct|ave)', re.I)

def usable(l):
    return bool(l) and l.lower() not in ('not supplied', 'unknown') and not PRIVATE.search(l) and len(l) > 3

def clean(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r',?\s*AU-QLD.*$', '', s)
    s = re.sub(r'\s*-?\d{2}\.\d+,\s*\d{3}\.\d+.*$', '', s)
    s = re.sub(r'\s*--\s*', ': ', s)
    s = re.sub(r'\s+(at|near|off)$', '', s, flags=re.I)
    s = re.sub(r'\s*\((?:general area|general)\)\s*$', '', s, flags=re.I)
    return s[:80]

if __name__ == '__main__':
    main()
