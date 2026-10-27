import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { GROUPS, HABITATS, RARITY, byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { audioUrl, calls } from '../../core/media.js';
import { loadSeq, monthRates } from '../../core/seqdata.js';
import { Band, Pips, SpeciesImage } from '../../components/SpeciesImage';
import { Icon } from '../../components/Icon';
import './progress.css';

interface CallState {
  id: number;
  text: string;
}

export default function Compare() {
  const { a, b } = useParams<{ a: string; b: string }>();
  const A = byId.get(Number(a));
  const B = byId.get(Number(b));
  const seen = useSeen();
  const [, setSeqTick] = useState(0);
  const [call, setCall] = useState<CallState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadSeq()
      .then(() => {
        if (alive) setSeqTick((tick) => tick + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  if (!A || !B) return <Navigate to="/dex" replace />;

  const playCall = async (sp: Species) => {
    audioRef.current?.pause();
    audioRef.current = null;
    setCall({ id: sp.id, text: 'Loading the call…' });
    try {
      const data = (await loadSeq()) as {
        species?: Record<number, { calls?: { src?: string }[] }>;
      } | null;
      let list: { src?: string }[] = data?.species?.[sp.id]?.calls ?? [];
      if (!list.length) {
        try {
          list = (await calls(sp)) as { src?: string }[];
        } catch {
          list = [];
        }
      }
      const src = list.find((entry) => entry.src)?.src;
      if (!src) {
        setCall({ id: sp.id, text: 'No recording for this one yet.' });
        return;
      }
      const audio = new Audio(await audioUrl(src));
      audioRef.current = audio;
      audio.onended = () => setCall({ id: sp.id, text: 'Tap to hear it again.' });
      await audio.play();
      setCall({ id: sp.id, text: 'Playing.' });
    } catch {
      setCall({ id: sp.id, text: 'Could not play that recording.' });
    }
  };

  const column = (sp: Species) => {
    const season = monthRates(sp.id) as { rel: number[] } | null;
    return (
      <div className="cmp-col">
        <Link to={`/bird/${sp.id}`} className="cmp-img">
          <SpeciesImage sp={sp} size="large" whole />
        </Link>
        <div className="cmp-id">
          <Band sp={sp} seen={seen.has(sp.id)} />
          <Pips rarity={sp.rarity} />
        </div>
        <h2>
          <Link to={`/bird/${sp.id}`}>{sp.name}</Link>
        </h2>
        <p className="sci small">{sp.sci}</p>
        <dl className="cmp-facts">
          <dt>Size</dt>
          <dd>{sp.sizeText || (sp.size != null ? `${sp.size} cm` : 'Unknown')}</dd>
          <dt>Look in</dt>
          <dd>{sp.habitats.map((h) => HABITATS[h]).join(', ') || 'Unknown'}</dd>
          <dt>Rarity</dt>
          <dd>
            <Pips rarity={sp.rarity} /> {RARITY[sp.rarity]?.label ?? 'Unknown'}
          </dd>
          <dt>Group</dt>
          <dd>{GROUPS[sp.group] ?? sp.group}</dd>
        </dl>
        {season && (
          <>
            <div className="season season--mini" aria-hidden="true">
              {season.rel.map((value, index) => (
                <i key={index} style={{ height: `${Math.max(3, value * 100)}%` }} />
              ))}
            </div>
            <div className="season-labels" aria-hidden="true">
              {[...'JFMAMJJASOND'].map((letter, index) => (
                <span key={index}>{letter}</span>
              ))}
            </div>
          </>
        )}
        {sp.notes && <p className="small">{sp.notes}</p>}
        <div>
          <button className="btn btn--small" onClick={() => void playCall(sp)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>{' '}
            Call
          </button>
        </div>
        {call?.id === sp.id && (
          <p className="small muted progress-status" role="status">
            {call.text}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to={`/bird/${A.id}`} aria-label="Back">
          <Icon name="back" />
        </Link>
        <h1>Compare</h1>
      </header>
      <div className="cmp">
        {column(A)}
        {column(B)}
      </div>
      <div className="compare-links">
        <div className="row-start">
          <Link className="btn" to={`/bird/${A.id}`}>
            Open {A.name}
          </Link>
          <Link className="btn" to={`/bird/${B.id}`}>
            Open {B.name}
          </Link>
        </div>
      </div>
    </>
  );
}
