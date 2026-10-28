import { useSyncExternalStore } from 'react';
import { loadSeq } from '../core/seqdata.js';

// seq.json holds the regional reporting rates, hotspots and map points. v1 loaded it
// before the first render; we start loading it at boot (lib/boot.ts), and React's first draw waits a moment for it
// there, so the Dex's day pick is on its first frame; screens re-render if it lands later.
let started = false;
let ready = false;
let waited = false;
let landed: Promise<void> = Promise.resolve();
// Changes when the data lands, or when the wait for it runs out: what the screens redraw on.
let version = 0;
const subscribers = new Set<() => void>();
const notify = () => {
  version += 1;
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // a broken subscriber must not stop the others
    }
  }
};

/** How long a screen waits for the regional data before it goes ahead without it. */
export const SEQ_WAIT = 1500;

export function ensureSeq(): void {
  if (started) return;
  started = true;
  // If the data never comes (a broken copy offline), screens waiting on it stop waiting, once, for the whole app.
  setTimeout(() => {
    waited = true;
    if (!ready) notify();
  }, SEQ_WAIT);
  landed = Promise.resolve(loadSeq())
    .catch(() => {})
    .then(() => {
      ready = true;
      notify();
    });
}

/** Starts the load if need be; resolves once the regional data is in (or failed to load). */
export function seqLanded(): Promise<void> {
  ensureSeq();
  return landed;
}

/** True once the regional data is in, or SEQ_WAIT after it was first asked for: anything waiting on it goes ahead. */
export const seqSettled = () => ready || waited;

const subscribe = (fn: () => void) => {
  ensureSeq();
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const snapshot = () => version;

/** Subscribe a component to the regional data becoming available (or the wait for it running out). */
export function useSeqReady(): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return ready;
}
