// The browser's install offer (Chromium's beforeinstallprompt), kept for the Install card on the dex home.
// Mirrors v1 js/app.js: the event is caught at start-up, the card shows while it is held, and using it clears it.

interface InstallEvent extends Event {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: string }>;
}

let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    notify();
  });
}

export const installOffered = () => !!offer;
export function onInstallOffer(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// One toast at a time, about 4.5 s, tap to dismiss (v1 toast()).
let toastEl: HTMLElement | null = null;
let toastT = 0;
function toast(msg: string) {
  clearTimeout(toastT);
  toastEl?.remove();
  const t = (toastEl = document.createElement('div'));
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
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

export async function promptInstall() {
  const p = offer;
  if (!p) { toast('Use your browser menu, then Add to Home screen.'); return; }
  void p.prompt();
  const r = await p.userChoice.catch(() => null);
  offer = null;
  notify();
  if (r?.outcome === 'accepted') toast("Installed. Find Sarah's BirdyDex on your home screen.");
}
