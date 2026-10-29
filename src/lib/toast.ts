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
 * Where a toast rests to keep clear of `clear` (an element near the foot of the screen, such as a page's own
 * buttons), as its offset from the bottom of the viewport: null when its usual place doesn't cover it, or when there
 * is no room above it. `rest` is the toast's usual box, measured from the top of the viewport.
 */
export function clearOf(rest: { top: number; bottom: number }, clear: { top: number; bottom: number }, vh: number, gap = 10): number | null {
  if (clear.bottom <= clear.top || rest.top >= clear.bottom || rest.bottom <= clear.top) return null;
  const height = rest.bottom - rest.top;
  if (clear.top - gap - height < 72) return null; // no room above it: it stays where it is (a tap takes it away)
  return Math.ceil(vh - clear.top + gap);
}

/**
 * Shows `msg` for about 4.5 s; screen readers hear `say` (the same words unless a fuller line is given). With `clear`,
 * a toast whose usual place would cover that element rests just above it instead. Returns a function that takes this
 * toast down early (it does nothing once the toast has gone).
 */
export function toast(msg: string, say = msg, { clear }: { clear?: Element | null } = {}): () => void {
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
  if (clear?.isConnected) {
    // Its resting place comes from its bottom offset and height, not its box, which the rise-in animation moves.
    const restBottom = innerHeight - (parseFloat(getComputedStyle(t).bottom) || 0);
    const at = clearOf({ top: restBottom - t.offsetHeight, bottom: restBottom }, clear.getBoundingClientRect(), innerHeight);
    if (at != null) t.style.bottom = `${at}px`;
  }
  toastT = window.setTimeout(hide, 4500);
  return hide;
}
