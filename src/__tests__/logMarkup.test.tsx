// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CountKey } from '../screens/lists/hubParts';
import { ConfirmDialog } from '../screens/lists/shared';
import { Sheet } from '../components/Sheet';
import { getLastPos, setLastPos } from '../lib/lastPos';

describe("v1's hooks in the markup", () => {
  afterEach(cleanup);

  it('marks a counted number with its data-count-key, as v1 countIn did', () => {
    const { container } = render(<p className="list-count"><CountKey k="log" value={3} /> sightings</p>);
    expect(container.querySelector('b')?.getAttribute('data-count-key')).toBe('log');
  });

  it('ends on the newest number when it changes while still counting up (Targets before the SEQ records)', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let now = 0;
    const tick = (ms: number) => {
      for (const end = now + ms; now < end; ) {
        now += 16;
        act(() => frames.splice(0).forEach((cb) => cb(now)));
      }
    };
    try {
      const { container, rerender } = render(<p className="list-count"><CountKey k="targets/test" value={160} /> to find</p>);
      tick(50);
      rerender(<p className="list-count"><CountKey k="targets/test" value={163} /> to find</p>);
      tick(2000);
      expect(container.querySelector('[data-count-key]')?.textContent).toBe('163');
    } finally {
      raf.mockRestore();
      hidden.mockRestore();
    }
  });

  it("gives a sheet's scrim v1's data-close", () => {
    render(<Sheet open onClose={() => {}} label="Test"><p>Hi</p></Sheet>);
    expect(document.querySelector('.sheet-scrim')?.hasAttribute('data-close')).toBe(true);
  });

  it("gives a confirm sheet's buttons v1's data-no and data-yes (confirmSheet)", () => {
    render(<ConfirmDialog title="Delete Home patch?" body="Your sightings stay." confirmLabel="Delete patch" danger onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.querySelector('[data-no]')?.textContent).toBe('Cancel');
    expect(document.querySelector('.btn--danger[data-yes]')?.textContent).toBe('Delete patch');
  });
});

describe('the last position fix', () => {
  it('is kept for the session with the time it was taken (v1 state.lastPos)', () => {
    expect(getLastPos()).toBeNull();
    const before = Date.now();
    const fix = setLastPos({ lat: -27.5, lng: 153, acc: 20 });
    expect(getLastPos()).toBe(fix);
    expect(fix).toMatchObject({ lat: -27.5, lng: 153, acc: 20 });
    expect(fix.at).toBeGreaterThanOrEqual(before);
  });
});
