// The species page's collector card (tilt + holographic foil) and its shareable image, ported from v1
// (birding-refresh js/card3d.js: cardHTML, enableTilt, openCard, cardImage and shareCard). The CSS is v1's
// (.card-overlay, .card3d and friends in src/styles/app.css and species.css).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { KINDS, RARITY, dexCode, type Species } from '../lib/data';
import { sized } from '../core/media.js';
import { closeLayer, onLayerKey, openLayer, type Layer } from '../lib/layers';

export interface CardInfo { seen: boolean; firstSeen?: string; place?: string; count?: number; isNew?: boolean }

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// iOS needs permission for motion; Android just works. Asked from the tap that opens the card, as iOS requires.
export function askMotion() {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<unknown> } }).DeviceOrientationEvent;
  if (!reducedMotion() && typeof DOE?.requestPermission === 'function') DOE.requestPermission().catch(() => {});
}

function Card3d({ sp, info, cardRef }: { sp: Species; info: CardInfo; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const { seen, firstSeen, count, place } = info;
  const kind = sp.kind || 'bird';
  const foil = seen && sp.rarity >= 4 ? ` card--foil card--foil-${sp.rarity}` : '';
  const img = sized(sp.id, 'large') as string | null;
  return (
    <div className={`card3d kind--${kind} ${seen ? 'card--seen' : 'card--unseen'}${foil}`} data-card="" ref={cardRef}>
      <div className="card-inner">
        <div className="card-face">
          <div className="card-top">
            <span className={`band band--${kind}${seen ? ' band--on' : ''}`}>{dexCode(sp.id)}</span>
            <span className="card-rarity">{sp.kind && sp.kind !== 'bird'
              ? `${KINDS[sp.kind].one.replace(/^./, (c) => c.toUpperCase())}, ${RARITY[sp.rarity].label.toLowerCase()}`
              : RARITY[sp.rarity].label}</span>
          </div>
          <div className="card-photo">{img ? (
            <span className="whole"><img className="whole-bg" src={img} alt="" aria-hidden="true" /><img className="whole-fg" src={img} alt="" /></span>
          ) : null}</div>
          <h3 className="card-name">{sp.name}</h3>
          <p className="card-sci">{sp.sci}</p>
          <div className="card-stats">
            <span>{sp.kind === 'bird' ? <><b>{sp.size}</b> cm</> : sp.sizeText || ''}</span>
            <span><b>{count || 0}</b> {count === 1 ? 'sighting' : 'sightings'}</span>
          </div>
          <p className="card-foot">{seen ? `First seen ${firstSeen || ''}${place ? `, ${place}` : ''}` : 'Not seen yet'}</p>
          <span className="card-glare" aria-hidden="true" />
          <span className="card-holo" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// Make a card element respond to finger drag and phone tilt. The frame loop runs only while the card is still
// moving towards where the finger or phone points, so a card lying still costs nothing.
// Reduced motion: no tilt from the phone moving; a deliberate drag still turns it.
export function enableTilt(card: HTMLElement, { phone = !reducedMotion() } = {}) {
  const inner = card.querySelector<HTMLElement>('.card-inner');
  if (!inner) return () => {};
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const paint = () => {
    inner.style.transform = `rotateY(${cx * 18}deg) rotateX(${-cy * 18}deg)`;
    card.style.setProperty('--mx', `${50 + cx * 40}%`);
    card.style.setProperty('--my', `${50 + cy * 40}%`);
    card.style.setProperty('--angle', `${cx * 60 + cy * 40}deg`);
  };
  const tick = () => {
    cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
    if (Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001) { cx = tx; cy = ty; raf = 0; }
    else raf = requestAnimationFrame(tick);
    paint();
  };
  const set = (x: number, y: number) => {
    tx = Math.max(-1, Math.min(1, x)); ty = Math.max(-1, Math.min(1, y));
    if (!raf) raf = requestAnimationFrame(tick);
  };
  paint();
  const move = (e: PointerEvent) => {
    const r = card.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const leave = () => set(0, 0);
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerleave', leave);
  const orient = (e: DeviceOrientationEvent) => { if (e.gamma == null || e.beta == null) return; set(e.gamma / 30, (e.beta - 45) / 30); };
  if (phone) window.addEventListener('deviceorientation', orient);
  return () => {
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('deviceorientation', orient);
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerleave', leave);
  };
}

// The card is a layer: Escape, Close, a tap outside or a route change (Android Back) close it, which stops the
// tilt loop and the motion listener. Focus goes back to whatever opened it.
export function CardOverlay({ sp, info, onClose }: { sp: Species; info: CardInfo; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const wrap = wrapRef.current, card = cardRef.current;
    if (!wrap || !card) return;
    const hash = location.hash;
    const stop = enableTilt(card);
    const layer: Layer = openLayer(wrap, { label: `${sp.name} card`, close: () => closeRef.current() });
    // A keydown another listener has already handled (the shared one, where the app wires it) is left alone.
    const key = (e: KeyboardEvent) => { if (!e.defaultPrevented) onLayerKey(e); };
    document.addEventListener('keydown', key);
    closeBtn.current?.focus({ preventScroll: true });
    return () => {
      stop();
      document.removeEventListener('keydown', key);
      // Closed by a route change: focus belongs to the new screen, not the Card tab.
      closeLayer(layer, { restore: location.hash === hash });
    };
  }, [sp]);

  return createPortal(
    <div className="card-overlay" ref={wrapRef} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card3d sp={sp} info={info} cardRef={cardRef} />
      <p className="card-hint">{reducedMotion() ? 'Drag across the card to turn it' : 'Tilt your phone or drag across the card'}</p>
      <div className="row-center">
        {info.seen && <button type="button" className="btn" data-share="" onClick={() => void shareCard(sp, info)}>Share card</button>}
        <button type="button" className="btn btn--primary" data-close-card="" ref={closeBtn} onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}

// Draw a shareable PNG of the card.
export async function cardImage(sp: Species, info: CardInfo): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  await document.fonts?.ready;
  g.fillStyle = '#142E29'; g.fillRect(0, 0, W, H);
  // card
  const x = 80, y = 80, w = W - 160, h = H - 160;
  g.fillStyle = '#EDF1EE'; roundRect(g, x, y, w, h, 40); g.fill();
  // photo
  const url = sized(sp.id, 'large') as string | null;
  if (url) {
    try {
      const img = await loadImg(url);
      const pw = w - 80, ph = pw * 0.75;
      const s = Math.max(pw / img.width, ph / img.height);
      g.save(); roundRect(g, x + 40, y + 140, pw, ph, 24); g.clip();
      g.drawImage(img, x + 40 + (pw - img.width * s) / 2, y + 140 + (ph - img.height * s) / 2, img.width * s, img.height * s);
      g.restore();
    } catch { /* no photo on the card */ }
  }
  // band
  const grad = g.createLinearGradient(0, y + 40, 0, y + 110);
  grad.addColorStop(0, '#F2F4F5'); grad.addColorStop(0.3, '#DCE0E3'); grad.addColorStop(0.62, '#B4BCC1'); grad.addColorStop(1, '#DCE0E3');
  g.fillStyle = grad; roundRect(g, x + 40, y + 40, 210, 72, 14); g.fill();
  g.fillStyle = '#1D2B29'; g.font = '800 58px "Big Shoulders", sans-serif'; g.textBaseline = 'middle';
  g.fillText(dexCode(sp.id), x + 72, y + 78);
  g.fillStyle = '#8A6400'; g.font = '700 38px "Schibsted Grotesk", sans-serif'; g.textAlign = 'right';
  g.fillText(info.isNew ? `New ${sp.kind && sp.kind !== 'bird' ? KINDS[sp.kind].one : 'bird'}!` : RARITY[sp.rarity].label, x + w - 40, y + 78);
  g.textAlign = 'left';
  // text
  const ty = y + 140 + (w - 80) * 0.75 + 90;
  g.fillStyle = '#142E29'; g.font = '700 76px "Schibsted Grotesk", sans-serif';
  wrapText(g, sp.name, x + 40, ty, w - 80, 84);
  g.fillStyle = '#4F6861'; g.font = 'italic 400 40px "Schibsted Grotesk", sans-serif';
  g.fillText(sp.sci, x + 40, ty + (g.measureText(sp.name).width > w - 80 ? 150 : 70));
  g.font = '500 36px "Schibsted Grotesk", sans-serif'; g.fillStyle = '#142E29';
  g.fillText(`Seen ${info.firstSeen || ''}${info.place ? ` at ${info.place}` : ''}`.slice(0, 52), x + 40, y + h - 70);
  g.fillStyle = '#F5C518'; g.font = '800 44px "Big Shoulders", sans-serif'; g.textAlign = 'right';
  g.fillText("SARAH'S BIRDYDEX", W - 80, H - 36);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export async function shareCard(sp: Species, info: CardInfo) {
  const blob = await cardImage(sp, info);
  if (!blob) return;
  const file = new File([blob], `${sp.name.replace(/\W+/g, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: sp.name, text: `${sp.name}, number ${dexCode(sp.id)} in Sarah's BirdyDex` }); } catch { /* cancelled */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) { g.fillText(line, x, y); line = w; y += lh; } else line = test;
  }
  g.fillText(line, x, y);
}
