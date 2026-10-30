import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hotspots } from '../../core/seqdata.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { getLastPos, setLastPos } from '../../lib/lastPos';
import { useSeqReady } from '../../lib/seq';
import {
  buildRows,
  distanceLabel,
  filterSpots,
  loadSpotAccess,
  NO_FILTERS,
  sortSpots,
  spotAccess,
  SORTS,
  suggestSpots,
  type HotspotLike,
  type SortKey,
  type SpotFilters,
  type SpotRow,
} from '../../lib/spots';
import { getPosition, plural } from '../lists/shared';
import { AccessBadges, AccessScore, SpotPhotos } from './parts';
import './spots.css';

// v1 kept the map's chips and Targets' filters in a session object; the sort she picks holds the same way, so
// coming back from a spot finds the list as she left it.
let savedSort: SortKey = 'rich';

const FILTERS: { key: keyof SpotFilters; label: string }[] = [
  { key: 'toilets', label: 'Toilets' },
  { key: 'parking', label: 'Parking' },
  { key: 'birdHide', label: 'Bird hide' },
  { key: 'wheelchair', label: 'Wheelchair friendly' },
];

/** One card: the name, the numbers, access badges and five of its birds. */
function SpotCard({ row }: { row: SpotRow }) {
  return (
    <li className="spot-card">
      <Link className="spot-card-link" to={`/spot/${row.idx}`}>
        <span className="spot-card-top">
          <strong className="spot-card-name">{row.name}</strong>
          <AccessScore access={row.access} />
        </span>
        <span className="spot-card-meta">
          {row.distanceKm != null && <span className="spot-distance">{distanceLabel(row.distanceKm)}</span>}
          <span>
            {plural(row.rich, 'species')}
          </span>
          <span className="spot-new">{row.newForYou ? `${row.newForYou} new for you` : 'All seen'}</span>
        </span>
        <AccessBadges access={row.access} />
        <SpotPhotos sp={row.sp} />
      </Link>
    </li>
  );
}

/** A suggested spot: one line, one thumb, the birds she hasn't met. */
function SuggestCard({ row }: { row: SpotRow }) {
  const sp = byId.get(row.sp[0]?.[0] ?? -1) as Species | undefined;
  return (
    <li className="spot-suggest-card">
      <Link to={`/spot/${row.idx}`}>
        <span className="spot-suggest-photo">{sp && <SpeciesImage sp={sp} />}</span>
        <span className="spot-suggest-main">
          <strong>{row.name}</strong>
          <span className="spot-suggest-line">
            {row.newForYou} birds new for you
            {row.distanceKm != null ? ` · ${distanceLabel(row.distanceKm)}` : ''}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function Spots() {
  const seqReady = useSeqReady();
  const seen = useSeen();
  const [access, setAccess] = useState(() => spotAccess());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(savedSort);
  const [filters, setFilters] = useState<SpotFilters>(NO_FILTERS);
  const [pos, setPos] = useState(() => getLastPos());
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  // The regional data is fetched at boot; this redraws the list when it lands.
  const all = useMemo(() => hotspots() as HotspotLike[], [seqReady]);
  // ... and if the data is never there (a broken copy offline), stop saying "Loading" after the boot wait.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadSpotAccess().then((records) => {
      if (alive) setAccess(records);
    });
    return () => {
      alive = false;
    };
  }, []);

  const askLocation = useCallback(() => {
    if (locating) return;
    setLocating(true);
    setLocError(null);
    getPosition()
      .then((p) => {
        setPos(setLastPos(p));
        setLocating(false);
      })
      .catch((error: unknown) => {
        setLocating(false);
        setLocError(
          `${error instanceof Error ? error.message : 'Could not get your location.'} Or pick another sort.`,
        );
      });
  }, [locating]);

  // Nearest asks once, when it is chosen and there is no fix yet.
  const chooseSort = (next: SortKey) => {
    savedSort = next;
    setSort(next);
    if (next === 'nearest' && !pos) askLocation();
  };

  const rows = useMemo(() => buildRows(all, access, seen, pos), [all, access, seen, pos]);
  const suggested = useMemo(() => suggestSpots(rows, pos, 3), [rows, pos]);
  const shown = useMemo(
    () => sortSpots(filterSpots(rows, filters, query), sort),
    [rows, filters, query, sort],
  );
  const filtering = query.trim() !== '' || Object.values(filters).some(Boolean);
  const waiting = !settled && all.length === 0;

  return (
    <div className="spots-screen">
      <header className="page-head spots-head">
        <div>
          <h1>Spots</h1>
          <p className="muted small">Birding hotspots across South East Queensland, with how easy each is to get into.</p>
        </div>
      </header>

      <section className="spots-suggest" aria-labelledby="spots-suggest-title">
        <h2 id="spots-suggest-title">Suggested for you</h2>
        {suggested.length ? (
          <>
            <p className="muted small">The most birds you haven't seen yet, nearer ones first.</p>
            <ul className="spot-suggest-list">
              {suggested.map((row) => (
                <SuggestCard key={row.idx} row={row} />
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">
            {waiting ? 'Loading the regional bird data…' : "You've seen every bird recorded at these spots. Any of them is still a good day out."}
          </p>
        )}
      </section>

      <div className="spots-tools">
        <div className="searchbox">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search spots by name"
            aria-label="Search spots by name"
            autoComplete="off"
          />
        </div>

        <div className="spots-sort">
          <label htmlFor="spots-sort">Sort</label>
          <select
            id="spots-sort"
            className="chip chip--select"
            value={sort}
            onChange={(event) => chooseSort(event.target.value as SortKey)}
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="chips chips--spots" role="group" aria-label="Filter spots">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`chip${filters[key] ? ' chip--on' : ''}`}
              aria-pressed={filters[key]}
              onClick={() => setFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
            >
              {label}
            </button>
          ))}
          {filtering && (
            <button
              type="button"
              className="chip chip--clear"
              onClick={() => {
                setFilters(NO_FILTERS);
                setQuery('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        {sort === 'nearest' && !pos && (
          <p className="spots-note" role="status">
            {locating ? 'Finding you…' : locError || 'Nearest needs your location once. It is kept on this phone only.'}
            {!locating && (locError || !('geolocation' in navigator)) && (
              <button type="button" className="btn btn--small spots-try" onClick={askLocation}>
                Try again
              </button>
            )}
          </p>
        )}
      </div>

      <p className="spots-count pad-x" role="status">
        {waiting ? 'Loading spots…' : `${shown.length} ${plural(shown.length, 'spot')}`}
      </p>

      {shown.length ? (
        <ul className="spot-cards">
          {shown.map((row) => (
            <SpotCard key={row.idx} row={row} />
          ))}
        </ul>
      ) : (
        <p className="empty-inline">
          {waiting ? 'Loading spots…' : 'No spots match. Try another name, or clear a filter.'}
        </p>
      )}

      <p className="spot-credit spots-credit small">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
          Access data © OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
