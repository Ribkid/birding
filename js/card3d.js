// 3D collector cards (tilt + holographic foil), feather confetti and shareable card images.
import { sized } from './media.js';
import { RARITY, KINDS, dexCode } from './species.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(3, '0');

export function cardHTML(sp, { seen, firstSeen, count, place } = {}) {
  const foil = seen && sp.rarity >= 4 ? `card--foil card--foil-${sp.rarity}` : '';
  const img = sized(sp.id, 'large');
  return `<div class="card3d kind--${sp.kind || 'bird'} ${seen ? 'card--seen' : 'card--unseen'} ${foil}" data-card>
    <div class="card-inner">
      <div class="card-face">
        <div class="card-top"><span class="band band--${sp.kind || 'bird'} ${seen ? 'band--on' : ''}">${dexCode(sp.id)}</span><span class="card-rarity">${sp.kind && sp.kind !== 'bird' ? `${esc(KINDS[sp.kind].one.replace(/^./, c => c.toUpperCase()))}, ${RARITY[sp.rarity].label.toLowerCase()}` : RARITY[sp.rarity].label}</span></div>
        <div class="card-photo">${img ? `<span class="whole"><img class="whole-bg" src="${esc(img)}" alt="" aria-hidden="true"><img class="whole-fg" src="${esc(img)}" alt=""></span>` : ''}</div>
        <h3 class="card-name">${esc(sp.name)}</h3>
        <p class="card-sci">${esc(sp.sci)}</p>
        <div class="card-stats">
          <span>${sp.kind === 'bird' ? `<b>${sp.size}</b> cm` : esc(sp.sizeText || '')}</span>
          <span><b>${count || 0}</b> ${count === 1 ? 'sighting' : 'sightings'}</span>
        </div>
        <p class="card-foot">${seen ? `First seen ${esc(firstSeen || '')}${place ? `, ${esc(place)}` : ''}` : 'Not seen yet'}</p>
        <span class="card-glare" aria-hidden="true"></span>
        <span class="card-holo" aria-hidden="true"></span>
      </div>
    </div>
  </div>`;
}

// Make a card element respond to finger drag and phone tilt.
export function enableTilt(card) {
  const inner = card.querySelector('.card-inner');
  let tx = 0, ty = 0, cx = 0, cy = 0, raf;
  const set = (x, y) => { tx = Math.max(-1, Math.min(1, x)); ty = Math.max(-1, Math.min(1, y)); };
  const tick = () => {
    cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
    inner.style.transform = `rotateY(${cx * 18}deg) rotateX(${-cy * 18}deg)`;
    card.style.setProperty('--mx', `${50 + cx * 40}%`);
    card.style.setProperty('--my', `${50 + cy * 40}%`);
    card.style.setProperty('--angle', `${cx * 60 + cy * 40}deg`);
    raf = requestAnimationFrame(tick);
  };
  tick();
  const move = e => {
    const r = card.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const leave = () => set(0, 0);
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerleave', leave);
  const orient = e => { if (e.gamma == null) return; set(e.gamma / 30, (e.beta - 45) / 30); };
  window.addEventListener('deviceorientation', orient);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('deviceorientation', orient); };
}

export function openCard(sp, info) {
  const wrap = document.createElement('div');
  wrap.className = 'card-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', `${sp.name} card`);
  wrap.innerHTML = `${cardHTML(sp, info)}<p class="card-hint">Tilt your phone or drag across the card</p>
    <div class="row-center">${info.seen ? '<button class="btn" data-share>Share card</button>' : ''}<button class="btn btn--primary" data-close-card>Close</button></div>`;
  document.body.append(wrap);
  // iOS needs permission for motion; Android just works.
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {});
  const stop = enableTilt(wrap.querySelector('[data-card]'));
  const close = () => { stop(); wrap.remove(); };
  wrap.addEventListener('click', e => {
    if (e.target.closest('[data-close-card]') || e.target === wrap) close();
    if (e.target.closest('[data-share]')) shareCard(sp, info);
  });
  setTimeout(() => wrap.querySelector('[data-close-card]')?.focus(), 50);
  return close;
}

// Feather confetti for new birds.
export function confetti(colours = ['#F5C518', '#1A5FCC', '#E4531C', '#2F7D5B', '#ffffff']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.append(c);
  const g = c.getContext('2d');
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

// Draw a shareable PNG of the card.
export async function cardImage(sp, info) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  await document.fonts?.ready;
  g.fillStyle = '#142E29'; g.fillRect(0, 0, W, H);
  // card
  const x = 80, y = 80, w = W - 160, h = H - 160;
  g.fillStyle = '#EDF1EE'; roundRect(g, x, y, w, h, 40); g.fill();
  // photo
  const url = sized(sp.id, 'large');
  if (url) {
    try {
      const img = await loadImg(url);
      const pw = w - 80, ph = pw * 0.75;
      const s = Math.max(pw / img.width, ph / img.height);
      g.save(); roundRect(g, x + 40, y + 140, pw, ph, 24); g.clip();
      g.drawImage(img, x + 40 + (pw - img.width * s) / 2, y + 140 + (ph - img.height * s) / 2, img.width * s, img.height * s);
      g.restore();
    } catch (_) {}
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
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export async function shareCard(sp, info) {
  const blob = await cardImage(sp, info);
  const file = new File([blob], `${sp.name.replace(/\W+/g, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: sp.name, text: `${sp.name}: number ${sp.id} in Sarah's BirdyDex` }); return; } catch (_) { return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
}

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrapText(g, text, x, y, max, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) { g.fillText(line, x, y); line = w; y += lh; } else line = test;
  }
  g.fillText(line, x, y);
}
