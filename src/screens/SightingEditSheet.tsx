// Log a sighting of this species, or edit one of hers, from the species page without leaving it, as v1's
// openSightingSheet({ speciesId }) and openSightingSheet({ sightingId }) do. The form and the save/delete path are the
// shared sighting pieces (src/screens/lists/shared.tsx) that the Log and Add pages use.
import { useEffect, useState, type FormEvent } from 'react';
import { focusables, topLayer } from '../lib/layers';
import { byId } from '../lib/data';
import {
  ConfirmDialog,
  Modal,
  SightingFields,
  buildSighting,
  deleteSighting,
  draftFromSighting,
  emptyDraft,
  getPosition,
  saveSighting,
  type SightingDraft,
  type SightingRow,
} from './lists/shared';
import { toast } from './birdToast';

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
    const { rec, error: problem } = buildSighting(draft, existing ? { ...existing } : {});
    if (!rec) {
      setError(problem ?? 'That sighting is not complete.');
      return;
    }
    setSaving(true);
    try {
      await saveSighting(rec);
      onClose();
      // v1's words. v1 shows its new-for-the-dex celebration instead of the toast for a first sighting; this app has
      // no celebration, so the toast says it was saved either way.
      toast(existing ? 'Changes saved' : `${byId.get(rec.speciesId as number)?.name ?? 'Sighting'} saved`);
    } catch {
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
        <SightingFields draft={draft} onChange={setDraft} status={status} onLocate={locate} locating={locating} error={error} />
        <div className="row-end">
          {existing && <><button type="button" className="btn btn--danger btn--quiet" onClick={() => setConfirmDelete(true)}>Delete</button><span className="spacer" /></>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Save sighting'}</button>
        </div>
      </form>
    </Modal>
  );
}
