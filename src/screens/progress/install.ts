// "Install app on this phone" (v1 js/app.js:3000-3008 and :3101). The browser offers its install prompt once, early,
// so this module listens from app start (Settings is imported by App) and keeps the event for the Settings row.
import { useEffect, useState } from 'react';
import { toast } from '../toast';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;
const subs = new Set<() => void>();
const changed = () => subs.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });
}

export const isInstalled = () => {
  try { return matchMedia('(display-mode: standalone)').matches; } catch { return false; }
};

/** true while the browser has an install prompt waiting. */
export function useInstallPrompt() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, []);
  return !!installPrompt;
}

export async function promptInstall() {
  const p = installPrompt;
  if (!p) { toast('Use your browser menu, then Add to Home screen.'); return; }
  const r = await p.prompt().then(() => p.userChoice).catch(() => null);
  installPrompt = null;
  if (r?.outcome === 'accepted') toast("Installed. Find Sarah's BirdyDex on your home screen.");
  changed();
}
