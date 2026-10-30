// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored: any[] = [];
const kv = new Map<string, any>();
let authUser: any = { id: 'user-1' };
vi.mock('../core/db.js', () => ({
  db: {
    all: async (name: string) => name === 'photos' ? [...stored] : [],
    kvGet: async (key: string) => kv.get(key),
    kvSet: async (key: string, value: any) => { if (value == null) kv.delete(key); else kv.set(key, value); },
    onChange: () => () => {},
  },
  raw: {
    put: async (_name: string, value: any) => {
      if (value.id == null) value.id = stored.length + 1;
      const at = stored.findIndex((r) => r.id === value.id);
      if (at < 0) stored.push(value); else stored[at] = value;
      return value.id;
    },
    del: async (_name: string, id: number) => {
      const at = stored.findIndex((r) => r.id === id);
      if (at >= 0) stored.splice(at, 1);
    },
  },
}));
vi.mock('../core/cloud.js', () => ({
  client: vi.fn(),
  user: () => authUser,
  onAuth: () => () => {},
}));
vi.mock('../core/config.js', () => ({ SUPABASE_URL: 'https://example.supabase.co' }));

import {
  addOutingPhotos,
  fetchProfilePhotos,
  fetchPublicOuting,
  photoUrl,
  removeOutingPhoto,
  syncOutingPhotos,
  togglePhotoLike,
  updateOutingPhoto,
} from '../core/outingPhotos.js';

function fakeSupabase() {
  const state = {
    uploads: [] as { path: string; blob: Blob; options: any }[],
    removed: [] as string[][],
    rows: [] as any[],
    deleted: [] as any[],
    failUpload: false,
  };
  const client = {
    storage: { from: (bucket: string) => ({
      upload: async (path: string, blob: Blob, options: any) => {
        if (bucket !== 'outing-photos') throw new Error('wrong bucket');
        if (state.failUpload) { state.failUpload = false; return { error: new Error('no signal') }; }
        state.uploads.push({ path, blob, options });
        return { error: null };
      },
      remove: async (paths: string[]) => { state.removed.push(paths); return { error: null }; },
    }) },
    from: (table: string) => {
      if (table !== 'outing_photos') throw new Error('wrong table');
      return {
        upsert: async (row: any, options: any) => {
          if (options.onConflict !== 'uid') throw new Error('not idempotent by uid');
          const at = state.rows.findIndex((r) => r.uid === row.uid);
          if (at < 0) state.rows.push(row); else state.rows[at] = row;
          return { error: null };
        },
        delete: () => {
          const where: any = {};
          const query = {
            eq: (key: string, value: any) => { where[key] = value; return query; },
            then: (resolve: (value: any) => void) => {
              state.deleted.push(where);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return query;
        },
      };
    },
  };
  return { client: client as any, state };
}

function pendingPhoto(uid = 'photo-1') {
  return {
    uid, kind: 'outing', outingUid: 'outing-1', takenAt: Date.parse('2026-10-30T07:15:00'),
    w: 2048, h: 1024, blob: new Blob(['clean-full'], { type: 'image/jpeg' }),
    thumb: new Blob(['clean-thumb'], { type: 'image/jpeg' }), speciesId: 42,
  };
}

beforeEach(() => {
  stored.length = 0;
  kv.clear();
  authUser = { id: 'user-1' };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  vi.stubGlobal('crypto', { randomUUID: () => 'photo-1' });
});

describe('upload queue', () => {
  it('leaves a failed photo pending, then uploads both JPEGs and its row once by uid', async () => {
    const [photo] = await addOutingPhotos('outing-1', [pendingPhoto()]);
    const { client, state } = fakeSupabase();
    state.failUpload = true;
    await expect(syncOutingPhotos(client, 'user-1')).rejects.toThrow('no signal');
    expect(stored[0].uploadedAt).toBeUndefined();

    await syncOutingPhotos(client, 'user-1');
    expect(state.uploads.map((u) => u.path)).toEqual([
      'user-1/outing-1/photo-1.jpg', 'user-1/outing-1/photo-1_t.jpg',
    ]);
    expect(state.rows).toEqual([{
      uid: 'photo-1', user_id: 'user-1', outing_uid: 'outing-1',
      path: 'user-1/outing-1/photo-1.jpg', thumb_path: 'user-1/outing-1/photo-1_t.jpg',
      taken_at: new Date(photo.takenAt).toISOString(), species_id: 42, w: 2048, h: 1024,
    }]);
    expect(stored[0]).toMatchObject({ uploadedAt: expect.any(Number), ownerId: 'user-1' });

    await syncOutingPhotos(client, 'user-1');
    expect(state.uploads).toHaveLength(2);
    expect(state.rows).toHaveLength(1);
  });

  it('marks an edited shared photo pending without changing its uid', async () => {
    stored.push({ ...pendingPhoto(), id: 1, uploadedAt: 100, ownerId: 'user-1' });
    await updateOutingPhoto(stored[0], { speciesId: 7 });
    expect(stored[0]).toMatchObject({ uid: 'photo-1', speciesId: 7, uploadedAt: null });
  });
});

describe('offline removal queue', () => {
  it('removes the local photo at once and deletes its row and both objects when sync resumes', async () => {
    stored.push({ ...pendingPhoto(), id: 1, uploadedAt: 100, ownerId: 'user-1' });
    await removeOutingPhoto(stored[0]);
    expect(stored).toHaveLength(0);
    expect(kv.get('outingPhotos:deletes')).toEqual([{ uid: 'photo-1', outingUid: 'outing-1', userId: 'user-1' }]);

    const { client, state } = fakeSupabase();
    await syncOutingPhotos(client, 'user-1');
    expect(state.deleted).toEqual([{ uid: 'photo-1', user_id: 'user-1' }]);
    expect(state.removed).toEqual([[
      'user-1/outing-1/photo-1.jpg', 'user-1/outing-1/photo-1_t.jpg',
    ]]);
    expect(kv.get('outingPhotos:deletes')).toEqual([]);
  });

  it('queues a signed-in pending photo too, covering an upload interrupted before its local marker', async () => {
    stored.push({ ...pendingPhoto(), id: 1, ownerId: 'user-1' });
    await removeOutingPhoto(stored[0]);
    expect(kv.get('outingPhotos:deletes')).toEqual([{ uid: 'photo-1', outingUid: 'outing-1', userId: 'user-1' }]);
  });
});

describe('optimistic likes', () => {
  it('draws the like at once and then accepts the server count', async () => {
    let answer!: (value: any) => void;
    const client = { rpc: () => new Promise((resolve) => { answer = resolve; }) };
    const changes: any[] = [];
    const original = { id: 'server-photo', liked: false, likeCount: 11 };
    const pending = togglePhotoLike(original, { client, onChange: (photo: any) => changes.push(photo) });
    expect(changes).toEqual([{ ...original, liked: true, likeCount: 12 }]);
    answer({ data: [{ liked: true, like_count: 14 }], error: null });
    await expect(pending).resolves.toEqual({ ...original, liked: true, likeCount: 14 });
    expect(changes.at(-1)).toEqual({ ...original, liked: true, likeCount: 14 });
  });

  it('rolls the heart and count back when the request fails', async () => {
    const client = { rpc: async () => ({ data: null, error: new Error('offline') }) };
    const changes: any[] = [];
    const original = { id: 'server-photo', liked: true, likeCount: 3 };
    await expect(togglePhotoLike(original, { client, onChange: (photo: any) => changes.push(photo) })).rejects.toThrow('offline');
    expect(changes).toEqual([
      { ...original, liked: false, likeCount: 2 },
      original,
    ]);
  });
});

describe('public reads', () => {
  it('fetches public outing and profile photo JSON through their RPCs', async () => {
    const calls: any[] = [];
    const outing = { outingUid: 'outing-1', photos: [{ id: 'p' }] };
    const profile = { mostLiked: [{ id: 'p' }], outings: [{ outingUid: 'outing-1' }] };
    const client = { rpc: async (name: string, args: any) => {
      calls.push([name, args]);
      return { data: name === 'get_public_outing' ? outing : profile, error: null };
    } };
    await expect(fetchPublicOuting('public-1', 'outing-1', client)).resolves.toEqual(outing);
    await expect(fetchProfilePhotos('public-1', client)).resolves.toEqual(profile);
    expect(calls).toEqual([
      ['get_public_outing', { p_public_id: 'public-1', p_outing_uid: 'outing-1' }],
      ['get_profile_photos', { p_public_id: 'public-1' }],
    ]);
    expect(photoUrl('user-1/outing 1/photo.jpg')).toBe('https://example.supabase.co/storage/v1/object/public/outing-photos/user-1/outing%201/photo.jpg');
  });
});
