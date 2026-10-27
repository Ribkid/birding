import { useEffect, useState } from 'react';
import { loadSeq } from '../core/seqdata.js';

// seq.json holds the regional reporting rates, hotspots and map points. v1 loaded it
// before the first render; we load it in the background and re-render once it lands so
// the dex paints immediately on a cold start.
let started = false;
let ready = false;
const subscribers = new Set<() => void>();

export function ensureSeq(): void {
  if (started) return;
  started = true;
  void Promise.resolve(loadSeq())
    .catch(() => {})
    .then(() => {
      ready = true;
      for (const fn of subscribers) {
        try {
          fn();
        } catch {
          // a broken subscriber must not stop the others
        }
      }
    });
}

/** Subscribe a component to the regional data becoming available. */
export function useSeqReady(): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    ensureSeq();
    const notify = () => setTick((t) => t + 1);
    subscribers.add(notify);
    if (ready) notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);
  return ready;
}
