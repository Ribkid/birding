// Scan a photo: pick or take a photo, frame what to identify with a square box, and compare the top matches.
// The box is exactly what gets analysed (js/photoid.js); 'Whole photo' analyses the whole frame instead.
import { byId, KINDS } from './species.js';
import { galleryFor } from './gallery.js';
import { sized } from './media.js';
import { db } from './db.js';

const KEEP_MS = 30 * 60 * 1000; // come back within half an hour (say from a species page) and the scan is still there
const LOG_MAX = 200;
const galleryIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 16.5l4-4.5 3 3 2-2 2.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="15.5" cy="9" r="1.5" fill="currentColor"/></svg>';

let S = { kind: null }; // the current scan: { at, file, storeBlob, url, W, H, box: { cx, cy, s }, whole, kind, result, yours, logAt }
let info = null;   // what photo ID covers, from data/photoid.json
let mod = null;    // js/photoid.js, loaded on first visit
let picks = 0;     // newest photo pick, so a slow earlier one can't replace it

const words = (list, and = 'or') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`);
const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const pct = p => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);
const firstSentence = s => (String(s || '').match(/^.*?[.!?](?=\s|$)/) || [String(s || '')])[0];

export async function renderScan(ctx) {
  const { view, $, esc, icon } = ctx;
  if (S.at && Date.now() - S.at > KEEP_MS) resetScan();
  try {
    mod = mod || await import('./photoid.js');
    info = info || await mod.photoInfo();
  } catch (_) {} // no data yet (first visit offline): generic wording now, the real thing next visit
  if (location.hash !== '#/scan') return;
  const known = info || { kinds: [], metrics: null };

  const covered = known.kinds.filter(k => KINDS[k]);
  const multi = covered.length > 1;
  const subject = () => (S.kind ? KINDS[S.kind].one : covered.length === 1 ? KINDS[covered[0]].one : null);
  const intro = covered.length ? `Name ${article(KINDS[covered[0]].one)} ${words(covered.map(k => KINDS[k].one))} from a photo, right on your phone.` : 'Find out what you photographed, right on your phone.';

  // A dark camera zone runs under the status bar (the viewfinder and its controls); the results sit on a sheet that
  // slides up over it. The zone is the screen's hero, so the frosted top bar only takes over once it has scrolled away.
  view.innerHTML = `
    <div class="scan">
      <section class="scan-cam" data-hero-zone>
        <header class="page-head page-head--back scan-head"><a class="iconbtn" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
          <div><h1>Scan a photo</h1><p class="small">${esc(intro)}</p></div></header>
        <div class="scan-cam-body">
          <section class="scan-vf" data-vf aria-label="Photo"></section>
          <div class="scan-tools" data-tools></div>
          ${multi ? `<div class="scan-kinds" role="group" aria-label="What kind is it?" data-kinds></div>` : ''}
          <button type="button" class="scan-go" data-identify><span class="scan-go-ico">${icon.scan}</span><span data-golabel>Identify</span></button>
          <div class="scan-work">
            <p class="scan-status" role="status" aria-live="polite" data-status></p>
            <div class="scan-progress" data-progress aria-hidden="true"></div>
          </div>
        </div>
      </section>
      <div class="scan-sheet pad-x">
        <section class="scan-result" data-result aria-labelledby="scan-verdict"></section>
        <p class="scan-foot" data-foot></p>
      </div>
    </div>`;

  const vf = $('[data-vf]', view), tools = $('[data-tools]', view), kindsEl = $('[data-kinds]', view);
  const go = $('[data-identify]', view), goLabel = $('[data-golabel]', view), status = $('[data-status]', view), prog = $('[data-progress]', view);
  const out = $('[data-result]', view);
  let busy = false;
  let step = null; // { index, count } while the model looks at the photo, shown over the photo

  // ---------- footnote ----------
  $('[data-foot]', view).textContent = `Photo ID runs on your phone with BioCLIP, a model from the Imageomics Institute (MIT licence). The first scan downloads about ${mod?.PHOTO_MODEL_MB ?? 104} MB once, best on Wi-Fi. After that it works offline.${accuracyLine(known.metrics)}`;

  // ---------- viewfinder ----------
  // fresh: a photo that has just been picked, so the box lands on it with a small spring.
  function drawVF(fresh = false) {
    if (!S.url) {
      vf.className = 'scan-vf scan-vf--empty';
      // A camera's controls: the shutter in the middle, the gallery beside it.
      vf.innerHTML = `<div class="scan-frame">
          <span class="scan-corners" aria-hidden="true"></span>
          <div class="scan-entry">
            <span class="scan-entry-icon">${icon.scan}</span>
            <p>Works best when ${subject() ? `the ${esc(subject())}` : 'it'} fills a good part of the frame.</p>
          </div>
        </div>
        <div class="scan-pick">
          <label class="scan-pickbtn scan-pickbtn--main"><span class="scan-shutter">${icon.cam}</span><span>Take a photo</span><input type="file" accept="image/*" capture="environment" class="scan-file" data-file></label>
          <label class="scan-pickbtn scan-pickbtn--side"><span class="scan-pickicon">${galleryIcon}</span><span>Choose from gallery</span><input type="file" accept="image/*" class="scan-file" data-file></label>
        </div>`;
      tools.innerHTML = '';
      go.classList.add('hidden');
      kindsEl?.classList.add('hidden');
      return;
    }
    vf.className = `scan-vf ${busy ? 'scan-vf--busy' : ''}`;
    const handle = c => `<span class="scan-handle scan-handle--${c}" data-handle="${c}"></span>`;
    vf.innerHTML = `<div class="scan-stage ${S.whole ? 'scan-stage--whole' : ''}" data-stage tabindex="0" role="application" aria-roledescription="photo"
        aria-label="${S.whole ? 'Your photo. The whole photo will be identified.' : 'Your photo with the identify box. Arrow keys move the box, plus and minus change its size.'}">
        <div class="scan-photo">
          <img src="${S.url}" alt="" draggable="false">
          <span class="scan-dim" data-dim aria-hidden="true"></span>
          <span class="scan-corners scan-corners--photo" aria-hidden="true"></span>
          <span class="scan-sweep scan-sweep--whole" aria-hidden="true"></span>
        </div>
        <div class="scan-box ${fresh ? 'scan-box--land' : ''}" data-box><span class="scan-sweep" aria-hidden="true"></span>${['nw', 'ne', 'sw', 'se'].map(handle).join('')}</div>
        <span class="scan-pips" data-pips aria-hidden="true"></span>
      </div>`;
    tools.innerHTML = `<p class="scan-hint">${S.whole ? 'The whole photo will be identified.'
      : subject() ? `Drag the box onto the ${esc(subject())}. Pull a corner to resize.` : 'Drag the box onto what you want named. Pull a corner to resize.'}</p>
      <div class="scan-tool-row">
        <button type="button" class="scan-chip scan-chip--whole" data-whole aria-pressed="${S.whole}"><i aria-hidden="true"></i>Whole photo</button>
        <label class="scan-chip scan-change">${galleryIcon}<span>Change photo</span><input type="file" accept="image/*" class="scan-file" data-file></label>
      </div>`;
    go.classList.remove('hidden');
    kindsEl?.classList.remove('hidden');
    drawBox();
    drawPips();
    const img = $('[data-stage] img', vf);
    if (!img.complete) img.addEventListener('load', drawBox, { once: true }); // the small-box check needs the laid-out size
    wireStage($('[data-stage]', vf));
  }

  // Progress per view while the model works: one pip over the photo for each way it looks at it (the status line
  // under Identify says the same in words).
  function drawPips() {
    const el = $('[data-pips]', vf);
    if (!el) return;
    el.innerHTML = step ? Array.from({ length: step.count }, (_, i) => `<i class="${i < step.index - 1 ? 'on' : i === step.index - 1 ? 'now' : ''}"></i>`).join('') : '';
  }

  function clampBox() {
    const b = S.box, short = Math.min(S.W, S.H), min = Math.max(24, short * 0.08);
    b.s = Math.min(Math.max(b.s, min), short);
    b.cx = Math.min(Math.max(b.cx, b.s / 2), S.W - b.s / 2);
    b.cy = Math.min(Math.max(b.cy, b.s / 2), S.H - b.s / 2);
  }
  function drawBox() {
    const el = $('[data-box]', vf);
    if (!el) return;
    clampBox();
    const b = S.box;
    const at = { left: `${(b.cx - b.s / 2) / S.W * 100}%`, top: `${(b.cy - b.s / 2) / S.H * 100}%`, width: `${b.s / S.W * 100}%`, height: `${b.s / S.H * 100}%` };
    // The box and its handles may hang over the photo's edge; the shade around the box stays clipped to the photo.
    Object.assign(el.style, at);
    const dim = $('[data-dim]', vf);
    if (dim) Object.assign(dim.style, at);
    // On a small box, four 44px handles would cover it; keep just the bottom-right one so the middle can still be dragged.
    const px = b.s / S.W * (el.parentElement?.clientWidth || 0);
    el.classList.toggle('scan-box--small', px > 0 && px < 110);
  }
  const cropFractions = () => { const b = S.box; return { x: (b.cx - b.s / 2) / S.W, y: (b.cy - b.s / 2) / S.H, w: b.s / S.W, h: b.s / S.H }; };

  // Drag the box to move it, drag the corner (or pinch) to resize, tap elsewhere to move it there.
  function wireStage(stage) {
    const pts = new Map();
    let mode = null, start = null;
    const toImg = e => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * S.W, y: (e.clientY - r.top) / r.height * S.H }; };
    stage.addEventListener('pointerdown', e => {
      if (S.whole || busy) return;
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, toImg(e));
      const b = S.box, p = toImg(e);
      const h = e.target.closest('[data-handle]');
      stage.querySelector('.scan-handle.is-active')?.classList.remove('is-active');
      if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        mode = 'pinch'; start = { d: Math.hypot(a.x - c.x, a.y - c.y) || 1, s: b.s };
      } else if (h) {
        // Resize from the corner that was grabbed; the opposite corner stays put.
        const c = h.dataset.handle, sx = c.includes('e') ? 1 : -1, sy = c.includes('s') ? 1 : -1;
        mode = 'resize'; start = { sx, sy, ax: b.cx - sx * b.s / 2, ay: b.cy - sy * b.s / 2 };
        h.classList.add('is-active');
      } else {
        if (!e.target.closest('[data-box]')) { b.cx = p.x; b.cy = p.y; drawBox(); }
        mode = 'move'; start = { dx: p.x - b.cx, dy: p.y - b.cy };
      }
      stage.classList.add('scan-stage--drag');
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !mode) return;
      pts.set(e.pointerId, toImg(e));
      const b = S.box, p = toImg(e);
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, c] = [...pts.values()];
        b.s = start.s * (Math.hypot(a.x - c.x, a.y - c.y) / start.d);
      } else if (mode === 'resize') {
        const { sx, sy, ax, ay } = start;
        const s = Math.max((p.x - ax) * sx, (p.y - ay) * sy);
        b.s = Math.min(s, sx > 0 ? S.W - ax : ax, sy > 0 ? S.H - ay : ay);
        b.cx = ax + sx * b.s / 2; b.cy = ay + sy * b.s / 2;
      } else if (mode === 'move') { b.cx = p.x - start.dx; b.cy = p.y - start.dy; }
      drawBox();
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (pts.size === 1 && mode === 'pinch') { const p = [...pts.values()][0]; mode = 'move'; start = { dx: p.x - S.box.cx, dy: p.y - S.box.cy }; }
      if (!pts.size) { mode = null; stage.classList.remove('scan-stage--drag'); stage.querySelector('.scan-handle.is-active')?.classList.remove('is-active'); }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('keydown', e => {
      if (S.whole || busy) return;
      const b = S.box, step = Math.min(S.W, S.H) * (e.shiftKey ? 0.01 : 0.05);
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) { b.cx += moves[e.key][0]; b.cy += moves[e.key][1]; }
      else if (e.key === '+' || e.key === '=') b.s *= 1.1;
      else if (e.key === '-' || e.key === '_') b.s /= 1.1;
      else return;
      e.preventDefault();
      drawBox();
    });
  }

  // ---------- kinds ----------
  function drawKinds() {
    if (!kindsEl) return;
    const chip = (k, label) => `<button type="button" class="scan-chip ${k ? `kind--${k}` : ''}" data-kind="${k || ''}" aria-pressed="${(S.kind || '') === (k || '')}">${k ? '<i aria-hidden="true"></i>' : ''}${esc(label)}</button>`;
    kindsEl.innerHTML = chip(null, 'Anything') + covered.map(k => chip(k, KINDS[k].label)).join('');
  }

  // ---------- picking a photo ----------
  // The current photo and result stay until the new one has opened, so a file that won't open loses nothing.
  async function pick(file) {
    if (!file) return;
    const ticket = ++picks;
    status.textContent = 'Opening the photo…';
    let blob, img;
    try {
      blob = await ctx.resizeImage(file, 1600);
      if (!blob) throw new Error('unreadable');
      img = new Image(); img.src = URL.createObjectURL(blob);
      await img.decode();
    } catch (_) {
      if (img?.src) URL.revokeObjectURL(img.src);
      if (ticket === picks) status.textContent = 'That file couldn\'t be opened as a photo. Try a JPEG or PNG.';
      return;
    }
    if (ticket !== picks) { URL.revokeObjectURL(img.src); return; } // a later pick won
    resetScan();
    out.innerHTML = ''; prog.innerHTML = '';
    const W = img.naturalWidth, H = img.naturalHeight;
    S = { at: Date.now(), file, storeBlob: blob, url: img.src, W, H, box: { cx: W / 2, cy: H / 2, s: Math.min(W, H) * 0.75 }, whole: false, kind: S.kind, result: null };
    drawVF(true);
    status.textContent = `Photo ready. Move the box onto ${subject() ? `the ${subject()}` : 'what you want named'}, then choose Identify.`;
    $('[data-stage]', vf)?.focus({ preventScroll: true });
  }

  // ---------- identify ----------
  async function identify() {
    if (busy || !S.file) return;
    busy = true;
    const { file, whole, kind } = S;
    go.setAttribute('aria-disabled', 'true'); goLabel.textContent = 'Identifying…';
    vf.classList.add('scan-vf--busy');
    out.innerHTML = ''; prog.innerHTML = '';
    status.textContent = 'Starting photo ID…';
    status.closest('.scan-work').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const MB = mod?.PHOTO_MODEL_MB ?? 104;
    try {
      mod = mod || await import('./photoid.js');
      if (!(await mod.isPhotoModelCached())) {
        if (navigator.onLine === false) throw new Error('offline-first-run');
        status.textContent = `Getting photo ID ready: a one-time download of about ${MB} MB. Wi-Fi is best.`;
        prog.innerHTML = '<div class="meter"><span></span></div><p class="scan-mb" data-mb></p>';
        let said = 0;
        await mod.loadPhotoModel(f => {
          prog.querySelector('.meter span')?.style.setProperty('width', `${Math.round(f * 100)}%`);
          const mb = prog.querySelector('[data-mb]');
          if (mb) mb.textContent = `${Math.round(f * MB)} of ${MB} MB`;
          if (f - said >= 0.25 && f < 1) { said = Math.floor(f * 4) / 4; status.textContent = `Downloading photo ID: ${Math.round(said * 100)}% done.`; }
        });
      } else {
        status.textContent = 'Starting photo ID…';
        await mod.loadPhotoModel();
      }
      const month = new Date(file.lastModified || Date.now()).getMonth() + 1;
      const res = await mod.identifyPhoto(file, {
        crop: whole ? null : cropFractions(), kinds: kind ? [kind] : null, month,
        onProgress: x => {
          if (x.phase !== 'view' || S.file !== file) return;
          status.textContent = `Looking closely, ${x.index} of ${x.count}`;
          prog.innerHTML = '';
          step = { index: x.index, count: x.count };
          drawPips();
        },
      });
      if (location.hash !== '#/scan' || S.file !== file) return; // left Scan or chose another photo meanwhile
      prog.innerHTML = '';
      done();
      S.result = { ...res, whole, kind };
      S.yours = yoursImage();
      S.logAt = await logScan(res);
      drawResult(true);
    } catch (err) {
      prog.innerHTML = '';
      status.textContent = /offline-first-run|Failed to fetch|NetworkError|network/i.test(String(err?.message || err))
        ? `Photo ID needs a one-time download of about ${MB} MB. Connect to the internet (Wi-Fi is best) and try again.`
        : `Photo ID couldn't run: ${err?.message || err}`;
    } finally {
      done();
    }
  }
  function done() {
    busy = false; step = null;
    go.removeAttribute('aria-disabled'); goLabel.textContent = 'Identify';
    vf.classList.remove('scan-vf--busy');
    drawPips();
  }

  // The analysed area as a small square image for the comparison cards.
  function yoursImage() {
    const img = $('[data-stage] img', vf);
    if (!img) return '';
    const n = 240, c = document.createElement('canvas'); c.width = c.height = n;
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
    if (S.whole) {
      const k = n / Math.max(S.W, S.H), w = S.W * k, h = S.H * k;
      cx.fillStyle = getComputedStyle($('.scan-cam', view)).backgroundColor || '#000'; cx.fillRect(0, 0, n, n);
      cx.drawImage(img, (n - w) / 2, (n - h) / 2, w, h);
    } else {
      const b = S.box;
      cx.drawImage(img, b.cx - b.s / 2, b.cy - b.s / 2, b.s, b.s, 0, 0, n, n);
    }
    try { return c.toDataURL('image/jpeg', 0.85); } catch (_) { return ''; }
  }

  // ---------- result ----------
  function drawResult(fresh) {
    const r = S.result;
    if (!r) { out.innerHTML = ''; return; }
    const top = r.results.slice(0, 3).map(x => ({ ...x, sp: byId.get(x.id) })).filter(x => x.sp);
    if (!top.length) { out.innerHTML = ''; return; }
    const [a, b] = top, seen = ctx.seenSet();
    const subj = r.kind ? KINDS[r.kind].one : covered.length === 1 ? KINDS[covered[0]].one : null;
    const band = r.band === 'possibly' && !b ? 'unsure' : r.band;
    // The headline reads "Likely: name" as one heading; the band word sits on its own line above the name.
    const headline = band === 'likely' ? `<span class="scan-band">Likely<span class="sr-only">:</span></span> <span class="scan-verdict-name">${esc(a.sp.name)}</span>`
      : band === 'possibly' ? `<span class="scan-band">Possibly</span> <span class="scan-verdict-name">${esc(a.sp.name)} or ${esc(b.sp.name)}</span>`
      : '<span class="scan-verdict-name">Can\'t tell from this photo</span>';
    const sure = Math.min(99, Math.max(1, Math.round(a.p * 100)));
    const next = r.band === 'likely' ? 'Check the markings against the photos below, then log it.'
      : r.band === 'possibly' ? (r.whole ? `Compare the two below. A box around just the ${subj || 'subject'} often settles it.` : 'Compare the two below. A tighter box or another angle often settles it.')
      : r.whole ? `Draw a box around the ${subj || 'subject'} and try again.`
      : multi && !r.kind ? 'Choose what kind it is, or try a tighter box or a photo from another angle.'
      : 'Try a tighter box, or a photo from another angle.';
    const lead = r.band === 'likely' ? 1 : r.band === 'possibly' ? 2 : 0;
    const level = p => (p >= (r.bands?.likely ?? 0.8) ? 'strong' : p >= 0.3 ? 'possible' : p >= 0.08 ? 'outside' : 'unlikely');
    const word = p => ({ strong: 'Strong match', possible: 'Possible', outside: 'Outside chance', unlikely: 'Unlikely' })[level(p)];
    const refs = id => {
      const g = galleryFor(id).slice(0, 2).map(p => ({ src: p.thumb || p.src, credit: p.credit, from: p.from }));
      if (g.length < 2) { const w = sized(id); if (w && !g.some(p => p.src === w)) g.unshift({ src: w, credit: '', from: 'Wikipedia' }); }
      return g.slice(0, 2);
    };
    // On a fresh result the cards rise in one after another (--i); a redraw on return just shows them.
    // rise() goes at the end of a class attribute: it adds the class, closes the attribute and sets the order.
    let n = 0;
    const rise = () => (fresh ? ` scan-rise" style="--i:${n++}` : '');
    const card = (x, i) => {
      const sp = x.sp, ph = refs(sp.id), isLead = i < lead;
      const credits = ph.filter(p => p.credit).map(p => p.credit);
      const tile = p => (p ? `<img src="${esc(p.src)}" alt="${esc(sp.name)}, reference photo" loading="lazy" decoding="async" onload="this.classList.add('in')" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'scan-tile-missing'}))">` : '<span class="scan-tile-missing"></span>');
      return `<article class="scan-card kind--${sp.kind} ${isLead ? 'scan-card--lead' : ''}${rise()}">
        <div class="scan-strip">
          <figure class="scan-yours">${S.yours ? `<img src="${S.yours}" alt="Your photo">` : '<span class="scan-tile-missing"></span>'}<figcaption>Yours</figcaption></figure>
          ${tile(ph[0])}${tile(ph[1])}
        </div>
        <div class="scan-card-body">
          ${credits.length ? `<p class="scan-credit">Photos: ${esc(words(credits.map(c => String(c).slice(0, 40)), 'and'))}${ph.some(p => p.from && p.credit) ? ` (${esc(ph.find(p => p.credit)?.from || '')})` : ''}</p>` : ''}
          <div class="scan-card-head">
            <h3><a href="#/bird/${sp.id}">${esc(sp.name)}</a></h3>
            <span class="scan-kind">${esc(KINDS[sp.kind].one)}</span>
            ${seen.has(sp.id) ? '' : '<span class="scan-new">New for your dex</span>'}
          </div>
          ${sp.notes ? `<p class="scan-tip">${esc(firstSentence(sp.notes))}</p>` : ''}
          <div class="scan-card-foot">
            <div class="scan-conf scan-conf--${level(x.p)}">
              <p><strong>${word(x.p)}</strong> <span>${pct(x.p)}</span></p>
              <span class="scan-bar" aria-hidden="true"><i style="--p:${Math.max(0.02, Math.min(1, x.p)).toFixed(3)}"></i></span>
            </div>
            <button type="button" class="btn scan-this ${isLead ? 'btn--primary' : 'scan-this--soft'}" data-this="${sp.id}" aria-label="This one: ${esc(sp.name)}">This one</button>
          </div>
        </div>
      </article>`;
    };
    const ring = band === 'unsure'
      ? '<b class="scan-ring-q">?</b>'
      : `<b class="scan-ring-n"><span data-ringn>${sure}</span><small>%</small></b>`;
    out.innerHTML = `<div class="scan-verdict-wrap scan-verdict-wrap--${band}${rise()}">
        <div class="scan-ring" aria-hidden="true" style="--p:${band === 'unsure' ? 0 : sure}">
          <svg viewBox="0 0 80 80"><circle class="scan-ring-track" cx="40" cy="40" r="34" pathLength="100"/><circle class="scan-ring-fill" cx="40" cy="40" r="34" pathLength="100"/></svg>
          ${ring}
        </div>
        <div class="scan-verdict-text">
          <h2 class="scan-verdict scan-verdict--${band}" id="scan-verdict" tabindex="-1">${headline}</h2>
          <p class="scan-next">${esc(next)}</p>
        </div>
      </div>
      <div class="scan-cards">
        ${top.slice(0, Math.max(lead, 0)).map(card).join('')}
        ${top.length > lead ? `<h3 class="scan-also${rise()}">${lead ? 'Also worth comparing' : 'Closest matches'}</h3>${top.slice(lead).map((x, i) => card(x, i + lead)).join('')}` : ''}
      </div>
      <section class="scan-none${rise()}" aria-labelledby="scan-none-h">
        <h3 id="scan-none-h">None of these?</h3>
        <div class="scan-none-acts">
          <button type="button" class="btn" data-tighter>Try a tighter box</button>
          ${multi ? '<button type="button" class="btn" data-pickkind>Pick a kind</button>' : ''}
          ${ctx.openSearch ? '<button type="button" class="btn" data-search>Search the dex</button>' : '<a class="btn" href="#/dex">Search the dex</a>'}
        </div>
      </section>`;
    if (fresh) {
      status.textContent = '';
      $('#scan-verdict', out)?.focus({ preventScroll: true });
      // The result section, not the verdict card: the card is still rising in, so its position is off by the offset.
      out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      ctx.countUp?.($('[data-ringn]', out), 0, sure, { delay: 260, duration: 820 });
    }
  }

  // ---------- events ----------
  view.onchange = e => {
    const inp = e.target.closest('[data-file]');
    if (inp) { const f = inp.files?.[0]; inp.value = ''; pick(f); }
  };
  view.onclick = e => {
    const t = e.target;
    if (t.closest('[data-identify]')) { identify(); return; }
    const w = t.closest('[data-whole]');
    if (w && !busy && S.url) { S.whole = !S.whole; drawVF(); $('[data-whole]', tools)?.focus(); return; }
    const k = t.closest('[data-kind]');
    if (k) { S.kind = k.dataset.kind || null; if (S.url) drawVF(); drawKinds(); kindsEl.querySelector(`[data-kind="${k.dataset.kind}"]`)?.focus(); return; }
    const pickBtn = t.closest('[data-this]');
    if (pickBtn) {
      const id = Number(pickBtn.dataset.this);
      markChosen(S.logAt, id);
      ctx.openSightingSheet({ speciesId: id, autoGps: true, photoBlob: S.storeBlob || null, notes: 'Identified from a photo.' });
      return;
    }
    if (t.closest('[data-tighter]')) {
      markChosen(S.logAt, 'none');
      const wasWhole = S.whole;
      if (S.url) { if (!S.whole) S.box.s *= 0.75; S.whole = false; drawVF(true); }
      vf.scrollIntoView({ block: 'center' });
      $('[data-stage]', vf)?.focus({ preventScroll: true });
      status.textContent = `Move the ${wasWhole ? '' : 'smaller '}box onto just the part you want named, then choose Identify.`;
      return;
    }
    if (t.closest('[data-pickkind]')) {
      markChosen(S.logAt, 'none');
      kindsEl?.scrollIntoView({ block: 'center' });
      kindsEl?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-search]')) { markChosen(S.logAt, 'none'); ctx.openSearch(); }
  };

  drawVF();
  drawKinds();
  drawResult(false);
  ctx.state.cleanup = () => { view.onchange = null; };
}

function resetScan() {
  if (S.url) URL.revokeObjectURL(S.url);
  S = { kind: S.kind };
}

function accuracyLine(m) {
  if (!m || typeof m !== 'object') return '';
  if (typeof m.text === 'string' && m.text.trim()) return ` ${m.text.trim()}`;
  const frac = v => (typeof v === 'number' && isFinite(v) ? (v > 1 ? v / 100 : v) : null);
  const top1 = frac(m.top1 ?? m.top1Acc ?? m.accuracy), top3 = frac(m.top3 ?? m.top3Acc);
  const n = m.n ?? m.photos ?? m.count;
  if (top1 == null) return '';
  const on = typeof n === 'number' && n > 0 ? ` on ${n.toLocaleString('en-AU')} photos it hadn't seen before` : '';
  let s = ` In testing${on}, it named the right species first ${Math.round(top1 * 100)}% of the time`;
  s += top3 != null ? `, and had it in its top three ${Math.round(top3 * 100)}% of the time.` : '.';
  const lp = frac(m.likelyPrecision ?? m.likely);
  if (lp != null) s += ` When it said Likely, it was right ${Math.round(lp * 100)}% of the time.`;
  return s;
}

async function logScan(res) {
  const at = Date.now();
  try {
    const log = (await db.kvGet('scanLog')) || [];
    log.push({ at, top: res.results.slice(0, 5).map(r => [r.id, Math.round(r.p * 1000) / 1000]), band: res.band, chosen: null });
    await db.kvSet('scanLog', log.slice(-LOG_MAX));
  } catch (_) {}
  return at;
}
async function markChosen(at, chosen) {
  if (!at) return;
  try {
    const log = (await db.kvGet('scanLog')) || [];
    const e = log.find(x => x.at === at);
    if (e) { e.chosen = chosen; await db.kvSet('scanLog', log); }
  } catch (_) {}
}
