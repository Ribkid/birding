// Small pieces shared by the dex home and its search overlay.
import type { CSSProperties, ReactNode } from 'react';
import { SpeciesImage } from '../components/SpeciesImage';
import type { Species } from '../lib/data';

/**
 * A species photo with an empty alt, for places where the name is written right beside it (v1 birdImg with
 * alt ''), so a screen reader doesn't read the name twice. The loading look (shimmer, one fade-in, a better photo
 * swapped in without blanking) is the shared SpeciesImage's.
 */
export const Photo = ({ sp, size, eager }: { sp: Species; size?: 'small' | 'large'; eager?: boolean }) => (
  <SpeciesImage sp={sp} size={size} eager={eager} alt="" />
);

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
  // The Dex's tier marks: an ear for a species she has only heard, a camera for one she has photographed.
  ear: svg(<>{line('M6.5 9a5.75 5.75 0 0 1 11.5 0c0 4.6-5 5.2-5 9a3.1 3.1 0 0 1-6.2 0', 2.4)}{line('M14.6 9.2a2.35 2.35 0 0 0-4.7 0v.9a1.9 1.9 0 0 1 0 3.8', 2.2)}</>),
  camera: svg(<>{line('M4.5 8.6A1.6 1.6 0 0 1 6.1 7h1.8l1.6-2.2h5l1.6 2.2h1.8a1.6 1.6 0 0 1 1.6 1.6v8.8a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6z', 2.1)}<circle cx="12" cy="12.8" r="3.1" fill="none" stroke="currentColor" strokeWidth="2.1" /></>),
};

/** v1 fmtDate: '2026-10-28' -> '28 Oct 2026'. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d?: string | null) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return MON[m - 1] ? `${day} ${MON[m - 1]} ${y}` : d;
}
