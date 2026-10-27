#!/usr/bin/env python3
"""Add the non-bird species (data/species-new.json) to data/seq.json, and write per-kind rarity tiers.

For each new species: SEQ record count since 2016, records per month, the busiest 1 km squares
("where it's reported"), and openly licensed call recordings for frogs.
Monthly rates are normalised by each kind's own records (data.effortByKind) so frogs are compared
with frogs, not with birds. Rarity tiers (data/tiers.json) are quintiles of record counts within
each kind: the most-recorded fifth is 1 (Common) … the least-recorded fifth is 5 (Rare).

Usage: python3 scripts/build_extra.py [path/to/species-new.json]
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_ala as b  # shares the ALA request cache and helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEQ = os.path.join(ROOT, 'data', 'seq.json')
TIERS = os.path.join(ROOT, 'data', 'tiers.json')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'species-new.json')

# Effort queries: all records of that kind in the SEQ bbox, used to turn counts into reporting rates.
EFFORT = {
    'mammal': 'class:Mammalia',
    'reptile': 'class:Reptilia',
    'frog': 'order:Anura',
    'butterfly': 'order:Lepidoptera',
    'plant': 'kingdom:Plantae',
}


def resolve(x):
    lsid = (x.get('ala') or {}).get('lsid')
    if lsid:
        return lsid
    d = b.get(f'{b.NM}/search', {'q': x['sci']})
    if d.get('success'):
        return d.get('taxonConceptID')
    d = b.get(f'{b.NM}/searchByVernacularName', {'vernacularName': x['name']})
    return d.get('taxonConceptID') if d.get('success') else None


def main():
    species = json.load(open(SRC))
    seq = json.load(open(SEQ))
    seq.setdefault('effortByKind', {})
    for kind, q in EFFORT.items():
        if any(s.get('kind') == kind for s in species):
            _, f = b.facets(q, fields=('month',), flimit=20)
            seq['effortByKind'][kind] = b.month_vec(f.get('month', []))
            print('effort', kind, sum(seq['effortByKind'][kind]), file=sys.stderr)

    counts = {}
    for x in species:
        sid = str(x['id'])
        lsid = resolve(x)
        if not lsid:
            print('NO LSID', x['name'], file=sys.stderr)
            continue
        total, f = b.facets(f'lsid:"{lsid}"')
        pts = f.get('point-0.01', [])
        rec = {'kind': x['kind'], 'lsid': lsid, 'ala': (x.get('ala') or {}).get('acceptedName') or x['sci'],
               'n': total, 'm': b.month_vec(f.get('month', [])),
               'pts': [[float(l.split(',')[0]), float(l.split(',')[1]), c] for l, c in pts[:40]]}
        if x['kind'] == 'frog':
            try:
                rec['calls'] = b.sounds(lsid)
            except Exception as e:
                print('sounds failed', x['name'], e, file=sys.stderr)
        seq['species'][sid] = rec
        counts.setdefault(x['kind'], []).append((total, x['id']))
        print(f"{x['id']:4} {x['kind']:9} {x['name']:34} {total:7}", file=sys.stderr)
    json.dump(b.cache, open(b.CACHE, 'w'))

    tiers = {}
    for kind, lst in counts.items():
        lst.sort(reverse=True)  # most records first
        n = len(lst)
        for rank, (_, sid) in enumerate(lst):
            tiers[str(sid)] = min(5, 1 + (rank * 5) // max(1, n))
    out = os.environ.get('OUT_DIR')  # write somewhere else when testing
    json.dump(seq, open(os.path.join(out, 'seq.json') if out else SEQ, 'w'), separators=(',', ':'))
    json.dump(tiers, open(os.path.join(out, 'tiers.json') if out else TIERS, 'w'), separators=(',', ':'))
    print('done', {k: len(v) for k, v in counts.items()}, file=sys.stderr)


if __name__ == '__main__':
    main()
