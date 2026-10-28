// @vitest-environment jsdom
// The one Search everything overlay, mounted at the App level: '/' opens it from any screen as in v1, not while she
// types in a field or over another layer; openSearch(initial) opens it with the text typed; Escape closes it and
// focus goes back to where it was.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const none = vi.hoisted(() => [] as never[]);
vi.mock('../lib/hooks', () => ({ useSightings: () => none, useMedia: () => {} }));
vi.mock('../core/db.js', () => ({ db: { all: async () => [], onChange: () => () => {} } }));
vi.mock('../core/seqdata.js', () => ({ hotspots: () => [{ name: 'Oxley Creek Common', lat: -27.55, lng: 152.98, rich: 140 }] }));

import { SearchHost, openSearch } from '../screens/DexSearch';
import { closeAllLayers, openLayer } from '../lib/layers';

const mount = () => render(
  <MemoryRouter initialEntries={['/lists']}>
    <button type="button" id="page-btn">On the page</button>
    <input id="page-input" />
    <SearchHost />
  </MemoryRouter>,
);
const overlay = () => document.querySelector('.search-ov');

afterEach(() => {
  cleanup();
  closeAllLayers('test');
  document.body.innerHTML = '';
});

describe('Search everything', () => {
  it("opens on '/' from a screen that is not the dex, with focus in its field, and Escape closes it", () => {
    mount();
    const btn = document.getElementById('page-btn')!;
    btn.focus();
    act(() => { fireEvent.keyDown(btn, { key: '/' }); });
    expect(overlay()).not.toBeNull();
    expect(document.activeElement).toBe(overlay()!.querySelector('input'));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("leaves '/' alone while she types in a field, or with modifier keys", () => {
    mount();
    const input = document.getElementById('page-input')!;
    input.focus();
    act(() => { fireEvent.keyDown(input, { key: '/' }); });
    expect(overlay()).toBeNull();
    act(() => { fireEvent.keyDown(document.body, { key: '/', ctrlKey: true }); });
    expect(overlay()).toBeNull();
  });

  it("does not open over another layer (a sheet or the welcome card)", () => {
    mount();
    const sheet = document.createElement('div');
    document.body.append(sheet);
    act(() => { openLayer(sheet, { label: 'Sheet' }); });
    act(() => { fireEvent.keyDown(document.body, { key: '/' }); });
    expect(overlay()).toBeNull();
  });

  it('opens once with the text it is given, and a second open while it is up changes nothing', () => {
    mount();
    act(() => { openSearch('Oxley'); });
    expect((overlay()!.querySelector('input') as HTMLInputElement).value).toBe('Oxley');
    expect(overlay()!.textContent).toContain('Oxley Creek Common');
    act(() => { openSearch('koala'); });
    expect(document.querySelectorAll('.search-ov')).toHaveLength(1);
    expect((overlay()!.querySelector('input') as HTMLInputElement).value).toBe('Oxley');
  });
});
