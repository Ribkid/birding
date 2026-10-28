import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { db } from '../../core/db.js';
import { likelihood, loadSeq, monthRates, seq } from '../../core/seqdata.js';
import { badges, MONTHS, targets } from '../../core/stats.js';
import { byId, dexCode, SPECIES, type Species } from '../../lib/data';
import { normaliseSighting, useOutings, useSightings, type Outing, type Sighting } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { nudgeAfterSave } from '../me/nudge';
import './lists.css';

export const MONTH_NAMES = MONTHS as string[];

/** A sighting as it is actually stored in IndexedDB (the facade type is a subset). */
export interface SightingRow extends Omit<Sighting, 'count'> {
  count?: number | null;
  place?: string;
  notes?: string;
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

/** What the sighting sheet and the #/add page need to hand: her sightings, outings, patches and the active outing. */
export interface LogData {
  sightings: SightingRow[];
  outings: OutingRow[];
  patches: Patch[];
  /** The `activeOuting` kv entry, or null. */
  activeId: number | null;
}

/**
 * Sightings, outings, patches and the active outing, kept fresh as the database changes, and null until the first
 * read lands. v1 held these in memory from boot, so its sheet knew at once whether an outing was running.
 */
export function useLogData(): LogData | null {
  const [data, setData] = useState<LogData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [sightings, outings, patches, active] = await Promise.all([
          db.all('sightings'), db.all('outings'), db.all('patches'), db.kvGet('activeOuting'),
        ]);
        if (!alive) return;
        setData({
          sightings: (sightings as SightingRow[]).map(normaliseSighting),
          outings: outings as OutingRow[],
          patches: patches as Patch[],
          activeId: active == null ? null : Number(active),
        });
      } catch {
        if (alive) setData((prev) => prev ?? { sightings: [], outings: [], patches: [], activeId: null });
      }
    };
    void load();
    const off = db.onChange((name: string) => {
      if (name === 'sightings' || name === 'outings' || name === 'patches' || name === 'kv:activeOuting') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return data;
}

/** v1 activeOuting(): the outing in the activeOuting kv entry, unless it has ended. */
export const activeOutingOf = (data: LogData): OutingRow | null =>
  data.activeId == null ? null : data.outings.find((o) => o.id === data.activeId && !o.endedAt) || null;

export interface EarnedBadge {
  id: string;
  name: string;
}

/** What a save changed: whether the species is new for her dex and which badges it earned (v1 saveSighting). */
export interface SaveOutcome {
  id: number;
  isNew: boolean;
  newBadges: EarnedBadge[];
  /** Every sighting after the save, for the celebration's counts. */
  sightings: SightingRow[];
}

const doneBadges = (sightings: SightingRow[], outings: OutingRow[]) =>
  (badges(sightings, outings) as (EarnedBadge & { done: boolean })[]).filter((b) => b.done);

/**
 * v1 saveSighting's write: store the record (a new one gets createdAt and its id), ask for persistent storage, and
 * work out whether the species is new for the dex and which badges the save earned. It shows nothing; the caller
 * closes its sheet first and then calls announceSaved, as v1 closed the sheet before saving.
 */
export async function writeSighting(rec: SightingInput): Promise<SaveOutcome> {
  const [stored, outings] = await Promise.all([db.all('sightings'), db.all('outings')]);
  const before = stored as SightingRow[];
  const seenBefore = new Set(before.map((s) => s.speciesId));
  const badgesBefore = new Set(doneBadges(before, outings as OutingRow[]).map((b) => b.id));
  let id: number;
  if (rec.id != null) {
    await db.put('sightings', rec);
    id = rec.id;
  } else {
    rec.createdAt = rec.createdAt ?? Date.now();
    id = Number(await db.add('sightings', rec));
    rec.id = id;
  }
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* storage persistence is best effort */
  }
  const saved = rec as SightingRow;
  const after = before.some((s) => s.id === id) ? before.map((s) => (s.id === id ? saved : s)) : [...before, saved];
  const newBadges = doneBadges(after, outings as OutingRow[])
    .filter((b) => !badgesBefore.has(b.id))
    .map(({ id: badgeId, name }) => ({ id: badgeId, name }));
  return { id, isNew: !seenBefore.has(saved.speciesId), newBadges, sightings: after };
}

/** A first sighting of a species, for the celebration (drawn by SightingSheetHost). */
export interface Celebration {
  speciesId: number;
  newBadges: EarnedBadge[];
  sightings: SightingRow[];
  /** Wait for the route to change before showing it (the #/add page navigates away after saving). */
  afterNav?: boolean;
}
const celebrators = new Set<(c: Celebration) => void>();
export function onCelebrate(fn: (c: Celebration) => void): () => void {
  celebrators.add(fn);
  return () => {
    celebrators.delete(fn);
  };
}

/**
 * The rest of v1 saveSighting: the new-for-the-dex celebration for a first sighting, otherwise a toast for any
 * badge earned, then the one-time sign-up nudge.
 */
export function announceSaved(rec: SightingInput, outcome: SaveOutcome, { afterNav = false } = {}): void {
  if (outcome.isNew && rec.speciesId != null) {
    for (const fn of celebrators) fn({ speciesId: rec.speciesId, newBadges: outcome.newBadges, sightings: outcome.sightings, afterNav });
  } else if (outcome.newBadges.length) {
    toast(`Badge earned: ${outcome.newBadges.map((b) => b.name).join(', ')}`);
  }
  void nudgeAfterSave(outcome.sightings.length);
}

/** v1 saveSighting: write the record, then celebrate a new species or toast a badge. Resolves to the record's id. */
export async function saveSighting(rec: SightingInput): Promise<number> {
  const outcome = await writeSighting(rec);
  announceSaved(rec, outcome);
  return outcome.id;
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

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** A v1-style bottom sheet on the shared layer stack, so the page behind is inert. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  return (
    <Sheet open onClose={onClose} label={title} wide={wide}>
      <h2 className="sheet-title">{title}</h2>
      {children}
    </Sheet>
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
/* The sighting record                                                 */
/* ------------------------------------------------------------------ */

/** What the Log a sighting sheet holds while she fills it in (v1 openSightingSheet's `rec` and form fields). */
export interface SightingDraft {
  speciesId: number | null;
  /** The How many field as typed: '' saves no count, as v1's '?' placeholder did. */
  count: string;
  heard: boolean;
  date: string;
  time: string;
  place: string;
  lat: number | null;
  lng: number | null;
  /** GPS accuracy in metres for lat/lng, or null for a place chip or a map pick (v1 `acc`). */
  acc: number | null;
  /** True once Use my location, a place chip or Choose on map has set lat, lng and acc. */
  moved: boolean;
  notes: string;
}

/** v1's new sighting: one of the species, now, nowhere yet. */
export function emptyDraft(speciesId: number | null = null, notes = ''): SightingDraft {
  return {
    speciesId,
    count: '1',
    heard: false,
    date: todayStr(),
    time: timeStr(),
    place: '',
    lat: null,
    lng: null,
    acc: null,
    moved: false,
    notes,
  };
}

export function draftFromSighting(s: SightingRow): SightingDraft {
  return {
    speciesId: s.speciesId ?? null,
    count: s.count != null ? String(s.count) : '',
    heard: !!s.heard,
    date: s.date ?? todayStr(),
    time: s.time ?? '',
    place: s.place ?? '',
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    acc: s.acc ?? null,
    moved: false,
    notes: s.notes ?? '',
  };
}

/** Plants can't be heard, so v1 hides 'Heard only' for them and never stores it. */
export const canBeHeard = (speciesId: number | null) => byId.get(Number(speciesId))?.kind !== 'plant';

// v1 app.js NOTES_HINT: the notes prompt follows the kind picked.
const NOTES_HINT: Record<string, string> = {
  bird: 'Behaviour, plumage, who you were with…',
  mammal: 'Behaviour, tracks, who you were with…',
  reptile: 'Basking, size, behaviour…',
  frog: 'Calling, weather, where it was…',
  butterfly: 'Feeding on, markings, behaviour…',
  plant: 'Flowering, fruit, where it grows…',
};
export const notesHint = (speciesId: number | null) =>
  NOTES_HINT[byId.get(Number(speciesId))?.kind ?? ''] ?? 'What it was doing, who you were with…';

export interface BuildOptions {
  /** The running outing, when 'Add to current outing' is ticked on a new sighting. */
  outing?: Pick<OutingRow, 'id' | 'lat' | 'lng' | 'place'> | null;
  /** The photo the record points at: a new photo's id, or null once she removed it. Left out, the record keeps its own. */
  photoId?: number | null;
}

/**
 * The record v1's sighting sheet writes (js/app.js openSightingSheet, its submit handler).
 *
 * A new sighting has exactly v1's fields, in v1's order: speciesId, count, heard, date, time, lat, lng, acc, place,
 * notes, photoId and outingId (saving adds createdAt, and the database id, uid and updatedAt). An edit starts from the
 * whole stored record, as v1's `{ ...existing }` did, so uid, createdAt, outingUid and anything else survive; it
 * changes lat, lng and acc only when she located it again, and photoId only when the photo changed.
 */
export function buildSighting(
  draft: SightingDraft,
  base: Partial<SightingRow> = {},
  { outing = null, photoId }: BuildOptions = {},
): { rec?: SightingInput; error?: string } {
  if (!draft.speciesId) return { error: 'Choose what you saw.' };
  if (!draft.date) return { error: 'Add the date of the sighting.' };

  const isNew = base.id == null;
  const rec: SightingInput = isNew
    ? {
        speciesId: draft.speciesId, count: 1, heard: false, date: draft.date, time: draft.time,
        lat: null, lng: null, acc: null, place: '', notes: '', photoId: null, outingId: null, ...base,
      }
    : ({ ...base } as SightingInput);
  // Where: Use my location, a place chip and Choose on map each set lat, lng and acc together.
  if (isNew || draft.moved) {
    Object.assign(rec, { lat: draft.lat, lng: draft.lng, acc: draft.lat != null ? draft.acc : null });
  }
  Object.assign(rec, {
    speciesId: draft.speciesId,
    count: draft.count ? Math.max(1, parseInt(draft.count, 10) || 1) : null,
    heard: canBeHeard(draft.speciesId) && !!draft.heard,
    date: draft.date,
    time: draft.time,
    place: draft.place.trim(),
    notes: draft.notes.trim(),
  });
  // 'Add to current outing': the sighting joins the outing and takes its place. Its coordinates are the outing's,
  // so a GPS accuracy from earlier no longer describes them.
  if (isNew && outing) {
    Object.assign(rec, { outingId: outing.id, lat: outing.lat ?? null, lng: outing.lng ?? null, acc: null, place: outing.place ?? '' });
  }
  if (photoId !== undefined) rec.photoId = photoId;
  return { rec };
}

/** An object URL for a photo blob, revoked when the blob changes or the form closes. */
export function useObjectUrl(blob: Blob | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

interface PhotoFieldProps {
  /** The photo's preview URL, or '' when the sighting has none. */
  url: string;
  onPick: (file: File) => void;
  onRemove: () => void;
}

/**
 * v1's photo field: a 72 px thumbnail, Add photo or Replace photo, and Remove (hidden while there is no photo), with
 * v1's data-photo-* hooks. The picker is a real button, so it can be reached with Tab (v1's was a label around a
 * hidden input), and Remove hands focus back to it instead of leaving it on a button that has just been hidden.
 */
export function PhotoField({ url, onPick, onRemove }: PhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  return (
    <div className="photo-field">
      <div className="photo-preview" data-photo-preview="">{url ? <img src={url} alt="Your photo" /> : null}</div>
      <button type="button" className="btn" ref={add} onClick={() => input.current?.click()}>
        <Icon name="cam" /> <span data-photo-label="">{url ? 'Replace photo' : 'Add photo'}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        data-photo-input=""
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        className={`btn btn--quiet${url ? '' : ' hidden'}`}
        data-photo-remove=""
        onClick={() => {
          onRemove();
          add.current?.focus({ preventScroll: true });
        }}
      >
        Remove
      </button>
    </div>
  );
}
