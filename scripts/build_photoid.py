#!/usr/bin/env python3
"""Build the photo-ID data the app ships: data/photoid.json (settings) + data/photoid.bin (float16 embeddings).

This is an owner-run data script, not part of the app (the app stays build-free). It rebuilds everything
from scratch so the numbers can be checked and extended when species are added.

What it does
  1. Species: birds 1-181 from js/species.js (via node), others from data/species-new.json. Row order = ids[].
  2. Text side: BioCLIP text embeddings (imageomics/bioclip, open_clip) for each species in three name formats
     (taxonomic + common, scientific + common, common), averaged over 16 prompt templates and over every
     scientific-name synonym. Synonyms matter: BioCLIP learnt 2022-23 taxonomy, and several dex names are newer
     (Ardea coromanda -> Bubulcus ibis, Tachyspiza -> Accipiter, Parvipsitta -> Glossopsitta ...).
     Taxonomy comes from GBIF species/match; reptile orders are mapped to class Reptilia.
  3. Image side: prototypes from reference photos run through the SAME uint8-quantised ONNX image encoder the
     phone uses (models/bioclip/*.bin) with the same preprocessing (Pillow bicubic, BioCLIP mean/std):
     the app's own gallery photos (data/gallery.json) plus top-voted research-grade iNaturalist photos from
     Australia. Each photo is embedded as the average of the centre crop and its mirror image. K prototypes per
     species are made with spherical k-means.
  4. Settings (scale, weights, temperature, views, confidence bands) are the ones chosen on a held-out
     validation set of different iNaturalist photos; see docs/photo-id.md for the measurements.

Requirements (a throwaway venv is fine):
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install open_clip_torch onnxruntime pillow numpy requests
  node (to read js/species.js)

Usage
  python scripts/build_photoid.py --work /tmp/photoid-work        # downloads photos into the work folder
  python scripts/build_photoid.py --work /tmp/photoid-work --skip-download
"""
import argparse, base64, concurrent.futures as cf, json, os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'birdydex-photoid-build/1.0 (personal, non-commercial)'}

# Chosen on the validation split (docs/photo-id.md). Change them only with new measurements.
SETTINGS = {
    'K': 3,                     # prototypes per species
    'protoAgg': 'max',          # score against the closest prototype
    'wText': 1.0, 'wProto': 1.0, 'scale': 100.0, 'temperature': 1.0,
    'views': {'whole': ['centre', 'centreF'], 'crop': ['box', 'boxF']},
    'bands': {'likely': 0.8, 'possibly': 0.6},
    'prior': {'month': 0.0, 'floor': 0.15},
}
TEMPLATES = ['a photo of {}.', 'a photo of a {}.', 'a bad photo of a {}.', 'a close-up photo of a {}.', 'a bright photo of a {}.',
             'a cropped photo of a {}.', 'a photo of the small {}.', 'a photo of the large {}.', 'a blurry photo of a {}.',
             'a good photo of a {}.', 'a photo of one {}.', 'a low resolution photo of the {}.', 'a dark photo of the {}.',
             'a jpeg corrupted photo of a {}.', 'a photo of a nice {}.', 'a close-up photo of the {}.']
EXTRA_SYNONYMS = {112: ['Glossopsitta pusilla'], 74: ['Bubulcus ibis'], 84: ['Accipiter fasciatus'], 85: ['Accipiter novaehollandiae'],
                  90: ['Haliaeetus leucogaster'], 80: ['Pandion haliaetus'], 2: ['Coturnix ypsilophora'], 38: ['Chalcites lucidus']}
TAXONOMY_FIXES = {  # GBIF leaves these incomplete
    51: ('Animalia', 'Chordata', 'Aves', 'Charadriiformes', 'Charadriidae'), 84: ('Animalia', 'Chordata', 'Aves', 'Accipitriformes', 'Accipitridae'),
    85: ('Animalia', 'Chordata', 'Aves', 'Accipitriformes', 'Accipitridae'), 262: ('Animalia', 'Arthropoda', 'Insecta', 'Lepidoptera', 'Papilionidae'),
}
MEAN = (0.48145466, 0.4578275, 0.40821073); STD = (0.26862954, 0.26130258, 0.27577711)


def species_list():
    js = os.path.join(ROOT, 'js', 'species.js').replace('\\', '/')
    out = subprocess.run(['node', '-e', f"import('file:///{js}').then(m => console.log(JSON.stringify(m.BIRDS.map(b => ({{id: b.id, kind: 'bird', name: b.name, sci: b.sci}})))))"],
                         capture_output=True, text=True, check=True).stdout
    birds = json.loads(out)
    extra = json.load(open(os.path.join(ROOT, 'data', 'species-new.json'), encoding='utf8'))
    others = [{'id': x['id'], 'kind': x['kind'], 'name': x['name'], 'sci': x['sci']} for x in extra]
    sp = sorted(birds + others, key=lambda s: s['id'])
    assert [s['id'] for s in sp] == list(range(1, len(sp) + 1)), 'species ids must be 1..N with no gaps'
    return sp


def synonyms(s, seq):
    names = [' '.join(s['sci'].split()[:2])]
    a = (seq['species'].get(str(s['id'])) or {}).get('ala')
    if isinstance(a, str) and a[:1].isupper() and not a.isupper():
        a = ' '.join(re.sub(r'\s*\([^)]*\)', '', a).split()[:2])
        if len(a.split()) == 2: names.append(a)
    names += EXTRA_SYNONYMS.get(s['id'], [])
    seen, res = set(), []
    for n in names:
        if n.lower() not in seen: seen.add(n.lower()); res.append(n)
    return res


def taxonomy(sp, work):
    import requests
    path = os.path.join(work, 'taxonomy.json')
    tax = json.load(open(path)) if os.path.exists(path) else {}
    for s in sp:
        if str(s['id']) in tax: continue
        g = requests.get('https://api.gbif.org/v1/species/match', params={'name': s['sci']}, headers=UA, timeout=30).json()
        tax[str(s['id'])] = {k: g.get(k) for k in ['kingdom', 'phylum', 'class', 'order', 'family']}
    for i, v in TAXONOMY_FIXES.items(): tax[str(i)] = dict(zip(['kingdom', 'phylum', 'class', 'order', 'family'], v))
    for t in tax.values():
        if t.get('class') in ('Squamata', 'Testudines', 'Crocodylia') and not t.get('order'):
            t['order'], t['class'] = t['class'], 'Reptilia'
    json.dump(tax, open(path, 'w'), indent=0)
    return tax


def text_embeddings(sp, tax, seq):
    import numpy as np, torch, open_clip
    model, _, _ = open_clip.create_model_and_transforms('hf-hub:imageomics/bioclip')
    tok = open_clip.get_tokenizer('hf-hub:imageomics/bioclip'); model.eval()
    def taxo(s, sci):
        t = tax.get(str(s['id']), {})
        return ' '.join([t[k] for k in ['kingdom', 'phylum', 'class', 'order', 'family'] if t.get(k)] + [sci])
    rows = []
    with torch.no_grad():
        for s in sp:
            syn = synonyms(s, seq)
            names = sorted({f"{taxo(s, n)} with common name {s['name']}" for n in syn}) + sorted({f"{n} with common name {s['name']}" for n in syn}) + [s['name']]
            e = torch.nn.functional.normalize(model.encode_text(tok([t.format(n) for n in names for t in TEMPLATES])), dim=-1)
            # equal weight per name format (taxonomic, scientific, common)
            k1 = len({f"{taxo(s, n)}" for n in syn}) * len(TEMPLATES); k2 = k1
            parts = [e[:k1].mean(0), e[k1:k1 + k2].mean(0), e[k1 + k2:].mean(0)]
            v = torch.nn.functional.normalize(torch.stack([torch.nn.functional.normalize(p, dim=-1) for p in parts]).sum(0), dim=-1)
            rows.append(v.numpy())
    return np.stack(rows).astype('float32')


def fetch_photos(sp, work, per=10):
    """Gallery photos from data/gallery.json plus top-voted iNaturalist photos (Australia, research grade)."""
    import requests
    os.makedirs(os.path.join(work, 'protos'), exist_ok=True)
    gal = json.load(open(os.path.join(ROOT, 'data', 'gallery.json'), encoding='utf8'))
    jobs = [(f"{sid}_g{i}.jpg", p['src']) for sid, ps in gal.items() for i, p in enumerate(ps)]
    for s in sp:
        t = requests.get('https://api.inaturalist.org/v1/taxa', params={'q': s['sci'], 'per_page': 5}, headers=UA, timeout=40).json()
        time.sleep(1)
        tid = next((x['id'] for x in t.get('results', []) if x['name'].lower() == s['sci'].lower()), (t.get('results') or [{}])[0].get('id'))
        if not tid: continue
        o = requests.get('https://api.inaturalist.org/v1/observations', params={'taxon_id': tid, 'quality_grade': 'research', 'photos': 'true',
                         'place_id': 6744, 'per_page': 30, 'order_by': 'votes'}, headers=UA, timeout=40).json()
        time.sleep(1)
        for ob in [ob for ob in o.get('results', []) if ob.get('photos')][:per]:
            jobs.append((f"{s['id']}_i{ob['id']}.jpg", ob['photos'][0]['url'].replace('/square.', '/medium.')))
    def dl(job):
        fn = os.path.join(work, 'protos', job[0])
        if os.path.exists(fn): return
        r = requests.get(job[1], headers=UA, timeout=60)
        if r.status_code == 200 and len(r.content) > 2000: open(fn, 'wb').write(r.content)
    with cf.ThreadPoolExecutor(8) as ex: list(ex.map(dl, jobs))


def image_embeddings(work):
    """centre crop + mirror, averaged, with the app's own quantised encoder."""
    import glob, numpy as np, onnxruntime as ort
    from PIL import Image, ImageOps
    m = json.load(open(os.path.join(ROOT, 'models', 'bioclip', 'manifest.json')))
    onnx_path = os.path.join(work, 'vision-q8.onnx')
    if not os.path.exists(onnx_path):
        with open(onnx_path, 'wb') as f:
            for ch in m['chunks']: f.write(open(os.path.join(ROOT, 'models', 'bioclip', ch['file']), 'rb').read())
    sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider']); name = sess.get_inputs()[0].name
    mean, std = np.array(MEAN, 'float32'), np.array(STD, 'float32')
    def centre(im):
        w, h = im.size
        ow, oh = (224, int(224 * h / w)) if w <= h else (int(224 * w / h), 224)
        r = im.resize((ow, oh), Image.BICUBIC); l, t = round((ow - 224) / 2), round((oh - 224) / 2)
        return r.crop((l, t, l + 224, t + 224))
    def emb(im):
        a = ((np.asarray(im, 'float32') / 255 - mean) / std).transpose(2, 0, 1)[None]
        v = sess.run(None, {name: a})[0][0]; return v / np.linalg.norm(v)
    out = {}
    for f in sorted(glob.glob(os.path.join(work, 'protos', '*.jpg'))):
        try:
            im = ImageOps.exif_transpose(Image.open(f)).convert('RGB')
            if min(im.size) > 1600: s = 1600 / min(im.size); im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.BICUBIC)
            c = centre(im); v = emb(c) + emb(ImageOps.mirror(c)); out[os.path.basename(f)] = v / np.linalg.norm(v)
        except Exception as ex: print('skip', f, ex)
    return out


def kmeans(X, k, seed):
    import numpy as np
    rng = np.random.default_rng(seed); C = X[rng.choice(len(X), k, replace=False)]
    for _ in range(20):
        a = (X @ C.T).argmax(1)
        C = np.stack([(lambda v: v / np.linalg.norm(v))(X[a == j].mean(0)) if (a == j).any() else C[j] for j in range(k)])
    return C


def main():
    import numpy as np
    ap = argparse.ArgumentParser(); ap.add_argument('--work', required=True); ap.add_argument('--skip-download', action='store_true')
    args = ap.parse_args(); os.makedirs(args.work, exist_ok=True)
    sp = species_list(); seq = json.load(open(os.path.join(ROOT, 'data', 'seq.json'), encoding='utf8'))
    tax = taxonomy(sp, args.work)
    if not args.skip_download: fetch_photos(sp, args.work)
    T = text_embeddings(sp, tax, seq)
    E = image_embeddings(args.work)
    rows, owner = [], []
    for i, s in enumerate(sp):
        X = np.stack([v for k, v in E.items() if int(k.split('_')[0]) == s['id']]) if any(int(k.split('_')[0]) == s['id'] for k in E) else None
        if X is None: continue
        K = SETTINGS['K']
        cs = [X.mean(0) / np.linalg.norm(X.mean(0))] if len(X) < 2 * K else list(kmeans(X, K, seed=s['id']))
        for c in cs: rows.append(c); owner.append(i)
    P = np.stack(rows).astype('float32')
    blob = np.concatenate([T, P]).astype('<f2').tobytes()
    open(os.path.join(ROOT, 'data', 'photoid.bin'), 'wb').write(blob)
    meta = {'format': 2, 'encoder': json.load(open(os.path.join(ROOT, 'models', 'bioclip', 'manifest.json')))['version'], 'dim': 512,
            'ids': [s['id'] for s in sp], 'bin': 'photoid.bin', 'text': {'row': 0, 'rows': len(sp)},
            'protos': {'row': len(sp), 'rows': len(P), 'owner': owner},
            'score': {k: SETTINGS[k] for k in ['scale', 'wText', 'wProto', 'protoAgg', 'temperature']},
            'views': SETTINGS['views'], 'prior': SETTINGS['prior'], 'bands': SETTINGS['bands']}
    old = os.path.join(ROOT, 'data', 'photoid.json')
    if os.path.exists(old):
        prev = json.load(open(old));  meta['metrics'] = prev.get('metrics')  # keep the last measured accuracy until re-measured
    json.dump(meta, open(old, 'w'), indent=1)
    print('wrote', len(sp), 'species,', len(P), 'prototypes,', len(blob) // 1024, 'KB')


if __name__ == '__main__':
    main()
