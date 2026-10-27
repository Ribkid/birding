// The bar above the tab bar while an outing runs (v1 js/app.js renderOutingBar and index.html #outing-bar): on every
// screen but that outing's own page it links back to the outing. body.has-outing keeps page ends and fixed controls
// clear of it (app.css, look.css and the screens' has-outing rules).
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { db } from '../core/db.js';
import type { Sighting } from '../lib/hooks';
import { useActiveOutingId, useOutingRows } from './lists/shared';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function OutingBar() {
  const { pathname } = useLocation();
  const activeId = useActiveOutingId();
  const outings = useOutingRows();
  // As v1 boot does, an outing that has been finished is not treated as running even if it is still marked active.
  const o = activeId == null ? null : outings.find((x) => x.id === activeId && !x.endedAt) || null;
  const n = useOutingCount(o ? o.id : null);
  // The bar comes in once its count is known, so it never shows a wrong number first.
  const show = !!o && n != null && pathname !== `/outing/${o.id}`;
  useEffect(() => {
    document.body.classList.toggle('has-outing', show);
  }, [show]);
  useEffect(() => () => { document.body.classList.remove('has-outing'); }, []);
  return (
    <div id="outing-bar" className="outing-bar" hidden={!show}>
      {show && o ? (
        <Link to={`/outing/${o.id}`}>
          <span className="pulse" aria-hidden="true" />
          <span><strong>Outing in progress</strong> {o.place || ''}</span>
          <span className="outing-bar-n">{plural(n ?? 0, 'species', 'species')}</span>
        </Link>
      ) : null}
    </div>
  );
}

/** Sightings logged to the running outing (v1 counts them from state.sightings); read only while one runs. */
function useOutingCount(outingId: number | null) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    setN(null);
    if (outingId == null) return;
    let alive = true;
    const load = async () => {
      const all = (await db.all('sightings')) as Sighting[];
      if (alive) setN(all.filter((s) => s.outingId === outingId).length);
    };
    void load().catch(() => {});
    const off = db.onChange((name: string) => { if (name === 'sightings') void load().catch(() => {}); });
    return () => { alive = false; off(); };
  }, [outingId]);
  return n;
}
