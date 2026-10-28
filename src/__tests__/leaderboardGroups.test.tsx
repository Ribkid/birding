// @vitest-environment jsdom
// Leaderboard groups follow v1 js/account.js: Leave asks in a confirm sheet ('Leave this group?'), and making or
// joining a group is confirmed with a toast; a failure stays on the form's error line.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const cloud = vi.hoisted(() => {
  const me = { id: 'u1', email: 'fake@example.test', name: 'Test Person' };
  let groups = [{ id: 'g1', name: 'Family', code: 'ABC123', members: 2 }];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'get_leaderboard') return { data: [], error: null };
    if (fn === 'my_groups') return { data: groups, error: null };
    if (fn === 'leave_group') { groups = groups.filter((g) => g.id !== args.p_group); return { data: null, error: null }; }
    if (fn === 'create_group') {
      if (args.p_name === 'Offline') throw new TypeError('Failed to fetch');
      const g = { id: 'g2', name: String(args.p_name), code: 'XYZ789', members: 1 };
      groups = [...groups, g];
      return { data: [g], error: null };
    }
    return { data: null, error: { message: `unexpected ${fn}` } };
  });
  return { me, rpc };
});
vi.mock('../core/cloud.js', () => ({
  configured: true,
  client: async () => ({ rpc: cloud.rpc }),
  onAuth: () => () => {},
  startAuth: async () => cloud.me,
  user: () => cloud.me,
}));
vi.mock('../core/sync.js', () => ({ schedule: () => {} }));
vi.mock('../screens/me/accountBits', () => ({ AccountAvatar: () => null }));

import Leaderboard from '../screens/progress/Leaderboard';
import { closeAllLayers } from '../lib/layers';

const toastText = () => document.querySelector('.toast:not(.toast--out)')?.textContent ?? null;

afterEach(() => {
  cleanup();
  closeAllLayers('test');
  document.querySelectorAll('.toast').forEach((t) => t.remove());
});

describe('Leaderboard groups', () => {
  it("asks 'Leave this group?' in a sheet, then leaves and says so", async () => {
    render(<MemoryRouter initialEntries={['/leaderboard']}><Leaderboard /></MemoryRouter>);
    // A loaded machine can take a while to mount the board; the default one second is not about the app.
    await screen.findByText('Family', { selector: 'strong' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Leave this group?');
    expect(dialog.textContent).toContain('You can join again with its code.');
    expect(cloud.rpc).not.toHaveBeenCalledWith('leave_group', expect.anything());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave group' })); });
    expect(cloud.rpc).toHaveBeenCalledWith('leave_group', { p_group: 'g1' });
    await waitFor(() => expect(screen.queryByText('Family', { selector: 'strong' })).toBeNull());
    expect(toastText()).toBe('You left Family');
  });

  it('confirms a new group with v1 toast, and keeps a failure on the form', async () => {
    render(<MemoryRouter initialEntries={['/leaderboard']}><Leaderboard /></MemoryRouter>);
    const name = await screen.findByPlaceholderText('e.g. Family', {}, { timeout: 5000 });
    fireEvent.change(name, { target: { value: 'Friends' } });
    await act(async () => { fireEvent.submit(name.closest('form')!); });
    await waitFor(() => expect(toastText()).toBe('Friends made. Its code is XYZ789'));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(name, { target: { value: 'Offline' } });
    await act(async () => { fireEvent.submit(name.closest('form')!); });
    expect((await screen.findByRole('alert')).textContent).toBe('Groups need a connection.');
  });
});
