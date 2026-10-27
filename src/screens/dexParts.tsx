// Small pieces shared by the dex home and its search overlay.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { sized } from '../core/media.js';
import type { Species } from '../lib/data';

/**
 * A species photo with an empty alt, for places where the name is written right beside it (v1 birdImg with
 * alt ''), so a screen reader doesn't read the name twice. Callers re-render on media readiness (useMedia).
 * When a better photo arrives (v1 patchSpeciesImages), a photo already on screen stays until its replacement is
 * decoded, so the tile never blanks; one not yet loaded switches at once.
 */
type PhotoProps = { sp: Species; size?: 'small' | 'large'; eager?: boolean };
// A different species (the pick changing with the kind tab) starts afresh rather than waiting on the old photo.
export const Photo = (props: PhotoProps) => <SpeciesPhoto key={props.sp.id} {...props} />;
function SpeciesPhoto({ sp, size = 'small', eager = false }: PhotoProps) {
  const url = sized(sp.id, size) as string | null;
  const [src, setSrc] = useState(url);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!url || url === src) return;
    const el = ref.current;
    if (!el || !el.complete || !el.naturalWidth) { setSrc(url); return; }
    let alive = true;
    const next = new Image();
    next.src = url;
    next.decode().then(() => { if (alive) setSrc(url); }, () => {});
    return () => { alive = false; };
  }, [url, src]);
  // The same element takes the new address, so the old photo shows until the new one paints.
  useLayoutEffect(() => { ref.current?.classList.remove('img-missing'); }, [src]);
  if (!src) return <span className="img-missing" aria-hidden="true" />;
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      onError={(e) => e.currentTarget.classList.add('img-missing')}
    />
  );
}

/** A progress ring (0-1). Its arc fills from empty the first time the dex is drawn in a session (.rings-in). */
export function Ring({ p, cls = '' }: { p: number; cls?: string }) {
  const f = Math.max(0, Math.min(1, p || 0));
  return (
    <svg className={`ring ${cls}${f ? '' : ' ring--zero'}`} viewBox="0 0 36 36" aria-hidden="true">
      <circle className="ring-track" cx="18" cy="18" r="15" />
      <circle className="ring-fill" cx="18" cy="18" r="15" pathLength={100} style={{ '--off': (100 - f * 100).toFixed(1) } as CSSProperties} />
    </svg>
  );
}

const svg = (body: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{body}</svg>;
const line = (d: string, w = 2) => <path d={d} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;

/** v1's icons (js/app.js icon.*, js/learn.js I.*) that the shared Icon set draws differently or lacks. */
export const ICON = {
  search: svg(<><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  gear: svg(
    <g fill="none" stroke="currentColor">
      <path d="M12 6V2.6M16.2 7.8l2.4-2.4M18 12h3.4M16.2 16.2l2.4 2.4M12 18v3.4M7.8 16.2l-2.4 2.4M6 12H2.6M7.8 7.8L5.4 5.4" strokeWidth="3.4" />
      <circle cx="12" cy="12" r="6.6" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="2.4" strokeWidth="2" />
    </g>,
  ),
  install: svg(<path d="M12 4v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />),
  close: svg(<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />),
  pin: svg(<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="9.5" r="2.5" fill="currentColor" /></>),
  outing: svg(<><path d="M12 21s-6-5.4-6-10.2a6 6 0 0 1 12 0C18 15.6 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9.6 10.6l1.7 1.7 3.2-3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>),
  grid: svg(<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="2" />),
  list: svg(<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />),
  deck: svg(line('M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10')),
  tick: svg(line('M5 12.5l4.5 4.5L19 7.5', 2.6)),
  cross: svg(line('M7 7l10 10M17 7L7 17', 2.6)),
};

/** v1 fmtDate: '2026-10-28' -> '28 Oct 2026'. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d?: string | null) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return MON[m - 1] ? `${day} ${MON[m - 1]} ${y}` : d;
}
