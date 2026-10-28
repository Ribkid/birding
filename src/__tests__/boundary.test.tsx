// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ScreenBoundary } from '../components/ErrorBoundary';

function Broken(): never {
  throw new Error('broken screen');
}

afterEach(cleanup);

describe('ScreenBoundary', () => {
  it('shows the failure card, then draws the next route after navigation', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter([
      { path: '/', element: <ScreenBoundary><Outlet /></ScreenBoundary>, children: [
        { path: 'learn', element: <Broken /> },
        { path: 'dex', element: <h1>Dex</h1> },
      ] },
    ], { initialEntries: ['/learn'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading').textContent).toBe('Something went wrong');
    await act(() => router.navigate('/dex'));
    expect(screen.getByRole('heading').textContent).toBe('Dex');
    await act(() => router.navigate('/learn'));
    expect(screen.getByRole('heading').textContent).toBe('Something went wrong');
    spy.mockRestore();
  });
});
