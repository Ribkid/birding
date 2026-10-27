import { NavLink } from 'react-router-dom';

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
    to: '/lists',
    label: 'Lists',
    icon: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1.2" />
        <circle cx="4.5" cy="12" r="1.2" />
        <circle cx="4.5" cy="18" r="1.2" />
      </>
    ),
  },
  { to: '/add', label: 'Add birds', plus: true, icon: <path d="M12 5v14M5 12h14" /> },
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
    to: '/badges',
    label: 'Badges',
    icon: (
      <>
        <circle cx="12" cy="9" r="5.5" />
        <path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5" />
      </>
    ),
  },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={tab.plus ? 'tab-plus' : undefined}
          aria-label={tab.plus ? tab.label : undefined}
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
