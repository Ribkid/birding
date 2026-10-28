import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { db } from '../../core/db.js';
import { sized } from '../../core/media.js';
import type { Species } from '../../lib/data';
import { normaliseSighting, useMedia } from '../../lib/hooks';
import { countUp } from '../../lib/motion';

/**
 * One IndexedDB store, kept fresh as it changes, and null until the first read lands. The shared hooks start
 * with an empty list, which would flash the empty-state copy and count the bento up from nothing on every visit;
 * v1 drew the hub only once its state had loaded.
 */
export function useStoreRows<T>(store: 'sightings' | 'outings' | 'patches'): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = (await db.all(store)) as T[];
        if (alive) setRows(store === 'sightings' ? all.map((r) => normaliseSighting(r as { notes?: string })) as T[] : all);
      } catch {
        if (alive) setRows((prev) => prev ?? []);
      }
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === store) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [store]);
  return rows;
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
 * twice. With no photo it leaves an empty, hidden placeholder.
 */
export function QuietImage({ sp }: { sp: Species }) {
  useMedia();
  const url = sized(sp.id, 'small') as string | null;
  if (!url) return <span className="img-missing" aria-hidden="true" />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => e.currentTarget.classList.add('img-missing')}
    />
  );
}

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
const counted = new Map<string, number>();

export function CountKey({ k, value }: { k: string; value: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const from = counted.has(k) ? (counted.get(k) as number) : 0;
    counted.set(k, value);
    void countUp(ref.current, from, value, { delay: 120 });
  }, [k, value]);
  return <b ref={ref} data-count-key={k}>{value}</b>;
}
