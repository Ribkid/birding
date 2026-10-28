// The outing tally's write queue. Each + and − counts at once as a pending change for that species, and one writer
// per outing stores the combined changes in turn, so quick taps on a flock are never dropped. (The tally used to
// ignore a tap while the one before it was still being written: with a big history, ten quick taps counted five.)
//
// A row shows the record as last known plus the changes not stored yet. "Last known" is the shared store's record,
// or the one this queue has just written while the store reads it back. The writer goes through the app's own save
// functions, with the record shape they always had:
//   - a species not on the outing yet: one new sighting holding the whole pending count (saveSighting);
//   - a species already on it: the same record with its new count (db.put);
//   - a count that reaches 0: the sighting is deleted (deleteSighting).
// A write that fails is taken back off the row and reported once.
//
// Taps not stored yet are also noted, as they happen, in a small journal (localStorage, which a page that is closed
// mid-write still keeps): the count each row should end at, and which stored counts are this tally's own. When the
// page is closed or killed before the writer is done (on a busy phone the page can go before pagehide even runs),
// recoverTallies() finishes the job on the next start, through the same save functions. It only ever moves a stored
// count that this tally wrote or started from, so an edit made anywhere else since is left alone.
//
// This file has no imports at run time, so the tests drive it with a fake writer (useTally.ts gives it the real one).
import type { OutingRow, SightingInput, SightingRow } from './shared';

/** How the queue writes. useTally.ts passes the app's saveSighting, db.put, deleteSighting, kv and toast. */
export interface TallyIO {
  /** Saves a new sighting and resolves to its id (saveSighting, quietly: a first sighting gets no card). */
  create: (rec: SightingInput) => Promise<number>;
  /** Stores an existing sighting again (db.put, which gives it a new updatedAt and an outbox entry). */
  update: (rec: SightingRow) => Promise<unknown>;
  /** Deletes a sighting and its photo (deleteSighting). */
  remove: (rec: SightingRow) => Promise<void>;
  /** Marks the outing as the running one after a + (the kv activeOuting entry). */
  markActive: (outingId: number) => Promise<unknown>;
  /** Says that a count didn't save. */
  failed: () => void;
  now: () => number;
  /** Where taps not stored yet are noted (useTally.ts: localStorage). */
  journal?: TallyJournal;
  /** Writes wait for this first: the last visit's unsaved taps being stored (recoverTallies). */
  ready?: Promise<unknown>;
}

/** One species' taps not stored yet, as the journal keeps them. */
export interface JournalEntry {
  /** The sighting being counted, or null while its first save hasn't landed. */
  id: number | null;
  /** Its createdAt: how a first save that landed unseen is found again. */
  createdAt: number;
  /** The count the row showed: what the sighting should end at (0: deleted). */
  count: number;
  /** Stored counts this tally wrote or started from: the only ones recovery moves. */
  safe: (number | null)[];
  at: number;
}
export type JournalData = Record<string, Record<string, JournalEntry>>;
export interface TallyJournal {
  read: () => JournalData;
  /** Notes a species' entry, or clears it with null. */
  write: (outingId: number, speciesId: number, entry: JournalEntry | null) => void;
}

/** One species on the tally, as the row shows it. */
export interface TallyCount {
  speciesId: number;
  /** The number on the row: null when the stored sighting has no count (drawn as X). */
  count: number | null;
  /** The sighting the next change is written to, or null while the species is not stored yet. */
  rec: SightingRow | null;
  /** Taps not stored yet, waiting or being written. */
  unsaved: number;
  /** When it joined the outing, for the order of the rows (newest first). */
  createdAt: number;
}

/** What this queue last wrote for a species: the record, or the id it deleted. */
type Known = { rec: SightingRow } | { gone: number };

const pad = (n: number) => String(n).padStart(2, '0');
/** When db.js last wrote a record (it sets updatedAt on every write). */
const writtenAt = (r: SightingRow) => Number((r as { updatedAt?: unknown }).updatedAt) || 0;
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The sighting the outing has always written for a new species, with these fields in this order. */
export function freshSighting(o: OutingRow, speciesId: number, count: number, at: number): SightingInput {
  return {
    speciesId,
    count,
    heard: false,
    date: o.date,
    time: o.past || o.endedAt ? o.time : clock(at),
    lat: o.lat ?? null,
    lng: o.lng ?? null,
    acc: null,
    place: o.place ?? '',
    notes: '',
    photoId: null,
    outingId: o.id,
    createdAt: at,
  };
}

export class TallyQueue {
  outing: OutingRow;
  private io: TallyIO;
  /** The shared store's sighting per species on this outing (Outing.tsx's tally). */
  private stored = new Map<number, SightingRow>();
  private pending = new Map<number, number>();
  private inflight = new Map<number, number>();
  private known = new Map<number, Known>();
  /** When she first tapped a species that isn't stored yet: its createdAt, and its time on a live outing. */
  private started = new Map<number, number>();
  private writing: Promise<void> | null = null;
  private waited = false;
  private subs = new Set<() => void>();
  private version = 0;

  constructor(outing: OutingRow, io: TallyIO) {
    this.outing = outing;
    this.io = io;
  }

  // ---------- for React (useSyncExternalStore) ----------
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
  getVersion = () => this.version;
  private bump() {
    this.version += 1;
    for (const fn of this.subs) {
      try { fn(); } catch { /* one broken subscriber must not stop the others */ }
    }
  }

  // What it wrote is forgotten once the store holds that write or a newer one: the store's reads run one after another,
  // so once it has the write it never goes back to an older copy. A delete is never forgotten. A store without the
  // record may not have read it yet (a first save and its delete close together), and base() already takes any other
  // record of the species over it.

  /** True while it holds a write the store hasn't read back yet. */
  waiting() {
    for (const k of this.known.values()) if ('rec' in k) return true;
    return false;
  }

  /**
   * The store's sightings by record id, after every change to the store, whether or not the outing is on screen.
   * Without it, a write that landed after she left the outing stayed "last known" until she came back, so a sighting
   * deleted elsewhere meanwhile showed again on the outing, and the next + there wrote it back.
   */
  catchUp(find: (recId: number) => SightingRow | undefined) {
    let changed = false;
    for (const [id, k] of this.known) {
      if (!('rec' in k)) continue;
      const s = find(k.rec.id);
      if (s && writtenAt(s) >= writtenAt(k.rec)) {
        this.known.delete(id);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  /** The store's sightings per species, as the rows draw them (Outing.tsx's tally). */
  setStored(stored: Map<number, SightingRow>) {
    this.stored = stored;
    for (const [id, k] of this.known) {
      if (!('rec' in k)) continue;
      const s = stored.get(id);
      if (s && s.id === k.rec.id && writtenAt(s) >= writtenAt(k.rec)) this.known.delete(id);
    }
  }

  /** The sighting a species' next change applies to: what this queue wrote, unless the store has something newer. */
  private base(id: number, stored = this.stored): SightingRow | null {
    const s = stored.get(id) ?? null;
    const k = this.known.get(id);
    if (!k) return s;
    if ('gone' in k) return s && s.id !== k.gone ? s : null;
    if (s && s.id === k.rec.id && writtenAt(s) > writtenAt(k.rec)) return s;
    return k.rec;
  }

  private unsaved(id: number) {
    return (this.pending.get(id) ?? 0) + (this.inflight.get(id) ?? 0);
  }

  /** What the row for a species shows, or null when it isn't on the tally (never added, or counted down to 0). */
  countOf(id: number, stored = this.stored): TallyCount | null {
    const rec = this.base(id, stored);
    const unsaved = this.unsaved(id);
    if (!rec) {
      return unsaved > 0 ? { speciesId: id, count: unsaved, rec: null, unsaved, createdAt: this.started.get(id) ?? 0 } : null;
    }
    const createdAt = rec.createdAt ?? 0;
    if (!unsaved) return { speciesId: id, count: rec.count ?? null, rec, unsaved, createdAt };
    const count = (rec.count ?? 1) + unsaved;
    return count > 0 ? { speciesId: id, count, rec, unsaved, createdAt } : null;
  }

  /** Every species on the tally, newest first, as the rows show them. */
  view(stored = this.stored): TallyCount[] {
    const ids = new Set<number>([...stored.keys(), ...this.known.keys(), ...this.inflight.keys(), ...this.pending.keys()]);
    const rows: TallyCount[] = [];
    for (const id of ids) {
      const row = this.countOf(id, stored);
      if (row) rows.push(row);
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * One tap (or a flock from the hold chooser): counts at once and starts the writer if it is idle. A − never takes
   * a row below 0. Resolves nothing; flush() waits for the writes.
   */
  tap(id: number, delta: number) {
    const now = this.countOf(id);
    const shown = now ? (now.count ?? 1) : 0;
    let d = Math.trunc(delta);
    if (shown + d < 0) d = -shown;
    if (!d) return;
    if (!now?.rec && !this.started.has(id)) this.started.set(id, this.io.now());
    this.pending.set(id, (this.pending.get(id) ?? 0) + d);
    this.note(id);
    this.bump();
    this.kick();
  }

  /** Brings a species' journal entry up to date: what its row shows, until nothing is left to store. */
  private note(id: number) {
    const journal = this.io.journal;
    if (!journal) return;
    if (!this.unsaved(id)) {
      journal.write(this.outing.id, id, null);
      return;
    }
    const base = this.base(id);
    const row = this.countOf(id);
    const safe: (number | null)[] = base ? [base.count ?? null] : [];
    const flying = this.inflight.get(id);
    if (flying) safe.push(base ? Math.max(0, (base.count ?? 1) + flying) : flying);
    journal.write(this.outing.id, id, {
      id: base?.id ?? null,
      createdAt: base ? base.createdAt ?? 0 : this.started.get(id) ?? 0,
      count: row ? row.count ?? 1 : 0,
      safe,
      at: this.io.now(),
    });
  }

  /** Resolves once every tap so far is stored (or has failed and been taken back). */
  async flush(): Promise<void> {
    this.kick();
    while (this.writing) await this.writing;
  }

  /** Forgets the taps not being written yet and waits for the write in progress (Discard deletes them all anyway). */
  async drop(): Promise<void> {
    if (this.pending.size) {
      const ids = [...this.pending.keys()];
      for (const id of ids) if (!this.base(id) && !this.inflight.has(id)) this.started.delete(id);
      this.pending.clear();
      for (const id of ids) this.note(id);
      this.bump();
    }
    while (this.writing) await this.writing;
  }

  /** True while taps are waiting or being written. */
  busy() {
    return !!this.writing || this.pending.size > 0;
  }

  private kick() {
    if (this.writing || !this.pending.size) return;
    this.writing = this.run().finally(() => {
      this.writing = null;
      this.kick();
    });
  }

  // The writer: takes everything pending as one batch, writes each species' combined change in turn, then takes
  // whatever came in meanwhile.
  private async run() {
    if (!this.waited && this.io.ready) {
      this.waited = true;
      try { await this.io.ready; } catch { /* nothing to recover */ }
    }
    while (this.pending.size) {
      const batch = [...this.pending];
      this.pending.clear();
      for (const [id, d] of batch) this.inflight.set(id, d);
      let added = false;
      let failed = false;
      for (const [id, d] of batch) {
        try {
          // Taps that cancel out (+ then −) write nothing.
          if (d) await this.write(id, d);
          if (d > 0) added = true;
        } catch {
          failed = true; // the change comes off the row with the inflight entry below
        }
        this.inflight.delete(id);
        if (this.base(id) || !this.unsaved(id)) this.started.delete(id);
        this.note(id);
        this.bump();
      }
      if (added && !this.outing.endedAt) {
        try { await this.io.markActive(this.outing.id); } catch { /* the count itself is stored */ }
      }
      if (failed) this.io.failed();
    }
  }

  private async write(id: number, d: number) {
    const rec = this.base(id);
    if (rec) {
      const to = (rec.count ?? 1) + d;
      if (to <= 0) {
        await this.io.remove(rec);
        this.known.set(id, { gone: rec.id });
        return;
      }
      const next: SightingRow = { ...rec, count: to };
      await this.io.update(next);
      this.known.set(id, { rec: next });
      return;
    }
    if (d <= 0) return;
    const fresh = freshSighting(this.outing, id, d, this.started.get(id) ?? this.io.now());
    const newId = await this.io.create(fresh);
    this.known.set(id, { rec: { ...fresh, id: newId } as SightingRow });
  }
}

/** How recoverTallies reads and writes: the database through the app's own functions, and the journal. */
export interface RecoverIO {
  journal: TallyJournal;
  getOuting: (id: number) => Promise<OutingRow | undefined>;
  /** The sightings on an outing, from the database itself. */
  onOuting: (id: number) => Promise<SightingRow[]>;
  /** Saves a new sighting without the celebration (the tap that started it happened on an earlier visit). */
  add: (rec: SightingInput) => Promise<unknown>;
  update: (rec: SightingRow) => Promise<unknown>;
  remove: (rec: SightingRow) => Promise<void>;
}

/**
 * Stores the taps an earlier visit noted but never stored (the page closed or was killed mid-write). Each entry says
 * the count its sighting should end at. A sighting whose stored count is one this tally wrote or started from is
 * moved to it (or deleted at 0); a first save that never landed is made now; anything changed elsewhere since, or an
 * outing that is gone, is left alone. An entry is cleared once handled, or kept for next time if its write fails.
 */
export async function recoverTallies(io: RecoverIO): Promise<void> {
  const all = io.journal.read();
  for (const [o, entries] of Object.entries(all)) {
    const outingId = Number(o);
    const outing = await io.getOuting(outingId).catch(() => undefined);
    const recs = outing ? await io.onOuting(outingId).catch(() => null) : [];
    if (!recs) continue;
    for (const [sp, e] of Object.entries({ ...entries })) {
      const speciesId = Number(sp);
      try {
        if (outing) {
          const rec = e.id != null
            ? recs.find((r) => r.id === e.id)
            : recs.find((r) => r.speciesId === speciesId && (r.createdAt ?? 0) === e.createdAt);
          if (!rec) {
            if (e.id == null && e.count > 0) await io.add(freshSighting(outing, speciesId, e.count, e.createdAt || e.at));
          } else if ((rec.count ?? null) !== e.count && e.safe.includes(rec.count ?? null)) {
            if (e.count <= 0) await io.remove(rec);
            else await io.update({ ...rec, count: e.count });
          }
        }
        io.journal.write(outingId, speciesId, null);
      } catch {
        /* kept for the next start */
      }
    }
  }
}
