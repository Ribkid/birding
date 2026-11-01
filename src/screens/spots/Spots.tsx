import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hotspots } from '../../core/seqdata.js';
import { haversineKm } from '../../core/stats.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { byId, type Species } from '../../lib/data';
import { useSeen } from '../../lib/hooks';
import { getLastPos, setLastPos } from '../../lib/lastPos';
import { useSeqReady } from '../../lib/seq';
import { EBIRD_CREDIT, loadSpotData, type NotableBird, type SpotData } from '../../lib/ebird';
import {
  applySpotVisibility,
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
import { birdsToFind, featureBird, seenAgo, tidySpotName } from '../../lib/spotLook';
import { AccessBadges } from './parts';
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

/**
 * One card. With a known bird list it leads with a photo of a bird she could find there, the name on glass over it;
 * then what's new for her, how easy it is to get into (only when OpenStreetMap knows), and a few birds to look for.
 */
function SpotCard({ row, seen }: { row: SpotRow; seen: Set<number> }) {
  const key = row.locId ?? String(row.idx);
  const { name, restricted } = tidySpotName(row.name);
  const ids = row.sp.map(([id]) => id);
  const listed = row.hasList !== false && ids.length > 0;
  const lead = listed ? featureBird(ids, seen, key) : undefined;
  const toFind = listed ? birdsToFind(ids, seen, key).slice(0, 3) : [];
  const known = row.access != null && row.access.score != null;
  const head = (
    <>
      <strong className="spot-card-name">{name}</strong>
      <span className="spot-card-meta">
        <span>{plural(row.rich, 'species')}</span>
        {row.distanceKm != null && <span>{distanceLabel(row.distanceKm)}</span>}
        {restricted && <span className="spot-tag">Restricted</span>}
      </span>
    </>
  );
  return (
    <li className={`spot-card${lead ? ' spot-card--photo' : ''}`}>
      <Link className="spot-card-link" to={`/spot/${key}`}>
        {lead ? (
          <span className="spot-card-photo">
            <SpeciesImage sp={lead} alt="" />
            <span className="spot-card-glass">{head}</span>
          </span>
        ) : (
          <span className="spot-card-head">{head}</span>
        )}
        {(listed || known) && (
          <span className="spot-card-body">
            <span className="spot-card-row">
              {listed && (row.newForYou > 0
                ? <span className="pill-new">{row.newForYou} new for you</span>
                : <span className="spot-allseen">All seen</span>)}
              <AccessBadges access={row.access} max={3} />
            </span>
            {toFind.length > 0 && <span className="spot-could">Look for {toFind.map((s) => s.name).join(', ')}</span>}
          </span>
        )}
      </Link>
    </li>
  );
}

/** A suggested spot, as a photo card in a row she can swipe: the bird to find there, the name and the count on glass. */
function SuggestCard({ row, seen }: { row: SpotRow; seen: Set<number> }) {
  const key = row.locId ?? String(row.idx);
  const { name } = tidySpotName(row.name);
  const lead = featureBird(row.sp.map(([id]) => id), seen, key);
  return (
    <li className="spot-suggest-card">
      <Link to={`/spot/${key}`}>
        <span className="spot-suggest-photo">{lead && <SpeciesImage sp={lead} alt="" />}</span>
        <span className="spot-suggest-glass">
          <strong>{name}</strong>
          <span className="spot-suggest-line">
            <span className="pill-new">{row.newForYou} new for you</span>
            {row.distanceKm != null && <span>{distanceLabel(row.distanceKm)}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** This week's rare birds as photo cards, nearest first when her location is known. Each opens its spot (or the bird). */
function RareBirds({ items, pos, spotIds, seen }: {
  items: NotableBird[]; pos: { lat: number; lng: number } | null; spotIds: Set<string>; seen: Set<number>;
}) {
  const nearest = useMemo(() => items.map((item) => ({
    item,
    distance: pos ? haversineKm(pos, item) : null,
  })).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.item.date.localeCompare(a.item.date)).slice(0, 8), [items, pos]);
  if (!nearest.length) return null;
  return (
    <section className="spots-rare" aria-labelledby="spots-rare-title">
      <h2 id="spots-rare-title">Rare birds around</h2>
      <p className="muted small">Notable eBird sightings this week.</p>
      <ul className="rare-cards">
        {nearest.map(({ item, distance }) => {
          const bird = byId.get(item.id);
          const to = spotIds.has(item.loc) ? `/spot/${item.loc}` : bird ? `/bird/${bird.id}` : null;
          const body = (
            <>
              <span className="rare-card-photo">{bird && <SpeciesImage sp={bird} alt="" />}</span>
              <span className="rare-card-text">
                {bird && !seen.has(bird.id) && <span className="pill-new">New for you</span>}
                <strong>{bird?.name ?? item.name}</strong>
                <span className="rare-card-where">{tidySpotName(item.where).name}</span>
                <span className="rare-card-when">
                  {seenAgo(item.date)}{item.n > 1 ? ` · ${item.n} birds` : ''}{distance != null ? ` · ${distanceLabel(distance)}` : ''}
                </span>
              </span>
            </>
          );
          return (
            <li key={`${item.loc}:${item.id}:${item.date}`} className="rare-card">
              {to ? <Link to={to}>{body}</Link> : <div>{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Spots() {
  const seqReady = useSeqReady();
  const seen = useSeen();
  const [data, setData] = useState<SpotData | null>(null);
  const [access, setAccess] = useState(() => spotAccess());
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<SortKey>(savedSort);
  const [filters, setFilters] = useState<SpotFilters>(NO_FILTERS);
  const [pos, setPos] = useState(() => getLastPos());
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    if (!seqReady) return;
    let alive = true;
    void loadSpotData(hotspots() as HotspotLike[]).then(async (result) => {
      const records = await loadSpotAccess(result.source === 'eBird' ? 'ebird' : 'ala');
      if (!alive) return;
      setAccess(records);
      setData(result);
    });
    return () => { alive = false; };
  }, [seqReady]);

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

  const source = data?.source ?? 'ALA';
  const all = data?.spots ?? [];
  const rows = useMemo(() => buildRows(all, access, seen, pos), [all, access, seen, pos]);
  const suggested = useMemo(() => suggestSpots(rows, pos, 3), [rows, pos]);
  const shown = useMemo(
    () => sortSpots(filterSpots(applySpotVisibility(rows, query, showAll), filters, query), sort),
    [rows, filters, query, showAll, sort],
  );
  const spotIds = useMemo(() => new Set(all.flatMap((spot) => spot.locId ? [spot.locId] : [])), [all]);
  const filtering = query.trim() !== '' || Object.values(filters).some(Boolean);
  const waiting = !data;

  return (
    <div className="spots-screen">
      <header className="page-head spots-head">
        <div>
          <h1>Spots</h1>
          <p className="muted small">Birding hotspots across South East Queensland, with how easy each is to get into.</p>
        </div>
      </header>

      {source === 'eBird' && <RareBirds items={data?.notable ?? []} pos={pos} spotIds={spotIds} seen={seen} />}

      <section className="spots-suggest" aria-labelledby="spots-suggest-title">
        <h2 id="spots-suggest-title">Suggested for you</h2>
        {suggested.length ? (
          <>
            <p className="muted small">The most birds you haven't seen yet, nearer ones first.</p>
            <ul className="spot-suggest-list">
              {suggested.map((row) => (
                <SuggestCard key={row.idx} row={row} seen={seen} />
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
            {SORTS.filter((option) => source === 'eBird' || option.key !== 'recent').map((option) => (
              <option key={option.key} value={option.key}>
                {option.key === 'records' && source === 'eBird' ? 'Most visited' : option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="spots-show-all">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          <span>Show all spots</span>
        </label>

        <div className="chips chips--spots" role="group" aria-label="Filter spots">
          {[...FILTERS, ...(source === 'eBird' ? [{ key: 'birdedWeek' as const, label: 'Birded this week' }] : [])].map(({ key, label }) => (
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
        {waiting ? 'Loading spots…' : plural(shown.length, 'spot')}
      </p>

      {shown.length ? (
        <ul className="spot-cards">
          {shown.map((row) => (
            <SpotCard key={row.locId ?? row.idx} row={row} seen={seen} />
          ))}
        </ul>
      ) : (
        <p className="empty-inline">
          {waiting ? 'Loading spots…' : 'No spots match. Try another name, or clear a filter.'}
        </p>
      )}

      <div className="spots-credit">
        {source === 'eBird' && (
          <p className="spot-credit small">
            <a href="https://ebird.org" target="_blank" rel="noopener">{EBIRD_CREDIT}</a>
          </p>
        )}
        <p className="spot-credit small">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
            Access data © OpenStreetMap contributors
          </a>
        </p>
      </div>
    </div>
  );
}
