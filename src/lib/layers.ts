// One stack for everything that sits over the page: sheets, search, the celebration and the welcome.
// The top layer owns focus and Escape. The page and every lower layer are made inert, so taps, Tab and screen
// readers stay inside the top one. Closing a layer puts focus back where it was.

export interface Layer {
  el: HTMLElement;
  dialog: HTMLElement;
  modal: boolean;
  lock: boolean;
  returnTo: Element | null;
  key: [string, string | null] | null;
  close: (reason?: string) => void;
}

const stack: Layer[] = [];
const madeInert = new Set<Element>();
const SKIP = '#announce, .toast, .confetti, .sync-banner, .update-bar, script, noscript, [data-closing]';
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let uid = 0;

const KEYS = ['data-show', 'data-kind', 'data-inc', 'data-dec', 'data-pick', 'data-scope', 'data-mshow', 'data-layout',
  'data-sort', 'data-season', 'data-hot', 'data-need', 'data-locate', 'data-lk', 'data-tk', 'data-mode', 'data-month',
  'data-habitat', 'data-group', 'data-rarity', 'data-reset', 'data-tile', 'data-edit', 'data-log', 'data-hero',
  'data-step', 'data-loghit', 'data-logscan', 'data-play', 'data-next', 'data-tab', 'data-search'];
const ALIAS: Record<string, string> = { 'data-dec': 'data-inc' };

export function focusKey(el: Element | null): [string, string | null] | null {
  if (!el || el === document.body || el === document.documentElement || !el.getAttribute) return null;
  for (const k of KEYS) if (el.hasAttribute(k)) return [k, el.getAttribute(k)];
  if (el.id) return ['id', el.id];
  if (el.matches('a[href]')) return ['href', el.getAttribute('href')];
  return null;
}

export function findByKey(key: [string, string | null] | null, root: ParentNode = document): HTMLElement | null {
  if (!key) return null;
  const [k, v] = key;
  if (k === 'id') { const el = document.getElementById(v || ''); return el && root.contains(el) ? el : null; }
  const find = (a: string) => root.querySelector<HTMLElement>(`[${a}="${CSS.escape(v || '')}"]`);
  return find(k) || (ALIAS[k] ? find(ALIAS[k]) : null);
}
const lost = () => { const a = document.activeElement; return !a || a === document.body || !(a as Element).isConnected; };

export function keepFocus<T>(fn: () => T, { fallback = '' }: { fallback?: string } = {}): T {
  const key = focusKey(document.activeElement);
  const out = fn();
  const spare = () => {
    for (const sel of fallback.split(',').map(x => x.trim()).filter(Boolean)) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      if (el.matches('h1, h2, h3') && !el.hasAttribute('tabindex')) el.tabIndex = -1;
      return el;
    }
    return null;
  };
  if (key) {
    const back = () => { if (lost()) (findByKey(key) || spare())?.focus({ preventScroll: true }); };
    back();
    if (out && typeof (out as any).then === 'function') (out as any).then(back);
  }
  return out;
}

export const focusables = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
  .filter(el => !el.closest('[inert], [hidden]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

// v1 openSheet: 50 ms after a sheet opens, its first control takes focus (the first input, select, textarea, button
// or link, in document order), unless that control is marked data-noautofocus. Focus already inside is left alone.
const FIRST = 'input:not([type=hidden]):not([type=file]), select, textarea, button, a[href]';
export function focusFirst(dialog: HTMLElement): boolean {
  const a = document.activeElement;
  if (a && a !== dialog && dialog.contains(a)) return false;
  const first = dialog.querySelector<HTMLElement>(FIRST);
  if (!first || first.matches('[data-noautofocus]')) return false;
  first.focus({ preventScroll: true });
  return true;
}

export const topLayer = (): Layer | null => stack[stack.length - 1] || null;
export const layers = () => stack.slice();
const topModal = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].modal) return stack[i]; return null; };

function sync() {
  const top = topModal();
  for (const child of document.body.children) {
    const want = !!top && child !== top.el && !child.matches(SKIP);
    if (want && !(child as HTMLElement).inert) { (child as HTMLElement).inert = true; madeInert.add(child); }
    else if (!want && madeInert.has(child)) { (child as HTMLElement).inert = false; madeInert.delete(child); }
  }
  for (const el of madeInert) if (!el.isConnected) madeInert.delete(el);
  document.body.classList.toggle('has-sheet', stack.some(l => l.lock));
}

export function openLayer(el: HTMLElement, { dialog = el, close, label, labelledBy, modal = true, lock = false, returnTo = document.activeElement }: {
  dialog?: HTMLElement; close?: (reason?: string) => void; label?: string; labelledBy?: string; modal?: boolean; lock?: boolean; returnTo?: Element | null;
} = {}): Layer {
  const layer: Layer = { el, dialog, modal, lock, returnTo, key: focusKey(returnTo) } as Layer;
  layer.close = close || (() => { el.remove(); closeLayer(layer); });
  if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', String(modal));
  const h = !label && !labelledBy && dialog.querySelector('h1, h2, h3');
  if (h && !h.id) h.id = `layer-h-${++uid}`;
  if (labelledBy || h) { dialog.setAttribute('aria-labelledby', labelledBy || (h as HTMLElement).id); dialog.removeAttribute('aria-label'); }
  else if (label) dialog.setAttribute('aria-label', label);
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  stack.push(layer);
  sync();
  return layer;
}

export function closeLayer(layer: Layer, { restore = true } = {}): boolean {
  const i = stack.indexOf(layer);
  if (i < 0) return false;
  stack.splice(i, 1);
  sync();
  if (restore) restoreFocus(layer);
  return true;
}

function restoreFocus(layer: Layer) {
  const top = topLayer();
  const scope = top ? top.dialog : document;
  let t: Element | null = layer.returnTo;
  const usable = (el: Element | null) => el && el.isConnected && !el.closest('[inert]') && scope.contains(el);
  if (!usable(t)) t = findByKey(layer.key, scope);
  if (!usable(t)) t = top ? focusables(top.dialog)[0] || top.dialog : null;
  (t as HTMLElement | null)?.focus?.({ preventScroll: true });
  if (!top && lost()) {
    const h = document.querySelector<HTMLElement>('#view h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } else document.getElementById('view')?.focus({ preventScroll: true });
  }
}

export function closeAllLayers(reason = 'nav') {
  for (const l of stack.slice().reverse()) l.close(reason);
  if (stack.length) { stack.length = 0; sync(); }
}

export function onLayerKey(e: KeyboardEvent): boolean {
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
