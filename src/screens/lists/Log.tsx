import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import {
  ConfirmDialog,
  Modal,
  SightingFields,
  buildSighting,
  deleteSighting,
  draftFromSighting,
  fmtDate,
  getPosition,
  saveSighting,
  useSightingRows,
  type SightingDraft,
  type SightingRow,
} from './shared';
import './lists.css';

function EditSighting({ sighting, onClose }: { sighting: SightingRow; onClose: () => void }) {
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
        <SightingFields
          draft={draft}
          onChange={setDraft}
          status={status}
          onLocate={locate}
          locating={locating}
          error={error}
        />
        <div className="row-end">
          <button
            type="button"
            className="btn btn--danger btn--quiet"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddSightingButton() {
  return (
    <Link className="iconbtn" to="/add" aria-label="Add a sighting">
      <Icon name="cam" />
    </Link>
  );
}

export default function Log() {
  const sightings = useSightingRows();
  const [editing, setEditing] = useState<SightingRow | null>(null);

  const grouped = useMemo(() => {
    const sorted = sightings
      .slice()
      .sort((a, b) =>
        `${b.date} ${b.time ?? ''}`.localeCompare(`${a.date} ${a.time ?? ''}`),
      );
    const byDate = new Map<string, SightingRow[]>();
    for (const rec of sorted) {
      const key = rec.date || 'Undated';
      const items = byDate.get(key) ?? [];
      items.push(rec);
      byDate.set(key, items);
    }
    return [...byDate.entries()];
  }, [sightings]);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
        <h1>All sightings</h1>
        <span className="spacer" />
        <AddSightingButton />
      </header>

      {grouped.map(([date, items]) => (
        <section className="block" key={date}>
          <h2 className="h2">{date === 'Undated' ? 'Undated' : fmtDate(date)}</h2>
          <ul className="rows">
            {items.map((rec) => {
              const sp = byId.get(rec.speciesId);
              return (
                <li key={rec.id}>
                  <button
                    type="button"
                    className={`row row--sp ${sp ? `kind--${sp.kind}` : ''}`}
                    onClick={() => setEditing(rec)}
                    aria-label={`Edit ${sp?.name ?? 'sighting'} on ${fmtDate(rec.date)}`}
                  >
                    <span className="row-thumb">
                      {sp ? (
                        <SpeciesImage sp={sp} />
                      ) : (
                        <span
                          className="img-missing"
                          role="img"
                          aria-label="Unknown species"
                        />
                      )}
                    </span>
                    <span className="row-main">
                      <strong>{sp?.name ?? 'Unknown species'}</strong>
                      <span className="muted small">
                        {rec.time || ''} {rec.place || ''}
                        {rec.notes ? ` — ${rec.notes}` : ''}
                      </span>
                    </span>
                    <span className="row-n">{rec.count ?? 'X'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {grouped.length === 0 && (
        <div className="empty">
          <p>No sightings yet. Tap + to log your first bird.</p>
          <Link className="btn" to="/add">
            Log a sighting
          </Link>
        </div>
      )}

      {editing && <EditSighting sighting={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
