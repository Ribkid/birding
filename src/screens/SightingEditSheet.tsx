// Log a sighting of this species, or edit one of hers, from the species page without leaving it, as v1's
// openSightingSheet({ speciesId }) and openSightingSheet({ sightingId }) do. The form and the save/delete path are the
// shared sighting pieces (src/screens/lists/shared.tsx) that the Log and Add pages use, photo field and GPS accuracy
// included, so the record written is v1's (heard, acc, photoId, outingId).
import { useEffect, useState, type FormEvent } from 'react';
import { byId } from '../lib/data';
import { db } from '../core/db.js';
import { resizeImage } from '../core/profile.js';
import { toast } from '../lib/toast';
import {
  ConfirmDialog,
  Modal,
  PhotoField,
  SightingFields,
  buildSighting,
  deleteSighting,
  draftFromSighting,
  emptyDraft,
  getPosition,
  lastSaveNew,
  saveSighting,
  useObjectUrl,
  type SightingDraft,
  type SightingRow,
} from './lists/shared';

export function SightingEditSheet({ sighting, speciesId, onClose }: { sighting?: SightingRow | null; speciesId?: number; onClose: () => void }) {
  const existing = sighting || null;
  const [draft, setDraft] = useState<SightingDraft>(() => {
    if (existing) return draftFromSighting(existing);
    const d = emptyDraft();
    if (speciesId) d.speciesId = speciesId;
    return d;
  });
  const [error, setError] = useState('');
  const [status, setStatus] = useState(
    existing?.lat != null && existing.lng != null
      ? `${existing.lat.toFixed(4)}, ${existing.lng.toFixed(4)}`
      : 'No location yet',
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // v1's sheet: the saved photo (when its blob is on this phone), a replacement, or a removal, applied on save.
  const [storedPhoto, setStoredPhoto] = useState<Blob | null>(null);
  const [newPhoto, setNewPhoto] = useState<Blob | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const photoUrl = useObjectUrl(newPhoto ?? (removePhoto ? null : storedPhoto));

  const storedId = existing?.photoId ?? null;
  useEffect(() => {
    if (storedId == null) return;
    let alive = true;
    void db.get('photos', storedId)
      .then((photo: { blob?: Blob | null } | undefined) => { if (alive && photo?.blob) setStoredPhoto(photo.blob); })
      .catch(() => {});
    return () => { alive = false; };
  }, [storedId]);

  // v1 app.js: a picked photo is resized (1600 px, JPEG 0.82) before it is kept.
  const pickPhoto = async (file: File) => {
    setError('');
    const blob = await resizeImage(file);
    if (!blob) {
      setError("That file couldn't be opened as a photo.");
      return;
    }
    setNewPhoto(blob);
    setRemovePhoto(false);
  };

  const locate = async () => {
    setLocating(true);
    setStatus('Finding you…');
    try {
      const pos = await getPosition();
      setDraft((current) => ({ ...current, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6), acc: pos.acc }));
      setStatus(`${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const { rec, error: problem } = buildSighting(draft, existing ? { ...existing } : {});
    if (!rec) {
      setError(problem ?? 'That sighting is not complete.');
      return;
    }
    setSaving(true);
    const oldPhotoId = storedId;
    let addedPhotoId: number | null = null;
    try {
      if (newPhoto) {
        addedPhotoId = (await db.add('photos', { blob: newPhoto, at: Date.now() })) as number;
        rec.photoId = addedPhotoId;
      } else if (removePhoto && oldPhotoId != null) {
        rec.photoId = null;
      }
      await saveSighting(rec);
      // The old photo goes only once the record no longer points at it.
      if (oldPhotoId != null && rec.photoId !== oldPhotoId) await db.del('photos', oldPhotoId).catch(() => {});
      onClose();
      // v1's words. For a species new to the dex, the celebration saveSighting opens stands in for 'saved'.
      if (existing) toast('Changes saved');
      else if (!lastSaveNew()) toast(`${byId.get(rec.speciesId as number)?.name ?? 'Sighting'} saved`);
    } catch {
      if (addedPhotoId != null) await db.del('photos', addedPhotoId).catch(() => {});
      setError(existing ? 'The change could not be saved. Try again.' : 'The sighting could not be saved. Try again.');
      setSaving(false);
    }
  };

  if (existing && confirmDelete) {
    return (
      <ConfirmDialog
        title="Delete this sighting?"
        body="It will be removed from your lists. This cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSighting(existing);
          onClose();
          toast('Sighting deleted');
        }}
      />
    );
  }

  return (
    <Modal title={existing ? 'Edit sighting' : 'Log a sighting'} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <SightingFields
          draft={draft}
          onChange={setDraft}
          status={status}
          onLocate={locate}
          locating={locating}
          error={error}
          photo={
            <PhotoField
              url={photoUrl}
              onPick={(file) => void pickPhoto(file)}
              onRemove={() => {
                setNewPhoto(null);
                setRemovePhoto(true);
              }}
            />
          }
        />
        <div className="row-end">
          {existing && <><button type="button" className="btn btn--danger btn--quiet" onClick={() => setConfirmDelete(true)}>Delete</button><span className="spacer" /></>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Save sighting'}</button>
        </div>
      </form>
    </Modal>
  );
}
