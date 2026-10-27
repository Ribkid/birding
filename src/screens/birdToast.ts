// v1's toast and live region (birding-refresh js/app.js:174-200), for the species page. One toast at a time, about
// 4.5 s, tap to dismiss. It is announced through the polite #announce region, not read twice: the toast itself is
// aria-hidden. Both sit on <body> like v1's, so src/lib/layers.ts leaves them usable while a sheet is open. Other
// branches carry the same module (src/lib/toast.ts); they share the one #announce element.

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
// A live region is only listened to once it is in the page, so it goes in at start-up, not with the first message.
if (typeof document !== 'undefined') {
  if (document.body) region();
  else document.addEventListener('DOMContentLoaded', () => region(), { once: true });
}

// Clearing it first lets the same message be announced twice.
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
