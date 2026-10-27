import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { loadListenModel, setLocation, startListening, stopListening } from '../../core/listen.js';
import { errorText, logSighting } from './sighting';
import './field.css';
import './calls.css';

// The v1 copy quotes about 60 MB for the first sound-model download.
const LISTEN_MODEL_MB = 60;
const THRESHOLD = 0.3;

interface Detection {
  index: number;
  name: string;
  sci: string;
  confidence: number;
  dexId: number | null;
}

interface Hit extends Detection {
  best: number;
  last: number;
}

type ModelPhase = 'loading' | 'ready' | 'error';
type LocPhase = 'idle' | 'requesting' | 'set' | 'error';

function agoText(last: number): string {
  const secs = Math.max(0, Math.round((Date.now() - last) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)} min ago`;
}

export default function Listen() {
  const seen = useSeen();
  const [modelPhase, setModelPhase] = useState<ModelPhase>('loading');
  const [modelPct, setModelPct] = useState(0);
  const [modelLabel, setModelLabel] = useState('Checking the sound model');
  const [modelError, setModelError] = useState('');
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState(
    'Point your phone towards the birds and keep still. The first time, the sound model downloads.',
  );
  const [error, setError] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [announce, setAnnounce] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [logged, setLogged] = useState<Record<number, 'saved' | 'error'>>({});
  const [locPhase, setLocPhase] = useState<LocPhase>('idle');
  const [locText, setLocText] = useState(
    'South East Queensland by default. Use your location only if you want the filter narrowed to where you are.',
  );

  const mountedRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelMeterRef = useRef<HTMLDivElement>(null);
  const levelTimerRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const hitIndexesRef = useRef<Set<number>>(new Set());
  const locRef = useRef<{ lat: number; lng: number } | null>(null);
  const seenRef = useRef(seen);

  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);

  // Stop the microphone and the meter on unmount (React Router unmounts this
  // screen on a route change) so nothing keeps recording in the background.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      if (levelTimerRef.current !== null) {
        window.clearInterval(levelTimerRef.current);
        levelTimerRef.current = null;
      }
      stopListening();
    };
  }, []);

  // Load the sound model when this screen opens (not at app start). listen.js
  // caches the worker promise, so re-mounting never loads it twice.
  useEffect(() => {
    let alive = true;
    loadListenModel((p: number, label?: string) => {
      if (!alive) return;
      const pct = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
      setModelPct(pct);
      if (label) setModelLabel(label);
      if (pct >= 100) setModelPhase('ready');
    })
      .then(() => {
        if (!alive) return;
        setModelPct(100);
        setModelLabel('Ready');
        setModelPhase('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setModelError(errorText(err));
        setModelLabel('The sound model could not load');
        setModelPhase('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  // The heard list shows relative times, so repaint it now and then.
  useEffect(() => {
    if (!hits.length) return;
    const id = window.setInterval(() => {
      if (mountedRef.current) setHits((prev) => prev.slice());
    }, 2000);
    return () => window.clearInterval(id);
  }, [hits.length]);

  // Post the area filter once the worker is ready too; a message sent while
  // the model was still loading can arrive before the worker is listening.
  useEffect(() => {
    if (modelPhase !== 'ready' || !listening) return;
    const loc = locRef.current;
    setLocation(loc?.lat ?? -27.47, loc?.lng ?? 153.02);
  }, [modelPhase, listening]);

  const stopLevelMeter = () => {
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    const el = levelMeterRef.current;
    if (el) {
      el.style.setProperty('--p', '0%');
      el.setAttribute('aria-valuenow', '0');
    }
  };

  // The spectrogram canvas is drawn from the live analyser by listen.js. Read
  // its newest column to show a real input-level meter without opening a
  // second microphone stream.
  const sampleLevel = () => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width < 2 || canvas.height < 1) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    try {
      const col = g.getImageData(canvas.width - 2, 0, 2, canvas.height).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < col.length; i += 4) {
        sum += col[i] * 0.2126 + col[i + 1] * 0.7152 + col[i + 2] * 0.0722;
        n += 1;
      }
      const mean = n ? sum / n : 0;
      // colour(0) is rgb(15,30,27), so just under 24 is silence; white is full scale.
      const pct = Math.max(0, Math.min(100, Math.round(((mean - 24) / 231) * 100)));
      const el = levelMeterRef.current;
      if (el) {
        el.style.setProperty('--p', `${pct}%`);
        el.setAttribute('aria-valuenow', String(Math.round(pct / 5) * 5));
      }
    } catch {
      // A canvas that cannot be read simply leaves the meter at zero.
    }
  };

  const startLevelMeter = () => {
    if (levelTimerRef.current !== null) window.clearInterval(levelTimerRef.current);
    levelTimerRef.current = window.setInterval(sampleLevel, 120);
  };

  const handleDetections = (incoming: Detection[]) => {
    if (!mountedRef.current || !Array.isArray(incoming) || !incoming.length) return;
    let wake = false;
    let firstNew: Detection | undefined;
    for (const d of incoming) {
      const isNew = !hitIndexesRef.current.has(d.index);
      hitIndexesRef.current.add(d.index);
      const sp = d.dexId !== null ? byId.get(d.dexId) : undefined;
      if (isNew && sp && !seenRef.current.has(sp.id)) wake = true;
      if (isNew && !firstNew) firstNew = d;
    }
    if (wake) navigator.vibrate?.(40);
    if (firstNew) {
      setAnnounce(`${firstNew.name}, ${Math.round(firstNew.confidence * 100)}% sure`);
    }
    const now = Date.now();
    setHits((prev) => {
      const map = new Map(prev.map((h) => [h.index, h]));
      for (const d of incoming) {
        const old = map.get(d.index);
        map.set(d.index, { ...d, best: Math.max(old?.best ?? 0, d.confidence), last: now });
      }
      return [...map.values()].sort((a, b) => b.last - a.last);
    });
  };

  const start = async () => {
    if (listening || starting) return;
    const run = ++runRef.current;
    setStarting(true);
    setError('');
    setStatus(modelPhase === 'ready' ? 'Starting the microphone…' : 'Waiting for the sound model…');
    try {
      if (modelPhase !== 'ready') {
        await loadListenModel((p: number, label?: string) => {
          if (!mountedRef.current || run !== runRef.current) return;
          const pct = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
          setModelPct(pct);
          if (label) setModelLabel(label);
        });
        if (!mountedRef.current || run !== runRef.current) return;
        setModelPct(100);
        setModelLabel('Ready');
        setModelPhase('ready');
      }
      if (!mountedRef.current || run !== runRef.current) return;
      setStatus('Starting the microphone…');
      await startListening({
        canvas: canvasRef.current,
        onDetections: handleDetections,
        onStatus: (s: string) => {
          if (!mountedRef.current) return;
          if (s === 'listening') setListening(true);
          else if (s === 'stopped') setListening(false);
        },
        threshold: THRESHOLD,
      });
      if (!mountedRef.current || run !== runRef.current) {
        stopListening();
        return;
      }
      setListening(true);
      // listen.js needs an area before it will report any hits. Start with the
      // South East Queensland centre v1 used, and only replace it with the
      // phone's coordinates if Sarah asked for them.
      const loc = locRef.current;
      setLocation(loc?.lat ?? -27.47, loc?.lng ?? 153.02);
      setStatus('Listening. Keep still and let the birds call.');
      startLevelMeter();
    } catch (err) {
      stopListening();
      if (!mountedRef.current || run !== runRef.current) return;
      const denied = /denied|NotAllowed/i.test(
        `${(err as { name?: string } | null)?.name ?? ''} ${errorText(err)}`,
      );
      setListening(false);
      setStarting(false);
      setStatus('Stopped.');
      setError(
        denied
          ? 'Microphone permission was denied. Allow it in your browser settings and try again.'
          : `Couldn't start listening: ${errorText(err)}`,
      );
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const stop = () => {
    runRef.current += 1;
    stopLevelMeter();
    stopListening();
    setListening(false);
    setStarting(false);
    setStatus('Stopped.');
  };

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocPhase('error');
      setLocText('This browser has no location support. The area filter stays on South East Queensland.');
      return;
    }
    setLocPhase('requesting');
    setLocText('Finding your area…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        locRef.current = { lat, lng };
        if (listening) setLocation(lat, lng);
        setLocPhase('set');
        setLocText(
          listening
            ? `Area filter: around ${lat.toFixed(2)}, ${lng.toFixed(2)}.`
            : `Location saved for the area filter: ${lat.toFixed(2)}, ${lng.toFixed(2)}. It will be used when you start listening.`,
        );
      },
      (err) => {
        if (!mountedRef.current) return;
        setLocPhase('error');
        setLocText(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. The area filter stays on South East Queensland.'
            : 'Could not get your location. The area filter stays on South East Queensland.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const logDetected = async (hit: Hit) => {
    const sp: Species | undefined = hit.dexId !== null ? byId.get(hit.dexId) : undefined;
    if (!sp || savingId !== null) return;
    setSavingId(sp.id);
    setError('');
    try {
      const loc = locRef.current;
      await logSighting({
        speciesId: sp.id,
        notes: 'Identified by call with BirdNET.',
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
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

  const clearHits = () => {
    setHits([]);
    hitIndexesRef.current.clear();
  };

  const onMic = () => {
    if (listening || starting) stop();
    else void start();
  };

  const pct = Math.round(modelPct);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/dex" aria-label="Back to the dex">
          <Icon name="back" />
        </Link>
        <div>
          <h1>Listen</h1>
          <p className="muted small">BirdNET names birds from their calls, right on your phone.</p>
        </div>
      </header>

      <div className="listen pad-x">
        <section
          className={`field-model ${modelPhase === 'error' ? 'field-model--error' : ''}`}
          aria-label="Sound model"
        >
          <div className="field-model-h">
            <strong>On-device sound model</strong>
            <span className={`field-pill ${modelPhase === 'ready' ? 'field-pill--ok' : ''}`}>
              {modelPhase === 'ready' ? 'Ready' : modelPhase === 'error' ? 'Unavailable' : 'Loading'}
            </span>
          </div>
          {modelPhase === 'ready' ? (
            <p className="small muted field-model-note">
              Ready. BirdNET runs on this phone, so the sound never leaves it.
            </p>
          ) : modelPhase === 'error' ? (
            <p className="small field-model-note" role="alert">
              {modelError}{' '}
              <button className="btn btn--small" onClick={() => window.location.reload()}>
                Reload the screen
              </button>
            </p>
          ) : (
            <>
              <p className="small muted field-model-note">
                {modelLabel} — {pct}%
              </p>
              <div
                className="meter meter--thin"
                role="progressbar"
                aria-label="Sound model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <span style={{ '--p': `${pct}%` } as CSSProperties} />
              </div>
              <p className="small muted field-model-note">
                About {LISTEN_MODEL_MB} MB the first time. It is kept on this phone for next time.
              </p>
            </>
          )}
        </section>

        <canvas
          ref={canvasRef}
          className="spectro field-spectro"
          width={600}
          height={220}
          role="img"
          aria-label="Live sound picture"
        />

        <div className="listen-ctl">
          <button
            className={`micbtn ${listening || starting ? 'on' : ''}`}
            data-mic
            aria-pressed={listening || starting}
            onClick={onMic}
          >
            <Icon name="mic" />
            <span>{starting && !listening ? 'Cancel' : listening ? 'Stop' : 'Start listening'}</span>
          </button>
          <p className="small muted listen-status" role="status" aria-live="polite">
            {status}
          </p>
          <p className="field-sr-only" role="status" aria-live="polite">
            {announce}
          </p>
          <div
            ref={levelMeterRef}
            className="meter level-meter"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
          >
            <span />
          </div>
          <p className="small muted listen-level-label">Live microphone level</p>
        </div>

        <div className="field-location">
          <div>
            <strong>Area filter</strong>
            <p className="small muted">{locText}</p>
          </div>
          <button
            className="btn btn--small"
            onClick={requestLocation}
            disabled={locPhase === 'requesting'}
            aria-busy={locPhase === 'requesting'}
          >
            <Icon name="pin" />
            {locPhase === 'requesting' ? 'Finding you…' : 'Use my location'}
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="block-h">
          <h2 className="h2">Heard</h2>
          {hits.length > 0 && (
            <button className="btn btn--small btn--quiet" onClick={clearHits}>
              Clear
            </button>
          )}
        </div>
        <ul className="rows">
          {hits.length === 0 ? (
            <li className="muted pad">Nothing yet. Calls show up here as they are recognised.</li>
          ) : (
            hits.map((h) => {
              const sp = h.dexId !== null ? byId.get(h.dexId) : undefined;
              const score = Math.round(h.best * 100);
              const live = Date.now() - h.last < 4000;
              const state = sp ? logged[sp.id] : undefined;
              return (
                <li className={`hit ${live ? 'hit--live' : ''}`} key={h.index}>
                  <span className="row-thumb">
                    {sp ? <SpeciesImage sp={sp} /> : <span className="img-missing" />}
                  </span>
                  <span className="row-main">
                    <strong>{sp ? sp.name : h.name}</strong>
                    <span className="small muted">
                      {score}% sure, {agoText(h.last)}
                      {sp ? (seen.has(sp.id) ? '' : '. New for your dex!') : '. Not in the dex'}
                    </span>
                    <span className="meter meter--thin" style={{ '--p': `${score}%` } as CSSProperties}>
                      <span />
                    </span>
                  </span>
                  {sp && (
                    <button
                      className="btn btn--small"
                      onClick={() => void logDetected(h)}
                      disabled={state === 'saved' || savingId !== null}
                      aria-label={
                        state === 'saved' ? `${sp.name} added to your dex` : `Add ${sp.name} to your dex`
                      }
                    >
                      {state === 'saved' ? 'Added' : savingId === sp.id ? 'Saving…' : 'Add to dex'}
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <p className="small muted field-footnote">
          BirdNET by the K. Lisa Yang Center for Conservation Bioacoustics and Chemnitz University of Technology
          (model CC BY-SA 4.0). Suggestions can be wrong, so check before you log.
        </p>
      </div>
    </>
  );
}
