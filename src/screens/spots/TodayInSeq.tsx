import { useOnline, useLiveEbird } from '../../lib/useEbird';
import { EBIRD_CREDIT, type RegionalStats } from '../../lib/ebird';
import './todayInSeq.css';

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function Skeleton() {
  return (
    <section className="today-qld" aria-label="Today in Queensland" aria-busy="true">
      <h2>Today in Queensland</h2>
      <div className="today-qld-skeleton" aria-hidden="true"><span /><span /><span /></div>
    </section>
  );
}

/** The day's eBird totals for Queensland, with yesterday's line when it is available. */
export default function TodayInSeq() {
  const online = useOnline();
  const now = new Date();
  const today = dateKey(now);
  const previous = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = dateKey(previous);
  const current = useLiveEbird<RegionalStats>({ stats: '', date: today });
  const before = useLiveEbird<RegionalStats>({ stats: '', date: yesterday });

  if (!online) return null;
  if (current.loading) return <Skeleton />;
  if (!current.data || (!current.data.checklists && !current.data.species)) return null;

  return (
    <section className="today-qld" aria-labelledby="today-qld-title">
      <header>
        <h2 id="today-qld-title">Today in Queensland</h2>
        <p className="small muted">eBird checklists submitted so far today.</p>
      </header>
      <dl className="today-qld-stats">
        <div><dt>checklists</dt><dd>{current.data.checklists.toLocaleString('en-AU')}</dd></div>
        <div><dt>birders</dt><dd>{current.data.birders.toLocaleString('en-AU')}</dd></div>
        <div><dt>species</dt><dd>{current.data.species.toLocaleString('en-AU')}</dd></div>
      </dl>
      {!before.loading && before.data && (before.data.checklists || before.data.species) ? (
        <p className="today-qld-yesterday small muted">
          Yesterday: {before.data.checklists.toLocaleString('en-AU')} checklists,{' '}
          {before.data.species.toLocaleString('en-AU')} species.
        </p>
      ) : null}
      <p className="small today-qld-credit">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
