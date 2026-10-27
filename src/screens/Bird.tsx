import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GROUPS, HABITATS, RARITY, SPECIES, byId, dexCode } from '../lib/data';
import { useSightings } from '../lib/hooks';
import { galleryFor, infoFor } from '../core/gallery.js';
import { localCallsNow, loadCallPack, calls as fetchCalls, audioUrl } from '../core/media.js';
import { lookalikesOf, tellFor } from '../core/quiz.js';
import { learnReady, masteryOf } from '../core/learn.js';
import { Icon } from '../components/Icon';
import { Pips, SpeciesImage } from '../components/SpeciesImage';
import './species.css';

interface Clip { src: string; local?: string; title?: string; artist?: string; license?: string; page?: string; from?: string }

export default function Bird() {
  const { id } = useParams();
  const sp = byId.get(Number(id));
  const sightings = useSightings();
  const [clips, setClips] = useState<Clip[]>([]);
  const [playing, setPlaying] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipTicket = useRef(0);
  const [, forceLearn] = useState(0);

  const mine = useMemo(
    () =>
      sightings
        .filter((s) => s.speciesId === sp?.id)
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)),
    [sightings, sp?.id],
  );

  useEffect(() => {
    let alive = true;
    learnReady().then(() => { if (alive) forceLearn((n) => n + 1); }).catch(() => {});
    return () => { alive = false; };
  }, [sp?.id]);

  useEffect(() => {
    clipTicket.current += 1;
    setClips([]);
    setPlaying(-1);
    const old = audioRef.current;
    if (old) {
      old.pause();
      if (old.src.startsWith('blob:')) URL.revokeObjectURL(old.src);
      audioRef.current = null;
    }
    if (!sp || !['bird', 'frog'].includes(sp.kind)) return;
    let alive = true;
    void (async () => {
      await loadCallPack().catch(() => null);
      let list: Clip[] = localCallsNow(sp.id) as Clip[];
      if (!list.length && navigator.onLine) {
        try {
          const remote = await fetchCalls(sp);
          list = (remote as any[]).map((c) => ({ ...c, title: c.title || 'Recording' }));
        } catch { /* no free recording */ }
      }
      if (alive) setClips(list.slice(0, 3));
    })();
    return () => {
      alive = false;
      clipTicket.current += 1;
      const playingAudio = audioRef.current;
      if (playingAudio) {
        playingAudio.pause();
        if (playingAudio.src.startsWith('blob:')) URL.revokeObjectURL(playingAudio.src);
        audioRef.current = null;
      }
    };
  }, [sp?.id]);

  const playClip = async (i: number) => {
    if (i === playing) { audioRef.current?.pause(); setPlaying(-1); return; }
    const c = clips[i];
    if (!c) return;
    const my = ++clipTicket.current;
    const old = audioRef.current;
    if (old) {
      old.pause();
      if (old.src.startsWith('blob:')) URL.revokeObjectURL(old.src);
      audioRef.current = null;
    }
    const src = await audioUrl(c.local || c.src);
    if (my !== clipTicket.current) {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      return;
    }
    const a = new Audio(src);
    audioRef.current = a;
    const drop = () => {
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      if (audioRef.current === a) audioRef.current = null;
      setPlaying(-1);
    };
    a.onended = drop;
    a.onerror = drop;
    setPlaying(i);
    await a.play().catch(drop);
  };

  if (!sp) {
    return (
      <div className="pad">
        <p>That species isn't in the dex.</p>
        <Link className="btn" to="/dex">
          Back to the dex
        </Link>
      </div>
    );
  }

  const info = infoFor(sp.id) as { text?: string; status?: string; sources?: { title: string; url: string }[] } | null;
  const gallery = galleryFor(sp.id) as { src: string; credit?: string; license?: string; page?: string }[];
  const mastery = masteryOf(sp.id);
  const similar = SPECIES.filter((s) => s.id !== sp.id && s.group === sp.group).slice(0, 4);
  const lookalikes = lookalikesOf(sp.id).map((n: number) => byId.get(n)).filter(Boolean) as typeof SPECIES;

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/dex" aria-label="Back to the dex">
          <Icon name="back" />
        </Link>
        <h1>{sp.name}</h1>
      </header>

      <div className="bird-hero">
        <SpeciesImage sp={sp} size="large" whole />
      </div>

      <section className="pad">
        <div className="bird-title">
          <div>
            <h2 className="h2">{sp.name}</h2>
            <p className="muted small">
              <i>{sp.sci}</i>
            </p>
          </div>
          <span className={`band band--${sp.kind} band--on band--big`}>{dexCode(sp.id)}</span>
        </div>

        {info?.text && <p className="bird-notes">{info.text}</p>}

        <dl className="facts">
          <div>
            <dt>Group</dt>
            <dd>{GROUPS[sp.group]}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{sp.sizeText}</dd>
          </div>
          <div>
            <dt>Habitat</dt>
            <dd>{sp.habitats.map((h) => HABITATS[h]).join(', ')}</dd>
          </div>
          <div>
            <dt>Rarity</dt>
            <dd>
              <Pips rarity={sp.rarity} /> {RARITY[sp.rarity]?.label}
            </dd>
          </div>
          {sp.nocturnal && (
            <div>
              <dt>Active</dt>
              <dd>Mostly at night</dd>
            </div>
          )}
        </dl>

        <div className="bird-sum">
          <span className="rarity-line"><Pips rarity={sp.rarity} /> {RARITY[sp.rarity]?.label}</span>
          <span data-mastery>{mastery >= 1 ? <span className="mastery mastery--done"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>Learnt</span> : mastery > 0 ? <span className="mastery"><i style={{ '--p': Math.round(mastery * 100) } as React.CSSProperties} aria-hidden="true" />Learning</span> : null}</span>
        </div>

        <Link className="btn spot-test" to={`/learn/test/${sp.id}`}><Icon name="grid" /><span>Test me on this</span></Link>

        {info?.status && <p className="small muted">Conservation: {info.status}</p>}

        <div className="quicklinks">
          <Link className="btn" to={`/map/sp/${sp.id}`}>
            <Icon name="pin" /> Show where it's reported
          </Link>
        </div>

        {clips.length > 0 && (
          <section className="call" aria-label="Calls">
            <h2 className="h2">Calls</h2>
            {clips.map((c, i) => (
              <div className="call-row" key={`${c.src}-${i}`}>
                <button type="button" className="playbtn" aria-label={playing === i ? `Pause recording ${i + 1}` : `Play recording ${i + 1}`} onClick={() => void playClip(i)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">{playing === i ? <><rect x="7" y="5" width="4" height="14" fill="currentColor" /><rect x="13" y="5" width="4" height="14" fill="currentColor" /></> : <path d="M8 5v14l11-7z" fill="currentColor" />}</svg>
                </button>
                <div className="call-meta">
                  <span className="call-title">{String(c.title || 'Recording').slice(0, 70)}</span>
                  <span className="small muted call-credit">
                    {c.artist || 'Unknown'}{c.license ? `, ${c.license}` : ''}{c.local ? ', from the offline call pack' : ''}
                  </span>
                </div>
              </div>
            ))}
          </section>
        )}

        {lookalikes.length > 0 && (
          <section className="pad">
            <h2 className="h2">Easily confused with</h2>
            <ul className="rows">
              {lookalikes.slice(0, 4).map((other: any) => (
                <li key={other.id}>
                  <Link className="row row--sp" to={`/compare/${sp.id}/${other.id}`}>
                    <span className="row-thumb"><SpeciesImage sp={other} /></span>
                    <span className="row-main"><strong>{other.name}</strong><span className="muted small">{tellFor(sp.id, other.id) || 'Compare the two side by side'}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>

      {mine.length > 0 && (
        <section className="pad">
          <h2 className="h2">Your sightings</h2>
          <ul className="rows">
            {mine.slice(0, 6).map((s) => (
              <li className="row" key={s.id}>
                <span className="row-main">
                  <strong>{s.date}</strong>
                  <span className="muted small">{s.time}{s.notes ? ` — ${s.notes}` : ''}</span>
                </span>
                <span className="row-n">{s.count ?? 1}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gallery.length > 0 && (
        <section className="pad">
          <h2 className="h2">More photos</h2>
          <ul className="gallery">
            {gallery.slice(0, 6).map((g) => (
              <li key={g.src}>
                <img src={g.src} alt={sp.name} loading="lazy" decoding="async" />
                <span className="credit small muted">
                  {g.page ? (
                    <a href={g.page} target="_blank" rel="noopener">
                      {g.credit || 'Unknown'}
                    </a>
                  ) : (
                    g.credit || 'Unknown'
                  )}
                  {g.license ? `, ${g.license}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {similar.length > 0 && (
        <section className="pad">
          <h2 className="h2">Similar species</h2>
          <ul className="rows">
            {similar.map((s) => (
              <li key={s.id}>
                <Link className="row row--sp" to={`/bird/${s.id}`}>
                  <span className="row-thumb">
                    <SpeciesImage sp={s} />
                  </span>
                  <span className="row-main">
                    <strong>{s.name}</strong>
                    <span className="muted small">{s.sizeText}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
