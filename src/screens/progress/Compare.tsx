// Two species side by side, ported from v1's renderCompare (birding-refresh js/app.js): two tall photo cards with the
// dex number and name on the photo, the curated "How to tell them apart" line on a glass band across their foot,
// then a column of facts for each. species.css styles it all under .compare.
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HABITATS, KINDS, byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { useSeqReady } from '../../lib/seq';
import { audioUrl, loadCallPack } from '../../core/media.js';
import { monthRates } from '../../core/seqdata.js';
import { loadLookalikes, tellFor } from '../../core/quiz.js';
import { Band, Pips, SpeciesImage } from '../../components/SpeciesImage';
import { Icon } from '../../components/Icon';
import { toast } from '../../lib/toast';
import { PlayIcon, getCalls, hasCalls } from '../BirdCalls';
import { sizeFact } from '../speciesFacts';

export default function Compare() {
  const { a, b } = useParams<{ a: string; b: string }>();
  const A = byId.get(Number(a));
  const B = byId.get(Number(b));
  if (!A || !B) return <Navigate to="/dex" replace />;
  // A fresh page per pair, so a call playing for one pair stops when another opens.
  return <ComparePage key={`${A.id}/${B.id}`} A={A} B={B} />;
}

function ComparePage({ A, B }: { A: Species; B: Species }) {
  useSeqReady();
  const seen = useSeen();
  const [, again] = useReducer((n: number) => n + 1, 0);
  const [grown, setGrown] = useState(false);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
  const ticket = useRef(0);

  // The curated tell lines and our own call clips load at start-up; fill them in if they arrive after the page.
  useEffect(() => {
    let alive = true;
    for (const p of [loadLookalikes(), loadCallPack()]) void Promise.resolve(p).then(() => { if (alive) again(); }, () => {});
    return () => { alive = false; };
  }, []);

  const stop = () => {
    const cur = audio.current;
    audio.current = null;
    if (!cur) return;
    cur.el.pause();
    cur.el.removeAttribute('src');
    if (cur.url.startsWith('blob:')) URL.revokeObjectURL(cur.url);
  };
  useEffect(() => () => { ticket.current++; stop(); }, []);

  // As in v1: the first recording plays; tapping again starts it over, and the other column's call stops it.
  const play = async (sp: Species) => {
    const t = ++ticket.current;
    stop();
    let list: { src: string }[] = [];
    try { list = await getCalls(sp); } catch { /* none found */ }
    if (t !== ticket.current) return;
    if (!list.length) { toast('No recording for this one yet.'); return; }
    const url = (await audioUrl(list[0].src)) as string;
    if (t !== ticket.current) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    const el = new Audio(url);
    audio.current = { el, url };
    el.play().catch(() => { if (audio.current?.el === el) toast('That recording would not play.'); });
  };

  const mA = monthRates(A.id) as { rel: number[] } | null;
  const mB = monthRates(B.id) as { rel: number[] } | null;
  const hasMonths = !!(mA || mB);
  // The month bars grow once, as the page is drawn.
  useEffect(() => {
    if (!hasMonths || grown) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setGrown(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [hasMonths, grown]);

  const tell = tellFor(A.id, B.id) as string | null;

  const card = (sp: Species) => (
    <Link to={`/bird/${sp.id}`} className={`cmp-card cmp-img kind--${sp.kind}`}>
      <SpeciesImage sp={sp} size="large" alt="" />
      <span className="cmp-cap"><Band sp={sp} seen={seen.has(sp.id)} /><h2 className="cmp-name">{sp.name}</h2></span>
    </Link>
  );

  const col = (sp: Species, m: { rel: number[] } | null) => {
    const size = sizeFact(sp);
    return (
      <div className={`cmp-col kind--${sp.kind}`}>
        <div className="cmp-id">
          {sp.kind !== 'bird' && <span className={`kindtag kind--${sp.kind}`}>{KINDS[sp.kind].one}</span>}
          <Pips rarity={sp.rarity} />
        </div>
        <p className="sci small">{sp.sci}</p>
        <dl className="cmp-facts">
          {size && <><dt>{size[0]}</dt><dd>{size[1]}</dd></>}
          <dt>Look in</dt><dd>{sp.habitats.map((h) => HABITATS[h]).join(', ')}</dd>
        </dl>
        {m && (
          <>
            <div className={`season season--mini${grown ? ' is-in' : ''}`} data-grow="" aria-hidden="true">
              {m.rel.map((v, i) => <i key={i} style={{ height: `${Math.max(3, v * 100)}%`, '--i': i } as CSSProperties} />)}
            </div>
            <div className="season-labels" aria-hidden="true">
              {[...'JFMAMJJASOND'].map((c, i) => <span key={i}>{c}</span>)}
            </div>
          </>
        )}
        <p className="small cmp-notes">{sp.notes}</p>
        {hasCalls(sp.id) && (
          <button type="button" className="btn btn--small" data-cplay={sp.id} aria-label={`Play the call of the ${sp.name}`} onClick={() => void play(sp)}>
            <PlayIcon /> Call
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="compare">
      <header className="page-head page-head--back">
        <Link className="iconbtn" to={`/bird/${A.id}`} aria-label="Back"><Icon name="back" /></Link>
        <h1>Compare</h1>
      </header>
      <div className="cmp-stage">
        {card(A)}
        {card(B)}
        <div className="cmp-tellbox" data-tell="">{tell && <p className="cmp-tell"><strong>How to tell them apart.</strong> {tell}</p>}</div>
      </div>
      <div className="cmp">
        {col(A, mA)}
        {col(B, mB)}
      </div>
    </div>
  );
}
