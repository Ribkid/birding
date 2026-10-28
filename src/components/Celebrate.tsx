// New for the dex: a big photo card that springs in, the band clamping on and the count stamping up by one, with
// feather confetti (v1 js/app.js:509 celebrate and js/card3d.js confetti). saveSighting calls celebrate() when a
// save adds a species she had never logged; <Celebrations /> (mounted once in App) draws it on the layer stack.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ANIMALS, KINDS, dexCode, ofKind, type Species } from '../lib/data';
import { sized } from '../core/media.js';
import { MONTHS } from '../core/stats.js';
import { closeLayer, openLayer, type Layer } from '../lib/layers';
import { applyTint } from '../lib/look';
import { countUp } from '../lib/motion';
import { CardOverlay, askMotion, shareCard, type CardInfo } from '../screens/BirdCard';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Feather confetti for new birds (v1 card3d.js confetti). Nothing under reduced motion.
export function confetti(colours = ['#F5C518', '#1A5FCC', '#E4531C', '#2F7D5B', '#ffffff']) {
  if (reducedMotion()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  const g = c.getContext('2d');
  if (!g) return;
  document.body.append(c);
  g.scale(devicePixelRatio, devicePixelRatio);
  const parts = Array.from({ length: 70 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 11 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
    s: 6 + Math.random() * 8, c: colours[(Math.random() * colours.length) | 0], sway: Math.random() * 6,
  }));
  let t = 0;
  const step = () => {
    t++;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.25; p.vx *= 0.99; p.vy = Math.min(p.vy, 3.2);
      p.x += p.vx + Math.sin((t + p.sway * 10) / 12) * 1.2; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      // a simple feather: quill + vane
      g.fillStyle = p.c;
      g.beginPath(); g.ellipse(0, 0, p.s * 0.35, p.s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -p.s); g.lineTo(0, p.s * 1.3); g.stroke();
      g.restore();
    }
    if (t < 200) requestAnimationFrame(step); else c.remove();
  };
  step();
}

interface Seen { speciesId: number; date: string; time?: string | null; place?: string | null }
interface Party {
  id: string;
  sp: Species;
  badges: string[];
  got: number;
  of: number;
  animals: { got: number; of: number } | null;
  info: CardInfo;
}

const listeners = new Set<(p: Party) => void>();

// v1 fmtDate: '20 Oct 2026'.
const fmtDate = (d?: string) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const month = (MONTHS as string[])[m - 1];
  return month ? `${day} ${month.slice(0, 3)} ${y}` : d;
};

/** Celebrate a species new for the dex. `sightings` is every sighting after the save; `newBadges` the badges it earned. */
export function celebrate(sp: Species, newBadges: { name: string }[], sightings: Seen[]) {
  // Chrome refuses (and logs) a vibration before any tap; every save comes from one.
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (!ua || ua.hasBeenActive) navigator.vibrate?.([60, 40, 120]);
  confetti();
  const hist = sightings
    .filter((s) => s.speciesId === sp.id)
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  const first = hist[hist.length - 1];
  const seen = new Set(sightings.map((s) => s.speciesId));
  const ofIt = ofKind(sp.kind);
  // The overall animal tally only adds something once the dex holds more than birds.
  const total = sp.kind !== 'plant' && ANIMALS.length > ofIt.length;
  const party: Party = {
    id: `cel-${sp.id}-${Date.now()}`,
    sp,
    badges: newBadges.map((b) => b.name),
    got: ofIt.filter((x) => seen.has(x.id)).length,
    of: ofIt.length,
    animals: total ? { got: ANIMALS.filter((x) => seen.has(x.id)).length, of: ANIMALS.length } : null,
    info: { seen: true, isNew: true, firstSeen: fmtDate(first?.date), place: first?.place || undefined, count: hist.length },
  };
  for (const l of listeners) l(party);
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function Celebration({ party, onGone, onCard }: { party: Party; onGone: () => void; onCard: (returnTo: Element | null) => void }) {
  const { id, sp, got, of, animals, badges } = party;
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const niceRef = useRef<HTMLButtonElement>(null);
  const nRef = useRef<HTMLElement>(null);
  const allRef = useRef<HTMLSpanElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const layerRef = useRef<Layer | null>(null);
  const [out, setOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const large = sized(sp.id, 'large') as string | null;
  const small = sized(sp.id, 'small') as string | null;
  const gone = useRef(onGone);
  gone.current = onGone;
  const card = useRef(onCard);
  card.current = onCard;

  const done = (reason?: string, then?: (returnTo: Element | null) => void) => {
    const layer = layerRef.current;
    if (!layer || !closeLayer(layer, { restore: !then && reason !== 'nav' })) return;
    if (reason === 'nav') { gone.current(); return; }
    setOut(true);
    setTimeout(() => gone.current(), 220);
    then?.(layer.returnTo);
  };
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    const wrap = wrapRef.current, c = cardRef.current;
    if (!wrap || !c) return;
    const layer = openLayer(wrap, { dialog: c, labelledBy: `${id}-k ${id}-h`, close: (reason) => doneRef.current(reason) });
    layerRef.current = layer;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) setLoaded(true);
    void applyTint(c, small || large || '', getComputedStyle(c).getPropertyValue('--kc').trim() || null);
    niceRef.current?.focus({ preventScroll: true });
    // The count lands after the card has sprung in.
    void countUp(nRef.current, got - 1, got, { delay: 420 });
    if (animals) void countUp(allRef.current, animals.got - 1, animals.got, { delay: 560 });
    return () => { closeLayer(layer, { restore: false }); };
  }, []); // one card, drawn once

  const label = (KINDS[sp.kind]?.label ?? 'species').toLowerCase();
  return createPortal(
    <div className={`celebrate${out ? ' celebrate--out' : ''}`} ref={wrapRef} onClick={(e) => { if (e.target === e.currentTarget) done('button'); }}>
      <div className={`celebrate-card kind--${sp.kind}`} ref={cardRef}>
        {/* While the large photo loads, the small one shows underneath. */}
        <div className="celebrate-photo" style={small ? { backgroundImage: `url("${small.replace(/"/g, '%22')}")` } : undefined}>
          {large ? (
            <img
              ref={imgRef}
              className={`fade${loaded ? ' in' : ''}`}
              src={large}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={(e) => e.currentTarget.classList.add('img-missing')}
            />
          ) : (
            <span className="img-missing" aria-hidden="true" />
          )}
          <div className="celebrate-over">
            <p className="celebrate-kicker" id={`${id}-k`}>New for your dex</p>
            <h2 id={`${id}-h`}>{sp.name}</h2>
          </div>
          <span className={`band band--${sp.kind} band--on band--big band--clamp`}>{dexCode(sp.id)}</span>
        </div>
        <div className="celebrate-body">
          <p className="celebrate-count">
            <b className="celebrate-n" data-count="" ref={nRef}>{got}</b> of {of} {label} {sp.kind === 'plant' ? 'found' : 'seen'}
          </p>
          {animals && (
            <p className="celebrate-total small muted">
              <span data-count-all="" ref={allRef}>{animals.got}</span> of {animals.of} animals in your dex
            </p>
          )}
          {badges.length > 0 && (
            <p className="celebrate-badges">
              Badge earned:{' '}
              {badges.map((b, i) => (
                <span key={b}>{i ? ', ' : ''}<strong>{b}</strong></span>
              ))}
            </p>
          )}
          <div className="row-center">
            <button type="button" className="btn" data-share="" onClick={() => void shareCard(sp, party.info)}><ShareIcon /> Share</button>
            <button type="button" className="btn" data-card="" onClick={() => { askMotion(); done('button', (back) => card.current(back)); }}>See card</button>
            <button type="button" className="btn btn--primary" data-dismiss="" ref={niceRef} onClick={() => done('button')}>Nice</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once in App: draws each celebration once any sheet the save came from has closed. */
export function Celebrations() {
  const [parties, setParties] = useState<Party[]>([]);
  const [card, setCard] = useState<{ sp: Species; info: CardInfo; returnTo: Element | null } | null>(null);
  useEffect(() => {
    const on = (p: Party) => {
      // v1 closed the sighting sheet before saving, so focus is back on what opened it before the card takes it.
      let tries = 0;
      const show = () => {
        if (document.querySelector('.sheet-wrap') && tries++ < 20) { setTimeout(show, 30); return; }
        setParties((list) => [...list, p]);
      };
      setTimeout(show, 30);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  return (
    <>
      {parties.map((p) => (
        <Celebration
          key={p.id}
          party={p}
          onGone={() => setParties((list) => list.filter((x) => x.id !== p.id))}
          onCard={(returnTo) => setCard({ sp: p.sp, info: p.info, returnTo })}
        />
      ))}
      {card && <CardOverlay sp={card.sp} info={card.info} returnTo={card.returnTo} onClose={() => setCard(null)} />}
    </>
  );
}
