// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  signedIn: false,
  openSignIn: vi.fn(),
  toggle: vi.fn(),
  add: vi.fn(async () => []),
  process: vi.fn(),
  profilePhotos: vi.fn(),
  publicOuting: vi.fn(),
  kvSet: vi.fn(async () => {}),
}));
vi.mock('../core/profile.js', () => ({ signedIn: () => h.signedIn, myName: () => 'Sarah' }));
vi.mock('../screens/me/AccountSheets', () => ({ openSignIn: h.openSignIn }));
vi.mock('../core/outingPhotos.js', () => ({
  togglePhotoLike: h.toggle,
  addOutingPhotos: h.add,
  fetchProfilePhotos: h.profilePhotos,
  fetchPublicOuting: h.publicOuting,
  photoUrl: (path: string) => `https://fake.test/${path}`,
  onOutingPhotosChange: () => () => {},
  updateOutingPhoto: vi.fn(),
  removeOutingPhoto: vi.fn(),
}));
vi.mock('../core/outingPhotoFiles.js', async (original) => ({
  ...(await original<typeof import('../core/outingPhotoFiles.js')>()),
  processOutingPhoto: h.process,
}));
vi.mock('../core/db.js', () => ({
  db: { kvGet: async () => null, kvSet: h.kvSet, all: async () => [] },
  raw: { put: vi.fn(), del: vi.fn() },
}));

import { OutingPhotoAddButton, PhotoLikeButton, ProfilePhotoSections } from '../components/OutingPhotos';
import PublicOuting from '../screens/me/PublicOuting';

beforeEach(() => {
  h.signedIn = false;
  h.openSignIn.mockClear();
  h.toggle.mockReset();
  h.add.mockClear();
  h.process.mockReset();
  h.profilePhotos.mockReset();
  h.publicOuting.mockReset();
  h.kvSet.mockClear();
  h.toggle.mockImplementation(async (photo: any, { onChange }: any) => {
    const next = { ...photo, liked: !photo.liked, likeCount: photo.likeCount + (photo.liked ? -1 : 1) };
    onChange(next);
    return next;
  });
  h.process.mockImplementation(async (file: File) => ({
    takenAt: file.name === 'inside.jpg' ? Date.parse('2026-10-30T08:00:00') : Date.parse('2026-10-29T08:00:00'),
    w: 2048, h: 1024,
    blob: new Blob(['clean'], { type: 'image/jpeg' }), thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  }));
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:photo');
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('photo likes', () => {
  it('opens the existing sign-in sheet instead of liking when signed out', () => {
    render(<PhotoLikeButton photo={{ uid: 'p', id: 'server-p', liked: false, likeCount: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like this photo, 12 likes' }));
    expect(h.openSignIn).toHaveBeenCalledWith('signin');
    expect(h.toggle).not.toHaveBeenCalled();
  });

  it('uses aria-pressed and draws the optimistic heart and count', async () => {
    h.signedIn = true;
    render(<PhotoLikeButton photo={{ uid: 'p', id: 'server-p', liked: false, likeCount: 12 }} />);
    const button = screen.getByRole('button', { name: 'Like this photo, 12 likes' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlike this photo, 13 likes' }).getAttribute('aria-pressed')).toBe('true'));
  });
});

describe('adding outing photos', () => {
  it('preselects the outing window and shows the one-time public owner notice', async () => {
    const outing = { id: 1, uid: 'outing-uid', startedAt: Date.parse('2026-10-30T07:00:00'), endedAt: Date.parse('2026-10-30T09:00:00') };
    render(<OutingPhotoAddButton outing={outing} />);
    fireEvent.change(screen.getByLabelText('Choose outing photos'), { target: { files: [new File(['a'], 'inside.jpg'), new File(['b'], 'outside.jpg')] } });
    expect(await screen.findByText('1 of 2 were taken during this outing')).toBeTruthy();
    expect(screen.getByText('Photos you add to an outing are public on your profile, and other birders can like them.')).toBeTruthy();
    expect(screen.getByText(/Sarah, you own these photos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 photo' }));
    await waitFor(() => expect(h.add).toHaveBeenCalledWith('outing-uid', [expect.objectContaining({ takenAt: Date.parse('2026-10-30T08:00:00') })]));
    expect(h.kvSet).toHaveBeenCalledWith('outingPhotos:noticeSeen', true);
  });
});

describe('profile photo sections', () => {
  it('draws most-liked photos and links outings to their public route', async () => {
    h.profilePhotos.mockResolvedValue({
      mostLiked: [{ id: 'server-p', uid: 'p', outingUid: 'o', path: 'u/o/p.jpg', thumbPath: 'u/o/p_t.jpg', likeCount: 4, liked: false }],
      outings: [{ outingUid: 'o', date: '2026-10-30', place: 'Sandy Camp', photoCount: 1, coverThumb: 'u/o/p_t.jpg' }],
    });
    render(<MemoryRouter><ProfilePhotoSections publicId="public-1" /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Most liked' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sandy Camp/ }).getAttribute('href')).toBe('/u/public-1/outing/o');
    expect((await screen.findByRole('img', { name: 'Outing photo' })).getAttribute('src')).toBe('https://fake.test/u/o/p_t.jpg');
  });
});

describe('public outing', () => {
  it('shows only the public outing facts and its photo grid', async () => {
    h.publicOuting.mockResolvedValue({
      publicId: 'public-1', outingUid: 'o', date: '2026-10-30', place: 'Sandy Camp', speciesCount: 8,
      distanceKm: 2.4, durationMin: 90,
      photos: [{ id: 'server-p', uid: 'p', outingUid: 'o', path: 'u/o/p.jpg', thumbPath: 'u/o/p_t.jpg', likeCount: 4, liked: false }],
    });
    render(<MemoryRouter initialEntries={['/u/public-1/outing/o']}><PublicOuting /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Sandy Camp' })).toBeTruthy();
    expect(screen.getByText(/8 species/)).toBeTruthy();
    expect(screen.getByText(/2.4 km/)).toBeTruthy();
    expect(screen.getByText(/90 min/)).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'Outing photo' })).toBeTruthy();
  });
});
