// Screen on: keeps the phone awake on a live outing (the Screen Wake Lock API), so she isn't unlocking it between
// birds. It is off until she asks, and it lets go by itself: the browser drops the lock when the page is hidden, so it
// is asked for again when she comes back; Finish, leaving the outing and two hours all release it for good.
import { useEffect, useRef, useState } from 'react';
import { toast } from './toast';

/** How long the screen stays on before it lets go by itself. */
export const WAKE_MAX_MS = 2 * 60 * 60 * 1000;

interface Sentinel {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', fn: () => void) => void;
}
interface WakeLockApi {
  request: (type: 'screen') => Promise<Sentinel>;
}
export interface WakeEnv {
  wakeLock?: WakeLockApi;
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}

const browserEnv = (): WakeEnv => ({
  wakeLock: typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock : undefined,
  doc: document,
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (t) => window.clearTimeout(t as number),
});

/** True where the browser can keep the screen on. */
export const wakeLockSupported = (env: Pick<WakeEnv, 'wakeLock'> = browserEnv()) => typeof env.wakeLock?.request === 'function';

/**
 * One screen lock, held while `on`. `onChange(false, why)` reports that it turned itself off: 'failed' when the
 * browser said no (battery saver, say), 'timeout' after WAKE_MAX_MS.
 */
export class ScreenWake {
  on = false;
  private sentinel: Sentinel | null = null;
  private timer: unknown = null;
  private asking = false;
  constructor(private env: WakeEnv, private onChange: (on: boolean, why?: 'failed' | 'timeout') => void) {}

  private visible = () => {
    if (this.env.doc.visibilityState === 'visible' && this.on && !this.sentinel) void this.request();
  };

  private async request() {
    if (this.asking || !this.env.wakeLock) return;
    this.asking = true;
    try {
      const s = await this.env.wakeLock.request('screen');
      if (!this.on) { void s.release().catch(() => {}); return; }
      this.sentinel = s;
      // The browser lets go when the page is hidden; visibilitychange asks again on the way back.
      s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; });
    } catch {
      // A hidden page is refused; it is asked again once it is visible. Anything else turns it off.
      if (this.env.doc.visibilityState === 'visible' && this.on) this.stop('failed');
    } finally {
      this.asking = false;
    }
  }

  start() {
    if (this.on || !wakeLockSupported(this.env)) return;
    this.on = true;
    this.env.doc.addEventListener('visibilitychange', this.visible);
    this.timer = this.env.setTimer(() => this.stop('timeout'), WAKE_MAX_MS);
    this.onChange(true);
    void this.request();
  }

  /** Lets go of the screen. */
  stop(why?: 'failed' | 'timeout') {
    if (!this.on) return;
    this.on = false;
    this.env.doc.removeEventListener('visibilitychange', this.visible);
    if (this.timer != null) this.env.clearTimer(this.timer);
    this.timer = null;
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) void s.release().catch(() => {});
    this.onChange(false, why);
  }

  /** True while the browser is holding the screen on. */
  held() {
    return !!this.sentinel && !this.sentinel.released;
  }
}

/**
 * Screen on for the outing page: off at first, and released when `live` goes false (Finish), when the page goes
 * (leaving the outing) and after two hours.
 */
export function useScreenWake(live: boolean): { supported: boolean; on: boolean; toggle: () => void } {
  const [on, setOn] = useState(false);
  const [supported] = useState(() => wakeLockSupported());
  const wake = useRef<ScreenWake | null>(null);
  if (!wake.current && supported) {
    wake.current = new ScreenWake(browserEnv(), (now, why) => {
      setOn(now);
      if (why === 'failed') toast("The screen can't stay on right now.");
      if (why === 'timeout') toast('Screen on has turned off after two hours.');
    });
  }
  useEffect(() => {
    if (!live) wake.current?.stop();
  }, [live]);
  useEffect(() => () => wake.current?.stop(), []);
  return {
    supported,
    on,
    toggle: () => {
      const w = wake.current;
      if (!w) return;
      if (w.on) w.stop(); else w.start();
    },
  };
}
