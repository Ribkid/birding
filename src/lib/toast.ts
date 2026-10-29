// v1 js/app.js:175-201. One toast at a time, about 4.5 s, tap to dismiss. It is announced through the polite live
// region (#announce, which v1 kept in index.html), not read twice: the toast itself is aria-hidden.

let announceT = 0;
function region(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('announce');
  if (!el) {
    el = document.createElement('div');
    el.id = 'announce';
    el.className = 'sr-only';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  return el;
}
// A live region is only listened to once it is in the page, so it goes in at boot, not with the first message.
region();

export function announce(msg: string) {
  const el = region();
  if (!el) return;
  clearTimeout(announceT);
  el.textContent = '';
  announceT = window.setTimeout(() => { el.textContent = msg; }, 60);
}

let toastEl: HTMLElement | null = null;
let toastT = 0;
/**
 * Shows `msg` for about 4.5 s; screen readers hear `say` (the same words unless a fuller line is given). Returns a
 * function that takes this toast down early (it does nothing once the toast has gone).
 */
export function toast(msg: string, say = msg): () => void {
  announce(say);
  clearTimeout(toastT);
  toastEl?.remove();
  const t = toastEl = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.setAttribute('aria-hidden', 'true');
  const hide = () => {
    if (t.classList.contains('toast--out')) return;
    t.classList.add('toast--out');
    if (toastEl === t) toastEl = null;
    setTimeout(() => t.remove(), 260);
  };
  t.addEventListener('click', hide);
  document.body.append(t);
  toastT = window.setTimeout(hide, 4500);
  return hide;
}
