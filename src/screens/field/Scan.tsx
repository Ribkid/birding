import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import {
  PHOTO_MODEL_MB,
  identifyPhoto,
  isPhotoModelCached,
  loadPhotoModel,
} from '../../core/photoid.js';
import { errorText, logSighting } from './sighting';
import './field.css';

const MAX_EDGE = 1600;
const LIKELY = 0.4;
const STRONG = 0.9;

interface ChosenPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface Crop {
  cx: number;
  cy: number;
  size: number;
}

interface Candidate {
  id: number;
  score: number;
}

type ModelPhase = 'checking' | 'loading' | 'ready' | 'error';

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** v1's square crop box, measured against the short side of the photo. */
function boxRect(photo: ChosenPhoto, crop: Crop) {
  const ar = photo.width / photo.height;
  const w = ar >= 1 ? crop.size / ar : crop.size;
  const h = ar >= 1 ? crop.size : crop.size * ar;
  const x = Math.min(Math.max(crop.cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(crop.cy - h / 2, 0), 1 - h);
  return { x, y, w, h };
}

/** Resize the photo the way v1 did before handing it to BioCLIP. */
async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await createImageBitmap(file);
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not read the photo.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('This browser could not prepare the photo.');
    return { blob, width, height };
  } finally {
    bmp.close();
  }
}

export default function Scan() {
  const seen = useSeen();
  const [modelPhase, setModelPhase] = useState<ModelPhase>('checking');
  const [cached, setCached] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Preparing the photo model');
  const [modelError, setModelError] = useState('');
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null);
  const [crop, setCrop] = useState<Crop>({ cx: 0.5, cy: 0.5, size: 1 });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [logged, setLogged] = useState<Record<number, 'saved' | 'error'>>({});

  const mountedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const runIdRef = useRef(0);

  // Warm the model as soon as the screen opens. loadPhotoModel is shared, so a
  // second mount (or StrictMode) reuses the same in-flight load instead of
  // downloading anything twice. It is never touched on app start.
  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    void (async () => {
      let already = false;
      try {
        already = await isPhotoModelCached();
      } catch {
        already = false;
      }
      if (!alive) return;
      setCached(already);
      setModelPhase('loading');
      setProgressLabel(
        already ? 'Loading the cached photo model' : `Downloading the photo model (about ${PHOTO_MODEL_MB} MB)`,
      );
      try {
        await loadPhotoModel((p: number, label?: string) => {
          if (!alive) return;
          setProgress(clamp(Number(p) || 0));
          setProgressLabel(already ? 'Loading the cached photo model' : label || 'Downloading the photo model');
        });
        if (!alive) return;
        setProgress(1);
        setProgressLabel('Ready');
        setModelPhase('ready');
      } catch (err) {
        if (!alive) return;
        setModelPhase('error');
        setModelError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Revoke every preview URL on unmount and stop any late async work updating state.
  useEffect(() => {
    mountedRef.current = true;
    const urls = urlsRef.current;
    return () => {
      mountedRef.current = false;
      urlRef.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const likelyCount = useMemo(
    () => (results ? results.filter((r) => r.score >= LIKELY).length : 0),
    [results],
  );

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not a photo. Choose an image from your camera or library.');
      return;
    }
    setError('');
    setStatus('');
    setResults(null);
    setLogged({});
    try {
      const prepared = await preparePhoto(file);
      if (!mountedRef.current) return;
      runIdRef.current += 1;
      setBusy(false);
      const url = URL.createObjectURL(prepared.blob);
      const previous = urlRef.current;
      urlRef.current = url;
      urlsRef.current.add(url);
      setPhoto({ ...prepared, url });
      setCrop({ cx: 0.5, cy: 0.5, size: 1 });
      if (previous) {
        window.setTimeout(() => {
          URL.revokeObjectURL(previous);
          urlsRef.current.delete(previous);
        }, 1000);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(`That photo couldn't be read: ${errorText(err)}`);
    }
  };

  const moveCrop = (e: MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = clamp((e.clientX - r.left) / r.width);
    const cy = clamp((e.clientY - r.top) / r.height);
    setCrop((c) => ({ cx, cy, size: c.size === 1 ? 0.5 : c.size }));
    runIdRef.current += 1;
    setBusy(false);
    setResults(null);
    setStatus('');
  };

  const keyCrop = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    let dx = 0;
    let dy = 0;
    let ds = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === '+' || e.key === '=') ds = 0.05;
    else if (e.key === '-') ds = -0.05;
    else return;
    e.preventDefault();
    setCrop((c) => ({
      cx: clamp(c.cx + dx),
      cy: clamp(c.cy + dy),
      size: clamp(c.size + ds, 0.15, 1),
    }));
    runIdRef.current += 1;
    setBusy(false);
    setResults(null);
    setStatus('');
  };

  const identify = async () => {
    if (!photo || busy) return;
    const run = ++runIdRef.current;
    const current = photo;
    const currentCrop = crop;
    setBusy(true);
    setError('');
    setResults(null);
    setLogged({});
    setStatus(modelPhase === 'ready' ? 'Looking closely…' : 'Waiting for the photo model…');
    try {
      if (modelPhase !== 'ready') {
        try {
          await loadPhotoModel((p: number, label?: string) => {
            if (!mountedRef.current || run !== runIdRef.current) return;
            setProgress(clamp(Number(p) || 0));
            setProgressLabel(label || 'Downloading the photo model');
          });
        } catch (err) {
          if (!mountedRef.current || run !== runIdRef.current) return;
          setModelPhase('error');
          setModelError(errorText(err));
          setStatus('');
          setError(`Photo ID couldn't run here: ${errorText(err)}`);
          return;
        }
        if (!mountedRef.current || run !== runIdRef.current) return;
        setProgress(1);
        setProgressLabel('Ready');
        setModelPhase('ready');
      }
      setStatus('Looking closely…');
      const res = (await identifyPhoto(current.blob, {
        crop: currentCrop.size < 1 ? boxRect(current, currentCrop) : undefined,
        topK: 5,
      })) as Candidate[];
      if (!mountedRef.current || run !== runIdRef.current) return;
      setResults(res);
      const top = res[0]?.score ?? 0;
      setStatus(
        top >= STRONG
          ? 'Strong match. Best guess first.'
          : top >= LIKELY
            ? 'Not certain. Compare the photos below.'
            : 'Not sure. It may not be one of the dex birds. Try a tighter box or a sharper photo.',
      );
    } catch (err) {
      if (!mountedRef.current || run !== runIdRef.current) return;
      setStatus('');
      setError(`Photo ID couldn't run here: ${errorText(err)}`);
    } finally {
      if (mountedRef.current && run === runIdRef.current) setBusy(false);
    }
  };

  const addToDex = async (sp: Species) => {
    if (!photo || savingId !== null) return;
    setSavingId(sp.id);
    setError('');
    try {
      await logSighting({
        speciesId: sp.id,
        notes: 'Identified from a photo with BioCLIP.',
        photoBlob: photo.blob,
      });
      if (!mountedRef.current) return;
      setLogged((prev) => ({ ...prev, [sp.id]: 'saved' }));
      setStatus(`${sp.name} added to your dex.`);
      navigator.vibrate?.(30);
    } catch (err) {
      if (!mountedRef.current) return;
      setLogged((prev) => ({ ...prev, [sp.id]: 'error' }));
      setError(`Could not save that sighting: ${errorText(err)}`);
    } finally {
      if (mountedRef.current) setSavingId(null);
    }
  };

  const pct = Math.round(progress * 100);
  const rect = photo ? boxRect(photo, crop) : null;
  const topScore = results?.[0]?.score ?? null;
  const notSure = topScore !== null && topScore < LIKELY;

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/dex" aria-label="Back to the dex">
          <Icon name="back" />
        </Link>
        <div>
          <h1>Scan a bird</h1>
          <p className="muted small">Take a photo or pick one, and BioCLIP suggests which dex bird it is.</p>
        </div>
      </header>

      <div className="scan pad-x">
        <section
          className={`field-model ${modelPhase === 'error' ? 'field-model--error' : ''}`}
          aria-label="Photo model"
        >
          <div className="field-model-h">
            <strong>On-device photo model</strong>
            <span className={`field-pill ${modelPhase === 'ready' ? 'field-pill--ok' : ''}`}>
              {modelPhase === 'ready'
                ? 'Ready'
                : modelPhase === 'error'
                  ? 'Unavailable'
                  : modelPhase === 'checking'
                    ? 'Checking'
                    : 'Loading'}
            </span>
          </div>
          {modelPhase === 'ready' ? (
            <p className="small muted field-model-note">
              {cached
                ? 'Ready. It was already saved on this phone, so nothing was downloaded.'
                : `Ready. It stays on this phone, so next time it won't download the ${PHOTO_MODEL_MB} MB again.`}
            </p>
          ) : modelPhase === 'error' ? (
            <p className="small field-model-note" role="alert">
              {modelError} You can try again by identifying a photo.
            </p>
          ) : (
            <>
              <p className="small muted field-model-note">
                {progressLabel} — {pct}%
              </p>
              <div
                className="meter meter--thin"
                role="progressbar"
                aria-label="Photo model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <span style={{ '--p': `${pct}%` } as CSSProperties} />
              </div>
              <p className="small muted field-model-note">
                About {PHOTO_MODEL_MB} MB the first time. Best on Wi-Fi; it works offline afterwards.
              </p>
            </>
          )}
        </section>

        <div className="scan-pick">
          <input
            ref={fileInputRef}
            id="scan-file"
            className="scan-file"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            tabIndex={photo ? -1 : 0}
            aria-label="Take or choose a photo"
          />
          {!photo && (
            <label className="scan-drop" htmlFor="scan-file">
              <span className="scan-preview">
                <Icon name="scan" />
                <strong>Take or choose a photo</strong>
                <em>Works best when the bird fills a good part of the frame</em>
              </span>
            </label>
          )}
        </div>

        {photo && (
          <div className="crop">
            {/* The photo is the click target as well as the visual reference. */}
            <div
              className="crop-stage"
              role="group"
              tabIndex={0}
              aria-label="Photo crop box. Click or tap the bird to centre the box, or use the arrow keys to move it and plus or minus to resize it."
              aria-describedby="scan-crop-hint"
              onClick={moveCrop}
              onKeyDown={keyCrop}
            >
              <img ref={imgRef} src={photo.url} alt="Your photo" draggable={false} />
              {rect && (
                <span
                  className="crop-box"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                />
              )}
            </div>
            <p className="small muted" id="scan-crop-hint">
              Tap the bird so the box sits on it. A tight box gives much better answers for distant birds.
              With a keyboard, use the arrow keys to move the box and plus or minus to resize it.
            </p>
            <label className="field">
              <span>Box size</span>
              <input
                type="range"
                min={15}
                max={100}
                value={Math.round(crop.size * 100)}
                onChange={(e) => {
                  setCrop((c) => ({ ...c, size: Number(e.target.value) / 100 }));
                  runIdRef.current += 1;
                  setBusy(false);
                  setResults(null);
                  setStatus('');
                }}
              />
            </label>
            <div className="row-start">
              <button className="btn btn--primary" onClick={() => void identify()} disabled={busy} aria-busy={busy}>
                {busy ? 'Working…' : 'Identify this bird'}
              </button>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                Use another photo
              </button>
            </div>
          </div>
        )}

        <p className="small muted field-status" role="status" aria-live="polite">
          {status}
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {notSure && (
          <p className="empty-inline">
            Not sure. The best guess is only {Math.round((topScore ?? 0) * 100)}% confident, so it may not be one
            of the dex birds. Try a tighter box or a sharper photo.
          </p>
        )}

        {results && (
          <>
            <div className="block-h">
              <h2 className="h2">Best guesses</h2>
              <span className="small muted">
                {likelyCount} likely · {results.length - likelyCount} possibly
              </span>
            </div>
            <ul className="rows" aria-live="polite" aria-busy={busy}>
              {results.map((r) => {
                const sp = byId.get(r.id);
                if (!sp) return null;
                const score = Math.round(r.score * 100);
                const band = r.score >= LIKELY ? 'likely' : 'possibly';
                const state = logged[sp.id];
                return (
                  <li className="hit" key={r.id}>
                    <Link className="row-thumb" to={`/bird/${sp.id}`} aria-label={`Open ${sp.name}`}>
                      <SpeciesImage sp={sp} />
                    </Link>
                    <span className="row-main">
                      <strong>{sp.name}</strong>
                      <span className="small muted">
                        {score}% sure ·{' '}
                        <span className={`hit-band hit-band--${band}`}>{band}</span>
                        {seen.has(sp.id) ? '' : '. New for your dex!'}
                      </span>
                      <span className="meter meter--thin" style={{ '--p': `${score}%` } as CSSProperties}>
                        <span />
                      </span>
                    </span>
                    <button
                      className="btn btn--small"
                      onClick={() => void addToDex(sp)}
                      disabled={state === 'saved' || savingId !== null}
                      aria-label={
                        state === 'saved' ? `${sp.name} added to your dex` : `Add ${sp.name} to your dex`
                      }
                    >
                      {state === 'saved' ? 'Added' : savingId === sp.id ? 'Saving…' : 'Add to dex'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p className="small muted field-footnote">
          Photo ID uses BioCLIP (Imageomics Institute, MIT licence) running on your phone. The first scan downloads
          the model (about {PHOTO_MODEL_MB} MB, best on Wi-Fi), then it works offline. In testing it named the right
          bird first about 6 times in 10, and 8 in 10 when it was very sure, so compare with the photos before you
          log.
        </p>
      </div>
    </>
  );
}
