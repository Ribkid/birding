import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import {
  SightingFields,
  buildSighting,
  emptyDraft,
  getPosition,
  saveSighting,
  type SightingDraft,
} from './shared';
import './lists.css';

export default function AddSighting() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
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

  const locate = async () => {
    setLocating(true);
    setStatus('Finding you…');
    try {
      const pos = await getPosition();
      setDraft((current) => ({
        ...current,
        lat: pos.lat.toFixed(6),
        lng: pos.lng.toFixed(6),
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
    const { rec, error: problem } = buildSighting(draft);
    if (!rec) {
      setError(problem ?? 'That sighting is not complete.');
      return;
    }
    setSaving(true);
    try {
      await saveSighting(rec);
      navigate('/lists');
    } catch {
      setError('The sighting could not be saved. Try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/lists" aria-label="Back to lists">
          <Icon name="back" />
        </Link>
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
        />
        <div className="row-end">
          <Link className="btn" to="/lists">
            Cancel
          </Link>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save sighting'}
          </button>
        </div>
      </form>
    </>
  );
}
