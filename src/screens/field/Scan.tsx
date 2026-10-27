import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KINDS, type ScanResult } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { resizeImage } from '../../core/profile.js';
import {
  photoIdInfo, identifyScan, modelCached, ensureModel, photoModelMb, scanSubject, scanFootnote,
  topResults, scanHeadline, scanAdvice, bandLevel, bandWord, pct, words, article, firstSentence,
  scanRefs, markChosen,
} from '../../core/scan.js';
import { setPending } from './scanHandoff';
import './scan.css';

const KEEP_MS = 30 * 60 * 1000;
interface Chosen { file: File; blob: Blob; url: string; W: number; H: number }
interface Box { cx: number; cy: number; s: number }

const shortOf = (p: Chosen) => Math.min(p.W, p.H);
function boxPct(photo: Chosen, b: Box) {
  const side = b.s * shortOf(photo);
  return { left: `${(b.cx * photo.W - side / 2) / photo.W * 100}%`, top: `${(b.cy * photo.H - side / 2) / photo.H * 100}%`, width: `${side / photo.W * 100}%`, height: `${side / photo.H * 100}%` };
}
function clampBox(photo: Chosen, b: Box): Box {
  const s = Math.min(1, Math.max(0.08, b.s));
  const hw = s * shortOf(photo) / (2 * photo.W), hh = s * shortOf(photo) / (2 * photo.H);
  return { s, cx: Math.min(Math.max(b.cx, hw), 1 - hw), cy: Math.min(Math.max(b.cy, hh), 1 - hh) };
}

export default function Scan() {
  const navigate = useNavigate();
  const seen = useSeen();
  const [info, setInfo] = useState<any>(null);
  const [photo, setPhoto] = useState<Chosen | null>(null);
  const [box, setBox] = useState<Box>({ cx: 0.5, cy: 0.5, s: 0.75 });
  const [whole, setWhole] = useState(false);
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ phase: 'model' | 'view'; frac: number; index?: number; count?: number } | null>(null);
  const [result, setResult] = useState<(ScanResult & { whole: boolean; kind: string }) | null>(null);
  const [logAt, setLogAt] = useState<number | null>(null);
  const [yours, setYours] = useState('');
  const [error, setError] = useState('');
  const [at, setAt] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; id: number; start: { x: number; y: number; cx: number; cy: number; s: number } } | null>(null);

  const covered: string[] = info?.kinds?.filter((k: string) => KINDS[k]) || [];
  const multi = covered.length > 1;
  const subject = scanSubject({ kinds: covered }, kind);
  const intro = covered.length
    ? `Name ${article(KINDS[covered[0]].one)} ${words(covered.map((k) => KINDS[k].one))} from a photo, right on your phone.`
    : 'Find out what you photographed, right on your phone.';

  useEffect(() => {
    if (at && Date.now() - at > KEEP_MS) { setPhoto(null); setResult(null); setAt(0); }
    void photoIdInfo().then((i: any) => setInfo(i));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      if (!photo || whole || busy) return;
      const step = 0.02;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) setBox((b) => clampBox(photo, { ...b, cx: b.cx + moves[e.key][0], cy: b.cy + moves[e.key][1] }));
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
    setStatus('Opening the photo…');
    let img: HTMLImageElement | null = null;
    try {
      const blob = await resizeImage(file, 1600);
      if (!blob) throw new Error('unreadable');
      const url = URL.createObjectURL(blob);
      img = new Image();
      img.src = url;
      await img.decode();
      setPhoto({ file, blob, url, W: img.naturalWidth, H: img.naturalHeight });
      setAt(Date.now());
      setResult(null); setLogAt(null); setError(''); setYours('');
      setBox({ cx: 0.5, cy: 0.5, s: 0.75 });
      setStatus(`Photo ready. Move the box onto ${subject ? `the ${subject}` : 'what you want named'}, then choose Identify.`);
    } catch {
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
    setBusy(true); setError(''); setResult(null); setStatus('Starting photo ID…');
    const MB = photoModelMb();
    try {
      const cached = await modelCached();
      if (!cached) {
        if (navigator.onLine === false) throw new Error('offline-first-run');
        setStatus(`Getting photo ID ready: a one-time download of about ${MB} MB. Wi-Fi is best.`);
        await ensureModel((f: number) => setProgress({ phase: 'model', frac: f }));
      } else {
        await ensureModel();
      }
      setProgress(null);
      const month = new Date(photo.file.lastModified || Date.now()).getMonth() + 1;
      const { res, logAt: logged } = await identifyScan(photo.file, {
        crop: cropFractions(), kinds: kind ? [kind] : null, month,
        onProgress: (x: any) => { if (x.phase === 'view') { setProgress({ phase: 'view', frac: 0, index: x.index, count: x.count }); setStatus(`Looking closely, ${x.index} of ${x.count}`); } },
      } as any);
      setResult({ ...res, whole, kind });
      setLogAt(logged);
      setYours(makeYours(photo, box, whole));
      setStatus('');
    } catch (err: any) {
      const msg = /offline-first-run|Failed to fetch|NetworkError|network/i.test(String(err?.message || err))
        ? `Photo ID needs a one-time download of about ${MB} MB. Connect to the internet (Wi-Fi is best) and try again.`
        : `Photo ID couldn't run: ${err?.message || err}`;
      setError(msg); setStatus('');
    } finally { setBusy(false); setProgress(null); }
  };

  const chosen = async (id: number) => {
    await markChosen(logAt, id);
    if (photo) setPending({ blob: photo.blob, notes: 'Identified from a photo.', autoGps: true });
    navigate(`/add?species=${id}`, { state: { scan: true } });
  };
  const none = (why: string) => { void markChosen(logAt, 'none'); setStatus(why); };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!photo || whole || busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const handle = (e.target as HTMLElement).closest('[data-handle]') as HTMLElement | null;
    const inside = (e.target as HTMLElement).closest('[data-box]');
    if (handle) drag.current = { mode: 'resize', id: e.pointerId, start: { ...p, cx: box.cx, cy: box.cy, s: box.s } };
    else {
      if (!inside) setBox((b) => clampBox(photo, { ...b, cx: p.x, cy: p.y }));
      drag.current = { mode: 'move', id: e.pointerId, start: { ...p, cx: inside ? box.cx : p.x, cy: inside ? box.cy : p.y, s: box.s } };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!photo || !d || d.id !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (d.mode === 'move') setBox((b) => clampBox(photo, { ...b, cx: d.start.cx + (p.x - d.start.x), cy: d.start.cy + (p.y - d.start.y) }));
    else {
      const sideX = Math.abs(p.x - d.start.cx) * 2 * photo.W / shortOf(photo);
      const sideY = Math.abs(p.y - d.start.cy) * 2 * photo.H / shortOf(photo);
      setBox((b) => clampBox(photo, { ...b, s: Math.max(sideX, sideY) }));
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  const top = result ? topResults(result).slice(0, 3) : [];
  const lead = result?.band === 'likely' ? 1 : result?.band === 'possibly' ? 2 : 0;
  const headline = result ? scanHeadline(result) : '';
  const advice = result ? scanAdvice(result, { whole: result.whole, multi, kind, known: info }) : '';
  const sure = result ? Math.min(99, Math.max(1, Math.round((result.results[0]?.p || 0) * 100))) : 0;
  const boxAt = photo ? boxPct(photo, box) : undefined;

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
                  <div className="scan-entry"><span className="scan-entry-icon">◱</span><p>Works best when {subject ? `the ${subject}` : 'it'} fills a good part of the frame.</p></div>
                </div>
                <div className="scan-pick">
                  <label className="scan-pickbtn scan-pickbtn--main"><span className="scan-shutter">◉</span><span>Take a photo</span><input type="file" accept="image/*" capture="environment" className="scan-file" onChange={(e) => void pick(e.target.files?.[0])} /></label>
                  <label className="scan-pickbtn scan-pickbtn--side"><span className="scan-pickicon">▣</span><span>Choose from gallery</span><input type="file" accept="image/*" className="scan-file" onChange={(e) => void pick(e.target.files?.[0])} /></label>
                </div>
              </>
            ) : (
              <div ref={stageRef} className={`scan-stage${whole ? ' scan-stage--whole' : ''}`} tabIndex={0} role="application"
                aria-label={whole ? 'Your photo. The whole photo will be identified.' : 'Your photo with the identify box. Arrow keys move the box, plus and minus change its size.'}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <div className="scan-photo">
                  <img src={photo.url} alt="" draggable={false} />
                  <span className="scan-dim" aria-hidden="true" />
                  <span className="scan-corners scan-corners--photo" aria-hidden="true" />
                  <span className="scan-sweep scan-sweep--whole" aria-hidden="true" />
                </div>
                {!whole && (
                  <div className="scan-box" data-box style={boxAt}>
                    <span className="scan-sweep" aria-hidden="true" />
                    {['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className={`scan-handle scan-handle--${c}`} data-handle={c} />)}
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
                  <label className="scan-chip scan-change"><span>Change photo</span><input type="file" accept="image/*" className="scan-file" onChange={(e) => void pick(e.target.files?.[0])} /></label>
                </div>
              </div>
              {multi && (
                <div className="scan-kinds" role="group" aria-label="What kind is it?">
                  <button type="button" className={`scan-chip ${kind ? `kind--${kind}` : ''}`} aria-pressed={!kind} onClick={() => setKind('')}>Anything</button>
                  {covered.map((k) => <button key={k} type="button" className={`scan-chip kind--${k}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{KINDS[k].label}</button>)}
                </div>
              )}
              <button type="button" className="scan-go" disabled={busy} onClick={() => void identify()} aria-disabled={busy}><span>◱</span><span>{busy ? 'Identifying…' : 'Identify'}</span></button>
            </>
          )}
          <div className="scan-work">
            <p className="scan-status" role="status" aria-live="polite">{status}</p>
            {progress?.phase === 'model' && <div className="scan-progress"><div className="meter"><span style={{ width: `${Math.round(progress.frac * 100)}%` }} /></div><p className="scan-mb">{Math.round(progress.frac * photoModelMb())} of {photoModelMb()} MB</p></div>}
          </div>
        </div>
      </section>

      <div className="scan-sheet pad-x">
        <section className="scan-result" aria-labelledby="scan-verdict">
          {error && <p className="form-error" role="alert">{error}</p>}
          {result && top.length > 0 && (
            <>
              <div className={`scan-verdict-wrap scan-verdict-wrap--${result.band}`}>
                <div className="scan-ring" aria-hidden="true" style={{ '--p': sure } as CSSProperties}>
                  <svg viewBox="0 0 80 80"><circle className="scan-ring-track" cx="40" cy="40" r="34" pathLength="100" /><circle className="scan-ring-fill" cx="40" cy="40" r="34" pathLength="100" /></svg>
                  {result.band === 'unsure' ? <b className="scan-ring-q">?</b> : <b className="scan-ring-n"><span>{sure}</span><small>%</small></b>}
                </div>
                <div className="scan-verdict-text">
                  <h2 className={`scan-verdict scan-verdict--${result.band}`} id="scan-verdict" tabIndex={-1}>{headline}</h2>
                  <p className="scan-next">{advice}</p>
                </div>
              </div>
              <div className="scan-cards">
                {top.map((x: any, i: number) => {
                  const sp = x.sp;
                  const refs = scanRefs(sp.id);
                  const level = bandLevel(x.p, result.bands);
                  return (
                    <article key={sp.id} className={`scan-card kind--${sp.kind} ${i < lead ? 'scan-card--lead' : ''}`}>
                      <div className="scan-strip">
                        <figure className="scan-yours">{yours ? <img src={yours} alt="Your photo" /> : <span className="scan-tile-missing" />}<figcaption>Yours</figcaption></figure>
                        {[0, 1].map((j) => refs[j] ? <img key={j} src={refs[j].src} alt={`${sp.name}, reference photo`} loading="lazy" decoding="async" /> : <span key={j} className="scan-tile-missing" />)}
                      </div>
                      <div className="scan-card-body">
                        <div className="scan-card-head"><h3><Link to={`/bird/${sp.id}`}>{sp.name}</Link></h3><span className="scan-kind">{KINDS[sp.kind]?.one}</span>{!seen.has(sp.id) && <span className="scan-new">New for your dex</span>}</div>
                        {sp.notes && <p className="scan-tip">{firstSentence(sp.notes)}</p>}
                        <div className="scan-card-foot">
                          <div className={`scan-conf scan-conf--${level}`}><p><strong>{bandWord(level)}</strong> <span>{pct(x.p)}</span></p><span className="scan-bar" aria-hidden="true"><i style={{ '--p': Math.max(0.02, Math.min(1, x.p)).toFixed(3) } as CSSProperties} /></span></div>
                          <button type="button" className={`btn scan-this ${i < lead ? 'btn--primary' : 'scan-this--soft'}`} onClick={() => void chosen(sp.id)} aria-label={`This one: ${sp.name}`}>This one</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <section className="scan-none" aria-labelledby="scan-none-h">
                <h3 id="scan-none-h">None of these?</h3>
                <div className="scan-none-acts">
                  <button type="button" className="btn" onClick={() => { none('Move the box onto just the part you want named, then choose Identify.'); setWhole(false); setBox((b) => clampBox(photo!, { ...b, s: b.s * 0.75 })); }}>Try a tighter box</button>
                  {multi && <button type="button" className="btn" onClick={() => none('Choose what kind it is, then try again.')}>Pick a kind</button>}
                  <Link className="btn" to="/dex">Search the dex</Link>
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
