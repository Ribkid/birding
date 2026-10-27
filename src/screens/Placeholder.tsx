import { Link } from 'react-router-dom';

/** The catch-all route: a real not-found message, not developer copy. */
export function Placeholder({ title = 'Not found' }: { title?: string }) {
  return (
    <div className="pad">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <p className="muted">That page isn't in BirdyDex.</p>
      <Link className="btn btn--primary" to="/dex">
        Back to the dex
      </Link>
    </div>
  );
}
