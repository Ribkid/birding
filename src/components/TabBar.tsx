import { useEffect, useReducer, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { byId } from '../lib/data';
import { db } from '../core/db.js';
import { onAuth } from '../core/cloud.js';
import { configured, getMyCloud, getProfile, initProfile, myName, signedIn, avatarUrl } from '../core/profile.js';
import { SpeciesImage } from './SpeciesImage';
import { PlusSheet } from './PlusSheet';
import { toTop, viaTabBar } from './RouteMotion';

const TABS = [
  {
    to: '/dex',
    key: 'dex',
    label: 'Dex',
    icon: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  {
    to: '/learn',
    key: 'learn',
    label: 'Learn',
    // v1's stacked-cards icon (birding-refresh index.html:63).
    icon: <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" />,
  },
  { to: '/add', key: 'plus', label: 'Add a sighting', plus: true, icon: <path d="M12 5v14M5 12h14" /> },
  {
    to: '/map',
    key: 'map',
    label: 'Map',
    icon: (
      <>
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </>
    ),
  },
  {
    to: '/spots',
    key: 'spots',
    label: 'Spots',
    // A pin with binoculars in it: where to go, and what to look at.
    icon: (
      <>
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
        <circle cx="9.6" cy="9.6" r="1.7" />
        <circle cx="14.4" cy="9.6" r="1.7" />
        <path d="M11.3 9.6h1.4" />
      </>
    ),
  },
  {
    to: '/me',
    key: 'me',
    label: 'Me',
    icon: (
      <>
        <circle cx="12" cy="8.5" r="4" />
        <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
      </>
    ),
  },
];

// v1 js/app.js:941 — which tab owns each route family.
const TAB_FOR: Record<string, string> = {
  bird: 'dex', dex: 'dex', compare: 'dex', listen: 'dex', scan: 'dex',
  learn: 'learn', quiz: 'learn',
  map: 'map',
  spots: 'spots', spot: 'spots',
  me: 'me', u: 'me', lists: 'me', list: 'me', patch: 'me', targets: 'me', outing: 'me',
  log: 'me', stats: 'me', badges: 'me', settings: 'me', leaderboard: 'me',
};

function MeTabIcon({ dot }: { dot: boolean }) {
  const path = getMyCloud()?.avatarPath || null;
  const spId = getProfile().avatarSpeciesId;
  const sp = spId ? byId.get(spId) : null;
  return (
    <span className="tab-ico">
      {signedIn() ? (
        <span className={`acct-av tab-av${path ? ' acct-av--photo' : ''}`} aria-hidden="true">
          {path ? (
            <img src={avatarUrl(path)} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.remove()} />
          ) : sp ? (
            <SpeciesImage sp={sp} />
          ) : (
            <span className="acct-av-letter">{(myName() || '?').slice(0, 1).toUpperCase()}</span>
          )}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      )}
      {dot && <i className="tab-dot" aria-hidden="true" />}
    </span>
  );
}

export function TabBar() {
  const location = useLocation();
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [notNow, setNotNow] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () => {
      void db.kvGet('me:notnow').then((value: unknown) => { if (alive) setNotNow(!!value); }).catch(() => {});
    };
    read();
    const offDb = db.onChange((name: string) => { if (name === 'kv:me:notnow') read(); });
    const offAuth = onAuth(() => { if (alive) force(); });
    // v1 paintTab: the avatar follows Edit profile's changes, which happen in a sheet with no route change.
    const offProfile = initProfile(() => { if (alive) force(); });
    return () => { alive = false; offDb(); offAuth(); offProfile(); };
  }, []);

  const segment = location.pathname.split('/')[1] || 'dex';
  const current = TAB_FOR[segment] || 'dex';
  const dot = configured && !signedIn() && !notNow;

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((tab) => {
          if (tab.plus) {
            // v1 index.html: a link to #/add that opens the Add sheet in place (js/app.js:3092), styled by `.tabbar a`.
            // v1's drawRoute marks every tab link, this one included, so it always carries aria-current="false".
            return (
              <a key={tab.to} href="#/add" id="plus" className="tab-plus" aria-label={tab.label} aria-current="false" onClick={(e) => { e.preventDefault(); setPlusOpen(true); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{tab.icon}</svg>
              </a>
            );
          }
          const active = current === tab.key;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              data-tab={tab.key}
              id={tab.key === 'me' ? 'me-tab' : undefined}
              aria-label={tab.key === 'me' && dot ? 'Me, not signed in' : undefined}
              aria-current={active ? 'page' : 'false'}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                // The tab she is on, on its own screen: back to the top. Any other tab: to its screen, where she was
                // on it (components/RouteMotion.tsx).
                if (location.pathname === tab.to && !location.search) {
                  e.preventDefault();
                  toTop(tab.to);
                } else viaTabBar();
              }}
            >
              {tab.key === 'me' ? (
                <MeTabIcon dot={dot} />
              ) : (
                <span className="tab-ico">
                  <svg viewBox="0 0 24 24" aria-hidden="true">{tab.icon}</svg>
                </span>
              )}
              {/* Visually hidden when larger text leaves the bar too narrow for words (look.css); it still names the link. */}
              <span className="tab-label">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
    </>
  );
}
