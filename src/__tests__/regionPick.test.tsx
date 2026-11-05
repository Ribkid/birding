// @vitest-environment jsdom
// Choosing a region: only usable packs are offered, the pack around a known location is preselected, and picking
// another region hands its code to setRegion.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ usable: ['seq', 'melb'] as string[], setRegion: vi.fn() }));
vi.mock('../regions/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../regions/index.js')>();
  return { ...real, canUse: (code: string) => state.usable.includes(code), setRegion: state.setRegion };
});

import { REGION_KEY } from '../regions/index.js';
import { birdCount, chooseRegion, hasStoredRegion, packAt, preselected, usablePacks } from '../lib/regionPick';
import { RegionCards } from '../components/RegionCards';
import { PACKS } from '../lib/region';

const brisbane = { lat: -27.47, lng: 153.03 };
const melbourne = { lat: -37.81, lng: 144.96 };

afterEach(() => { state.usable = ['seq', 'melb']; state.setRegion.mockClear(); localStorage.clear(); });

describe('which regions are offered', () => {
  it('lists every usable pack and no other', () => {
    expect(usablePacks().map((p) => p.code)).toEqual(['seq', 'melb']);
    state.usable = ['seq'];
    expect(usablePacks().map((p) => p.code)).toEqual(['seq']);
  });

  it('counts only the birds in a pack', () => {
    expect(birdCount(PACKS.seq)).toBeGreaterThan(100);
    expect(birdCount(PACKS.seq)).toBeLessThanOrEqual(Object.keys(PACKS.seq.species).length);
  });
});

describe('which region is preselected', () => {
  it('is the pack whose box holds a known location', () => {
    const packs = usablePacks();
    expect(packAt(brisbane, packs)?.code).toBe('seq');
    expect(packAt(melbourne, packs)?.code).toBe('melb');
    expect(preselected(melbourne, packs, 'seq')).toBe('melb');
    expect(preselected(brisbane, packs, 'melb')).toBe('seq');
  });

  it('is the current region when there is no location or it is outside every pack', () => {
    const packs = usablePacks();
    expect(preselected(null, packs, 'melb')).toBe('melb');
    expect(preselected({ lat: 51.5, lng: -0.1 }, packs, 'seq')).toBe('seq');
  });

  it('ignores a pack that is not usable', () => {
    state.usable = ['seq'];
    expect(preselected(melbourne, usablePacks(), 'seq')).toBe('seq');
  });
});

describe('saving the choice', () => {
  it('calls setRegion with the picked code when it is not the current region', () => {
    chooseRegion('melb');
    expect(state.setRegion).toHaveBeenCalledWith('melb');
  });

  it('just writes down the current region when it is kept, without reloading', () => {
    expect(hasStoredRegion()).toBe(false);
    chooseRegion('seq');
    expect(state.setRegion).not.toHaveBeenCalled();
    expect(localStorage.getItem(REGION_KEY)).toBe('seq');
    expect(hasStoredRegion()).toBe(true);
  });
});

describe('the region cards', () => {
  it('show a card per pack with its bird count, and report the pick', () => {
    const onChange = vi.fn();
    render(<RegionCards packs={usablePacks()} value="seq" onChange={onChange} label="Region" />);
    expect(screen.getByRole('radiogroup', { name: 'Region' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect((screen.getByRole('radio', { name: /South East Queensland/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(`${birdCount(PACKS.seq)} birds`)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Greater Melbourne/ }));
    expect(onChange).toHaveBeenCalledWith('melb');
  });
});
