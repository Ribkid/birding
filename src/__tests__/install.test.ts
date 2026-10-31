// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canInstall, promptInstall } from '../lib/install';

const offer = (outcome: string) => {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn();
  e.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(e);
  return e;
};
const toastText = () => document.querySelector('.toast')?.textContent || null;

describe('install offer (v1 promptInstall)', () => {
  it('holds the browser offer, shows it once, and drops it after use', async () => {
    expect(canInstall()).toBe(false);
    const e = offer('accepted');
    expect(e.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    await promptInstall();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false);
    expect(toastText()).toBe('Installed. Find BirdyDex on your home screen.');
  });

  it('points to the browser menu when there is no offer', async () => {
    await promptInstall();
    expect(toastText()).toBe('Use your browser menu, then Add to Home screen.');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(document.getElementById('announce')?.getAttribute('aria-live')).toBe('polite');
  });
});
