// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// No photo index or gallery fetches in a test.
vi.mock('../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../lib/hooks')>()), useMedia: () => {} }));
vi.mock('../core/media.js', () => ({ sized: () => null }));
vi.mock('../screens/me/nudge', () => ({ nudgeAfterSave: async () => {} }));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SightingForm } from '../components/SightingSheet';
import { announceSaved, onCelebrate, type LogData, type SightingRow } from '../screens/lists/shared';
import { setPending } from '../screens/field/scanHandoff';
import AddSighting from '../screens/lists/AddSighting';

const sighting = (id: number, speciesId: number, place: string, createdAt: number) =>
  ({ id, speciesId, date: '2026-10-20', time: '07:10', lat: -27.4 - id / 100, lng: 153, acc: 15, place, notes: '', createdAt }) as SightingRow;
const data = (active: boolean): LogData => ({
  sightings: [sighting(1, 5, 'Home', 2), sighting(2, 7, 'Oxley Creek Common', 1)],
  outings: [{ id: 2, date: '2026-10-28', time: '07:00', place: 'Sandy Camp Road Wetlands', lat: -27.44, lng: 153.17, endedAt: null }],
  patches: [],
  activeId: active ? 2 : null,
});
const noop = () => {};

describe('the Log a sighting form', () => {
  afterEach(cleanup);

  it("has v1's fields in v1's order, with the species card and Change species", () => {
    const { container } = render(<SightingForm data={data(false)} speciesId={1} onCancel={noop} onSaved={noop} />);
    const labels = [...container.querySelectorAll('.field > span, .check > span, legend')].map((el) => el.textContent);
    expect(labels).toEqual(['What did you see?', 'How many', 'Heard only', 'Date', 'Time', 'Where', 'Place name', 'Notes']);
    expect(container.querySelector('.chosen-txt strong')?.textContent).toBe('Australian Brush-turkey');
    expect(screen.getByRole('button', { name: 'Change species' }).textContent).toBe('Change');
    expect(container.querySelector('.picker-search')?.classList.contains('hidden')).toBe(true);
    expect([...container.querySelectorAll('[data-recent] .chip')].map((c) => c.textContent)).toEqual(['Home', 'Oxley Creek Common']);
    expect([...container.querySelectorAll('.row-end .btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Save sighting']);
    expect(container.querySelector('[name=toOuting]')).toBeNull();
    expect(container.querySelector('textarea')?.getAttribute('placeholder')).toBe('Behaviour, plumage, who you were with…');
  });

  it('offers the running outing, ticked, and hides Where until it is unticked', () => {
    const { container } = render(<SightingForm data={data(true)} speciesId={1} onCancel={noop} onSaved={noop} />);
    const tick = container.querySelector<HTMLInputElement>('[name=toOuting]')!;
    expect(tick.checked).toBe(true);
    expect(tick.parentElement?.textContent).toBe('Add to current outing at Sandy Camp Road Wetlands');
    expect(container.querySelector('fieldset.loc')?.classList.contains('hidden')).toBe(true);
    fireEvent.click(tick);
    expect(container.querySelector('fieldset.loc')?.classList.contains('hidden')).toBe(false);
  });

  it('never offers the outing when editing', () => {
    const { container } = render(<SightingForm data={data(true)} existing={sighting(1, 5, 'Home', 2)} onCancel={noop} onSaved={noop} onDelete={noop} />);
    expect(container.querySelector('[name=toOuting]')).toBeNull();
    expect([...container.querySelectorAll('.row-end .btn')].map((b) => b.textContent)).toEqual(['Delete', 'Cancel', 'Save changes']);
    expect(container.querySelector('[data-gps-status]')?.textContent).toBe('-27.4100, 153.0000');
  });

  it('searches the dex after Change, and a tapped place chip brings its spot', () => {
    const { container } = render(<SightingForm data={data(false)} speciesId={1} onCancel={noop} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change species' }));
    const q = container.querySelector<HTMLInputElement>('[data-picker-q]')!;
    expect(document.activeElement).toBe(q);
    fireEvent.change(q, { target: { value: 'kookab' } });
    expect([...container.querySelectorAll('.picker-results li')].map((li) => li.textContent)).toEqual(['094Laughing Kookaburra', '095Blue-winged Kookaburra']);
    fireEvent.change(q, { target: { value: 'zzzz' } });
    expect(container.querySelector('.picker-results')?.textContent).toBe('Nothing by that name in the dex.');
    fireEvent.click(container.querySelector('[data-place="Oxley Creek Common"]')!);
    expect(container.querySelector('[data-gps-status]')?.textContent).toBe('-27.4200, 153.0000');
    expect(container.querySelector<HTMLInputElement>('[name=place]')?.value).toBe('Oxley Creek Common');
  });

  it("keeps v1's photo field: Remove stays in the page, hidden, and hands focus back to Add photo", async () => {
    URL.createObjectURL = () => 'blob:photo';
    URL.revokeObjectURL = () => {};
    const { container } = render(
      <SightingForm data={data(false)} speciesId={1} photoBlob={new Blob(['x'], { type: 'image/jpeg' })} onCancel={noop} onSaved={noop} />,
    );
    expect(container.querySelector('form')?.hasAttribute('data-form')).toBe(true);
    const remove = container.querySelector<HTMLButtonElement>('[data-photo-remove]')!;
    await waitFor(() => expect(container.querySelector('[data-photo-preview] img')?.getAttribute('src')).toBe('blob:photo'));
    expect(container.querySelector('[data-photo-label]')?.textContent).toBe('Replace photo');
    expect(remove.classList.contains('hidden')).toBe(false);
    fireEvent.click(remove);
    expect(container.querySelector('[data-photo-remove]')).toBe(remove);
    expect(remove.classList.contains('hidden')).toBe(true);
    expect(container.querySelector('[data-photo-preview] img')).toBeNull();
    expect(container.querySelector('[data-photo-label]')?.textContent).toBe('Add photo');
    expect(document.activeElement?.textContent?.trim()).toBe('Add photo');
    expect(container.querySelector('[data-photo-input]')?.getAttribute('type')).toBe('file');
  });

  it("says what is missing in v1's words", () => {
    const { container } = render(<SightingForm data={data(false)} onCancel={noop} onSaved={noop} />);
    fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('[data-error]')?.textContent).toBe('Choose what you saw.');
  });
});

describe('the #/add page', () => {
  afterEach(cleanup);

  it('takes the Scan hand-off into the same form: species, photo and notes', async () => {
    URL.createObjectURL = () => 'blob:scan';
    URL.revokeObjectURL = () => {};
    setPending({ blob: new Blob(['x'], { type: 'image/jpeg' }), notes: 'Identified from a photo.', autoGps: false });
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/add', search: '?species=1', state: { scan: true } }]}>
        <Routes><Route path="/add" element={<AddSighting />} /></Routes>
      </MemoryRouter>,
    );
    // The form waits for her sightings and outings (none here: there is no IndexedDB in the test).
    await screen.findByRole('button', { name: 'Save sighting' });
    expect(container.querySelector('h1')?.textContent).toBe('Log a sighting');
    expect(screen.getByRole('button', { name: 'Back to the scan result' })).toBeTruthy();
    expect(container.querySelector('.chosen-txt strong')?.textContent).toBe('Australian Brush-turkey');
    await waitFor(() => expect(container.querySelector('.photo-preview img')?.getAttribute('src')).toBe('blob:scan'));
    expect(container.querySelector('textarea')?.value).toBe('Identified from a photo.');
  });
});

describe('after a save', () => {
  afterEach(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });

  it('celebrates a first sighting of a species', () => {
    const seen: number[] = [];
    const off = onCelebrate((c) => seen.push(c.speciesId));
    announceSaved({ speciesId: 184 } as SightingRow, { id: 9, isNew: true, newBadges: [], sightings: [] });
    off();
    expect(seen).toEqual([184]);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('toasts a badge earned by a sighting of a species already seen', () => {
    const seen: number[] = [];
    const off = onCelebrate((c) => seen.push(c.speciesId));
    act(() => announceSaved({ speciesId: 5 } as SightingRow, { id: 9, isNew: false, newBadges: [{ id: 'days7', name: 'Regular' }], sightings: [] }));
    off();
    expect(seen).toEqual([]);
    expect(document.querySelector('.toast')?.textContent).toBe('Badge earned: Regular');
  });
});
