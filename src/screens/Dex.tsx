// The dex home (v1 js/app.js renderDex): today's pick full-bleed with the wordmark and her count, then a sheet with
// the kind rail (the tally), the Today rail, the sticky search tools and the grid.
import {
  memo, startTransition, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ANIMALS, ANIMAL_KINDS, GROUPS, HABITATS, KINDS, RARITY, SPECIES, byId, dexCode, inSeason, kindsPresent, ofKind,
  pluralFor, type Species,
} from '../lib/data';
import { useDexReady, useKindCounts, useLastSeen, useMedia, useSeen } from '../lib/hooks';
import { countIn, tierNote, useTiers } from '../lib/tiers';
import { seqSettled } from '../lib/seq';
import { keepFocus } from '../lib/layers';
import { countUp, flip, motionOK } from '../lib/motion';
import { applyTint, stagger, tintFrom } from '../lib/look';
import { Band, Pips } from '../components/SpeciesImage';
import { Icon } from '../components/Icon';
import { db } from '../core/db.js';
import { sized } from '../core/media.js';
import { targets } from '../core/stats.js';
import { likelihood, seq, spotsFor } from '../core/seqdata.js';
import { relRate } from '../core/quiz.js';
import { photoIdInfo } from '../core/scan.js';
import { onAuth } from '../core/cloud.js';
import { onStatus, syncStatus } from '../core/account.js';
import { avatarUrl, getMyCloud, getProfile, myName, signedIn } from '../core/profile.js';
import { currentStreak, dayStr, dueCards, getDaily, getLearn, learnReady, monthName } from '../core/learn.js';
import { openSearch } from './DexSearch';
import { openSightingSheet } from '../components/SightingSheet';
import { ICON, Photo, Ring } from './dexParts';
import { promptInstall, useCanInstall } from '../lib/install';
import { landingScroll } from '../components/RouteMotion';
import { drawFirst, groupKey, rememberLeaving, rememberedBox, rememberedContent } from './dexMemory';
import { announce } from '../lib/toast';

// Heard only and No photo yet sit with the show filters: species she has only heard, and ones she has logged
// without a photo of her own (lib/tiers.ts).
type Show = 'all' | 'seen' | 'unseen' | 'heard' | 'nophoto';
type Sort = 'dex' | 'name' | 'rarity' | 'recent';
type Layout = 'grid' | 'list';
interface DexFilters {
  kind: string; q: string; show: Show; sort: Sort; layout: Layout;
  rarity: string; habitat: string; group: string; season: boolean;
}
interface DayPick { sp: Species; label: string; why: string; where: string }

// Filters, sort, kind and layout hold for the session, as v1's state.dex did.
const saved: DexFilters = { kind: 'animals', q: '', show: 'all', sort: 'dex', layout: 'grid', rarity: '', habitat: '', group: '', season: false };
// The species page's Group link passes { dexFilter } as router state (v1 set state.dex on that tap). It is applied
// once per history entry, so coming Back to that entry later keeps whatever she has changed since.
const appliedLinks = new Set<string>();

const inScope = (s: Species, scope: string) => (scope === 'all' ? true : scope === 'animals' ? s.kind !== 'plant' : s.kind === scope);
const scopeNoun = (scope: string, n: number) => (scope === 'all' ? 'species' : pluralFor(scope, n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listWords = (list: string[], and = 'and') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`);
const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const targetOpts = () => ((seq() as { hotspots?: unknown[] } | null)?.hotspots?.length ? { score: likelihood, rel: relRate } : {});

// '<Kind> of the day' follows the kind tab (a bird for All animals). The pick holds all day; it is worked out once per
// day, tab and dex size, not on every keystroke in the filter.
let dayMemo: { key: string; pick: DayPick | null } = { key: '', pick: null };
function dayPick(seen: Set<number>, scope: string): DayPick | null {
  const k = scope === 'animals' || scope === 'all' ? 'bird' : scope;
  const now = new Date(), month = now.getMonth() + 1, today = todayStr(now);
  const memo = `${today} ${k} ${seen.size} ${!!seq()}`;
  if (dayMemo.key === memo) return dayMemo.pick;
  let pool = (targets as unknown as (a: object) => Species[])({ seen, month, kinds: [k], ...targetOpts() }).slice(0, 40);
  if (!pool.length) pool = ofKind(k);
  let pick: DayPick | null = null;
  if (pool.length) {
    const sp = pool[(Number(today.replace(/-/g, '')) * 2654435761 >>> 0) % pool.length];
    const spot = (spotsFor(sp.id, 1) as { h: { name: string } }[])[0];
    const when = k === 'plant' && sp.season && inSeason(sp, month) ? 'Flowering now' : (relRate(sp.id, month) ?? 0) >= 0.8 ? 'Often reported right now' : 'Around this month';
    // The hero already names it; the Today card says why today and where to look.
    const why = seen.has(sp.id) ? 'One of yours' : when;
    const where = spot ? `Try ${spot.h.name}` : seen.has(sp.id) ? 'Say hello again today' : 'Keep an eye out this month';
    pick = { sp, label: `${cap(KINDS[k].one)} of the day`, why, where };
  }
  dayMemo = { key: memo, pick };
  return pick;
}

// What photo ID covers (from photoid.json, read once), so Scan isn't offered for kinds it can't name.
let photoKinds: string[] | null = null;
function scanSub(scope: string) {
  const single = scope !== 'animals' && scope !== 'all';
  const pk = photoKinds || [];
  const missing = single && pk.length && !pk.includes(scope);
  const all = pk.length && kindsPresent.every((k) => pk.includes(k));
  return missing ? `Not for ${KINDS[scope].label.toLowerCase()} yet` : all || !pk.length ? 'Name it from a photo'
    : `${cap(listWords(pk.map((k) => KINDS[k].label.toLowerCase())))} by photo`;
}

// Off-screen groups skip rendering until they're near (content-visibility); this is their size until then, unless
// the dex remembers the height they really had when she left it (dexMemory.ts).
function groupSize(n: number, layout: Layout) {
  if (layout === 'list') return 52 + n * 69;
  const w = Math.min(innerWidth, 760) - 32, min = innerWidth >= 700 ? 130 : 104;
  const cols = Math.max(1, Math.floor((w + 10) / (min + 10))), rows = Math.ceil(n / cols);
  return 60 + rows * ((w - (cols - 1) * 10) / cols + 64) + (rows - 1) * 16;
}

// A count that changed since the last draw (a new sighting) counts up and its ring sweeps on; the first draw of a
// session fills every ring from empty and stamps the hero's number up from nothing.
let dexCounts: Record<string, number> | null = null;
function sweepRing(svg: Element | null | undefined, from: number, to: number) {
  const c = svg?.querySelector('.ring-fill');
  if (c && motionOK()) c.animate([{ strokeDashoffset: 100 - from * 100 }, { strokeDashoffset: 100 - to * 100 }], { duration: 700, delay: 200, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
}
function countKindTabs(view: HTMLElement) {
  const now: Record<string, number> = {};
  const first = !dexCounts;
  if (first) { view.classList.add('rings-in'); setTimeout(() => view.classList.remove('rings-in'), 1400); }
  for (const b of view.querySelectorAll<HTMLElement>('[data-kn]')) {
    const k = b.closest<HTMLElement>('[data-kind]')!.dataset.kind!, n = Number(b.dataset.kn), of = Math.max(1, Number(b.dataset.of));
    const was = dexCounts?.[k];
    now[k] = n;
    if (was == null || was === n) continue;
    void countUp(b, was, n, { delay: 200 });
    sweepRing(b.closest('.kind-tab')?.querySelector('.kind-ring'), was / of, n / of);
  }
  const capn = view.querySelector<HTMLElement>('[data-capn]');
  if (capn) {
    now.cap = Number(capn.dataset.capn);
    if (first) void countUp(capn, 0, now.cap, { delay: 250, duration: 900 });
    else if (dexCounts!.cap !== now.cap) void countUp(capn, dexCounts!.cap, now.cap, { delay: 150 });
  }
  dexCounts = now;
}

/**
 * After a long press has opened the Log a sighting sheet, the click that lifting that finger (or mouse button) makes is
 * dropped wherever it lands, with the mousedown a touch sends before it, which would move focus. The sheet slides up
 * under the finger, so otherwise that click can tick Heard only or press Change. v1 only dropped it on the tile.
 */
function dropReleaseClick(pointerId: number) {
  const opts = { capture: true } as const;
  let stop = 0;
  let released = false;
  const off = () => {
    clearTimeout(stop);
    document.removeEventListener('click', drop, opts);
    document.removeEventListener('mousedown', press, opts);
    document.removeEventListener('pointerup', up, opts);
    document.removeEventListener('pointercancel', up, opts);
  };
  const drop = (e: globalThis.MouseEvent) => { e.preventDefault(); e.stopPropagation(); off(); };
  const press = (e: globalThis.MouseEvent) => { if (released) { e.preventDefault(); e.stopPropagation(); } };
  const up = (e: globalThis.PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (e.type === 'pointercancel') { off(); return; }
    // The click follows the release at once; a release that makes none leaves nothing waiting.
    released = true;
    clearTimeout(stop);
    stop = window.setTimeout(off, 400);
  };
  document.addEventListener('click', drop, opts);
  document.addEventListener('mousedown', press, opts);
  document.addEventListener('pointerup', up, opts);
  document.addEventListener('pointercancel', up, opts);
  stop = window.setTimeout(off, 10000);
}

/** v1 accountChip: her avatar and sync dot, linking to Me, once she is signed in. */
function AccountChip() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [sync, setSync] = useState(() => syncStatus() as { state: string });
  useEffect(() => {
    const offAuth = onAuth(() => force());
    const offStatus = onStatus((st: { state: string }) => setSync(st));
    return () => { offAuth(); offStatus(); };
  }, []);
  if (!signedIn()) return null;
  const name = myName() as string;
  const path = getMyCloud()?.avatarPath || null;
  const sp = byId.get(Number(getProfile()?.avatarSpeciesId));
  return (
    <Link className="acct-chip" to="/me" aria-label={`Your profile: ${name}`}>
      <span className={`acct-av${path ? ' acct-av--photo' : ''}`} aria-hidden="true">
        {path ? <img src={avatarUrl(path)} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.remove()} />
          : sp ? <Photo sp={sp} /> : <span className="acct-av-letter">{(name || '?').slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="acct-chip-name">{name}</span>
      <i className={`acct-dot acct-dot--${sync.state}`} aria-hidden="true" />
    </Link>
  );
}

/** v1 learnTeaser: today's challenge, the streak and cards due, from what learnReady() has loaded. */
function LearnTeaser() {
  // It draws again when Learn's data arrives, on its own, so the dex around it does not.
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let alive = true;
    void learnReady().then(() => { if (alive) force(); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const L = getLearn();
  const D = getDaily();
  if (!L || !D) {
    return <Link className="lt" to="/learn"><span className="lt-main"><strong>Learn</strong><span>Today's challenge, quizzes and your review deck</span></span></Link>;
  }
  const today = dayStr();
  const picks: { right: boolean }[] = D.today?.date === today ? D.today.picks : [];
  const done = D.history[today] != null;
  const status = done ? `Done for today: ${D.history[today]} of 5` : picks.length ? `${picks.length} of 5 answered` : `Five species around in ${monthName()}`;
  const streak = currentStreak() as number, due = dueCards().length;
  return (
    <div className="lt-wrap">
      <Link className="lt" to="/learn/daily">
        <span className="lt-pips" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => {
            const p = picks[i];
            return <i key={i} className={p ? (p.right ? 'is-right' : 'is-wrong') : ''}>{p ? (p.right ? ICON.tick : ICON.cross) : null}</i>;
          })}
        </span>
        <span className="lt-main"><strong>Today's challenge</strong><span>{status}</span></span>
        {streak ? <span className="lt-streak"><b>{streak}</b><span>{streak === 1 ? 'day' : 'days'} in a row</span></span> : null}
      </Link>
      {due ? <Link className="lt-due" to="/learn/deck">{ICON.deck}<span><b>{due}</b> {due === 1 ? 'card' : 'cards'} to review</span></Link> : null}
    </div>
  );
}


/** The Today rail's Scan card: its line says what photo ID covers once photoid.json has been read (on its own). */
function ScanCard({ kind }: { kind: string }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (photoKinds) return;
    let alive = true;
    void photoIdInfo().then((info: { kinds: string[] }) => {
      if (!info.kinds.length) return;
      photoKinds = info.kinds;
      if (alive) force();
    });
    return () => { alive = false; };
  }, []);
  return <Link className="today-card today-tool" to="/scan">{todayTool(<Icon name="scan" />, 'Scan a photo', scanSub(kind))}</Link>;
}
const todayTool = (ic: ReactNode, title: string, sub: string) => (
  <><span className="today-ic">{ic}</span><span className="today-t"><strong>{title}</strong><span>{sub}</span></span></>
);

/** Today: one snapping row of cards. Install, Listen and Scan, Learn, and the pick of the day (photo-backed). */
const TodayRail = memo(function TodayRail({ kind, day }: { kind: string; day: DayPick | null }) {
  const install = useCanInstall();
  const single = kind !== 'animals' && kind !== 'all';
  const [lt, ls] = single && kind !== 'bird' ? ['Listen (birds)', kind === 'frog' ? 'Frog calls to compare' : 'Birds by call'] : ['Listen', 'Birds by call'];
  return (
    <section className="today" aria-label="Today">
      {install ? <button type="button" className="today-card today-tool" onClick={() => void promptInstall()}>{todayTool(ICON.install, 'Install', 'Add to your home screen')}</button> : null}
      <Link className="today-card today-tool" to="/listen">{todayTool(<Icon name="mic" />, lt, ls)}</Link>
      <ScanCard kind={kind} />
      <LearnTeaser />
      {day ? (
        <Link className={`today-card today-day kind--${day.sp.kind}`} to={`/bird/${day.sp.id}`}>
          <span className="botd-img"><Photo sp={day.sp} /></span>{' '}
          <span className="today-day-txt">
            <span className="today-day-k">{day.why}</span>
            <strong>{day.sp.name}</strong>
            <span>{day.where}</span>
            <span className="sr-only">, {day.label.toLowerCase()}</span>
          </span>
        </Link>
      ) : null}
    </section>
  );
});

/**
 * Today's pick full-bleed with the wordmark and her count. It follows the photo index on its own (useMedia), so a
 * better photo arriving redraws the hero, not the dex.
 */
const DexHero = memo(function DexHero({ day, got, n, kind, photo, heard }: {
  day: DayPick | null; got: number; n: number; kind: string;
  /** Photographed and heard-only species in the kind tab; heard is null for plants, which can't be heard. */
  photo: number; heard: number | null;
}) {
  useMedia();
  const heroRef = useRef<HTMLElement>(null);
  // The hero takes its colour from the pick's photo where the host allows it to be read. A new pick starts plain; a
  // better photo of the same pick arriving keeps the colour it has until the new photo has been read (in v1 the
  // swapped-in photo kept the first tint), and a pick that has since changed never takes an older pick's colour.
  const heroSrc = day ? (sized(day.sp.id, 'large') as string | null) || '' : '';
  const heroId = day ? day.sp.id : null;
  const tintedFor = useRef<number | null>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    if (tintedFor.current !== heroId) {
      for (const k of ['--tint', '--tint-deep', '--tint-soft', '--tint-soft-dark', '--tint-ink-dark']) hero.style.removeProperty(k);
      hero.classList.remove('tinted');
      tintedFor.current = heroId;
    }
    if (!heroSrc) return;
    let alive = true;
    void tintFrom(heroSrc).then(() => { if (alive) void applyTint(hero, heroSrc); });
    return () => { alive = false; };
  }, [heroSrc, heroId]);
  return (
    <header ref={heroRef} className={`dex-hero kind--${day ? day.sp.kind : 'bird'}`}>
      <div className="dex-hero-photo" aria-hidden="true">{day && <Photo sp={day.sp} size="large" eager />}</div>
      <div className="dex-hero-top">
        {day ? <Link className="dex-hero-pick" to={`/bird/${day.sp.id}`}><span>{day.label}</span><strong>{day.sp.name}</strong></Link> : <span />}
        <div className="dex-hero-actions">
          <AccountChip />
          <button type="button" className="hero-btn glass" data-search aria-label="Search everything" onClick={() => openSearch('')}>{ICON.search}</button>
          <Link className="hero-btn glass" to="/settings" aria-label="Settings">{ICON.gear}</Link>
        </div>
      </div>
      <div className="dex-hero-foot">
        <h1 className="wordmark">Sarah's BirdyDex<small>South East Queensland</small></h1>
        <p className="dex-cap glass">
          <Ring p={got / n} cls="dex-cap-ring" />
          <span className="dex-cap-txt">
            <span><b data-capn={got} style={digits(got)}>{got}</b> of {n} {scopeNoun(kind, n)} {kind === 'plant' ? 'found' : 'seen'}</span>
            {/* A quiet second line once she has logged something here: how many have her photo, how many are only heard. */}
            {got ? (
              <span className="dex-cap-sub" data-cap-tiers>
                <span className="sr-only">, </span>{photo} photographed
                {heard != null ? <><span aria-hidden="true"> · </span><span className="sr-only">, </span>{heard} heard only</> : null}
              </span>
            ) : null}
          </span>
        </p>
      </div>
    </header>
  );
});

// One tile or row per species, drawn again only when what it shows changes: whether she has seen it, whether she has
// only heard it or has her own photo of it (lib/tiers.ts), and for a row, which second line it carries. Photos
// follow the photo index on their own (SpeciesImage). The link is a plain one: a tap is handled once for the whole
// dex (Dex's onClick), and Ctrl, Cmd, Shift or a middle click open a new tab. The spaces between the parts are v1's,
// so the link reads '028 Tawny Frogmouth, not seen' as text too.
interface ItemProps { id: number; seen: boolean; heard: boolean; photo: boolean }
const seenNote = (seen: boolean, heard: boolean, photo: boolean) => <span className="sr-only">{tierNote(seen, heard, photo)}</span>;

/**
 * When a tile's tier changes while the dex is open (she logs a heard-only bird as seen from the long-press sheet, or a
 * photo arrives), its new mark stamps in, so she sees what her sighting changed. Not on the first draw, and not under
 * reduced motion.
 */
function useTierStamp(ref: { current: HTMLElement | null }, seen: boolean, heard: boolean, photo: boolean) {
  const was = useRef({ seen, heard, photo });
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { seen, heard, photo };
    const el = ref.current;
    if (!el || !motionOK() || typeof el.animate !== 'function') return;
    const stamp = [{ transform: 'scale(.4) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }];
    const timing = { duration: 460, easing: 'cubic-bezier(.2, .8, .2, 1)' };
    if (seen && before.seen && heard !== before.heard) {
      const ear = el.querySelector<HTMLElement>('.tile-ear');
      if (ear) ear.animate(stamp, timing);
      else el.querySelector('.tile-img')?.animate(stamp, { ...timing, pseudoElement: '::before' });
    }
    if (photo && !before.photo) el.querySelector('.tile-stamp')?.animate(stamp, { ...timing, delay: 80 });
  }, [ref, seen, heard, photo]);
}

const TileItem = memo(function TileItem({ id, seen, heard, photo }: ItemProps) {
  const s = byId.get(id)!;
  const ref = useRef<HTMLAnchorElement>(null);
  const heardOnly = seen && heard;
  const photographed = seen && photo;
  useTierStamp(ref, seen, heardOnly, photographed);
  return (
    <li>
      <a
        ref={ref}
        className={`tile kind--${s.kind} ${seen ? 'tile--seen' : ''}${heardOnly ? ' tile--heard' : ''}${photographed ? ' tile--photo' : ''}`}
        href={`#/bird/${id}`}
        data-tile={id}
      >
        <span className="tile-img">
          <Photo sp={s} />
          {/* One mark per corner: the ear takes the tick's place top right, her photo's stamp sits bottom left. */}
          {heardOnly ? <span className="tile-mark tile-ear">{ICON.ear}</span> : null}
          {photographed ? <span className="tile-mark tile-stamp">{ICON.camera}</span> : null}
        </span>{' '}
        <Band sp={s} seen={seen} />{' '}
        <span className="tile-name">{s.name}{seenNote(seen, heardOnly, photographed)}</span>
      </a>
    </li>
  );
});
// Under a group heading the group name would repeat on every row, so rows show the scientific name instead.
const RowItem = memo(function RowItem({ id, seen, heard, photo, sci }: ItemProps & { sci: boolean }) {
  const s = byId.get(id)!;
  const heardOnly = seen && heard;
  const photographed = seen && photo;
  return (
    <li>
      <a className={`row row--sp kind--${s.kind}`} href={`#/bird/${id}`} data-tile={id}>
        <span className={`row-thumb ${seen ? 'row-thumb--seen' : ''}${heardOnly ? ' row-thumb--heard' : ''}`}><Photo sp={s} /></span>{' '}
        <span className="row-main">
          <strong>{s.name}{seenNote(seen, heardOnly, photographed)}</strong>
          <span className="muted small">{sci ? <i>{s.sci}</i> : GROUPS[s.group]}</span>
        </span>
        <Pips rarity={s.rarity} />{' '}
        {/* The ear and camera hang under the band, so the pips and bands stay in their columns down the list. */}
        <span className="row-band">
          <Band sp={s} seen={seen} />
          {heardOnly || photographed ? (
            <span className="row-marks">
              {heardOnly ? <span className="row-mark row-mark--ear">{ICON.ear}</span> : null}
              {photographed ? <span className="row-mark row-mark--photo">{ICON.camera}</span> : null}
            </span>
          ) : null}
        </span>
      </a>
    </li>
  );
});

/** A counted number's final width in digits, so the words after it hold still while it counts (screens.css). */
const digits = (n: number) => ({ '--digits': String(n).length }) as CSSProperties;

/** Seen species in a kind tab's scope, from the store's per-kind counts. */
function seenIn(scope: string, counts: Map<string, number>) {
  if (scope === 'all' || scope === 'animals') {
    let n = 0;
    for (const [k, c] of counts) if (scope === 'all' || k !== 'plant') n += c;
    return n;
  }
  return counts.get(scope) ?? 0;
}

export default function Dex() {
  // Her records come from the shared store, already in when the dex first draws (lib/store.ts); `ready` is false
  // only while a cold start is still waiting for them (or gave up after a moment).
  const ready = useDexReady();
  const seen = useSeen();
  const kindCounts = useKindCounts();
  const lastSeen = useLastSeen();
  const tiers = useTiers();
  const navigate = useNavigate();

  const location = useLocation();
  const entry = useRef(location.key);
  entry.current = location.key;
  // Coming back to where she left this dex (Back from a species page): the groups that were around her are drawn
  // first, where they were, and the others, each held at its height, a moment later, so her tile is back at once and
  // the rest of the 291 never hold up the first frame.
  const [nearOnly, setNearOnly] = useState(() => drawFirst(location.key, landingScroll(location.key)));
  const [f, setF] = useState<DexFilters>(() => {
    const linked = (location.state as { dexFilter?: Partial<DexFilters> } | null)?.dexFilter;
    if (linked && !appliedLinks.has(location.key)) {
      appliedLinks.add(location.key);
      Object.assign(saved, linked);
    }
    return { ...saved };
  });
  const [colourUnseen, setColourUnseen] = useState(false);
  const sayT = useRef(0);
  const countRef = useRef({ n: 0, kind: 'animals' });
  const suppressClick = useRef(false);
  const press = useRef<{ timer: number; x: number; y: number }>({ timer: 0, x: 0, y: 0 });
  const railRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  const month = new Date().getMonth() + 1;
  // Regional data feeds relRate; the app re-renders when it lands.
  const seqData = seq();
  const scopeAll = useMemo(() => SPECIES.filter((s) => inScope(s, f.kind)), [f.kind]);
  const filtersOn = !!(f.habitat || f.group || f.rarity || f.season || f.show !== 'all');

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const shows = (id: number) => (f.show === 'all' ? true
      : f.show === 'seen' ? seen.has(id)
        : f.show === 'unseen' ? !seen.has(id)
          : f.show === 'heard' ? seen.has(id) && tiers.heardOnly.has(id)
            : seen.has(id) && !tiers.photographed.has(id));
    return scopeAll.filter((s) =>
      (!q || `${s.name} ${s.sci} ${dexCode(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one}`.toLowerCase().includes(q)) &&
      shows(s.id) &&
      (!f.group || s.group === f.group) && (!f.habitat || s.habitats.includes(f.habitat)) &&
      (!f.rarity || s.rarity === Number(f.rarity)) &&
      (!f.season || (relRate(s.id, month) ?? (inSeason(s, month) ? 1 : 0)) >= 0.35));
  }, [scopeAll, f.q, f.show, f.group, f.habitat, f.rarity, f.season, seen, tiers, month, seqData]);

  // The tiers in this kind tab, for the hero's second line and the Heard only and No photo yet chips. Plants can't
  // be heard (the log sheet never stores it for them), so their tab has no Heard only.
  const canHear = f.kind !== 'plant';
  const inKind = (id: number) => { const s = byId.get(id); return !!s && inScope(s, f.kind); };
  const heardN = countIn(tiers.heardOnly, (id) => seen.has(id) && inKind(id));
  const photoN = countIn(tiers.photographed, (id) => seen.has(id) && inKind(id));
  const noPhotoN = Math.max(0, seenIn(f.kind, kindCounts) - photoN);

  // The pick is ranked by the regional reporting rates, so (as v1 drew the dex once they were in) it waits for them as
  // well as her sightings; otherwise the hero would show one species and then swap to another a moment later. If the
  // regional data never answers, it goes ahead once the app has waited for it (lib/seq.ts).
  const day = ready && (seqData || seqSettled()) ? dayPick(seen, f.kind) : null;

  // ---------- effects ----------
  useEffect(() => {
    let alive = true;
    const readSettings = () => {
      void db.kvGet('settings').then((s: { colourUnseen?: boolean } | undefined) => { if (alive) setColourUnseen(!!s?.colourUnseen); }).catch(() => {});
    };
    readSettings();
    const offDb = db.onChange((name: string) => { if (name === 'kv:settings') readSettings(); });
    return () => { alive = false; offDb(); clearTimeout(sayT.current); clearTimeout(press.current.timer); };
  }, []);

  // The search tools stick to the top of the screen; once stuck they turn to frosted glass over the tiles.
  useEffect(() => {
    const mark = stickRef.current, tools = toolsRef.current;
    if (!mark || !tools || !('IntersectionObserver' in window)) return;
    tools.classList.toggle('is-stuck', mark.getBoundingClientRect().top < 0);
    const io = new IntersectionObserver(([en]) => tools.classList.toggle('is-stuck', !en.isIntersecting && en.boundingClientRect.top < 0));
    io.observe(mark);
    return () => io.disconnect();
  }, []);

  // Tiles and Today cards come in once per session.
  useEffect(() => {
    const id = requestAnimationFrame(() => stagger(document.getElementById('view'), '.today > .today-card, .today .lt, .today .lt-due, .dex-grid > li, .rows > li', { key: 'dex', max: 16 }));
    return () => cancelAnimationFrame(id);
  }, []);

  // Rings and counts, once her sightings are in, and again when what she has seen changes.
  useLayoutEffect(() => {
    const view = document.getElementById('view');
    if (ready && view) countKindTabs(view);
  }, [ready, f.kind, seen]);

  // Back to a dex she left: the groups held at their heights are drawn once the first frame is up, without
  // holding up the page (a transition yields to her taps and to the browser).
  useEffect(() => {
    if (!nearOnly) return;
    let t = 0;
    const id = requestAnimationFrame(() => { t = window.setTimeout(() => startTransition(() => setNearOnly(null))); });
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On the way out, the groups' heights as she leaves them (the drawn ones exact, the others as the browser holds
  // them), and which of them were on or near the screen.
  useLayoutEffect(() => () => {
    const groups = [...document.querySelectorAll<HTMLElement>('#view .dex-group[data-group-key]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const padding = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, k) => a + (parseFloat(cs[k as 'paddingTop']) || 0), 0);
      return { key: el.dataset.groupKey!, top: r.top, bottom: r.bottom, height: r.height, padding };
    });
    rememberLeaving(entry.current, groups, scrollY, innerHeight);
  }, []);

  // The chosen kind tab is kept in sight.
  useLayoutEffect(() => {
    const rail = railRef.current, on = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (rail && on && (on.offsetLeft < rail.scrollLeft || on.offsetLeft + on.offsetWidth > rail.scrollLeft + rail.clientWidth)) {
      rail.scrollLeft = on.offsetLeft - (rail.clientWidth - on.offsetWidth) / 2;
    }
  }, [f.kind]);

  // ---------- actions ----------
  // v1 sayDexCount: the count goes out through the shared #announce region (lib/toast.ts).
  const say = (delay = 0) => {
    clearTimeout(sayT.current);
    sayT.current = window.setTimeout(() => {
      const { n, kind } = countRef.current;
      announce(`${n} ${scopeNoun(kind, n)}`);
    }, delay);
  };
  const update = (patch: Partial<DexFilters>) => setF((prev) => {
    const next = { ...prev, ...patch };
    Object.assign(saved, next);
    return next;
  });
  // Filters, sorts, kinds and layout: tiles glide to their new places and focus stays on the control she used.
  const redraw = (patch: Partial<DexFilters>) => {
    keepFocus(() => flip(() => flushSync(() => update(patch))), { fallback: '[data-show="all"]' });
    say();
  };
  const reset = () => redraw({ q: '', show: 'all', group: '', habitat: '', rarity: '', season: false });

  // Press and hold a tile to log it fast: v1's Log a sighting sheet opens over the dex and finds her (GPS).
  const cancelPress = () => { clearTimeout(press.current.timer); press.current.timer = 0; };
  const onPointerDown = (e: PointerEvent) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tile]');
    if (!t) return;
    press.current.x = e.clientX; press.current.y = e.clientY;
    const pointerId = e.pointerId;
    clearTimeout(press.current.timer);
    press.current.timer = window.setTimeout(() => {
      press.current.timer = 0;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 800);
      dropReleaseClick(pointerId);
      if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(25);
      openSightingSheet({ speciesId: Number(t.dataset.tile), autoGps: true });
    }, 520);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (press.current.timer && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
  };
  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick.current && (e.target as Element).closest('[data-tile]')) { suppressClick.current = false; e.preventDefault(); }
  };
  // One handler for every tile and row: a plain tap (or Enter) opens the species page in the app, as a router Link
  // would. A click that was already handled (the long press above), a modified click or any button but the main one
  // is left to the browser, which opens the address in a new tab or window.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-tile]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(`/bird/${a.dataset.tile}`);
  };

  // ---------- pieces ----------
  const sci = f.sort === 'dex';
  const item = (s: Species) => ({ id: s.id, seen: seen.has(s.id), heard: tiers.heardOnly.has(s.id), photo: tiers.photographed.has(s.id) });
  const block = (items: Species[]) => (f.layout === 'list'
    ? <ul className="rows pad-x">{items.map((s) => <RowItem key={s.id} {...item(s)} sci={sci} />)}</ul>
    : <ul className="dex-grid">{items.map((s) => <TileItem key={s.id} {...item(s)} />)}</ul>);

  const noun2 = scopeNoun(f.kind, 2);
  let body: ReactNode;
  if (!list.length) {
    const q = f.q.trim();
    const clear = <button type="button" className="btn" data-reset onClick={reset}>{q && !filtersOn ? 'Clear search' : 'Clear filters'}</button>;
    if (q) {
      body = (
        <div className="empty">
          <p className="empty-h">No {noun2} match "{q}"{filtersOn ? ' with these filters' : ''}.</p>
          <p className="small">Check the spelling or try part of a name. Search everything to look through places and your sightings too.</p>
          <div className="row-center"><button type="button" className="btn btn--primary" data-search onClick={() => openSearch(q)}>Search everything</button>{clear}</div>
        </div>
      );
    } else if ((f.show === 'seen' || f.show === 'heard' || f.show === 'nophoto') && !seenIn(f.kind, kindCounts)) {
      body = (
        <div className="empty">
          <p className="empty-h">No {noun2} logged yet.</p>
          <p className="small">Press and hold any tile to log it, or tap the + button.</p>
          <div className="row-center"><button type="button" className="btn btn--primary" data-show="all" onClick={() => redraw({ show: 'all' })}>Show all {noun2}</button></div>
        </div>
      );
    } else if ((f.show === 'heard' && !heardN) || (f.show === 'nophoto' && !noPhotoN)) {
      // Nothing is waiting on this list: say so plainly, and how a species gets onto it.
      const one = scopeNoun(f.kind, 1);
      body = (
        <div className="empty">
          {f.show === 'heard' ? (
            <>
              <p className="empty-h">No {noun2} heard only.</p>
              <p className="small">Tick Heard only when you log one you couldn't see. It waits here until you see it.</p>
            </>
          ) : (
            <>
              <p className="empty-h">You have a photo of every {one} you've logged.</p>
              <p className="small">Add a photo when you log a sighting to keep it that way.</p>
            </>
          )}
          <div className="row-center"><button type="button" className="btn btn--primary" data-show="all" onClick={() => redraw({ show: 'all' })}>Show all {noun2}</button></div>
        </div>
      );
    } else {
      body = (
        <div className="empty">
          <p className="empty-h">None of the {noun2} match all of these filters.</p>
          <p className="small">Turn one off, or clear them all to see the whole dex again.</p>
          <div className="row-center">{clear}</div>
        </div>
      );
    }
  } else if (f.sort === 'dex') {
    const byGroup: Record<string, Species[]> = {};
    list.forEach((s) => (byGroup[s.group] ||= []).push(s));
    const shown = Object.keys(GROUPS).filter((g) => byGroup[g]);
    const keyOf = (g: string) => groupKey(g, f.layout, byGroup[g].length);
    // Hold groups back only when the dex is drawn as she left it (some of its groups were near the screen).
    const holding = !!nearOnly && shown.some((g) => nearOnly.has(keyOf(g)));
    body = shown.map((g, i) => {
      const k = SPECIES.find((s) => s.group === g)?.kind || 'bird';
      const all = SPECIES.filter((s) => s.group === g);
      const got = all.filter((s) => seen.has(s.id)).length;
      const gk = keyOf(g);
      const known = rememberedContent(gk);
      const later = i ? { containIntrinsicSize: `auto ${known ?? Math.round(groupSize(byGroup[g].length, f.layout))}px` } : undefined;
      const held = holding && !nearOnly!.has(gk) ? rememberedBox(gk) : undefined;
      return (
        <section
          key={g}
          className={`dex-group kind--${k}${i ? ' dex-group--later' : ''}`}
          style={held ? { ...later, height: held } : later}
          data-group-key={gk}
          aria-busy={held ? true : undefined}
        >
          <h2 className="dex-group-h">
            <span>{GROUPS[g]}</span>
            <span className="dex-group-n"><span aria-hidden="true">{got}/{all.length}</span><span className="sr-only">{got} of {all.length} seen</span></span>
          </h2>
          {held ? null : block(byGroup[g])}
        </section>
      );
    });
  } else {
    const sorted = list.slice().sort(
      f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
        : f.sort === 'rarity' ? (a, b) => b.rarity - a.rarity || a.id - b.id
          : (a, b) => (lastSeen.get(b.id) || '').localeCompare(lastSeen.get(a.id) || '') || a.id - b.id);
    body = <section className="dex-group">{block(sorted)}</section>;
  }
  // The count read out after a change: the latest render's, not the one the timer was set in.
  countRef.current = { n: list.length, kind: f.kind };

  // The kind rail is the tally: each pill carries a small ring, its label and seen/total.
  const kindTab = (k: string, label: string, all: Species[], cls = '') => {
    const g = seenIn(k, kindCounts), of = all.length;
    return (
      <button
        key={k}
        type="button"
        role="tab"
        className={`kind-tab kind--${k === 'animals' ? 'all' : k} ${cls}`}
        aria-selected={f.kind === k}
        data-kind={k}
        onClick={() => { if (f.kind !== k) redraw({ kind: k, group: '' }); }}
      >
        <Ring p={g / Math.max(1, of)} cls="kind-ring" />{' '}
        <span className="kind-tab-txt">
          <span className="kind-tab-l">{label}</span>{' '}
          <span className="kind-tab-n" aria-hidden="true"><b data-kn={g} data-of={of} style={digits(g)}>{g}</b>/{of}</span>
        </span>{' '}
        <span className="sr-only">, {g} of {of} {k === 'plant' ? 'found' : 'seen'}</span>
      </button>
    );
  };
  const kindRail = kindsPresent.length < 2 ? null : (
    <div className="kind-tabs" role="tablist" aria-label="What to show" ref={railRef}>
      {kindTab('animals', 'All animals', ANIMALS)}
      {ANIMAL_KINDS.filter((k) => kindsPresent.includes(k)).map((k) => kindTab(k, KINDS[k].label, ofKind(k)))}
      {kindsPresent.includes('plant') ? kindTab('plant', 'Plants', ofKind('plant'), 'kind-tab--quiet') : null}
    </div>
  );

  return (
    <>
      <DexHero day={day} got={seenIn(f.kind, kindCounts)} n={scopeAll.length} kind={f.kind} photo={photoN} heard={canHear ? heardN : null} />
      <div className="dex-sheet">
        {kindRail}
        <TodayRail kind={f.kind} day={day} />
        <div className="dex-stick" aria-hidden="true" ref={stickRef} />
        <div className="dex-tools" ref={toolsRef}>
          <div className="searchbox searchbox--dex">
            <Icon name="search" />
            <input
              type="search"
              placeholder={`Filter ${scopeAll.length} ${noun2}`}
              value={f.q}
              data-q
              aria-label="Filter by name"
              // Typing redraws without motion (tiles sliding on every key would be noise); the count is read out once she pauses.
              onChange={(e) => { update({ q: e.target.value }); say(900); }}
            />
          </div>
          <button
            type="button"
            className="iconbtn iconbtn--tool"
            data-layout
            aria-label={f.layout === 'list' ? 'Show as grid' : 'Show as list'}
            onClick={() => redraw({ layout: f.layout === 'list' ? 'grid' : 'list' })}
          >
            {f.layout === 'list' ? ICON.grid : ICON.list}
          </button>
        </div>
        <div className="chips chips--scroll chips--dex" role="group" aria-label="Filter and sort">
          {([['all', 'All'], ['seen', 'Seen'], ['unseen', 'Not seen']] as [Show, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`chip ${f.show === v ? 'chip--on' : ''}`} data-show={v} aria-pressed={f.show === v} onClick={() => redraw({ show: v })}>{l}</button>
          ))}
          {/* Her two to-do lists: birds to go and see properly, and ones to photograph. The count is for the kind tab. */}
          {([['heard', 'Heard only', heardN, ICON.ear], ['nophoto', 'No photo yet', noPhotoN, ICON.camera]] as [Show, string, number, ReactNode][])
            .filter(([v]) => v !== 'heard' || canHear || f.show === 'heard')
            .map(([v, l, n, ic]) => (
              <button key={v} type="button" className={`chip chip--tier ${f.show === v ? 'chip--on' : ''}`} data-show={v} aria-pressed={f.show === v} onClick={() => redraw({ show: v })}>
                {ic}{l}<span className="chip-n"><span aria-hidden="true">·</span><span className="sr-only">,</span> <span data-tier-n>{n}</span></span>
              </button>
            ))}
          <button type="button" className={`chip ${f.season ? 'chip--on' : ''}`} data-season aria-pressed={f.season} onClick={() => redraw({ season: !f.season })}>In season now</button>
          <select className={`chip chip--select ${f.sort !== 'dex' ? 'chip--on' : ''}`} data-sort aria-label="Sort" value={f.sort} onChange={(e) => redraw({ sort: e.target.value as Sort })}>
            {([['dex', 'Dex order'], ['name', 'Name A–Z'], ['rarity', 'Rarest first'], ['recent', 'Recently seen']] as [Sort, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={`chip chip--select ${f.rarity ? 'chip--on' : ''}`} data-rarity aria-label="Rarity" value={f.rarity} onChange={(e) => redraw({ rarity: e.target.value })}>
            <option value="">Any rarity</option>
            {Object.entries(RARITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className={`chip chip--select ${f.habitat ? 'chip--on' : ''}`} data-habitat aria-label="Habitat" value={f.habitat} onChange={(e) => redraw({ habitat: e.target.value })}>
            <option value="">Any habitat</option>
            {Object.entries(HABITATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={`chip chip--select ${f.group ? 'chip--on' : ''}`} data-group aria-label="Group" value={f.group} onChange={(e) => redraw({ group: e.target.value })}>
            <option value="">All groups</option>
            {Object.entries(GROUPS).filter(([k]) => scopeAll.some((s) => s.group === k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {filtersOn ? <button type="button" className="chip" data-reset onClick={reset}>Clear</button> : null}
        </div>
        {(f.q || filtersOn) && list.length ? <p className="list-count"><b>{list.length}</b> {scopeNoun(f.kind, list.length)}</p> : null}
        <div
          className={`dex ${colourUnseen ? 'dex--colour' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onClickCapture={onClickCapture}
          onClick={onClick}
          onContextMenu={(e) => { if ((e.target as Element).closest('[data-tile]')) e.preventDefault(); }}
        >
          {body}
        </div>
        <p className="small muted pad dex-tip">Tip: press and hold anything in the dex to log it quickly.</p>
      </div>
    </>
  );
}
