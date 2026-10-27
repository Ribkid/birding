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

  view.innerHTML = `
    <header class="page-head page-head--back scan-head"><a class="iconbtn" href="#/dex" aria-label="Back to the dex">${icon.back}</a>
      <div><h1>Scan a photo</h1><p class="muted small">${esc(intro)}</p></div></header>
    <div class="scan pad-x">
      <section class="scan-vf" data-vf aria-label="Photo"></section>
      <div class="scan-tools" data-tools></div>
      ${multi ? `<div class="scan-kinds" role="group" aria-label="What kind is it?" data-kinds></div>` : ''}
      <button type="button" class="btn btn--primary btn--block scan-go" data-identify>Identify</button>
      <div class="scan-work">
        <p class="scan-status" role="status" aria-live="polite" data-status></p>
        <div class="scan-progress" data-progress aria-hidden="true"></div>
      </div>
      <section class="scan-result" data-result aria-labelledby="scan-verdict"></section>
      <p class="scan-foot" data-foot></p>
    </div>`;

  const vf = $('[data-vf]', view), tools = $('[data-tools]', view), kindsEl = $('[data-kinds]', view);
  const go = $('[data-identify]', view), status = $('[data-status]', view), prog = $('[data-progress]', view);
  const out = $('[data-result]', view);
  let busy = false;

  // ---------- footnote ----------
  $('[data-foot]', view).textContent = `Photo ID runs on your phone with BioCLIP, a model from the Imageomics Institute (MIT licence). The first scan downloads about ${mod?.PHOTO_MODEL_MB ?? 98} MB once, best on Wi-Fi. After that it works offline.${accuracyLine(known.metrics)}`;

  // ---------- viewfinder ----------
  function drawVF() {
    if (!S.url) {
      vf.className = 'scan-vf scan-vf--empty';
      vf.innerHTML = `<span class="scan-corners" aria-hidden="true"></span>
        <div class="scan-entry">
          <span class="scan-entry-icon">${icon.scan}</span>
          <p>Works best when ${subject() ? `the ${esc(subject())}` : 'it'} fills a good part of the frame.</p>
          <div class="scan-pick">
            <label class="btn btn--primary scan-pickbtn">${icon.cam}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" class="scan-file" data-file></label>
            <label class="btn scan-pickbtn scan-pickbtn--ghost">${galleryIcon}<span>Choose from gallery</span><input type="file" accept="image/*" class="scan-file" data-file></label>
          </div>
        </div>`;
      tools.innerHTML = '';
      go.classList.add('hidden');
      kindsEl?.classList.add('hidden');
      return;
    }
    vf.className = 'scan-vf';
    vf.innerHTML = `<div class="scan-stage ${S.whole ? 'scan-stage--whole' : ''}" data-stage tabindex="0" role="application" aria-roledescription="photo"
        aria-label="${S.whole ? 'Your photo. The whole photo will be identified.' : 'Your photo with the identify box. Arrow keys move the box, plus and minus change its size.'}">
        <img src="${S.url}" alt="" draggable="false">
        <div class="scan-box" data-box><span class="scan-handle" data-handle></span></div>
        <span class="scan-corners scan-corners--photo" aria-hidden="true"></span>
      </div>`;
    tools.innerHTML = `<p class="scan-hint">${S.whole ? 'The whole photo will be identified.'
      : subject() ? `Drag the box onto the ${esc(subject())}. Pull its corner to resize.` : 'Drag the box onto what you want named. Pull its corner to resize.'}</p>
      <div class="scan-tool-row">
        <button type="button" class="chip scan-chip" data-whole aria-pressed="${S.whole}">Whole photo</button>
        <label class="btn btn--quiet scan-change">${galleryIcon}<span>Change photo</span><input type="file" accept="image/*" class="scan-file" data-file></label>
      </div>`;
    go.classList.remove('hidden');
    kindsEl?.classList.remove('hidden');
    drawBox();
    wireStage($('[data-stage]', vf));
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
    Object.assign(el.style, { left: `${(b.cx - b.s / 2) / S.W * 100}%`, top: `${(b.cy - b.s / 2) / S.H * 100}%`, width: `${b.s / S.W * 100}%`, height: `${b.s / S.H * 100}%` });
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
      if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        mode = 'pinch'; start = { d: Math.hypot(a.x - c.x, a.y - c.y) || 1, s: b.s };
      } else if (e.target.closest('[data-handle]')) {
        mode = 'resize'; start = { x0: b.cx - b.s / 2, y0: b.cy - b.s / 2 };
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
        const s = Math.max(p.x - start.x0, p.y - start.y0);
        b.s = Math.min(s, S.W - start.x0, S.H - start.y0);
        b.cx = start.x0 + b.s / 2; b.cy = start.y0 + b.s / 2;
      } else if (mode === 'move') { b.cx = p.x - start.dx; b.cy = p.y - start.dy; }
      drawBox();
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (pts.size === 1 && mode === 'pinch') { const p = [...pts.values()][0]; mode = 'move'; start = { dx: p.x - S.box.cx, dy: p.y - S.box.cy }; }
      if (!pts.size) { mode = null; stage.classList.remove('scan-stage--drag'); }
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
    const chip = (k, label) => `<button type="button" class="chip scan-chip ${k ? `kind--${k}` : ''}" data-kind="${k || ''}" aria-pressed="${(S.kind || '') === (k || '')}">${k ? '<i aria-hidden="true"></i>' : ''}${esc(label)}</button>`;
    kindsEl.innerHTML = chip(null, 'Anything') + covered.map(k => chip(k, KINDS[k].label)).join('');
  }

  // ---------- picking a photo ----------
  async function pick(file) {
    if (!file) return;
    resetScan();
    out.innerHTML = ''; prog.innerHTML = '';
    status.textContent = 'Opening the photo…';
    let blob, img;
    try {
      blob = await ctx.resizeImage(file, 1600);
      if (!blob) throw new Error('unreadable');
      img = new Image(); img.src = URL.createObjectURL(blob);
      await img.decode();
    } catch (_) {
      if (img?.src) URL.revokeObjectURL(img.src);
      status.textContent = 'That file couldn\'t be opened as a photo. Try a JPEG or PNG.';
      return;
    }
    const W = img.naturalWidth, H = img.naturalHeight;
    S = { at: Date.now(), file, storeBlob: blob, url: img.src, W, H, box: { cx: W / 2, cy: H / 2, s: Math.min(W, H) * 0.75 }, whole: false, kind: S.kind, result: null };
    drawVF();
    status.textContent = `Photo ready. Move the box onto ${subject() ? `the ${subject()}` : 'what you want named'}, then choose Identify.`;
    $('[data-stage]', vf)?.focus({ preventScroll: true });
  }

  // ---------- identify ----------
  async function identify() {
    if (busy || !S.file) return;
    busy = true;
    const { file, whole, kind } = S;
    go.setAttribute('aria-disabled', 'true'); go.textContent = 'Identifying…';
    out.innerHTML = ''; prog.innerHTML = '';
    status.textContent = 'Starting photo ID…';
    status.closest('.scan-work').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const MB = mod?.PHOTO_MODEL_MB ?? 98;
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
          prog.innerHTML = `<div class="scan-steps">${Array.from({ length: x.count }, (_, i) => `<i class="${i < x.index - 1 ? 'on' : i === x.index - 1 ? 'now' : ''}"></i>`).join('')}</div>`;
        },
      });
      if (location.hash !== '#/scan' || S.file !== file) return; // left Scan or chose another photo meanwhile
      prog.innerHTML = '';
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
      busy = false;
      go.removeAttribute('aria-disabled'); go.textContent = 'Identify';
    }
  }

  // The analysed area as a small square image for the comparison cards.
  function yoursImage() {
    const img = $('[data-stage] img', vf);
    if (!img) return '';
    const n = 240, c = document.createElement('canvas'); c.width = c.height = n;
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
    if (S.whole) {
      const k = n / Math.max(S.W, S.H), w = S.W * k, h = S.H * k;
      cx.fillStyle = getComputedStyle(vf).backgroundColor || '#000'; cx.fillRect(0, 0, n, n);
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
    const headline = r.band === 'likely' ? `Likely: ${a.sp.name}`
      : r.band === 'possibly' && b ? `Possibly ${a.sp.name} or ${b.sp.name}` : 'Can\'t tell from this photo';
    const next = r.band === 'likely' ? 'Check the markings against the photos below, then log it.'
      : r.band === 'possibly' ? (r.whole ? `Compare the two below. A box around just the ${subj || 'subject'} often settles it.` : 'Compare the two below. A tighter box or another angle often settles it.')
      : r.whole ? `Draw a box around the ${subj || 'subject'} and try again.`
      : multi && !r.kind ? 'Choose what kind it is, or try a tighter box or a photo from another angle.'
      : 'Try a tighter box, or a photo from another angle.';
    const lead = r.band === 'likely' ? 1 : r.band === 'possibly' ? 2 : 0;
    const word = p => (p >= (r.bands?.likely ?? 0.8) ? 'Strong match' : p >= 0.3 ? 'Possible' : p >= 0.08 ? 'Outside chance' : 'Unlikely');
    const refs = id => {
      const g = galleryFor(id).slice(0, 2).map(p => ({ src: p.thumb || p.src, credit: p.credit, from: p.from }));
      if (g.length < 2) { const w = sized(id); if (w && !g.some(p => p.src === w)) g.unshift({ src: w, credit: '', from: 'Wikipedia' }); }
      return g.slice(0, 2);
    };
    const card = (x, i) => {
      const sp = x.sp, ph = refs(sp.id), isLead = i < lead;
      const credits = ph.filter(p => p.credit).map(p => p.credit);
      const tile = p => (p ? `<img src="${esc(p.src)}" alt="${esc(sp.name)}, reference photo" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'scan-tile-missing'}))">` : '<span class="scan-tile-missing"></span>');
      return `<article class="scan-card kind--${sp.kind} ${isLead ? 'scan-card--lead' : ''}">
        <div class="scan-strip">
          <figure class="scan-yours">${S.yours ? `<img src="${S.yours}" alt="Your photo">` : '<span class="scan-tile-missing"></span>'}<figcaption>Yours</figcaption></figure>
          ${tile(ph[0])}${tile(ph[1])}
        </div>
        ${credits.length ? `<p class="scan-credit">Photos: ${esc(words(credits.map(c => String(c).slice(0, 40)), 'and'))}${ph.some(p => p.from && p.credit) ? ` (${esc(ph.find(p => p.credit)?.from || '')})` : ''}</p>` : ''}
        <div class="scan-card-head">
          <h3><a href="#/bird/${sp.id}">${esc(sp.name)}</a></h3>
          <span class="scan-kind">${esc(KINDS[sp.kind].one)}</span>
          ${seen.has(sp.id) ? '' : '<span class="scan-new">New for your dex</span>'}
        </div>
        ${sp.notes ? `<p class="scan-tip">${esc(firstSentence(sp.notes))}</p>` : ''}
        <div class="scan-card-foot">
          <p class="scan-conf"><strong>${word(x.p)}</strong> <span>${pct(x.p)}</span></p>
          <button type="button" class="btn ${isLead ? 'btn--primary' : ''} scan-this" data-this="${sp.id}" aria-label="This one: ${esc(sp.name)}">This one</button>
        </div>
      </article>`;
    };
    out.innerHTML = `<div class="scan-verdict-wrap ${fresh ? 'scan-reveal' : ''}">
        <h2 class="scan-verdict scan-verdict--${r.band}" id="scan-verdict" tabindex="-1">${esc(headline)}</h2>
        <p class="scan-next">${esc(next)}</p>
      </div>
      <div class="scan-cards">
        ${top.slice(0, Math.max(lead, 0)).map(card).join('')}
        ${top.length > lead ? `<h3 class="scan-also">${lead ? 'Also worth comparing' : 'Closest matches'}</h3>${top.slice(lead).map((x, i) => card(x, i + lead)).join('')}` : ''}
      </div>
      <section class="scan-none" aria-labelledby="scan-none-h">
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
      $('.scan-verdict-wrap', out)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
      if (S.url) { if (!S.whole) S.box.s *= 0.75; S.whole = false; drawVF(); }
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
