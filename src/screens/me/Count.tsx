// v1 js/me.js animateIn: the numbers on Me and on a profile (the rings, the Species, Badges and Outings strip, and Me's
// Life, year and month totals) carry data-count and count up from 0, 120 ms after they are drawn, the first time each
// is shown in a session; after that they are written straight in. v1 drew Me once its data had loaded. A React screen
// draws zeros first while IndexedDB answers, so a number counts once it has a value to count to, a value that lands
// in those 120 ms is the one counted to, and a count under way ends on the newest value.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { countUp, motionOK } from '../../lib/motion';

// v1 me.js `counted`: numbers that have already counted up this session, by screen and slot ('guest:species').
const counted = new Set<string>();

export function Count({ k, n, tag: Tag = 'b', className }: { k: string; n: number; tag?: 'b' | 'dd'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const latest = useRef(n);
  const busy = useRef(false);
  const waiting = useRef<{ timer: number; k: string } | null>(null);
  latest.current = n;

  // The text is written here, never by React, so a count under way is not cut short by a redraw.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || busy.current) return;
    if (counted.has(k) || !n) { el.textContent = String(n); return; }
    counted.add(k);
    if (!motionOK() || document.hidden) { el.textContent = String(n); return; }
    busy.current = true;
    el.textContent = '0';
    waiting.current = {
      k,
      timer: window.setTimeout(() => {
        waiting.current = null;
        void countUp(el, 0, latest.current).then(() => {
          busy.current = false;
          if (el.isConnected) el.textContent = String(latest.current);
        });
      }, 120),
    };
  }, [k, n]);

  // Leaving before the count started: it never showed, so it counts next time.
  useEffect(() => () => {
    const w = waiting.current;
    if (!w) return;
    clearTimeout(w.timer);
    counted.delete(w.k);
    waiting.current = null;
    busy.current = false;
  }, []);

  return <Tag ref={ref} className={className} data-count={n} />;
}
