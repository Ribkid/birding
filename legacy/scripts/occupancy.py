import json, sys
sys.path.insert(0, '/home/claude/scripts')
import build_ala as b
d = json.load(open('/home/claude/birddex/data/seq.json'))
tot, f = b.facets('class:Aves', fields=('point-0.1',), flimit=-1)
allcells = len(f.get('point-0.1', []))
out = {'_all': allcells}
for k, v in d['species'].items():
    n, f = b.facets(f'lsid:"{v["lsid"]}"', fields=('point-0.1', 'year'), flimit=-1)
    cells = f.get('point-0.1', [])
    out[k] = {'cells': len(cells), 'cells5': sum(1 for _, c in cells if c >= 5)}
json.dump(b.cache, open(b.CACHE, 'w'))
json.dump(out, open('/home/claude/scripts/occupancy.json', 'w'))
print(allcells)
