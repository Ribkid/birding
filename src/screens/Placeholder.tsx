import { Link } from 'react-router-dom';

/**
 * Stand-in for a screen that hasn't been ported yet. Each of these is owned by a
 * porting agent (see docs/port-plan.md); the route and its hash path already match
 * v1, so links and bookmarks keep working while the port lands.
 */
export function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <div className="pad">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <p className="muted">This screen is still being ported to React.</p>
      <p className="small muted">
        Owner: <code>{owner}</code>
      </p>
      <Link className="btn" to="/dex">
        Back to the dex
      </Link>
    </div>
  );
}
