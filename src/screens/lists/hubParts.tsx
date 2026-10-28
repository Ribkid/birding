import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Species } from '../../lib/data';
import { useStore, type StoreState } from '../../lib/store';
import { SpeciesImage } from '../../components/SpeciesImage';
import { countOnTo, countUp } from '../../lib/motion';

/**
 * One store's rows from the shared store (lib/store.ts), kept fresh as they change, and null until her records are
 * in. An empty list drawn first would flash the empty-state copy and count the bento up from nothing; v1 drew the
 * hub only once its state had loaded, and as v1 held it in memory from boot, every later visit draws at once.
 */
export function useStoreRows<T>(store: 'sightings' | 'outings' | 'patches'): T[] | null {
  const rows = useStore((s: StoreState) => s[store]);
  const ready = useStore((s: StoreState) => s.ready);
  return ready ? (rows as unknown as T[]) : null;
}

/** v1 icons the shared Icon set does not carry (birding-refresh js/app.js icon.outing, icon.learn). */
const PATHS = {
  outing: (
    <>
      <path d="M12 21s-6-5.4-6-10.2a6 6 0 0 1 12 0C18 15.6 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9.6 10.6l1.7 1.7 3.2-3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  learn: (
    <path
      d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  ),
};

export function HubIcon({ name }: { name: keyof typeof PATHS }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}

/**
 * v1 birdImg(sp, 'small', '', { alt: '' }): a photo whose name is already written beside it, so it is not read
 * twice. With no photo it leaves an empty, hidden placeholder. Loading look: the shared SpeciesImage's.
 */
export const QuietImage = ({ sp }: { sp: Species }) => <SpeciesImage sp={sp} alt="" />;

// v1 js/app.js:1828-1840. How likely each target is this month, against the most likely one on the list (0..1),
// with words for it so the bar never carries the meaning alone. Without the SEQ records, rarer species score lower.
export function targetChances(
  list: Species[],
  month: number,
  score?: (id: number, month: number) => number,
): Map<number, number> {
  const raw = (s: Species) => (score ? score(s.id, month) : 6 - s.rarity);
  const top = Math.max(1e-9, ...list.map(raw));
  return new Map(list.map((s) => [s.id, Math.max(0.06, raw(s) / top)]));
}

export const chanceWord = (p: number) => (p >= 0.6 ? 'Good chance' : p >= 0.3 ? 'Fair chance' : 'Outside chance');

export function ChanceBar({ p, cls = '', when = ' this month' }: { p: number; cls?: string; when?: string }) {
  return (
    <span className={`chance ${cls}`}>
      <span className="chance-bar" style={{ '--p': `${Math.round(p * 100)}%` } as CSSProperties}>
        <i />
      </span>
      <span className="chance-txt">
        {chanceWord(p)}
        {when}
      </span>
    </span>
  );
}

// v1 countIn: numbers count up the first time they show and whenever they change; otherwise they simply sit there.
// v1 starts the count in the same task that draws the number; a layout effect does the same, so the final number is
// never painted before the count. v1 draws a screen once its data is in; React can draw it again while the number
// is still counting (Targets: 177, then 180 once the regional data arrives), so the running count goes on to the
// new number instead of being drawn at it and starting again.
const counted = new Map<string, number>();

export function CountKey({ k, value }: { k: string; value: number }) {
  const ref = useRef<HTMLElement>(null);
  const lastKey = useRef(k);
  useLayoutEffect(() => {
    const from = counted.has(k) ? (counted.get(k) as number) : 0;
    counted.set(k, value);
    const sameKey = lastKey.current === k;
    lastKey.current = k;
    if (sameKey && countOnTo(ref.current, value)) return;
    void countUp(ref.current, from, value, { delay: 120 });
  }, [k, value]);
  // One element per count, so a newer number can carry the running count on (countOnTo) instead of starting again.
  return <b ref={ref} data-count-key={k}>{value}</b>;
}
