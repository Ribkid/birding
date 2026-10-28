// @vitest-environment jsdom
// v1 js/app.js drawRoute: every link in the tab bar, the + included, carries aria-current, "page" on the tab that owns
// the route and "false" on the rest.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/data', () => ({ byId: new Map() }));
vi.mock('../core/db.js', () => ({ db: { kvGet: async () => null, onChange: () => () => {} } }));
vi.mock('../core/cloud.js', () => ({ onAuth: () => () => {} }));
vi.mock('../core/profile.js', () => ({
  configured: false,
  signedIn: () => false,
  getMyCloud: () => null,
  getProfile: () => ({ avatarSpeciesId: null }),
  initProfile: () => () => {},
  myName: () => '',
  avatarUrl: () => '',
}));
vi.mock('../components/SpeciesImage', () => ({ SpeciesImage: () => null }));
vi.mock('../components/Motion', () => ({ useViewTransitionNavigate: () => () => {} }));
vi.mock('../components/PlusSheet', () => ({ PlusSheet: () => null }));

import { TabBar } from '../components/TabBar';

afterEach(cleanup);

const marks = (path: string) => {
  const { container } = render(<MemoryRouter initialEntries={[path]}><TabBar /></MemoryRouter>);
  return [...container.querySelectorAll('.tabbar a')].map((a) => `${a.getAttribute('href')} ${a.getAttribute('aria-current')}`);
};

describe('tab bar aria-current', () => {
  it('marks the owning tab "page" and every other link, the + too, "false"', () => {
    expect(marks('/settings')).toEqual(['/dex false', '/learn false', '#/add false', '/map false', '/me page']);
    expect(marks('/bird/1')).toEqual(['/dex page', '/learn false', '#/add false', '/map false', '/me false']);
  });

  it('leaves the + "false" on the #/add page, which no tab owns but the dex', () => {
    expect(marks('/add')).toEqual(['/dex page', '/learn false', '#/add false', '/map false', '/me false']);
  });
});
