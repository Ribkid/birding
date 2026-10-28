import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KINDS, type ScanResult } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { resizeImage } from '../../core/profile.js';
import { Icon } from '../../components/Icon';
import { countUp } from '../../lib/motion';
import {
  photoIdInfo, identifyScan, modelCached, ensureModel, photoModelMb, scanSubject, scanFootnote,
  topResults, scanHeadline, scanAdvice, bandLevel, bandWord, pct, words, article, firstSentence,
  scanRefs, logScan, markChosen,
} from '../../core/scan.js';
import { setPending } from './scanHandoff';
import { openSearch } from '../DexSearch';
import { KEEP_MS, S, resetScan, type ScanBox, type ScanPhoto } from './scanSession';
import './scan.css';

type Chosen = ScanPhoto;
type Box = ScanBox;

function RefTile({ item, name }: { item?: { src: string } | null; name: string }) {
  const [failed, setFailed] = useState(!item);
  if (!item || failed) return <span className="scan-tile-missing" />;
  return <img src={item.src} alt={`${name}, reference photo`} loading="lazy" decoding="async" onLoad={(e) => e.currentTarget.classList.add('in')} onError={() => setFailed(true)} />;
}

const GalleryIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M6.5 16.5l4-4.5 3 3 2-2 2.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="15.5" cy="9" r="1.5" fill="currentColor" /></svg>
);

const shortOf = (p: Chosen) => Math.min(p.W, p.H);
function boxPct(photo: Chosen, b: Box) {
  const side = b.s * shortOf(photo);
  return { left: `${(b.cx * photo.W - side / 2) / photo.W * 100}%`, top: `${(b.cy * photo.H - side / 2) / photo.H * 100}%`, width: `${side / photo.W * 100}%`, height: `${side / photo.H * 100}%` };
}
function clampBox(photo: Chosen, b: Box): Box {
  const min = Math.min(1, Math.max(0.08, 24 / shortOf(photo)));
  const s = Math.min(1, Math.max(min, b.s));
  const hw = s * shortOf(photo) / (2 * photo.W), hh = s * shortOf(photo) / (2 * photo.H);
  return { s, cx: Math.min(Math.max(b.cx, hw), 1 - hw), cy: Math.min(Math.max(b.cy, hh), 1 - hh) };
}

export default function Scan() {
  const navigate = useNavigate();
  const seen = useSeen();
  const [info, setInfo] = useState<any>(null);
  const [photo, setPhoto] = useState<Chosen | null>(S.photo);
  const [box, setBox] = useState<Box>(S.box);
  const [whole, setWhole] = useState(S.whole);
  const [kind, setKind] = useState(S.kind);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ phase: 'model' | 'view'; frac: number; index?: number; count?: number } | null>(null);
  const [result, setResult] = useState<(ScanResult & { whole: boolean; kind: string }) | null>(S.result as (ScanResult & { whole: boolean; kind: string }) | null);
  const [logAt, setLogAt] = useState<number | null>(S.logAt);
  const [yours, setYours] = useState(S.yours);
  const [error, setError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [at, setAt] = useState(S.at);
  const sure = result ? Math.min(99, Math.max(1, Math.round((result.results[0]?.p || 0) * 100))) : 0;
  const stageRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const kindsRef = useRef<HTMLDivElement>(null);
  const [freshResult, setFreshResult] = useState(false);
  const [land, setLand] = useState(false);
  const [landTick, setLandTick] = useState(0);
  const [rise, setRise] = useState(false);
  const ringNRef = useRef<HTMLElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: 'move' | 'resize' | 'pinch'; start: any } | null>(null);
  const [activeHandle, setActiveHandle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [stageW, setStageW] = useState(0);
  const picks = useRef(0);
  // The photo a run belongs to. A scan restored from the session (after a species page, a tab switch or
  // This one → Cancel) brings its file back with it, so Identify works without picking the photo again.
  const currentFile = useRef<File | null>(S.photo?.file ?? null);
  const identifyRun = useRef(0);
  // False once the person has left Scan: a run that finishes after that is neither shown nor logged (v1 checks the hash).
  const onScan = useRef(true);
  useEffect(() => {
    onScan.current = true;
    return () => { onScan.current = false; };
  }, []);
  useEffect(() => {
    S.at = at; S.photo = photo; S.box = box; S.whole = whole; S.kind = kind;
    S.result = result; S.logAt = logAt; S.yours = yours;
  }, [at, photo, box, whole, kind, result, logAt, yours]);

  useEffect(() => {
    if (!landTick) return;
    setLand(true);
    const timer = window.setTimeout(() => setLand(false), 700);
    return () => window.clearTimeout(timer);
  }, [landTick]);

  // A freshly picked photo: the stage takes focus, without scrolling, so the arrow keys move the box (v1 pick()).
  useEffect(() => {
    if (landTick) stageRef.current?.focus({ preventScroll: true });
  }, [landTick]);

  useEffect(() => {
    if (!rise) return;
    const start = window.setTimeout(() => { void countUp(ringNRef.current, 0, sure, { delay: 260, duration: 820 }); }, 60);
    const end = window.setTimeout(() => setRise(false), 1300);
    return () => { window.clearTimeout(start); window.clearTimeout(end); };
  }, [rise, sure]);

  useEffect(() => {
    if (!freshResult) return;
    document.getElementById('scan-verdict')?.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }));
    setFreshResult(false);
  }, [freshResult]);

  const covered: string[] = info?.kinds?.filter((k: string) => KINDS[k]) || [];
  const multi = covered.length > 1;
  const subject = scanSubject({ kinds: covered }, kind);
  const intro = covered.length
    ? `Name ${article(KINDS[covered[0]].one)} ${words(covered.map((k) => KINDS[k].one))} from a photo, right on your phone.`
    : 'Find out what you photographed, right on your phone.';

  useEffect(() => {
    if (S.at && Date.now() - S.at > KEEP_MS) {
      resetScan();
      currentFile.current = null;
      setPhoto(null); setBox(S.box); setWhole(false); setResult(null); setLogAt(null); setYours(''); setAt(0);
    }
    void photoIdInfo().then((i: any) => setInfo(i));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      if (!photo || whole || busy) return;
      const step = shortOf(photo) * (e.shiftKey ? 0.01 : 0.05);
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) setBox((b) => clampBox(photo, { ...b, cx: b.cx + moves[e.key][0] / photo.W, cy: b.cy + moves[e.key][1] / photo.H }));
      else if (e.key === '+' || e.key === '=') setBox((b) => clampBox(photo, { ...b, s: b.s * 1.1 }));
      else if (e.key === '-' || e.key === '_') setBox((b) => clampBox(photo, { ...b, s: b.s / 1.1 }));
      else return;
      e.preventDefault();
    };
    stage.addEventListener('keydown', onKey);
    return () => stage.removeEventListener('keydown', onKey);
  }, [photo, whole, busy]);

  const pick = async (file?: File) => {
    if (!file) return;
    const ticket = ++picks.current;
    setStatus('Opening the photo…');
    let img: HTMLImageElement | null = null;
    try {
      const blob = await resizeImage(file, 1600);
      if (!blob) throw new Error('unreadable');
      if (ticket !== picks.current) return;
      const url = URL.createObjectURL(blob);
      img = new Image();
      img.src = url;
      await img.decode();
      if (ticket !== picks.current) { URL.revokeObjectURL(url); return; }
      currentFile.current = file;
      const next: Chosen = { file, blob, url, W: img.naturalWidth, H: img.naturalHeight };
      setPhoto((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return next;
      });
      setAt(Date.now());
      setResult(null); setLogAt(null); setError(''); setYours('');
      // Three quarters of the short side, but never under 24 px: v1 clamps the fresh box as well.
      setBox(clampBox(next, { cx: 0.5, cy: 0.5, s: 0.75 }));
      setLandTick((n) => n + 1);
      setStatus(`Photo ready. Move the box onto ${subject ? `the ${subject}` : 'what you want named'}, then choose Identify.`);
    } catch {
      if (ticket !== picks.current) return;
      if (img?.src) URL.revokeObjectURL(img.src);
      setStatus("That file couldn't be opened as a photo. Try a JPEG or PNG.");
    }
  };

  const cropFractions = () => {
    if (!photo || whole) return null;
    const side = box.s * shortOf(photo);
    return { x: (box.cx * photo.W - side / 2) / photo.W, y: (box.cy * photo.H - side / 2) / photo.H, w: side / photo.W, h: side / photo.H };
  };

  const identify = async () => {
    if (busy || !photo) return;
    const file = photo.file;
    const run = ++identifyRun.current;
    setBusy(true); setError(''); setNeedsReload(false); setResult(null); setStatus('Starting photo ID…');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => workRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
    const MB = photoModelMb();
    // Stop quietly when another photo or run took over, or the person left Scan.
    const stale = () => !onScan.current || currentFile.current !== file || run !== identifyRun.current;
    try {
      const cached = await modelCached();
      if (!cached) {
        if (navigator.onLine === false) throw new Error('offline-first-run');
        setStatus(`Getting photo ID ready: a one-time download of about ${MB} MB. Wi-Fi is best.`);
        let said = 0;
        await ensureModel((f: number) => {
          if (stale()) return;
          setProgress({ phase: 'model', frac: f });
          const quarter = Math.floor(f * 4) / 4;
          if (quarter > said && f < 1) {
            said = quarter;
            setStatus(`Downloading photo ID: ${Math.round(quarter * 100)}% done.`);
          }
        });
      } else {
        await ensureModel();
      }
      if (stale()) return;
      setProgress(null);
      const month = new Date(file.lastModified || Date.now()).getMonth() + 1;
      const { res } = await identifyScan(file, {
        crop: cropFractions(), kinds: kind ? [kind] : null, month,
        onProgress: (x: any) => {
          if (stale()) return;
          if (x.phase === 'view') { setProgress({ phase: 'view', frac: 0, index: x.index, count: x.count }); setStatus(`Looking closely, ${x.index} of ${x.count}`); }
        },
      } as any);
      if (stale()) return;
      const logged = await logScan(res);
      if (stale()) return;
      setResult({ ...res, whole, kind });
      setLogAt(logged);
      setYours(makeYours(photo, box, whole));
      setFreshResult(true);
      setRise(true);
      setStatus('');
    } catch (err: any) {
      if (stale()) return;
      const raw = String(err?.message || err);
      const importFailed = /dynamically imported module|Importing a module script failed|module script failed/i.test(raw);
      // Only a new release makes a reload help. A module that is just not saved yet (offline) needs the network,
      // which is v1's message for a failed fetch.
      const updated = importFailed && await releaseChanged();
      if (stale()) return;
      if (updated) {
        setError('BirdyDex was updated. Reload to use Scan.');
        setNeedsReload(true);
        setStatus('');
      } else {
        // v1 says why in the status line under Identify, where she is looking.
        setStatus(importFailed || /offline-first-run|Failed to fetch|NetworkError|network/i.test(raw)
          ? `Photo ID needs a one-time download of about ${MB} MB. Connect to the internet (Wi-Fi is best) and try again.`
          : `Photo ID couldn't run: ${raw}`);
      }
    } finally { if (run === identifyRun.current) { setBusy(false); setProgress(null); } }
  };

  const chosen = async (id: number) => {
    await markChosen(logAt, id);
    if (photo) setPending({ blob: photo.blob, notes: 'Identified from a photo.', autoGps: true });
    navigate(`/add?species=${id}`, { state: { scan: true } });
  };
  // None of these: the scan log records that no match was taken (v1 marks it for Tighter, Pick a kind and Search).
  const none = () => { void markChosen(logAt, 'none'); };

  const toImg = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * (photo?.W || 1), y: (e.clientY - r.top) / r.height * (photo?.H || 1) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!photo || whole || busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImg(e);
    pts.current.set(e.pointerId, p);
    const b = box;
    const handle = (e.target as HTMLElement).closest('[data-handle]') as HTMLElement | null;
    const inside = (e.target as HTMLElement).closest('[data-box]');
    setActiveHandle('');
    if (pts.current.size === 2) {
      const [a, c] = [...pts.current.values()];
      gesture.current = { mode: 'pinch', start: { d: Math.hypot(a.x - c.x, a.y - c.y) || 1, s: b.s } };
    } else if (handle) {
      const corner = handle.dataset.handle || '';
      const sx = corner.includes('e') ? 1 : -1;
      const sy = corner.includes('s') ? 1 : -1;
      const side = b.s * shortOf(photo);
      gesture.current = {
        mode: 'resize',
        start: { sx, sy, ax: b.cx * photo.W - sx * side / 2, ay: b.cy * photo.H - sy * side / 2 },
      };
      setActiveHandle(corner);
    } else {
      const cx = inside ? b.cx * photo.W : p.x;
      const cy = inside ? b.cy * photo.H : p.y;
      if (!inside) setBox(clampBox(photo, { ...b, cx: p.x / photo.W, cy: p.y / photo.H }));
      gesture.current = { mode: 'move', start: { dx: p.x - cx, dy: p.y - cy } };
    }
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!photo || !g || !pts.current.has(e.pointerId)) return;
    const p = toImg(e);
    pts.current.set(e.pointerId, p);
    const b = box;
    const short = shortOf(photo);
    if (g.mode === 'pinch' && pts.current.size >= 2) {
      const [a, c] = [...pts.current.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      setBox(clampBox(photo, { ...b, s: g.start.s * (d / g.start.d) }));
    } else if (g.mode === 'resize') {
      const { sx, sy, ax, ay } = g.start;
      const side = Math.max((p.x - ax) * sx, (p.y - ay) * sy);
      const maxSide = Math.min(sx > 0 ? photo.W - ax : ax, sy > 0 ? photo.H - ay : ay);
      const sPx = Math.min(side, maxSide);
      setBox(clampBox(photo, { s: sPx / short, cx: (ax + sx * sPx / 2) / photo.W, cy: (ay + sy * sPx / 2) / photo.H }));
    } else if (g.mode === 'move') {
      setBox(clampBox(photo, { ...b, cx: (p.x - g.start.dx) / photo.W, cy: (p.y - g.start.dy) / photo.H }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 1 && gesture.current?.mode === 'pinch' && photo) {
      const p = [...pts.current.values()][0];
      gesture.current = { mode: 'move', start: { dx: p.x - box.cx * photo.W, dy: p.y - box.cy * photo.H } };
      return;
    }
    if (!pts.current.size) {
      gesture.current = null;
      setDragging(false);
      setActiveHandle('');
    }
  };

  const top = result ? topResults(result).slice(0, 3) : [];
  const band = result ? (result.band === 'possibly' && top.length < 2 ? 'unsure' : result.band) : '';
  const lead = band === 'likely' ? 1 : band === 'possibly' ? 2 : 0;
  const headlineNode = !result ? null
    : band === 'likely' ? <><span className="scan-band">Likely<span className="sr-only">:</span></span> <span className="scan-verdict-name">{top[0]?.sp.name}</span></>
    : band === 'possibly' ? <><span className="scan-band">Possibly</span> <span className="scan-verdict-name">{top[0]?.sp.name} or {top[1]?.sp.name}</span></>
    : <span className="scan-verdict-name">Can't tell from this photo</span>;
  const advice = result ? scanAdvice(result, { whole: result.whole, multi, kind, known: info }) : '';
  const boxAt = photo ? boxPct(photo, box) : undefined;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setStageW(stage.clientWidth));
    observer.observe(stage);
    setStageW(stage.clientWidth);
    return () => observer.disconnect();
  }, [photo]);

  const boxScreenPx = photo ? (box.s * shortOf(photo) / photo.W) * stageW : 0;

  const renderCard = (x: any, i: number) => {
    if (!result) return null;
    const sp = x.sp;
    const refs = scanRefs(sp.id);
    const credits = refs.filter((p2: any) => p2.credit).map((p2: any) => String(p2.credit).slice(0, 40));
    const level = bandLevel(x.p, result.bands);
    return (
      <article key={sp.id} className={`scan-card kind--${sp.kind} ${i < lead ? 'scan-card--lead' : ''}${rise ? ' scan-rise' : ''}`} style={{ '--i': i } as CSSProperties}>
        <div className="scan-strip">
          <figure className="scan-yours">{yours ? <img src={yours} alt="Your photo" /> : <span className="scan-tile-missing" />}<figcaption>Yours</figcaption></figure>
          {[0, 1].map((j) => <RefTile key={j} item={refs[j]} name={sp.name} />)}
        </div>
        <div className="scan-card-body">
          {credits.length > 0 && <p className="scan-credit">Photos: {words(credits, 'and')}{refs.some((p2: any) => p2.from && p2.credit) ? ` (${refs.find((p2: any) => p2.credit)?.from || ''})` : ''}</p>}
          <div className="scan-card-head"><h3><Link to={`/bird/${sp.id}`}>{sp.name}</Link></h3><span className="scan-kind">{KINDS[sp.kind]?.one}</span>{!seen.has(sp.id) && <span className="scan-new">New for your dex</span>}</div>
          {sp.notes && <p className="scan-tip">{firstSentence(sp.notes)}</p>}
          <div className="scan-card-foot">
            <div className={`scan-conf scan-conf--${level}`}><p><strong>{bandWord(level)}</strong> <span>{pct(x.p)}</span></p><span className="scan-bar" aria-hidden="true"><i style={{ '--p': Math.max(0.02, Math.min(1, x.p)).toFixed(3) } as CSSProperties} /></span></div>
            <button type="button" className={`btn scan-this ${i < lead ? 'btn--primary' : 'scan-this--soft'}`} onClick={() => void chosen(sp.id)} aria-label={`This one: ${sp.name}`}>This one</button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="scan">
      <section className="scan-cam" data-hero-zone>
        <header className="page-head page-head--back scan-head">
          <Link className="iconbtn" to="/dex" aria-label="Back to the dex"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link>
          <div><h1>Scan a photo</h1><p className="small">{intro}</p></div>
        </header>
        <div className="scan-cam-body">
          <section className={`scan-vf${!photo ? ' scan-vf--empty' : ''}${busy ? ' scan-vf--busy' : ''}`} aria-label="Photo">
            {!photo ? (
              <>
                <div className="scan-frame">
                  <span className="scan-corners" aria-hidden="true" />
                  <div className="scan-entry"><span className="scan-entry-icon"><Icon name="scan" /></span><p>Works best when {subject ? `the ${subject}` : 'it'} fills a good part of the frame.</p></div>
                </div>
                <div className="scan-pick">
                  <label className="scan-pickbtn scan-pickbtn--main"><span className="scan-shutter"><Icon name="cam" /></span><span>Take a photo</span><input type="file" accept="image/*" capture="environment" className="scan-file" onChange={(e) => void pick(e.target.files?.[0])} /></label>
                  <label className="scan-pickbtn scan-pickbtn--side"><span className="scan-pickicon"><GalleryIcon /></span><span>Choose from gallery</span><input type="file" accept="image/*" className="scan-file" onChange={(e) => void pick(e.target.files?.[0])} /></label>
                </div>
              </>
            ) : (
              <div ref={stageRef} className={`scan-stage${whole ? ' scan-stage--whole' : ''}${dragging ? ' scan-stage--drag' : ''}`} tabIndex={0} role="application"
                aria-label={whole ? 'Your photo. The whole photo will be identified.' : 'Your photo with the identify box. Arrow keys move the box, plus and minus change its size.'}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <div className="scan-photo">
                  <img src={photo.url} alt="" draggable={false} />
                  <span className="scan-dim" aria-hidden="true" style={boxAt} />
                  <span className="scan-corners scan-corners--photo" aria-hidden="true" />
                  <span className="scan-sweep scan-sweep--whole" aria-hidden="true" />
                </div>
                {!whole && (
                  <div className={`scan-box${boxScreenPx > 0 && boxScreenPx < 110 ? ' scan-box--small' : ''}${land ? ' scan-box--land' : ''}`} data-box style={boxAt}>
                    <span className="scan-sweep" aria-hidden="true" />
                    {['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className={`scan-handle scan-handle--${c}${activeHandle === c ? ' is-active' : ''}`} data-handle={c} />)}
                  </div>
                )}
                <span className="scan-pips" aria-hidden="true">{progress?.phase === 'view' && Array.from({ length: progress.count || 0 }, (_, i) => <i key={i} className={i < (progress.index || 0) - 1 ? 'on' : i === (progress.index || 0) - 1 ? 'now' : ''} />)}</span>
              </div>
            )}
          </section>
          {photo && (
            <>
              <div className="scan-tools">
                <p className="scan-hint">{whole ? 'The whole photo will be identified.' : subject ? `Drag the box onto the ${subject}. Pull a corner to resize.` : 'Drag the box onto what you want named. Pull a corner to resize.'}</p>
                <div className="scan-tool-row">
                  <button type="button" className="scan-chip scan-chip--whole" data-whole aria-pressed={whole} onClick={() => setWhole((v) => !v)}><i aria-hidden="true" />Whole photo</button>
                  <label className="scan-chip scan-change"><GalleryIcon /><span>Change photo</span><input type="file" accept="image/*" className="scan-file" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} /></label>
                </div>
              </div>
              {multi && (
                <div ref={kindsRef} className="scan-kinds" role="group" aria-label="What kind is it?">
                  <button type="button" className="scan-chip" aria-pressed={!kind} onClick={() => setKind('')}>Anything</button>
                  {covered.map((k) => <button key={k} type="button" className={`scan-chip kind--${k}`} aria-pressed={kind === k} onClick={() => setKind(k)}><i aria-hidden="true" />{KINDS[k].label}</button>)}
                </div>
              )}
              {/* Busy is aria-disabled only, as in v1: a disabled button would drop focus to the page. identify() ignores taps while busy. */}
              <button type="button" className="scan-go" onClick={() => void identify()} aria-disabled={busy || undefined}><span className="scan-go-ico"><Icon name="scan" /></span><span>{busy ? 'Identifying…' : 'Identify'}</span></button>
            </>
          )}
          <div ref={workRef} className="scan-work">
            <p className="scan-status" role="status" aria-live="polite">{status}</p>
            {/* Always present, as in v1: scan.css collapses .scan-work only when both the status and this are empty. */}
            <div className="scan-progress" aria-hidden="true">{progress?.phase === 'model' && <><div className="meter"><span style={{ width: `${Math.round(progress.frac * 100)}%` }} /></div><p className="scan-mb">{Math.round(progress.frac * photoModelMb())} of {photoModelMb()} MB</p></>}</div>
          </div>
        </div>
      </section>

      <div className="scan-sheet pad-x">
        <section ref={resultRef} className="scan-result" aria-labelledby="scan-verdict">
          {error && <p className="form-error" role="alert">{error}</p>}
          {needsReload && <button type="button" className="btn btn--primary btn--block" onClick={() => window.location.reload()}>Reload BirdyDex</button>}
          {result && top.length > 0 && (
            <>
              <div className={`scan-verdict-wrap scan-verdict-wrap--${band}${rise ? ' scan-rise' : ''}`} style={{ '--i': 0 } as CSSProperties}>
                <div className="scan-ring" aria-hidden="true" style={{ '--p': band === 'unsure' ? 0 : sure } as CSSProperties}>
                  <svg viewBox="0 0 80 80"><circle className="scan-ring-track" cx="40" cy="40" r="34" pathLength="100" /><circle className="scan-ring-fill" cx="40" cy="40" r="34" pathLength="100" /></svg>
                  {band === 'unsure' ? <b className="scan-ring-q">?</b> : <b className="scan-ring-n"><span ref={ringNRef}>{sure}</span><small>%</small></b>}
                </div>
                <div className="scan-verdict-text">
                  <h2 className={`scan-verdict scan-verdict--${band}`} id="scan-verdict" tabIndex={-1}>{headlineNode}</h2>
                  <p className="scan-next">{advice}</p>
                </div>
              </div>
              <div className="scan-cards">
                {top.slice(0, lead).map(renderCard)}
                {top.length > lead && <h3 className={`scan-also${rise ? ' scan-rise' : ''}`} style={{ '--i': 1 } as CSSProperties}>{lead ? 'Also worth comparing' : 'Closest matches'}</h3>}
                {top.slice(lead).map((x: any, i: number) => renderCard(x, lead + i))}
              </div>
              <section className={`scan-none${rise ? ' scan-rise' : ''}`} style={{ '--i': 3 } as CSSProperties} aria-labelledby="scan-none-h">
                <h3 id="scan-none-h">None of these?</h3>
                <div className="scan-none-acts">
                  <button type="button" className="btn" onClick={() => {
                    none();
                    const wasWhole = whole;
                    if (!wasWhole) setBox((b) => clampBox(photo!, { ...b, s: b.s * 0.75 }));
                    setWhole(false);
                    setStatus(`Move the ${wasWhole ? '' : 'smaller '}box onto just the part you want named, then choose Identify.`);
                    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    stageRef.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
                    stageRef.current?.focus({ preventScroll: true });
                  }}>Try a tighter box</button>
                  {multi && <button type="button" className="btn" onClick={() => {
                    none();
                    setStatus('Choose what kind it is, then try again.');
                    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    kindsRef.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
                    (kindsRef.current?.querySelector('[aria-pressed="true"]') as HTMLElement | null)?.focus();
                  }}>Pick a kind</button>}
                  <button type="button" className="btn" data-search="" onClick={() => { none(); openSearch(); }}>Search the dex</button>
                </div>
              </section>
            </>
          )}
        </section>
        <p className="scan-foot">{scanFootnote(info)}</p>
      </div>
    </div>
  );
}

// True when a newer release is installed or deployed: its index.html loads a different entry chunk from the one
// this page runs. The service worker answers with the shell it has installed (also offline); without one this is
// the server's copy. Any doubt counts as no update.
async function releaseChanged() {
  const entry = (html: string) => /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)?.[1]
    ?? /<script\b[^>]*\bsrc="([^"]+)"[^>]*\btype="module"/.exec(html)?.[1];
  const mine = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  if (!mine) return false;
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    if (!res.ok) return false;
    const live = entry(await res.text());
    return !!live && live !== mine;
  } catch {
    return false;
  }
}

function makeYours(photo: Chosen, b: Box, whole: boolean) {
  const img = new Image(); img.src = photo.url;
  const n = 240, c = document.createElement('canvas'); c.width = c.height = n;
  const cx = c.getContext('2d');
  if (!cx) return '';
  cx.imageSmoothingQuality = 'high';
  if (whole) {
    const k = n / Math.max(photo.W, photo.H), w = photo.W * k, h = photo.H * k;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, n, n); cx.drawImage(img, (n - w) / 2, (n - h) / 2, w, h);
  } else {
    const side = b.s * shortOf(photo);
    cx.drawImage(img, b.cx * photo.W - side / 2, b.cy * photo.H - side / 2, side, side, 0, 0, n, n);
  }
  try { return c.toDataURL('image/jpeg', 0.85); } catch { return ''; }
}
