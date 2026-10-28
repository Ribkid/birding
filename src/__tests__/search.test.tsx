// @vitest-environment jsdom
// The one Search everything overlay, mounted at the App level: '/' opens it from any screen as in v1, over a sheet
// too, but not while she types in a field or with Ctrl, Alt or Cmd; openSearch(initial) opens it with the text typed;
// Escape closes it and focus goes back to where it was.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const none = vi.hoisted(() => [] as never[]);
vi.mock('../lib/hooks', () => ({ useSightings: () => none, useMedia: () => {} }));
vi.mock('../core/db.js', () => ({ db: { all: async () => [], onChange: () => () => {} } }));
vi.mock('../core/seqdata.js', () => ({ hotspots: () => [{ name: 'Oxley Creek Common', lat: -27.55, lng: 152.98, rich: 140 }] }));

import { SearchHost, openSearch } from '../screens/DexSearch';
import { closeAllLayers, closeLayer, openLayer } from '../lib/layers';

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
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      act(() => { fireEvent.keyDown(document.body, { key: '/', [mod]: true }); });
      expect(overlay()).toBeNull();
    }
  });

  it('opens over a sheet as v1 did: Escape closes search and gives focus back to the sheet, then closes the sheet', () => {
    mount();
    const sheet = document.createElement('div');
    sheet.innerHTML = '<button type="button" id="in-sheet">In the sheet</button>';
    document.body.append(sheet);
    const closed: string[] = [];
    act(() => { const l = openLayer(sheet, { label: 'Sheet', close: () => { closed.push('sheet'); closeLayer(l); } }); });
    const inSheet = document.getElementById('in-sheet')!;
    inSheet.focus();
    act(() => { fireEvent.keyDown(inSheet, { key: '/' }); });
    expect(overlay()).not.toBeNull();
    expect(document.activeElement).toBe(overlay()!.querySelector('input'));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(overlay()).toBeNull();
    expect(closed).toEqual([]);
    expect(document.activeElement).toBe(inSheet);
    act(() => { fireEvent.keyDown(inSheet, { key: 'Escape' }); });
    expect(closed).toEqual(['sheet']);
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
