import { useLiveEbird, useOnline } from '../../lib/useEbird';
import { EBIRD_CREDIT, type EbirdTopBirder } from '../../lib/ebird';
import './topEbirders.css';

const pad = (n: number) => String(n).padStart(2, '0');

/** Brisbane's public eBird top ten for today. Names are shown exactly as published and are never linked. */
export default function TopEbirders() {
  const online = useOnline();
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const live = useLiveEbird<EbirdTopBirder[]>({ top: '', region: 'AU-QLD-BRI', date });

  if (!online) return null;
  if (live.loading) {
    return (
      <section className="top-ebirders" aria-label="Top eBirders in Brisbane today" aria-busy="true">
        <header><h2>Top eBirders in Brisbane today</h2><span className="eg-credit">via eBird</span></header>
        <div className="top-ebirders-skeleton" aria-hidden="true"><span /><span /><span /></div>
      </section>
    );
  }
  if (!live.data?.length) return null;

  return (
    <section className="top-ebirders" aria-labelledby="top-ebirders-title">
      <header>
        <h2 id="top-ebirders-title">Top eBirders in Brisbane today</h2>
        <span className="eg-credit">via eBird</span>
      </header>
      <p className="small muted top-ebirders-sub">Ranked by species reported today. Names appear as eBird publishes them.</p>
      <ol className="top-ebirders-list">
        {live.data.map((row, index) => (
          <li key={`${row.name}-${index}`}>
            <span className="top-ebirders-rank" aria-hidden="true">{index + 1}</span>
            <span className="top-ebirders-name">{row.name}</span>
            <span className="top-ebirders-count">
              <b>{row.species.toLocaleString('en-AU')}</b>
              <span>species</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="small top-ebirders-credit">
        <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
      </p>
    </section>
  );
}
