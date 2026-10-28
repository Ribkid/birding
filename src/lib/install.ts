// v1 js/app.js:3101 and promptInstall (:3000). The browser's install offer arrives once, early, so it is caught as
// soon as this module loads and held. v1 showed an Install button on the welcome card, in Settings and on the Dex
// Today rail while it was held; useCanInstall() and promptInstall() are what those screens need.
import { useSyncExternalStore } from 'react';
import { toast } from './toast';

type InstallPrompt = Event & { prompt: () => Promise<void> | void; userChoice: Promise<{ outcome: string }> };

let held: InstallPrompt | null = null;
const subs = new Set<() => void>();
const notify = () => { for (const fn of subs) fn(); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    held = e as InstallPrompt;
    notify();
  });
}

export const canInstall = () => !!held;
export function onInstallChange(fn: () => void) {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
export const useCanInstall = () => useSyncExternalStore(onInstallChange, canInstall, () => false);

export async function promptInstall() {
  const p = held;
  if (!p) { toast('Use your browser menu, then Add to Home screen.'); return; }
  void p.prompt();
  const r = await p.userChoice.catch(() => null);
  held = null;
  notify();
  if (r?.outcome === 'accepted') toast("Installed. Find Sarah's BirdyDex on your home screen.");
}
