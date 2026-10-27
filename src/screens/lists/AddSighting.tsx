import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { db } from '../../core/db.js';
import { resizeImage } from '../../core/profile.js';
import { takePending } from '../field/scanHandoff';
import {
  PhotoField,
  SightingFields,
  buildSighting,
  emptyDraft,
  getPosition,
  saveSighting,
  useObjectUrl,
  type SightingDraft,
} from './shared';
import './lists.css';

export default function AddSighting() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const fromScan = useRef(false);
  const [draft, setDraft] = useState<SightingDraft>(() => {
    const d = emptyDraft();
    const species = Number(params.get('species'));
    if (species && Number.isFinite(species)) d.speciesId = species;
    return d;
  });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('No location yet');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const photoUrl = useObjectUrl(photoBlob);

  // v1 app.js: a picked photo is resized (1600 px, JPEG 0.82) before it is kept.
  const pickPhoto = async (file: File) => {
    setError('');
    const blob = await resizeImage(file);
    if (!blob) {
      setError("That file couldn't be opened as a photo.");
      return;
    }
    setPhotoBlob(blob);
  };

  const locate = async () => {
    setLocating(true);
    setStatus('Finding you…');
    try {
      const pos = await getPosition();
      setDraft((current) => ({
        ...current,
        lat: pos.lat.toFixed(6),
        lng: pos.lng.toFixed(6),
        acc: pos.acc,
      }));
      setStatus(`${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (±${pos.acc} m)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (!location.state?.scan) return;
    const pending = takePending();
    if (!pending) return;
    fromScan.current = true;
    setPhotoBlob(pending.blob);
    setDraft((current) => ({ ...current, note: pending.notes || current.note }));
    if (pending.autoGps) void locate();
    // Run once when the scan hand-off opens this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    if (fromScan.current) navigate(-1);
    else navigate('/lists');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const { rec, error: problem } = buildSighting(draft);
    if (!rec) {
      setError(problem ?? 'That sighting is not complete.');
      return;
    }
    setSaving(true);
    let photoId: number | null = null;
    try {
      if (photoBlob) photoId = (await db.add('photos', { blob: photoBlob, at: Date.now() })) as number;
      await saveSighting(photoId != null ? { ...rec, photoId } : rec);
      navigate('/lists');
    } catch {
      if (photoId != null) await db.del('photos', photoId).catch(() => {});
      setError('The sighting could not be saved. Try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <header className="page-head page-head--back">
        <button type="button" className="iconbtn" aria-label={fromScan.current ? 'Back to the scan result' : 'Back to lists'} onClick={cancel}>
          <Icon name="back" />
        </button>
        <h1>Log a sighting</h1>
      </header>

      <p className="muted small pad-x">
        Pick the species, then add when and where you saw it. Count, place and coordinates are
        optional.
      </p>

      <form className="form pad" onSubmit={save} noValidate>
        <SightingFields
          draft={draft}
          onChange={setDraft}
          status={status}
          onLocate={locate}
          locating={locating}
          error={error}
          photo={<PhotoField url={photoUrl} onPick={(file) => void pickPhoto(file)} onRemove={() => setPhotoBlob(null)} />}
        />
        <div className="row-end">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save sighting'}
          </button>
        </div>
      </form>
    </>
  );
}
