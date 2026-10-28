// Listen: v1 renderListen and wireFrogBoard (js/app.js). BirdNET names birds from their calls on the phone; the sound
// model downloads only once she taps Start listening. Under the heard list, the frogs calling this month can be matched
// by ear from our own clips, since BirdNET only knows birds.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { byId, inSeason, ofKind, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { useSeqReady } from '../../lib/seq';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { loadListenModel, setLocation, startListening, stopListening } from '../../core/listen.js';
import { callPackStatus, loadCallPack, localCalls } from '../../core/media.js';
import { monthRates } from '../../core/seqdata.js';
import { MONTHS } from '../../core/stats.js';
import { openSightingSheet } from '../../components/SightingSheet';
import { getLastPos, setLastPos } from '../../lib/lastPos';
import { stagger } from '../../lib/look';
import { announce } from '../../lib/toast';
import { errorText } from './sighting';
import './field.css';
import './calls.css';

const IDLE =
  'Point your phone towards the birds and keep still. The first time, the sound model downloads (about 60 MB). After that, Listen works with no signal.';

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

interface Clip {
  file: string;
  src?: string;
  seconds?: number;
  artist?: string;
  license?: string;
  page?: string;
  from?: string;
}

type Pack = Record<string, Clip[]>;

// v1 state.listen.hits: what was heard is kept for the session, so leaving Listen and coming back still shows it.
const heard = new Map<number, Hit>();

// v1's quiet trace on the idle screen.
const IDLE_BARS = Array.from({ length: 30 }, (_, i) =>
  (0.16 + 0.7 * Math.abs(Math.sin(i * 0.5)) * (0.55 + 0.45 * Math.cos(i * 0.23))).toFixed(2),
);

// v1 callLine: the sentence of the notes that describes the call.
const callLine = (sp: Species): string => {
  const parts = String(sp.notes || '').match(/[^.]+\./g) || [];
  return (parts.find((t) => /\bcall|bleat|trill|chorus|cackle|"/i.test(t)) || parts[0] || '').trim();
};

// v1 relRate (core/quiz.js), read straight from the regional data.
const relRate = (id: number, month: number): number | null =>
  (monthRates(id) as { rel: number[] } | null)?.rel[month - 1] ?? null;

// v1 getPosition.
const getPosition = () =>
  new Promise<{ lat: number; lng: number; acc: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share location'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
);

// v1 callCredit: our clips are cut down from the original, which the licence asks us to say.
function CallCredit({ c }: { c: Clip }) {
  const who = String(c.artist || 'Unknown').slice(0, 50);
  return (
    <>
      By {c.page ? <a href={c.page} target="_blank" rel="noopener">{who}</a> : who}
      {c.license ? `, ${c.license}` : ''}. Trimmed from the {c.from === 'iNaturalist Australia' ? 'iNaturalist' : 'original'}{' '}
      recording.
    </>
  );
}

function agoText(last: number): string {
  const ago = Math.round((Date.now() - last) / 1000);
  return ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
}

export default function Listen() {
  const seen = useSeen();
  const seqReady = useSeqReady();
  const month = new Date().getMonth() + 1;

  // ---- the microphone ----
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState(IDLE);
  const [prog, setProg] = useState<number | null>(null);
  const [, redraw] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef(0);
  const onRef = useRef(false);
  const mountedRef = useRef(true);
  const seenRef = useRef(seen);
  // Only a call heard while this screen is open slides in; the list redraws every 2 s and those must not replay.
  const shownRef = useRef<Set<number> | null>(null);
  if (!shownRef.current) shownRef.current = new Set(heard.keys());

  // ---- the frog board ----
  const [pack, setPack] = useState<Pack | null>(null);
  const [fsave, setFsave] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  const [fplaying, setFplaying] = useState(false);
  const [fprog, setFprog] = useState(0);
  const [credits, setCredits] = useState<Record<number, Clip | string>>({});
  const [fstatus, setFstatus] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const curRef = useRef<string | null>(null);
  const boardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);

  useEffect(() => {
    let alive = true;
    void (loadCallPack() as Promise<Pack>).then((p) => {
      if (alive) setPack(p || {});
    });
    return () => {
      alive = false;
    };
  }, []);

  const frogs = useMemo(() => {
    if (!pack) return [];
    return ofKind('frog')
      .filter((sp) => pack[sp.id]?.length)
      .map((sp) => ({ sp, r: relRate(sp.id, month) ?? 0 }))
      .filter(({ sp, r }) => r >= 0.35 || inSeason(sp, month))
      .sort((a, b) => b.r - a.r || a.sp.id - b.sp.id);
    // seqReady: the reporting rates arrive with the regional data.
  }, [pack, month, seqReady]);
  const hasFrogs = frogs.length > 0;

  // v1: the frog cards come in one after another, once a session; and until the call pack is saved, how to play them
  // with no signal.
  useEffect(() => {
    if (!hasFrogs) return;
    stagger(boardRef.current, '.frog-row', { key: 'listen-frogs', max: 10 });
    let alive = true;
    void (callPackStatus() as Promise<{ saved: number; total: number }>)
      .then((st) => {
        if (alive && st.saved < st.total) setFsave(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hasFrogs]);

  // One player for the whole board (v1 wireFrogBoard).
  const frogReset = () => {
    setFplaying(false);
    setFprog(0);
  };
  const frogStop = () => {
    audioRef.current?.pause();
    frogReset();
    curRef.current = null;
    setCur(null);
  };

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onTime = () => {
      if (audio.duration) setFprog(Math.min(1, audio.currentTime / audio.duration));
    };
    const onEnded = () => {
      frogReset();
      curRef.current = null;
      setCur(null);
    };
    const onError = () => {
      const key = curRef.current;
      if (!key || !audio.getAttribute('src')) return;
      const msg = navigator.onLine
        ? 'That clip would not play.'
        : 'Not saved on this phone yet. Save calls in Settings to play it with no signal.';
      const id = Number(key.split(':')[0]);
      setCredits((c) => ({ ...c, [id]: msg }));
      setFstatus(msg); // the row text isn't announced; this is
      frogReset();
      curRef.current = null; // a second tap tries the clip again
      setCur(null);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, []);

  // Stop the microphone and the frog clip when she leaves (v1 state.cleanup).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      onRef.current = false;
      stopListening();
    };
  }, []);

  // The heard list shows how long ago each call was, so it redraws every 2 s (v1 L.tickT).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (heard.size) redraw((n) => n + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  // Everything drawn so far has slid in; later redraws must not replay it.
  useEffect(() => {
    for (const key of heard.keys()) shownRef.current?.add(key);
  });

  const stopMic = () => {
    runRef.current += 1;
    stopListening();
    onRef.current = false;
    setOn(false);
    setProg(null);
  };

  const onDetections = (hits: Detection[]) => {
    if (!mountedRef.current || !Array.isArray(hits)) return;
    let fresh: Detection | undefined;
    for (const h of hits) {
      const prev = heard.get(h.index);
      heard.set(h.index, { ...h, best: Math.max(prev?.best || 0, h.confidence), last: Date.now() });
      if (!prev) {
        fresh ??= h;
        if (h.dexId && !seenRef.current.has(h.dexId)) navigator.vibrate?.(40);
      }
    }
    // The heard list is not a live region (v1); a screen reader hears each new bird here.
    if (fresh) announce(`${fresh.name}, ${Math.round(fresh.confidence * 100)}% sure`);
    if (hits.length) redraw((n) => n + 1);
  };

  const start = async () => {
    const run = ++runRef.current;
    frogStop();
    onRef.current = true;
    setOn(true);
    setProg(0);
    try {
      const loading = loadListenModel((p: number, t: string) => {
        if (run !== runRef.current) return;
        setProg(p);
        setStatus(`${t}… ${p}%`);
      }) as Promise<void>;
      loading.catch(() => {}); // a failed load is reported below, once startListening is done
      await startListening({ canvas: canvasRef.current, onDetections, onStatus: undefined });
      if (run !== runRef.current) {
        // Stopped, or left, while the microphone was starting.
        stopListening();
        return;
      }
      await loading;
      if (run !== runRef.current) return;
      setProg(null);
      setStatus('Listening. Keep still and let the birds call.');
      // Filter to birds of this area: start with Brisbane (or her last fix), then refine with GPS.
      const last = getLastPos();
      setLocation(last?.lat ?? -27.47, last?.lng ?? 153.02);
      getPosition()
        .then((pos) => {
          setLastPos(pos);
          if (run === runRef.current) setLocation(pos.lat, pos.lng);
        })
        .catch(() => {});
    } catch (err) {
      if (run !== runRef.current) return;
      stopMic();
      const why = `${(err as { name?: string } | null)?.name ?? ''} ${errorText(err)}`;
      setStatus(
        /denied|NotAllowed/i.test(why)
          ? 'Microphone permission was denied. Allow it in your browser settings and try again.'
          : `Couldn't start listening: ${errorText(err)}`,
      );
    }
  };

  const onMic = () => {
    if (onRef.current) {
      stopMic();
      setStatus('Stopped.');
      return;
    }
    void start();
  };

  const playFrog = (id: number, i: number) => {
    const audio = audioRef.current;
    if (!audio || !pack) return;
    const beforePlay = () => {
      if (!onRef.current) return;
      stopMic();
      setStatus('Stopped listening while the frog call plays, so BirdNET does not hear it.');
    };
    const key = `${id}:${i}`;
    if (curRef.current === key) {
      if (audio.paused) {
        beforePlay();
        audio.play().catch(() => {});
        setFplaying(true);
      } else {
        audio.pause();
        setFplaying(false);
      }
      return;
    }
    frogReset();
    const c = pack[id]?.[i];
    if (!c) return;
    curRef.current = key;
    setCur(key);
    beforePlay();
    setFplaying(true);
    setCredits((cr) => ({ ...cr, [id]: c }));
    setFstatus('');
    void (localCalls(id) as Promise<{ src: string }[]>).then((list) => {
      if (curRef.current !== key || !list[i]) return;
      audio.src = list[i].src;
      audio.play().catch(() => {});
    });
  };

  const logDetected = (sp: Species) => {
    openSightingSheet({ speciesId: sp.id, autoGps: true, notes: 'Identified by call with BirdNET.' });
  };

  const clearHits = () => {
    heard.clear();
    shownRef.current?.clear();
    redraw((n) => n + 1);
  };

  const hits = [...heard.entries()].sort((a, b) => b[1].last - a[1].last);
  let freshN = 0;

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
        <section className="listen-stage" aria-label="Sound picture">
          <div className="listen-screen">
            <canvas ref={canvasRef} className="spectro" width={600} height={220} role="img" aria-label="Live sound picture" />
            <span className="listen-idle" aria-hidden="true">
              {IDLE_BARS.map((h, i) => (
                <i key={i} style={{ '--h': h } as CSSProperties} />
              ))}
            </span>
            <span className="listen-scale" aria-hidden="true">
              <span>12 kHz</span>
              <span>6</span>
              <span>0</span>
            </span>
            <span className="listen-live" aria-hidden="true">
              <i />
              Live
            </span>
          </div>
          <button className={`micbtn${on ? ' on' : ''}`} data-mic="" aria-pressed={on} onClick={onMic}>
            <Icon name="mic" />
            <span>{on ? 'Stop' : 'Start listening'}</span>
          </button>
        </section>

        <div className="listen-ctl">
          <p className="small muted" data-lstatus="" role="status">
            {status}
          </p>
          <div
            className={`meter meter--thin${prog == null ? ' hidden' : ''}`}
            data-lprog=""
            style={{ '--p': `${prog ?? 0}%` } as CSSProperties}
          >
            <span />
          </div>
        </div>

        <div className="block-h">
          <h2 className="h2">Heard</h2>
          {/* v1 offered Clear only when the screen opened with calls already heard; here it shows whenever there are any. */}
          {hits.length > 0 && (
            <button className="btn btn--small btn--quiet" data-clear="" onClick={clearHits}>
              Clear
            </button>
          )}
        </div>
        <ul className="hits" data-hits="">
          {hits.length === 0 ? (
            <li className="hits-empty">Nothing yet. Calls show up here as they are recognised.</li>
          ) : (
            hits.map(([key, h]) => {
              const sp = h.dexId ? byId.get(h.dexId) : undefined;
              const fresh = !shownRef.current?.has(key);
              const nameId = `hit-${key}-name`;
              return (
                <li
                  key={key}
                  className={`hit${Date.now() - h.last < 4000 ? ' hit--live' : ''}${fresh ? ' hit--in' : ''}`}
                  style={fresh ? ({ '--i': freshN++ } as CSSProperties) : undefined}
                >
                  <span className="row-thumb hit-photo">
                    {sp ? (
                      <SpeciesImage sp={sp} />
                    ) : (
                      <span className="hit-nophoto">
                        <Icon name="mic" />
                      </span>
                    )}
                  </span>
                  <span className="hit-main">
                    <strong id={nameId}>{sp ? sp.name : h.name}</strong>
                    <span className="small muted">
                      {Math.round(h.best * 100)}% sure, {agoText(h.last)}
                      {sp ? (seen.has(sp.id) ? '' : '. New for your dex') : '. Not in the dex'}
                    </span>
                    <span className="hit-bar" aria-hidden="true">
                      <i style={{ '--p': Math.min(1, h.best).toFixed(3) } as CSSProperties} />
                    </span>
                  </span>
                  {/* The species name describes its Log it, so each one is told apart. */}
                  {sp && (
                    <button className="btn btn--small hit-log" data-loghit={sp.id} aria-describedby={nameId} onClick={() => logDetected(sp)}>
                      Log it
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>
        <p className="small muted listen-credit">
          BirdNET by the K. Lisa Yang Center for Conservation Bioacoustics and Chemnitz University of Technology (model CC
          BY-SA 4.0). Suggestions can be wrong, so check before you log.
        </p>

        {pack && hasFrogs && (
          <section className="frogboard" aria-labelledby="frogboard-h" ref={boardRef}>
            <h2 className="h2" id="frogboard-h">
              Frogs calling in {MONTHS[month - 1]}
            </h2>
            <p className="muted small">BirdNET only knows birds. Match frog calls by ear here.</p>
            <p className={`small frogboard-save${fsave ? '' : ' hidden'}`} data-fsave="">
              To play these with no signal, <Link to="/settings">save calls in Settings</Link>.
            </p>
            <ul className="frogboard-list">
              {frogs.map(({ sp }) => {
                const clips = pack[sp.id];
                const playingRow = fplaying && cur != null && cur.startsWith(`${sp.id}:`);
                const curRow = cur != null && cur.startsWith(`${sp.id}:`);
                const credit = credits[sp.id];
                return (
                  <li key={sp.id} className={`frog-row kind--frog${playingRow ? ' is-playing' : ''}`} data-frog={sp.id}>
                    <Link className="row-thumb frog-photo" to={`/bird/${sp.id}`} tabIndex={-1} aria-hidden="true">
                      <SpeciesImage sp={sp} />
                    </Link>
                    <div className="frog-main">
                      <Link className="frog-name" to={`/bird/${sp.id}`}>
                        {sp.name}
                      </Link>
                      <span className="frog-call small">{callLine(sp)}</span>
                      <div className="frog-plays">
                        {clips.map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            className="fplay"
                            data-fplay={`${sp.id}:${i}`}
                            aria-pressed={fplaying && cur === `${sp.id}:${i}`}
                            aria-label={`${sp.name}, call ${i + 1} of ${clips.length}`}
                            onClick={() => playFrog(sp.id, i)}
                          >
                            <span className="fplay-ico" aria-hidden="true">
                              <PlayIcon />
                            </span>
                            <span className="fplay-eq" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </span>
                            <span aria-hidden="true">
                              {clips.length > 1 ? (
                                <>
                                  Call <b>{i + 1}</b>
                                </>
                              ) : (
                                'Play call'
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                      <span className="frog-prog" aria-hidden="true">
                        <span style={{ transform: `scaleX(${curRow ? fprog : 0})` }} />
                      </span>
                      <p className="frog-credit small muted" data-fcredit="">
                        {typeof credit === 'string' ? credit : credit ? <CallCredit c={credit} /> : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="frog-sr" role="status" data-fstatus="">
              {fstatus}
            </p>
            <details className="frog-credits">
              <summary className="small">Recording credits</summary>
              <ul className="small muted">
                {frogs.flatMap(({ sp }) =>
                  pack[sp.id].map((c, i) => (
                    <li key={`${sp.id}:${i}`}>
                      {sp.name}
                      {pack[sp.id].length > 1 ? `, call ${i + 1}` : ''}: <CallCredit c={c} />
                    </li>
                  )),
                )}
              </ul>
            </details>
          </section>
        )}
      </div>
    </>
  );
}
