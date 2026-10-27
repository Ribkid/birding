import { NavLink } from 'react-router-dom';
import { useViewTransitionNavigate } from './Motion';

const TABS = [
  {
    to: '/dex',
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
    label: 'Learn',
    icon: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H11v16H6.5A2.5 2.5 0 0 0 4 22z" />
        <path d="M20 6.5A2.5 2.5 0 0 0 17.5 4H13v16h4.5A2.5 2.5 0 0 1 20 22z" />
      </>
    ),
  },
  { to: '/add', label: 'Add a sighting', plus: true, icon: <path d="M12 5v14M5 12h14" /> },
  {
    to: '/map',
    label: 'Map',
    icon: (
      <>
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </>
    ),
  },
  {
    to: '/me',
    label: 'Me',
    icon: (
      <>
        <circle cx="12" cy="8.5" r="4" />
        <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
      </>
    ),
  },
];

export function TabBar() {
  const go = useViewTransitionNavigate();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          id={tab.to === '/me' ? 'me-tab' : undefined}
          className={tab.plus ? 'tab-plus' : undefined}
          aria-label={tab.plus ? tab.label : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            go(tab.to);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {tab.icon}
          </svg>
          {!tab.plus && <span>{tab.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
