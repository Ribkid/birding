// One stack for everything that sits over the page: sheets, search, the place picker, the celebration, the card
// and the welcome. The top layer owns focus and Escape. The page and every lower layer are made inert, so taps,
// Tab and screen readers stay inside the top one. Closing a layer puts focus back where it was.

const stack = [];
const madeInert = new Set();
// Never made inert: the live region, passing messages and the update notice.
const SKIP = '#announce, .toast, .confetti, .sync-banner, .update-bar, script, noscript, [data-closing]';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let uid = 0;

// ---------- focus keys ----------
// Attributes that identify a control well enough to find its twin after the page is redrawn.
const KEYS = ['data-show', 'data-kind', 'data-inc', 'data-dec', 'data-pick', 'data-scope', 'data-mshow', 'data-layout',
  'data-sort', 'data-season', 'data-hot', 'data-need', 'data-locate', 'data-lk', 'data-tk', 'data-mode', 'data-month',
  'data-habitat', 'data-group', 'data-rarity', 'data-reset', 'data-tile', 'data-edit', 'data-log', 'data-hero',
  'data-step', 'data-loghit', 'data-logscan', 'data-play', 'data-next', 'data-tab', 'data-search'];
// If the control itself is gone (a count went to zero), its neighbour will do.
const ALIAS = { 'data-dec': 'data-inc' };

export function focusKey(el) {
  if (!el || el === document.body || el === document.documentElement || !el.getAttribute) return null;
  for (const k of KEYS) if (el.hasAttribute(k)) return [k, el.getAttribute(k)];
  if (el.id) return ['id', el.id];
  if (el.matches('a[href]')) return ['href', el.getAttribute('href')];
  return null;
}
export function findByKey(key, root = document) {
  if (!key) return null;
  const [k, v] = key;
  if (k === 'id') { const el = document.getElementById(v); return el && root.contains(el) ? el : null; }
  const find = a => root.querySelector(`[${a}="${CSS.escape(v)}"]`);
  return find(k) || (ALIAS[k] ? find(ALIAS[k]) : null);
}
const lost = () => { const a = document.activeElement; return !a || a === document.body || !a.isConnected; };

// Run fn (which redraws part of the page) and put keyboard focus back on the matching control afterwards.
// fallback: selectors to try in order if that control is gone (a tally row removed at zero), e.g. '[data-tq], h1'.
export function keepFocus(fn, { fallback = '' } = {}) {
  const key = focusKey(document.activeElement);
  const out = fn();
  const spare = () => {
    for (const sel of fallback.split(',').map(x => x.trim()).filter(Boolean)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.matches('h1, h2, h3') && !el.hasAttribute('tabindex')) el.tabIndex = -1;
      return el;
    }
    return null;
  };
  if (key) {
    const back = () => { if (lost()) (findByKey(key) || spare())?.focus({ preventScroll: true }); };
    back();
    // No rejection handler: a redraw that fails must still surface as an uncaught error.
    if (out && typeof out.then === 'function') out.then(back);
  }
  return out;
}

export const focusables = root => [...root.querySelectorAll(FOCUSABLE)]
  .filter(el => !el.closest('[inert], [hidden]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

// ---------- the stack ----------
export const topLayer = () => stack[stack.length - 1] || null;
export const layers = () => stack.slice();
const topModal = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].modal) return stack[i]; return null; };

function sync() {
  const top = topModal();
  for (const child of document.body.children) {
    const want = !!top && child !== top.el && !child.matches(SKIP);
    if (want && !child.inert) { child.inert = true; madeInert.add(child); }
    else if (!want && madeInert.has(child)) { child.inert = false; madeInert.delete(child); }
  }
  for (const el of madeInert) if (!el.isConnected) madeInert.delete(el);
  document.body.classList.toggle('has-sheet', stack.some(l => l.lock));
}

// el: the element appended to <body>. dialog: the part that is the dialog (defaults to el).
// close(reason): how this layer dismisses itself ('escape', 'nav', ...); it must call closeLayer().
// label / labelledBy name the dialog; otherwise its first heading does. lock stops the page scrolling behind it.
// modal: false keeps the page usable (the patch sheet over the map).
export function openLayer(el, { dialog = el, close, label, labelledBy, modal = true, lock = false, returnTo = document.activeElement } = {}) {
  const layer = { el, dialog, modal, lock, returnTo, key: focusKey(returnTo) };
  layer.close = close || (() => { el.remove(); closeLayer(layer); });
  if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', String(modal));
  const h = !label && !labelledBy && dialog.querySelector('h1, h2, h3');
  if (h && !h.id) h.id = `layer-h-${++uid}`;
  if (labelledBy || h) { dialog.setAttribute('aria-labelledby', labelledBy || h.id); dialog.removeAttribute('aria-label'); }
  else if (label) dialog.setAttribute('aria-label', label);
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  stack.push(layer);
  sync();
  return layer;
}

// Take a layer off the stack (the caller removes or animates out its element). Returns false if it was already off.
export function closeLayer(layer, { restore = true } = {}) {
  const i = stack.indexOf(layer);
  if (i < 0) return false;
  stack.splice(i, 1);
  sync();
  if (restore) restoreFocus(layer);
  return true;
}

function restoreFocus(layer) {
  const top = topLayer();
  const scope = top ? top.dialog : document;
  let t = layer.returnTo;
  const usable = el => el && el.isConnected && !el.closest('[inert]') && scope.contains(el);
  if (!usable(t)) t = findByKey(layer.key, scope);
  if (!usable(t)) t = top ? focusables(top.dialog)[0] || top.dialog : null;
  t?.focus({ preventScroll: true });
  if (!top && lost()) {
    // Nothing to go back to (it was redrawn away): land on the page heading.
    const h = document.querySelector('#view h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } else document.getElementById('view')?.focus({ preventScroll: true });
  }
}

// Close every layer, top first (a route change does this). Each layer's own close() does the work.
export function closeAllLayers(reason = 'nav') {
  for (const l of stack.slice().reverse()) l.close(reason);
  if (stack.length) { stack.length = 0; sync(); }
}

// Escape closes only the top layer; Tab and Shift+Tab wrap inside a modal one.
export function onLayerKey(e) {
  const top = topLayer();
  if (!top) return false;
  if (e.key === 'Escape') { e.preventDefault(); top.close('escape'); return true; }
  if (e.key === 'Tab' && top.modal) {
    const f = focusables(top.dialog);
    if (!f.length) { e.preventDefault(); top.dialog.focus(); return true; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!top.dialog.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (a === first || a === top.dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    return true;
  }
  return false;
}
