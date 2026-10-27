// v1's toast and live region (js/app.js:176-200): one toast at a time, about 4.5 s, tap to dismiss. It is announced
// through the polite #announce region, not read twice. Both live on <body>, so a toast survives a route change
// (Settings says "All sightings deleted" after moving to the dex, as v1 does).

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

// Made up front, so a screen reader is already watching it when the first message arrives.
if (typeof document !== 'undefined') {
  if (document.body) region();
  else document.addEventListener('DOMContentLoaded', () => region(), { once: true });
}

let announceT = 0;
export function announce(msg: string) {
  const el = region();
  if (!el) return;
  clearTimeout(announceT);
  el.textContent = '';
  announceT = window.setTimeout(() => { el.textContent = msg; }, 60);
}

let toastEl: HTMLElement | null = null;
let toastT = 0;
export function toast(msg: string) {
  announce(msg);
  clearTimeout(toastT);
  toastEl?.remove();
  const t = (toastEl = document.createElement('div'));
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
}
