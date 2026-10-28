import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { plural, useActiveOutingId, useOutingRows, useSightingRows } from '../screens/lists/shared';

/**
 * v1's renderOutingBar (js/app.js:1054): while an outing runs, a bar above the tab bar on every other screen leads
 * back to it, and body.has-outing keeps page ends and map controls clear of it. An ended outing is not active.
 * As in v1's index.html, the #outing-bar element is always there and hidden while no outing runs.
 */
export function OutingBar() {
  const { pathname } = useLocation();
  const activeId = useActiveOutingId();
  const outings = useOutingRows();
  const sightings = useSightingRows();
  const o = activeId == null ? null : outings.find((x) => x.id === activeId && !x.endedAt) || null;
  const show = !!o && pathname !== `/outing/${o.id}`;

  useEffect(() => {
    document.body.classList.toggle('has-outing', show);
  }, [show]);
  useEffect(() => () => { document.body.classList.remove('has-outing'); }, []);

  const n = o ? sightings.filter((s) => s.outingId === o.id).length : 0;
  const to = o ? `/outing/${o.id}` : '';
  return (
    <div id="outing-bar" className="outing-bar" hidden={!show}>
      {show && o && (
        <Link to={to}>
          <span className="pulse" aria-hidden="true" />
          <span><strong>Outing in progress</strong> {o.place || ''}</span>
          <span className="outing-bar-n">{plural(n, 'species', 'species')}</span>
        </Link>
      )}
    </div>
  );
}
