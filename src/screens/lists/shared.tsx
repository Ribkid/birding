import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { db } from '../../core/db.js';
import { likelihood, loadSeq, monthRates, seq } from '../../core/seqdata.js';
import { MONTHS, targets } from '../../core/stats.js';
import { byId, dexCode, SPECIES, type Species } from '../../lib/data';
import { useOutings, useSeen, useSightings, type Outing, type Sighting } from '../../lib/hooks';
import { Icon } from '../../components/Icon';
import { Band, SpeciesImage } from '../../components/SpeciesImage';
import './lists.css';

export const MONTH_NAMES = MONTHS as string[];

/** A sighting as it is actually stored in IndexedDB (the facade type is a subset). */
export interface SightingRow extends Omit<Sighting, 'count'> {
  count?: number | null;
  place?: string;
  notes?: string;
  note?: string;
  heard?: boolean;
  photoId?: number | null;
  acc?: number | null;
  createdAt?: number;
}

/** A sighting that has not been saved yet. */
export type SightingInput = Omit<SightingRow, 'id'> & { id?: number };

/** An outing as it is actually stored in IndexedDB (the facade type is a subset). */
export interface OutingRow extends Omit<Outing, 'endedAt'> {
  endedAt?: string | number | null;
  startedAt?: number;
  past?: boolean;
  complete?: boolean;
  notes?: string;
  distanceKm?: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface Patch {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const todayStr = (d = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const timeStr = (d = new Date()): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fmtDate(d?: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day || !MONTH_NAMES[m - 1]) return d;
  return `${day} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

export const plural = (n: number, one: string, many?: string): string =>
  `${n} ${n === 1 ? one : (many ?? (one.endsWith('s') ? one : `${one}s`))}`;

/** All sightings, with the extra fields the v1 records carry. */
export function useSightingRows(): SightingRow[] {
  return useSightings() as SightingRow[];
}

/** All outings, with the extra fields the v1 records carry. */
export function useOutingRows(): OutingRow[] {
  return useOutings() as OutingRow[];
}

/** Patches are stored in their own IndexedDB store; this keeps the list fresh. */
export function usePatches(): Patch[] {
  const [rows, setRows] = useState<Patch[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = (await db.all('patches')) as Patch[];
      if (alive) setRows(all);
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'patches') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

/** The id in the `activeOuting` kv entry, or null. */
export function useActiveOutingId(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const value = await db.kvGet('activeOuting');
      if (!alive) return;
      setId(value == null ? null : Number(value));
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'kv:activeOuting') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return id;
}

/**
 * True after a short pause. Hooks expose no loading flag, so this stops a
 * not-found message flashing before IndexedDB has answered.
 */
export function useSettled(ms = 300): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return settled;
}

/** Loads the regional data once; the returned number changes when it is ready. */
export function useSeqVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadSeq().then(() => {
      if (alive) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

export interface TargetOptions {
  score?: (id: number, month: number) => number;
  rel?: (id: number, month: number) => number | null;
}

export interface TargetArgs extends TargetOptions {
  seen: Set<number>;
  month: number;
  habitat?: string;
  kinds?: string[];
}

/** The v1 ranking options, used only when the regional hotspot data is present. */
export function targetOptions(): TargetOptions {
  const data = seq() as { hotspots?: unknown[] } | null;
  if (!data?.hotspots?.length) return {};
  return {
    score: (id, month) => likelihood(id, month) as number,
    rel: (id, month) => {
      const rates = monthRates(id) as { rel: number[] } | null;
      return rates ? rates.rel[month - 1] : null;
    },
  };
}

/** stats.targets() with a permissive signature for the framework-free module. */
export function suggestTargets(args: TargetArgs): Species[] {
  return (targets as unknown as (value: TargetArgs) => Species[])(args);
}

export async function saveSighting(rec: SightingInput): Promise<number> {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* storage persistence is best effort */
  }
  if (rec.id != null) {
    await db.put('sightings', rec);
    return rec.id;
  }
  rec.createdAt = rec.createdAt ?? Date.now();
  const id = Number(await db.add('sightings', rec));
  rec.id = id;
  return id;
}

export async function deleteSighting(rec: SightingRow): Promise<void> {
  if (rec.photoId != null) await db.del('photos', rec.photoId);
  await db.del('sightings', rec.id);
}

export function getPosition(): Promise<{ lat: number; lng: number; acc: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
        }),
      (err) =>
        reject(
          new Error(
            err.code === 1
              ? 'Location permission was denied. Allow it in your browser settings.'
              : 'Could not get your location. Try again outside or near a window.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** The v1 species search: every word must match name, scientific name or dex code. */
export function matchSpecies(query: string, limit = 8): Species[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/);
  return SPECIES.map((sp) => {
    const hay = `${sp.name} ${sp.sci} ${dexCode(sp.id)}`.toLowerCase();
    if (!words.every((word) => hay.includes(word))) return null;
    const score = sp.name.toLowerCase().startsWith(needle) ? 0 : hay.includes(` ${needle}`) ? 1 : 2;
    return { sp, score };
  })
    .filter((entry): entry is { sp: Species; score: number } => entry !== null)
    .sort((a, b) => a.score - b.score || a.sp.id - b.sp.id)
    .slice(0, limit)
    .map((entry) => entry.sp);
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** A v1-style bottom sheet with Escape-to-close and a focus trap. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    document.body.classList.add('has-sheet');

    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === node)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-sheet');
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="sheet-wrap open">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className={`sheet ${wide ? 'sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="muted">{body}</p>
      <div className="row-end">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Species picker                                                      */
/* ------------------------------------------------------------------ */

interface SpeciesPickerProps {
  value: number | null;
  onChange: (sp: Species | null) => void;
  label?: string;
}

export function SpeciesPicker({ value, onChange, label = 'Species' }: SpeciesPickerProps) {
  const seen = useSeen();
  const [query, setQuery] = useState('');
  const resultsRef = useRef<HTMLUListElement>(null);
  const sp = value != null ? (byId.get(value) ?? null) : null;

  if (sp) {
    return (
      <div className="picker">
        <div className="chosen">
          <SpeciesImage sp={sp} className="chosen-img" />
          <div>
            <strong>{sp.name}</strong>
            <em>{sp.sci}</em>
          </div>
          <button type="button" className="btn btn--small" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  const results = matchSpecies(query);

  return (
    <div className="picker">
      <div className="picker-search">
        <label className="field">
          <span>{label}</span>
          <input
            type="search"
            placeholder="Type a name, e.g. kookaburra"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                resultsRef.current?.querySelector('button')?.focus();
              }
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
        </label>
        {query.trim() !== '' && (
          <ul className="picker-results" ref={resultsRef}>
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item);
                    setQuery('');
                  }}
                >
                  <Band sp={item} seen={seen.has(item.id)} />
                  <span>{item.name}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="muted pad">No species by that name in the dex.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sighting form                                                       */
/* ------------------------------------------------------------------ */

export interface SightingDraft {
  speciesId: number | null;
  count: string;
  date: string;
  time: string;
  place: string;
  lat: string;
  lng: string;
  note: string;
}

export function emptyDraft(): SightingDraft {
  return {
    speciesId: null,
    count: '1',
    date: todayStr(),
    time: timeStr(),
    place: '',
    lat: '',
    lng: '',
    note: '',
  };
}

export function draftFromSighting(s: SightingRow): SightingDraft {
  return {
    speciesId: s.speciesId ?? null,
    count: s.count != null ? String(s.count) : '',
    date: s.date ?? todayStr(),
    time: s.time ?? '',
    place: s.place ?? '',
    lat: s.lat != null ? String(s.lat) : '',
    lng: s.lng != null ? String(s.lng) : '',
    note: s.note ?? s.notes ?? '',
  };
}

export function buildSighting(
  draft: SightingDraft,
  base: Partial<SightingRow> = {},
): { rec?: SightingInput; error?: string } {
  if (!draft.speciesId) return { error: 'Choose which species you saw.' };
  if (!draft.date) return { error: 'Add the date of the sighting.' };

  const countText = draft.count.trim();
  const count = countText ? Math.max(1, parseInt(countText, 10) || 1) : null;

  const latText = draft.lat.trim();
  const lngText = draft.lng.trim();
  let lat: number | null = null;
  let lng: number | null = null;

  if (latText || lngText) {
    const latValue = Number(latText);
    const lngValue = Number(lngText);
    if (!latText || !lngText || !Number.isFinite(latValue) || !Number.isFinite(lngValue)) {
      return { error: 'Add both coordinates, or leave both blank.' };
    }
    if (latValue < -90 || latValue > 90 || lngValue < -180 || lngValue > 180) {
      return { error: 'Those coordinates are outside the map.' };
    }
    lat = latValue;
    lng = lngValue;
  }

  const note = draft.note.trim();
  const rec: SightingInput = {
    ...base,
    speciesId: draft.speciesId,
    count,
    date: draft.date,
    time: draft.time,
    place: draft.place.trim(),
    lat,
    lng,
    note,
    notes: note,
  };
  return { rec };
}

interface SightingFieldsProps {
  draft: SightingDraft;
  onChange: (next: SightingDraft) => void;
  status?: string;
  onLocate?: () => void;
  locating?: boolean;
  error?: string;
}

/** The shared fields for adding or editing a sighting. */
export function SightingFields({
  draft,
  onChange,
  status,
  onLocate,
  locating = false,
  error,
}: SightingFieldsProps) {
  const update = (patch: Partial<SightingDraft>) => onChange({ ...draft, ...patch });
  const step = (delta: number) => {
    const current = parseInt(draft.count, 10) || 1;
    update({ count: String(Math.max(1, current + delta)) });
  };

  return (
    <>
      <SpeciesPicker
        value={draft.speciesId}
        onChange={(sp) => update({ speciesId: sp ? sp.id : null })}
      />

      <div className="grid2">
        <label className="field">
          <span>How many</span>
          <div className="stepper">
            <button type="button" onClick={() => step(-1)} aria-label="One fewer">
              −
            </button>
            <input
              name="count"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.count}
              placeholder="?"
              aria-label="Count"
              onChange={(event) => update({ count: event.target.value })}
            />
            <button type="button" onClick={() => step(1)} aria-label="One more">
              +
            </button>
          </div>
        </label>
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            name="date"
            value={draft.date}
            max={todayStr()}
            onChange={(event) => update({ date: event.target.value })}
          />
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Time</span>
          <input
            type="time"
            name="time"
            value={draft.time}
            onChange={(event) => update({ time: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Place name (optional)</span>
          <input
            name="place"
            value={draft.place}
            placeholder="e.g. Oxley Creek Common"
            autoComplete="off"
            onChange={(event) => update({ place: event.target.value })}
          />
        </label>
      </div>

      <fieldset className="loc">
        <legend>Where (optional)</legend>
        <div className="loc-row">
          {onLocate && (
            <button type="button" className="btn" onClick={onLocate} disabled={locating}>
              <Icon name="pin" />
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
          )}
          <span className="muted small">{status ?? 'No location yet'}</span>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Latitude</span>
            <input
              name="lat"
              inputMode="decimal"
              value={draft.lat}
              placeholder="e.g. -27.5210"
              onChange={(event) => update({ lat: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Longitude</span>
            <input
              name="lng"
              inputMode="decimal"
              value={draft.lng}
              placeholder="e.g. 153.0200"
              onChange={(event) => update({ lng: event.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <label className="field">
        <span>Note (optional)</span>
        <textarea
          name="note"
          rows={2}
          value={draft.note}
          placeholder="Behaviour, plumage, who you were with…"
          onChange={(event) => update({ note: event.target.value })}
        />
      </label>

      <p className="form-error" role="alert">
        {error ?? ''}
      </p>
    </>
  );
}
