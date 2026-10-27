#!/usr/bin/env python3
"""Build the offline call pack for BirdyDex: short, level-matched clips served from our own site.

Why: every call in data/seq.json is an Atlas of Living Australia proxy link (images.ala.org.au). That server sends
no CORS header, so the app can never save those recordings for offline use. Same-origin copies can be cached.

This is an owner-run data script. It is not part of the app and nothing in the app imports it.

Requirements
  - Python 3.9 or newer, with numpy  (pip install numpy)
  - ffmpeg with its built-in AAC encoder. Found in this order: the FFMPEG environment variable, ffmpeg on PATH,
    then the binary bundled with imageio-ffmpeg (pip install imageio-ffmpeg).
  - Internet access to images.ala.org.au (downloads are cached, so reruns are fast and offline-friendly).

Usage
  python scripts/build_calls.py                 # build anything missing, reuse clips already built
  python scripts/build_calls.py --force         # rebuild every clip
  python scripts/build_calls.py --cache DIR     # where downloaded originals are kept (default: system temp dir)

What it does, per species in data/seq.json that has recordings (today: birds and frogs only; no other kind has any)
  1. Licence check. Clips are trimmed and level-matched, which is a derivative, so recordings marked ND (no
     derivatives), all rights reserved, or with an unknown licence are skipped. CC0, CC BY, BY-SA, BY-NC and
     BY-NC-SA are used, and the artist, licence and source page are kept with every clip.
  2. Picks the best recording(s): calls that stand well above the background noise, and enough calling to learn
     from (a single 1 s note scores lower than several seconds of song).
     One clip per bird, two per frog (frogs are matched by ear, so a second example helps), within the budget.
  3. Trims to the most informative stretch of at most 12 s: 100 ms RMS windows, a threshold set between the noise
     floor and the loud peaks, the 12 s span with the most windows above it (earliest wins a tie), then leading
     and trailing quiet trimmed off with a short pre-roll and tail. Deterministic: same input, same clip.
  4. Encodes mono AAC-LC in .m4a at 48 kbps (plays in Chrome on Android and in Safari), 80 Hz high-pass to cut
     wind rumble, short fades, and two-pass EBU R128 loudness normalisation (-18 LUFS, linear) so clips sit at
     about the same volume.
  5. Writes data/calls/<id>-<n>.m4a and data/calls.json:
       {"<id>": [{"file": "calls/<id>-1.m4a", "artist": "...", "license": "...", "page": "...",
                  "src": "<original url>", "from": "iNaturalist Australia", "seconds": 9.8,
                  "bytes": 58123, "v": "<first 8 hex of the clip's sha1>"}]}
     and prints the pack's total size. The pack must stay at or under 16 MB; second frog clips are dropped first
     if it doesn't.
"""
import argparse, concurrent.futures as cf, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEQ = os.path.join(ROOT, 'data', 'seq.json')
OUT_DIR = os.path.join(ROOT, 'data', 'calls')
OUT_JSON = os.path.join(ROOT, 'data', 'calls.json')

BUDGET = 16 * 1024 * 1024
MAX_S = 12.0          # longest clip
WIN = 0.1             # analysis window, seconds
AN_RATE = 16000       # analysis sample rate
PER_KIND = {'frog': 2}  # clips per species; everything else gets 1
LUFS = -18

# Licences that allow a trimmed, level-matched copy. ND and anything unknown are left out.
OK_LICENCE = re.compile(r'^(CC0|CC BY(-SA|-NC|-NC-SA)?)\b', re.I)


def find_ffmpeg():
    exe = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit('ffmpeg not found. Put it on PATH, set FFMPEG, or pip install imageio-ffmpeg.')


FFMPEG = find_ffmpeg()


def licence_ok(lic):
    lic = (lic or '').strip()
    return bool(OK_LICENCE.match(lic)) and '-ND' not in lic.upper()


def download(url, cache):
    name = hashlib.sha1(url.encode()).hexdigest()[:16]
    path = os.path.join(cache, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={'User-Agent': 'BirdyDex call pack builder (owner script)'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if not data:
                raise IOError('empty response')
            tmp = path + '.part'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, path)
            return path
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)


def analyse(path):
    """RMS in dB per 100 ms window (after a gentle high-pass so rumble doesn't count as calling)."""
    cmd = [FFMPEG, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(AN_RATE), '-af', 'highpass=f=250',
           '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    hop = int(AN_RATE * WIN)
    n = len(x) // hop
    if n < 5:
        return None
    frames = x[:n * hop].reshape(n, hop).astype(np.float64)
    rms = np.sqrt(np.mean(frames ** 2, axis=1)) + 1e-9
    return 20 * np.log10(rms)


def choose_span(db):
    """Pick the most informative stretch of at most MAX_S seconds. Returns (start_s, dur_s, snr_db, calling_s)."""
    n = len(db)
    floor = float(np.percentile(db, 20))
    peak = float(np.percentile(db, 98))
    snr = peak - floor
    if peak < -60:  # effectively silent
        return None
    thr = floor + max(6.0, 0.4 * snr)
    active = db >= thr
    w = int(round(MAX_S / WIN))
    if n <= w:
        s0, e0 = 0, n
    else:
        csum = np.concatenate([[0], np.cumsum(active)])
        counts = csum[w:] - csum[:-w]
        s0 = int(np.argmax(counts))  # argmax returns the earliest of equal maxima
        e0 = s0 + w
    idx = np.nonzero(active[s0:e0])[0]
    if len(idx) == 0:
        start, end = s0, e0
    else:
        start = max(0, s0 + int(idx[0]) - 3)          # 0.3 s pre-roll
        end = min(n, s0 + int(idx[-1]) + 1 + 5, start + w)  # 0.5 s tail
    if end - start < 30:  # at least 3 s where the recording allows, widened on both sides
        start = max(0, start - (30 - (end - start)) // 2)
        end = min(n, start + 30)
        start = max(0, end - 30)
    return start * WIN, (end - start) * WIN, snr, float(active[start:end].sum()) * WIN


def measure_loudness(path, start, dur, chain):
    cmd = [FFMPEG, '-hide_banner', '-nostats', '-ss', f'{start:.2f}', '-t', f'{dur:.2f}', '-i', path,
           '-ac', '1', '-af', f'{chain},loudnorm=I={LUFS}:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']
    err = subprocess.run(cmd, capture_output=True, text=True, errors='replace').stderr
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err, re.S)
    return json.loads(m.group(0)) if m else None


def encode(path, start, dur, out):
    fade_out = min(0.3, dur / 4)
    chain = (f'highpass=f=80,afade=t=in:st=0:d=0.05,afade=t=out:st={max(0, dur - fade_out):.2f}:d={fade_out:.2f}')
    m = measure_loudness(path, start, dur, chain)
    if m and all(k in m for k in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset')) \
            and m['input_i'] not in ('-inf', 'inf'):
        norm = (f'loudnorm=I={LUFS}:TP=-1.5:LRA=11:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}:'
                f'measured_LRA={m["input_lra"]}:measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}:linear=true')
    else:
        norm = f'loudnorm=I={LUFS}:TP=-1.5:LRA=11'
    tmp = out + '.tmp.m4a'
    cmd = [FFMPEG, '-v', 'error', '-y', '-ss', f'{start:.2f}', '-t', f'{dur:.2f}', '-i', path,
           '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn',
           '-af', f'{chain},{norm}', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '48k',
           '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:a', '+bitexact', tmp]
    subprocess.run(cmd, capture_output=True, check=True)
    os.replace(tmp, out)


def clip_seconds(path):
    err = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True, errors='replace').stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err)
    return round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 1) if m else None


def build_species(sid, info, cache, force, prev):
    kind = info.get('kind') or 'bird'
    want = PER_KIND.get(kind, 1)
    cands = []
    skipped = []
    for order, c in enumerate(info.get('calls') or []):
        if not licence_ok(c.get('license')):
            skipped.append(f'{c.get("license") or "no licence"}')
            continue
        try:
            path = download(c['src'], cache)
            db = analyse(path)
        except Exception as e:
            skipped.append(f'failed: {type(e).__name__}')
            continue
        if db is None:
            skipped.append('too short')
            continue
        span = choose_span(db)
        if not span:
            skipped.append('silent')
            continue
        cands.append({'c': c, 'path': path, 'span': span, 'order': order})
    # Best first: calls well above the background, and enough calling to learn from (a 1 s clip of one note
    # teaches less than 8 s of song). The original order breaks ties so reruns pick the same clips.
    score = lambda x: min(x['span'][2], 30) + 3 * min(x['span'][3], 6)
    cands.sort(key=lambda x: (-round(score(x), 1), x['order']))
    out = []
    for n, cand in enumerate(cands[:want], 1):
        c = cand['c']
        start, dur = cand['span'][:2]
        rel = f'calls/{sid}-{n}.m4a'
        dest = os.path.join(ROOT, 'data', rel)
        old = next((p for p in prev.get(sid, []) if p.get('file') == rel), None)
        if force or not os.path.exists(dest) or not old or old.get('src') != c['src']:
            encode(cand['path'], start, dur, dest)
        out.append({
            'file': rel, 'artist': c.get('artist') or 'Unknown', 'license': c.get('license'),
            'page': c.get('page'), 'src': c['src'], 'from': c.get('from') or '',
            'seconds': clip_seconds(dest), 'bytes': os.path.getsize(dest),
            # Content hash: the app adds it to the URL, so a rebuilt clip is never served stale from a phone's cache.
            'v': hashlib.sha1(open(dest, 'rb').read()).hexdigest()[:8],
        })
    return sid, kind, out, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--force', action='store_true', help='rebuild every clip')
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'birddex-calls-cache'))
    ap.add_argument('--jobs', type=int, default=6)
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(SEQ, encoding='utf-8') as f:
        seq = json.load(f)
    try:
        with open(OUT_JSON, encoding='utf-8') as f:
            prev = json.load(f)
    except Exception:
        prev = {}

    todo = sorted(((sid, s) for sid, s in seq['species'].items() if s.get('calls')), key=lambda x: int(x[0]))
    kinds_with_calls = sorted({(s.get('kind') or 'bird') for _, s in todo})
    print(f'ffmpeg: {FFMPEG}')
    print(f'{len(todo)} species have recordings ({", ".join(kinds_with_calls)})')

    results = {}
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = [ex.submit(build_species, sid, s, args.cache, args.force, prev) for sid, s in todo]
        for i, fut in enumerate(cf.as_completed(futs), 1):
            sid, kind, clips, skipped = fut.result()
            results[sid] = (kind, clips, skipped)
            if i % 20 == 0:
                print(f'  {i}/{len(todo)}')

    size = lambda rel: os.path.getsize(os.path.join(ROOT, 'data', rel))
    total = sum(size(c['file']) for _, clips, _ in results.values() for c in clips)
    # Over budget: drop second frog clips (highest id first) until it fits.
    for sid in sorted(results, key=int, reverse=True):
        if total <= BUDGET:
            break
        kind, clips, skipped = results[sid]
        if len(clips) > 1:
            total -= size(clips[-1]['file'])
            results[sid] = (kind, clips[:1], skipped)
    if total > BUDGET:
        sys.exit(f'Pack is {total / 1e6:.2f} MB, over the {BUDGET / 1048576:.0f} MB budget. Lower MAX_S or the bitrate.')

    pack = {sid: results[sid][1] for sid in sorted(results, key=int) if results[sid][1]}
    with open(OUT_JSON, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    keep = {c['file'].split('/')[-1] for clips in pack.values() for c in clips}
    for name in os.listdir(OUT_DIR):
        if name not in keep:
            os.remove(os.path.join(OUT_DIR, name))

    n_clips = sum(len(v) for v in pack.values())
    by_kind = {}
    for sid, clips in pack.items():
        k = results[sid][0]
        by_kind[k] = by_kind.get(k, 0) + 1
    missing = [sid for sid in results if not results[sid][1]]
    secs = [c['seconds'] for v in pack.values() for c in v if c['seconds']]
    print(f'{len(pack)} species with a local clip ({", ".join(f"{v} {k}s" for k, v in sorted(by_kind.items()))}), '
          f'{n_clips} clips, {sum(secs) / max(1, len(secs)):.1f} s on average')
    if missing:
        print('No usable recording: ' + '; '.join(f'{sid} ({", ".join(results[sid][2]) or "none"})' for sid in sorted(missing, key=int)))
    print(f'Total pack size: {total / 1e6:.2f} MB ({total:,} bytes) of {BUDGET / 1048576:.0f} MB budget')


if __name__ == '__main__':
    main()
