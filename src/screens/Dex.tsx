// The dex home (v1 js/app.js renderDex): today's pick full-bleed with the wordmark and her count, then a sheet with
// the kind rail (the tally), the Today rail, the sticky search tools and the grid.
import {
  useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import {
  ANIMALS, ANIMAL_KINDS, GROUPS, HABITATS, KINDS, RARITY, SPECIES, byId, dexCode, inSeason, kindsPresent, ofKind,
  pluralFor, type Species,
} from '../lib/data';
import { useMedia, useSightings, type Sighting } from '../lib/hooks';
import { keepFocus } from '../lib/layers';
import { countUp, flip, motionOK } from '../lib/motion';
import { applyTint, stagger } from '../lib/look';
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
import { DexSearch } from './DexSearch';
import { ICON, Photo, Ring } from './dexParts';
import { installOffered, onInstallOffer, promptInstall } from './dexInstall';

type Show = 'all' | 'seen' | 'unseen';
type Sort = 'dex' | 'name' | 'rarity' | 'recent';
type Layout = 'grid' | 'list';
interface DexFilters {
  kind: string; q: string; show: Show; sort: Sort; layout: Layout;
  rarity: string; habitat: string; group: string; season: boolean;
}
interface DayPick { sp: Species; label: string; why: string; where: string }

// Filters, sort, kind and layout hold for the session, as v1's state.dex did.
const saved: DexFilters = { kind: 'animals', q: '', show: 'all', sort: 'dex', layout: 'grid', rarity: '', habitat: '', group: '', season: false };

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

// Off-screen groups skip rendering until they're near (content-visibility); this is their size until then.
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

export default function Dex() {
  const navigate = useNavigate();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useMedia();
  const sightings = useSightings();
  // useSightings starts from one empty array and swaps in the stored rows once they are read (or, if storage
  // never answers, the page carries on without them).
  const firstRows = useRef(sightings);
  const [gaveUp, setGaveUp] = useState(false);
  const loaded = sightings !== firstRows.current || gaveUp;
  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);

  const [f, setF] = useState<DexFilters>(() => ({ ...saved }));
  const [colourUnseen, setColourUnseen] = useState(false);
  const [install, setInstall] = useState(installOffered);
  const [search, setSearch] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const sayT = useRef(0);
  const countRef = useRef({ n: 0, kind: 'animals' });
  const suppressClick = useRef(false);
  const press = useRef<{ timer: number; x: number; y: number }>({ timer: 0, x: 0, y: 0 });
  const heroRef = useRef<HTMLElement>(null);
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
    return scopeAll.filter((s) =>
      (!q || `${s.name} ${s.sci} ${dexCode(s.id)} ${GROUPS[s.group]} ${KINDS[s.kind].label} ${KINDS[s.kind].one}`.toLowerCase().includes(q)) &&
      (f.show === 'all' || (f.show === 'seen') === seen.has(s.id)) &&
      (!f.group || s.group === f.group) && (!f.habitat || s.habitats.includes(f.habitat)) &&
      (!f.rarity || s.rarity === Number(f.rarity)) &&
      (!f.season || (relRate(s.id, month) ?? (inSeason(s, month) ? 1 : 0)) >= 0.35));
  }, [scopeAll, f.q, f.show, f.group, f.habitat, f.rarity, f.season, seen, month, seqData]);

  const lastSeen = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sightings as (Sighting & { time?: string })[]) {
      const key = s.date + (s.time || '');
      if (key > (m.get(s.speciesId) || '')) m.set(s.speciesId, key);
    }
    return m;
  }, [sightings]);

  const day = loaded ? dayPick(seen, f.kind) : null;

  // ---------- effects ----------
  useEffect(() => {
    let alive = true;
    void learnReady().then(() => { if (alive) force(); }).catch(() => {});
    if (!photoKinds) {
      void photoIdInfo().then((info: { kinds: string[] }) => {
        if (!info.kinds.length) return;
        photoKinds = info.kinds;
        if (alive) force();
      });
    }
    const readSettings = () => {
      void db.kvGet('settings').then((s: { colourUnseen?: boolean } | undefined) => { if (alive) setColourUnseen(!!s?.colourUnseen); }).catch(() => {});
    };
    readSettings();
    const offDb = db.onChange((name: string) => { if (name === 'kv:settings') readSettings(); });
    const offInstall = onInstallOffer(() => { if (alive) setInstall(installOffered()); });
    const wait = setTimeout(() => { if (alive) setGaveUp(true); }, 1500);
    return () => { alive = false; offDb(); offInstall(); clearTimeout(wait); clearTimeout(sayT.current); clearTimeout(press.current.timer); };
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

  // Rings and counts, once her sightings are in.
  const countsKey = loaded ? `${f.kind}|${sightings.length}|${seen.size}` : '';
  useLayoutEffect(() => {
    const view = document.getElementById('view');
    if (countsKey && view) countKindTabs(view);
  }, [countsKey]);

  // The chosen kind tab is kept in sight.
  useLayoutEffect(() => {
    const rail = railRef.current, on = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (rail && on && (on.offsetLeft < rail.scrollLeft || on.offsetLeft + on.offsetWidth > rail.scrollLeft + rail.clientWidth)) {
      rail.scrollLeft = on.offsetLeft - (rail.clientWidth - on.offsetWidth) / 2;
    }
  }, [f.kind]);

  // The hero takes its colour from the pick's photo where the host allows it to be read.
  const heroSrc = day ? (sized(day.sp.id, 'large') as string | null) || '' : '';
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    for (const k of ['--tint', '--tint-deep', '--tint-soft', '--tint-soft-dark', '--tint-ink-dark']) hero.style.removeProperty(k);
    hero.classList.remove('tinted');
    if (heroSrc) void applyTint(hero, heroSrc);
  }, [heroSrc]);

  // ---------- actions ----------
  const say = (delay = 0) => {
    clearTimeout(sayT.current);
    sayT.current = window.setTimeout(() => {
      setSaid('');
      sayT.current = window.setTimeout(() => {
        const { n, kind } = countRef.current;
        setSaid(`${n} ${scopeNoun(kind, n)}`);
      }, 60);
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
  const openSearch = (initial = '') => setSearch(initial);

  // Press and hold a tile to log it fast.
  const cancelPress = () => { clearTimeout(press.current.timer); press.current.timer = 0; };
  const onPointerDown = (e: PointerEvent) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tile]');
    if (!t) return;
    press.current.x = e.clientX; press.current.y = e.clientY;
    clearTimeout(press.current.timer);
    press.current.timer = window.setTimeout(() => {
      press.current.timer = 0;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 800);
      if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(25);
      navigate(`/add?species=${t.dataset.tile}`);
    }, 520);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (press.current.timer && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
  };
  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick.current && (e.target as Element).closest('[data-tile]')) { suppressClick.current = false; e.preventDefault(); }
  };

  // ---------- pieces ----------
  const isSeen = (s: Species) => seen.has(s.id);
  const hidden = (s: Species) => <span className="sr-only">, {isSeen(s) ? 'seen' : 'not seen'}</span>;
  const tile = (s: Species) => (
    <li key={s.id}>
      <Link className={`tile kind--${s.kind} ${isSeen(s) ? 'tile--seen' : ''}`} to={`/bird/${s.id}`} data-tile={s.id}>
        <span className="tile-img"><Photo sp={s} /></span>
        <Band sp={s} seen={isSeen(s)} />
        <span className="tile-name">{s.name}{hidden(s)}</span>
      </Link>
    </li>
  );
  // Under a group heading the group name would repeat on every row, so rows show the scientific name instead.
  const row = (s: Species) => (
    <li key={s.id}>
      <Link className={`row row--sp kind--${s.kind}`} to={`/bird/${s.id}`} data-tile={s.id}>
        <span className={`row-thumb ${isSeen(s) ? 'row-thumb--seen' : ''}`}><Photo sp={s} /></span>
        <span className="row-main">
          <strong>{s.name}{hidden(s)}</strong>
          <span className="muted small">{f.sort === 'dex' ? <i>{s.sci}</i> : GROUPS[s.group]}</span>
        </span>
        <Pips rarity={s.rarity} /> <Band sp={s} seen={isSeen(s)} />
      </Link>
    </li>
  );
  const block = (items: Species[]) => (f.layout === 'list' ? <ul className="rows pad-x">{items.map(row)}</ul> : <ul className="dex-grid">{items.map(tile)}</ul>);

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
    } else if (f.show === 'seen' && !SPECIES.some((s) => inScope(s, f.kind) && seen.has(s.id))) {
      body = (
        <div className="empty">
          <p className="empty-h">No {noun2} logged yet.</p>
          <p className="small">Press and hold any tile to log it, or tap the + button.</p>
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
    body = Object.keys(GROUPS).filter((g) => byGroup[g]).map((g, i) => {
      const k = SPECIES.find((s) => s.group === g)?.kind || 'bird';
      const all = SPECIES.filter((s) => s.group === g);
      const got = all.filter(isSeen).length;
      const later = i ? { containIntrinsicSize: `auto ${Math.round(groupSize(byGroup[g].length, f.layout))}px` } : undefined;
      return (
        <section key={g} className={`dex-group kind--${k}${i ? ' dex-group--later' : ''}`} style={later}>
          <h2 className="dex-group-h">
            <span>{GROUPS[g]}</span>
            <span className="dex-group-n"><span aria-hidden="true">{got}/{all.length}</span><span className="sr-only">{got} of {all.length} seen</span></span>
          </h2>
          {block(byGroup[g])}
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

  // The hero
  const got = scopeAll.filter(isSeen).length, n = scopeAll.length;
  const hero = (
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
          <span><b data-capn={got}>{got}</b> of {n} {scopeNoun(f.kind, n)} {f.kind === 'plant' ? 'found' : 'seen'}</span>
        </p>
      </div>
    </header>
  );

  // The kind rail is the tally: each pill carries a small ring, its label and seen/total.
  const kindTab = (k: string, label: string, all: Species[], cls = '') => {
    const g = all.filter(isSeen).length, of = all.length;
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
        <Ring p={g / Math.max(1, of)} cls="kind-ring" />
        <span className="kind-tab-txt">
          <span className="kind-tab-l">{label}</span>
          <span className="kind-tab-n" aria-hidden="true"><b data-kn={g} data-of={of}>{g}</b>/{of}</span>
        </span>
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

  // Today: one snapping row of cards. Listen and Scan, Learn, and the pick of the day (photo-backed).
  const single = f.kind !== 'animals' && f.kind !== 'all';
  const [lt, ls] = single && f.kind !== 'bird' ? ['Listen (birds)', f.kind === 'frog' ? 'Frog calls to compare' : 'Birds by call'] : ['Listen', 'Birds by call'];
  const tool = (ic: ReactNode, title: string, sub: string) => (
    <><span className="today-ic">{ic}</span><span className="today-t"><strong>{title}</strong><span>{sub}</span></span></>
  );
  const todayRail = (
    <section className="today" aria-label="Today">
      {install ? <button type="button" className="today-card today-tool" onClick={() => void promptInstall()}>{tool(ICON.install, 'Install', 'Add to your home screen')}</button> : null}
      <Link className="today-card today-tool" to="/listen">{tool(<Icon name="mic" />, lt, ls)}</Link>
      <Link className="today-card today-tool" to="/scan">{tool(<Icon name="scan" />, 'Scan a photo', scanSub(f.kind))}</Link>
      <LearnTeaser />
      {day ? (
        <Link className={`today-card today-day kind--${day.sp.kind}`} to={`/bird/${day.sp.id}`}>
          <span className="botd-img"><Photo sp={day.sp} /></span>
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

  return (
    <>
      {hero}
      <div className="dex-sheet">
        {kindRail}
        {todayRail}
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
          onContextMenu={(e) => { if ((e.target as Element).closest('[data-tile]')) e.preventDefault(); }}
        >
          {body}
        </div>
        <p className="small muted pad dex-tip">Tip: press and hold anything in the dex to log it quickly.</p>
        <p className="sr-only" role="status" aria-live="polite">{said}</p>
      </div>
      {search != null && <DexSearch initial={search} sightings={sightings} seen={seen} onClose={() => setSearch(null)} />}
    </>
  );
}
