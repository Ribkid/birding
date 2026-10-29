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
  /** The page asked again while a request was still on its way. */
  private again = false;
  /** The lock went while the page was in view once already this visit. */
  private lost = false;
  constructor(private env: WakeEnv, private onChange: (on: boolean, why?: 'failed' | 'timeout') => void) {}

  private visible = () => {
    if (this.env.doc.visibilityState !== 'visible' || !this.on) return;
    this.lost = false;
    if (!this.held()) void this.request();
  };

  private async request() {
    if (!this.env.wakeLock) return;
    // Asked again while an answer is on its way (the page shown again before a request made as it hid has come back):
    // it is asked once more after that answer, rather than dropped.
    if (this.asking) { this.again = true; return; }
    this.asking = true;
    this.again = false;
    let s: Sentinel;
    try {
      s = await this.env.wakeLock.request('screen');
    } catch {
      const back = this.again;
      this.asking = false;
      this.again = false;
      // A hidden page is refused; it is asked again once it is visible, or at once if it came back while this was
      // asked. Anything else turns it off.
      if (this.env.doc.visibilityState !== 'visible' || !this.on) return;
      if (back) void this.request();
      else this.stop('failed');
      return;
    }
    this.asking = false;
    this.again = false;
    if (!this.on) { void s.release().catch(() => {}); return; }
    this.sentinel = s;
    s.addEventListener('release', () => {
      if (this.sentinel !== s) return;
      this.sentinel = null;
      // The browser lets go when the page is hidden; visibilitychange asks again on the way back. Let go while she
      // is still looking (battery saver coming on, say), it is asked for once more, and if it goes again Screen on
      // turns off and says so, rather than showing on while the screen can sleep.
      if (!this.on || this.env.doc.visibilityState !== 'visible') return;
      if (this.lost) { this.stop('failed'); return; }
      this.lost = true;
      void this.request();
    });
  }

  start() {
    if (this.on || !wakeLockSupported(this.env)) return;
    this.on = true;
    this.lost = false;
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
