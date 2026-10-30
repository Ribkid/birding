import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../core/db.js';
import { myName, signedIn } from '../core/profile.js';
import {
  addOutingPhotos,
  fetchProfilePhotos,
  onOutingPhotosChange,
  photoUrl,
  removeOutingPhoto,
  togglePhotoLike,
  updateOutingPhoto,
} from '../core/outingPhotos.js';
import { listOutingPhotos, preselectPhotos, processOutingPhoto } from '../core/outingPhotoFiles.js';
import { byId, SPECIES } from '../lib/data';
import { toast } from '../lib/toast';
import { openSignIn } from '../screens/me/AccountSheets';
import { Icon } from './Icon';
import { PhotoViewer } from './PhotoViewer';
import { Sheet } from './Sheet';
import './outingPhotos.css';

export interface OutingPhoto {
  id?: string | number;
  uid: string;
  outingUid: string;
  path?: string;
  thumbPath?: string;
  blob?: Blob;
  thumb?: Blob;
  takenAt?: number | string | null;
  speciesId?: number | null;
  likeCount?: number;
  liked?: boolean;
  uploadedAt?: number | null;
  ownerId?: string;
  w?: number;
  h?: number;
}

type OutingWithUid = {
  id: number;
  uid?: string;
  date?: string;
  time?: string;
  startedAt?: number;
  endedAt?: string | number | null;
};

const Heart = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? 'is-liked' : ''}>
    <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

export function PhotoLikeButton({ photo, onChange }: { photo: OutingPhoto; onChange?: (photo: OutingPhoto) => void }) {
  const [current, setCurrent] = useState(photo);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCurrent(photo), [photo.liked, photo.likeCount, photo.id, photo.uid]);
  const count = current.likeCount || 0;
  const liked = !!current.liked;
  const like = async () => {
    if (busy) return;
    if (!signedIn()) { openSignIn('signin'); return; }
    if (!navigator.onLine) { toast('Liking a photo needs a connection.'); return; }
    setBusy(true);
    try {
      await togglePhotoLike(current, { onChange: (next: OutingPhoto) => { setCurrent(next); onChange?.(next); } });
    } catch {
      toast('The like could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`op-like${liked ? ' is-liked' : ''}`}
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'} this photo, ${count} ${count === 1 ? 'like' : 'likes'}`}
      aria-disabled={busy || undefined}
      onClick={() => void like()}
    >
      <span className="op-heart" key={liked ? 'liked' : 'not-liked'}><Heart filled={liked} /></span>
      <span>{count}</span>
    </button>
  );
}

function LikeCount({ photo }: { photo: OutingPhoto }) {
  return <span className="op-like op-like--static" aria-label={`${photo.likeCount || 0} likes`}><Heart filled={!!photo.liked} /><span>{photo.likeCount || 0}</span></span>;
}

function usePhotoUrls(photos: OutingPhoto[]) {
  const [urls, setUrls] = useState(() => new Map<string, { full: string; small: string }>());
  useEffect(() => {
    const next = new Map<string, { full: string; small: string }>();
    for (const photo of photos) {
      if (photo.blob) next.set(photo.uid, {
        full: URL.createObjectURL(photo.blob),
        small: photo.thumb ? URL.createObjectURL(photo.thumb) : URL.createObjectURL(photo.blob),
      });
      else if (photo.path) next.set(photo.uid, { full: photoUrl(photo.path), small: photoUrl(photo.thumbPath || photo.path) });
    }
    setUrls(next);
    return () => {
      for (const photo of photos) {
        const url = next.get(photo.uid);
        if (!photo.blob || !url) continue;
        URL.revokeObjectURL(url.full);
        URL.revokeObjectURL(url.small);
      }
    };
  }, [photos]);
  return urls;
}

export function OutingPhotoGrid({
  photos,
  owner = false,
  canLike = true,
  onRemove,
  onSpecies,
}: {
  photos: OutingPhoto[];
  owner?: boolean;
  canLike?: boolean;
  onRemove?: (photo: OutingPhoto) => Promise<void>;
  onSpecies?: (photo: OutingPhoto, speciesId: number | null) => Promise<void>;
}) {
  const [items, setItems] = useState(photos);
  const [open, setOpen] = useState<number | null>(null);
  const [tagging, setTagging] = useState<OutingPhoto | null>(null);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const frames = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => setItems(photos), [photos]);
  const urls = usePhotoUrls(items);
  const changed = (next: OutingPhoto) => setItems(all => all.map(p => p.uid === next.uid ? next : p));
  const shared = (photo: OutingPhoto) => !!(photo.path || photo.uploadedAt);
  const current = open == null ? null : items[open];
  const species = current?.speciesId ? byId.get(current.speciesId) : null;

  if (!items.length) return null;
  return (
    <>
      <ul className="op-grid" role="list">
        {items.map((photo, index) => {
          const url = urls.get(photo.uid);
          return (
            <li key={photo.uid} className="op-tile">
              <button
                type="button"
                className="op-thumb"
                ref={el => { if (el) frames.current.set(photo.uid, el); else frames.current.delete(photo.uid); }}
                aria-label={`Open outing photo${photo.speciesId && byId.get(photo.speciesId) ? `, ${byId.get(photo.speciesId)?.name}` : ''}`}
                onClick={() => setOpen(index)}
              >
                {url?.small ? <img src={url.small} alt="Outing photo" loading="lazy" /> : <span className="op-wait" aria-hidden="true" />}
              </button>
              {shared(photo) && (owner || !canLike ? <LikeCount photo={photo} /> : <PhotoLikeButton photo={photo} onChange={changed} />)}
            </li>
          );
        })}
      </ul>
      {open != null && current && (
        <PhotoViewer
          photos={items.map((photo, index) => ({
            src: urls.get(photo.uid)?.full || '',
            small: urls.get(photo.uid)?.small || null,
            credit: index === open ? (
              <span className="op-credit">
                {species && <span className="op-credit-species">{species.name}</span>}
                {shared(current) && (owner || !canLike ? <LikeCount photo={current} /> : <PhotoLikeButton photo={current} onChange={changed} />)}
                {owner && onSpecies && <button type="button" className="op-credit-action" onClick={() => { setTag(current.speciesId ? String(current.speciesId) : ''); setTagging(current); }}>{current.speciesId ? 'Change species' : 'Tag species'}</button>}
                {owner && onRemove && <button type="button" className="op-credit-action op-credit-remove" aria-disabled={busy || undefined} onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  try { await onRemove(current); setOpen(null); toast('Photo removed'); }
                  catch { toast('The photo could not be removed. Try again.'); }
                  finally { setBusy(false); }
                }}>Remove photo</button>}
              </span>
            ) : undefined,
            creditText: index === open ? [species?.name, `${current.likeCount || 0} likes`].filter(Boolean).join(', ') : '',
          }))}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          name={species?.name || 'Outing photo'}
          origin={index => frames.current.get(items[index]?.uid)}
        />
      )}
      {tagging && (
        <Sheet open onClose={() => setTagging(null)} labelledBy="op-tag-h">
          <h2 className="sheet-title" id="op-tag-h">Tag this photo</h2>
          <p className="muted">A species is optional.</p>
          <label className="field">
            <span>Species</span>
            <select value={tag} onChange={event => setTag(event.target.value)}>
              <option value="">No species</option>
              {SPECIES.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </label>
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setTagging(null)}>Cancel</button>
            <button type="button" className="btn btn--primary" onClick={async () => {
              if (!onSpecies) return;
              const next = { ...tagging, speciesId: tag ? Number(tag) : null };
              await onSpecies(tagging, next.speciesId ?? null);
              changed(next);
              setTagging(null);
            }}>Save species</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function useLocalOutingPhotos(outingUid: string) {
  const [photos, setPhotos] = useState<OutingPhoto[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void listOutingPhotos(outingUid).then((rows: OutingPhoto[]) => { if (alive) setPhotos(rows); }); };
    load();
    const off = onOutingPhotosChange(load);
    return () => { alive = false; off(); };
  }, [outingUid]);
  return photos;
}

type Candidate = { key: string; preview: string; takenAt: number | null; w: number; h: number; blob: Blob; thumb: Blob };

export function OutingPhotoAddButton({ outing, onAdded, className = '' }: { outing: OutingWithUid; onAdded?: () => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [during, setDuring] = useState(0);
  const [notice, setNotice] = useState(false);
  const [saving, setSaving] = useState(false);

  const clear = () => {
    candidates.forEach(photo => URL.revokeObjectURL(photo.preview));
    setCandidates([]);
    setSelected(new Set());
  };
  useEffect(() => () => candidates.forEach(photo => URL.revokeObjectURL(photo.preview)), [candidates]);

  const picked = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const prepared: Candidate[] = [];
      for (const [index, file] of files.entries()) {
        try {
          const photo = await processOutingPhoto(file);
          prepared.push({ ...photo, key: `${Date.now()}-${index}`, preview: URL.createObjectURL(photo.thumb) });
        } catch { toast(`${file.name} could not be read as a photo.`); }
      }
      if (!prepared.length) return;
      const inside = preselectPhotos(prepared, outing);
      setCandidates(prepared);
      setDuring(inside.length);
      setSelected(new Set(inside.map((photo: Candidate) => photo.key)));
      setNotice(!(await db.kvGet('outingPhotos:noticeSeen')));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const add = async () => {
    if (saving || !selected.size || !outing.uid) return;
    setSaving(true);
    try {
      const chosen = candidates.filter(photo => selected.has(photo.key));
      await addOutingPhotos(outing.uid, chosen);
      await db.kvSet('outingPhotos:noticeSeen', true);
      toast(`${chosen.length} ${chosen.length === 1 ? 'photo' : 'photos'} added`);
      clear();
      onAdded?.();
    } catch {
      toast('The photos could not be saved on this phone. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        aria-label="Choose outing photos"
        onChange={event => void picked(Array.from(event.target.files || []))}
      />
      <button type="button" className={`btn op-add ${className}`.trim()} aria-disabled={busy || undefined} onClick={() => { if (!busy) input.current?.click(); }}>
        <Icon name="cam" /> {busy ? 'Preparing photos…' : 'Add photos'}
      </button>
      {candidates.length > 0 && (
        <Sheet open onClose={clear} labelledBy="op-pick-h" wide>
          <h2 className="sheet-title" id="op-pick-h">Add photos</h2>
          <p className="op-pick-count">{during} of {candidates.length} were taken during this outing</p>
          {notice && (
            <div className="op-public-note">
              <p>Photos you add to an outing are public on your profile, and other birders can like them.</p>
              <p><strong>{myName()}, you own these photos.</strong> You can remove a photo at any time.</p>
            </div>
          )}
          <ul className="op-pick-grid" role="list">
            {candidates.map((photo, index) => (
              <li key={photo.key}>
                <label className="op-pick">
                  <input
                    type="checkbox"
                    checked={selected.has(photo.key)}
                    onChange={() => setSelected(old => {
                      const next = new Set(old);
                      if (next.has(photo.key)) next.delete(photo.key); else next.add(photo.key);
                      return next;
                    })}
                  />
                  <img src={photo.preview} alt={`Photo ${index + 1}`} />
                  <span className="sr-only">Include photo {index + 1}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-end">
            <button type="button" className="btn" onClick={clear}>Cancel</button>
            <button type="button" className="btn btn--primary" aria-disabled={!selected.size || saving || undefined} onClick={() => void add()}>
              {saving ? 'Adding…' : `Add ${selected.size} ${selected.size === 1 ? 'photo' : 'photos'}`}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

const dateText = (date?: string) => {
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ProfilePhotoSections({ publicId, canLike = true }: { publicId: string; canLike?: boolean }) {
  const [data, setData] = useState<{ mostLiked: OutingPhoto[]; outings: any[] } | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (!navigator.onLine) return;
    void fetchProfilePhotos(publicId).then((result: any) => {
      if (alive) setData({ mostLiked: result.mostLiked || [], outings: result.outings || [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, [publicId]);
  const photos = useMemo(() => data?.mostLiked || [], [data]);
  if (!data || (!photos.length && !data.outings.length)) return null;
  return (
    <>
      {photos.length > 0 && (
        <section className="me-sec" aria-labelledby="op-most-liked-h">
          <div className="me-sec-h"><h2 id="op-most-liked-h">Most liked</h2></div>
          <OutingPhotoGrid photos={photos} canLike={canLike} />
        </section>
      )}
      {data.outings.length > 0 && (
        <section className="me-sec" aria-labelledby="op-outings-h">
          <div className="me-sec-h"><h2 id="op-outings-h">Outings</h2></div>
          <ul className="op-outings" role="list">
            {data.outings.map(outing => (
              <li key={outing.outingUid}>
                <Link to={`/u/${publicId}/outing/${outing.outingUid}`} className="op-outing-link">
                  {outing.coverThumb && <img src={photoUrl(outing.coverThumb)} alt="" />}
                  <span><strong>{outing.place || 'Outing'}</strong><span>{dateText(outing.date)} · {outing.photoCount} {outing.photoCount === 1 ? 'photo' : 'photos'}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

type LocalOuting = { id: number; uid?: string; date?: string; place?: string; startedAt?: number };

export function LocalProfilePhotoSections({ publicId, outings }: { publicId?: string; outings: LocalOuting[] }) {
  const [photos, setPhotos] = useState<OutingPhoto[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void db.all('photos').then((rows: OutingPhoto[]) => {
        if (alive) setPhotos(rows.filter(photo => (photo as any).kind === 'outing'));
      }).catch(() => {});
    };
    load();
    const off = onOutingPhotosChange(load);
    return () => { alive = false; off(); };
  }, []);
  const liked = useMemo(() => photos.slice().sort((a, b) =>
    (b.likeCount || 0) - (a.likeCount || 0) || Number(b.takenAt || 0) - Number(a.takenAt || 0) || Number(b.id || 0) - Number(a.id || 0),
  ).slice(0, 9), [photos]);
  const groups = useMemo(() => outings.map(outing => {
    const items = photos.filter(photo => photo.outingUid === outing.uid);
    return { outing, photos: items, cover: items[0] };
  }).filter(group => group.photos.length > 0).sort((a, b) =>
    (b.outing.startedAt || Date.parse(`${b.outing.date}T00:00:00`) || 0) - (a.outing.startedAt || Date.parse(`${a.outing.date}T00:00:00`) || 0),
  ), [photos, outings]);
  if (!photos.length) return null;
  return (
    <>
      {liked.length > 0 && (
        <section className="me-sec" aria-labelledby="op-local-most-liked-h">
          <div className="me-sec-h"><h2 id="op-local-most-liked-h">Most liked</h2></div>
          <OutingPhotoGrid photos={liked} canLike={false} />
        </section>
      )}
      <section className="me-sec" aria-labelledby="op-local-outings-h">
        <div className="me-sec-h"><h2 id="op-local-outings-h">Outings</h2></div>
        <ul className="op-outings" role="list">
          {groups.map(({ outing, photos: items, cover }) => (
            <li key={outing.uid}>
              <LocalOutingLink outing={outing} cover={cover} publicId={publicId}>
                <span><strong>{outing.place || 'Outing'}</strong><span>{dateText(outing.date)} · {items.length} {items.length === 1 ? 'photo' : 'photos'}</span></span>
              </LocalOutingLink>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function LocalOutingLink({ outing, cover, publicId, children }: { outing: LocalOuting; cover: OutingPhoto; publicId?: string; children: React.ReactNode }) {
  const [small, setSmall] = useState('');
  const shared = !!(cover.path || cover.uploadedAt);
  useEffect(() => {
    if (cover.path) { setSmall(photoUrl(cover.thumbPath || cover.path)); return; }
    if (!cover.thumb && !cover.blob) { setSmall(''); return; }
    const url = URL.createObjectURL(cover.thumb || cover.blob!);
    setSmall(url);
    return () => URL.revokeObjectURL(url);
  }, [cover.uid, cover.path, cover.thumbPath, cover.thumb, cover.blob]);
  const to = publicId && shared ? `/u/${publicId}/outing/${outing.uid}` : `/outing/${outing.id}`;
  return <Link to={to} className="op-outing-link">{small && <img src={small} alt="" />}{children}</Link>;
}

export async function tagLocalOutingPhoto(photo: OutingPhoto, speciesId: number | null) {
  await updateOutingPhoto(photo, { speciesId });
}

export async function removeLocalOutingPhoto(photo: OutingPhoto) {
  await removeOutingPhoto(photo);
}
