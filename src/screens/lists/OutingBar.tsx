import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { plural, useActiveOutingId, useOutingRows, useSightingRows } from './shared';

/**
 * v1 renderOutingBar (birding-refresh js/app.js:1054): while an outing runs, a bar above the tab bar leads back
 * to it from every screen but the outing itself. body.has-outing keeps page ends and fixed controls clear of it
 * (app.css, look.css and the screens' has-outing rules).
 */
export function OutingBar() {
  const { pathname } = useLocation();
  const activeId = useActiveOutingId();
  const outings = useOutingRows();
  const sightings = useSightingRows();
  const o = activeId == null ? null : outings.find((x) => x.id === activeId) ?? null;
  const show = !!o && pathname !== `/outing/${o.id}`;
  const n = o ? sightings.filter((s) => s.outingId === o.id).length : 0;

  useEffect(() => {
    document.body.classList.toggle('has-outing', show);
  }, [show]);
  useEffect(() => () => document.body.classList.remove('has-outing'), []);

  return (
    <div id="outing-bar" className="outing-bar" hidden={!show}>
      {show && o && (
        <Link to={`/outing/${o.id}`}>
          <span className="pulse" aria-hidden="true" />
          <span>
            <strong>Outing in progress</strong> {o.place || ''}
          </span>
          <span className="outing-bar-n">{plural(n, 'species', 'species')}</span>
        </Link>
      )}
    </div>
  );
}
