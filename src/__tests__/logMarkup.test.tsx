// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CountKey } from '../screens/lists/hubParts';
import { Sheet } from '../components/Sheet';

describe("v1's hooks in the markup", () => {
  afterEach(cleanup);

  it('marks a counted number with its data-count-key, as v1 countIn did', () => {
    const { container } = render(<p className="list-count"><CountKey k="log" value={3} /> sightings</p>);
    expect(container.querySelector('b')?.getAttribute('data-count-key')).toBe('log');
  });

  it("gives a sheet's scrim v1's data-close", () => {
    render(<Sheet open onClose={() => {}} label="Test"><p>Hi</p></Sheet>);
    expect(document.querySelector('.sheet-scrim')?.hasAttribute('data-close')).toBe(true);
  });
});
