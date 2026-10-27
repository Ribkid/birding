// Edit one of her sightings from the species page, as v1's openSightingSheet({ sightingId }) does. The same form and
// save/delete path as the Log page's editor (src/screens/lists/Log.tsx), built from the shared sighting pieces.
import { useEffect, useState, type FormEvent } from 'react';
import { focusables, topLayer } from '../lib/layers';
import {
  ConfirmDialog,
  Modal,
  SightingFields,
  buildSighting,
  deleteSighting,
  draftFromSighting,
  getPosition,
  saveSighting,
  type SightingDraft,
  type SightingRow,
} from './lists/shared';

export function SightingEditSheet({ sighting, onClose }: { sighting: SightingRow; onClose: () => void }) {
  const [draft, setDraft] = useState<SightingDraft>(() => draftFromSighting(sighting));
  const [error, setError] = useState('');
  const [status, setStatus] = useState(
    sighting.lat != null && sighting.lng != null
      ? `${sighting.lat.toFixed(4)}, ${sighting.lng.toFixed(4)}`
      : 'No location yet',
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // As v1's sheets do, focus moves to the first control in the sheet once it opens (the page behind goes inert).
  useEffect(() => {
    const t = setTimeout(() => {
      const top = topLayer();
      if (!top || top.dialog.contains(document.activeElement)) return;
      (focusables(top.dialog)[0] || top.dialog).focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const locate = async () => {
    setLocating(true);
    setStatus('Finding you…');
    try {
      const pos = await getPosition();
      setDraft((current) => ({ ...current, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6) }));
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
    const { rec, error: problem } = buildSighting(draft, { ...sighting });
    if (!rec) {
      setError(problem ?? 'That sighting is not complete.');
      return;
    }
    setSaving(true);
    try {
      await saveSighting(rec);
      onClose();
    } catch {
      setError('The change could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (confirmDelete) {
    return (
      <ConfirmDialog
        title="Delete this sighting?"
        body="It will be removed from your lists. This cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSighting(sighting);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal title="Edit sighting" onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <SightingFields draft={draft} onChange={setDraft} status={status} onLocate={locate} locating={locating} error={error} />
        <div className="row-end">
          <button type="button" className="btn btn--danger btn--quiet" onClick={() => setConfirmDelete(true)}>Delete</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}
