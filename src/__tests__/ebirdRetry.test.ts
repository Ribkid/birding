import { describe, expect, it } from 'vitest';
import { retryDelayMs } from '../../scripts/build-ebird.mjs';

describe('eBird build retry pacing', () => {
  it('backs off patiently across the three allowed attempts', () => {
    expect(retryDelayMs(1)).toBe(5000);
    expect(retryDelayMs(2)).toBe(10000);
  });

  it('never retries sooner than the upstream Retry-After header', () => {
    expect(retryDelayMs(1, '7')).toBe(7000);
    expect(retryDelayMs(2, '4')).toBe(10000);
  });
});
