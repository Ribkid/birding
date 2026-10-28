// v1's onRouteChange (birding-refresh js/app.js:996-1043): every change of address runs in one view transition,
// whether it came from a tab, a link, Back, Forward or a hash typed into the address bar. How deep each screen sits
// picks the motion: deeper is 'forward' (the new page rises), shallower is 'back', level (the four tabs) is a 'swap'
// cross-fade. A photo tapped on its way to a species page grows into that page's hero, and going back from it shrinks
// the hero into the photo it came from. Open layers close and sheets still sliding away go before the new screen
// draws. Reduced motion, a hidden tab or a browser without view transitions get the plain change (lib/motion.ts vt()).
//
// Going back puts her where she was. Back and Forward return to the place she left that history entry at, going back
// up to a shallower screen returns to where she was on it (as v1 did), and so does going back to a tab's own screen
// through the tab bar. The place is the scroll, held to the photo tile that was at the top of the screen, and the
// control she left by, which takes focus again (RouteFocus). Tapping the tab she is on, on its own screen, glides to
// the top.
//
// Drawn plainly, without a transition: a redirect (a replace that isn't her own tap: the empty address to the Dex,
// Me's account addresses, a round that can't be made going back to Learn), a move within the map, and a Back the
// phone has already animated with its own edge swipe.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Router, UNSAFE_createHashHistory as createHashHistory, type Location } from 'react-router-dom';
import { clearNames, motionOK, nameFor, settle, transitioning, vt } from '../lib/motion';
import { closeAllLayers, findByKey, focusKey, FOCUSABLE } from '../lib/layers';
import { flushClosingSheets } from './Sheet';

type Nav = 'forward' | 'back' | 'swap';
type History = ReturnType<typeof createHashHistory>;
type Action = History['action'];

// How deep each screen sits (v1 DEPTH). A screen not listed is one level down.
const DEPTH: Record<string, number> = {
  dex: 0, learn: 0, map: 0, me: 0, lists: 1, badges: 1, bird: 1, list: 2, patch: 2, targets: 2, stats: 1, log: 2,
  listen: 1, scan: 1, settings: 1, quiz: 1, leaderboard: 1, u: 2, compare: 2, outing: 2,
};
const depthOf = (path: string) => DEPTH[path.split('/')[1] || 'dex'] ?? 1;
export function navKind(from: string, to: string): Nav {
  const a = depthOf(from), b = depthOf(to);
  return b > a ? 'forward' : b < a ? 'back' : 'swap';
}

/** The four tabs' own screens. */
export const TAB_ROOTS = ['/dex', '/learn', '/map', '/me'];
// The map is one screen whatever it is centred on (/map, /map/sp/:id, /map/at/:lat,:lng): moving within it redraws
// the same map in place, so there is nothing to cross-fade.
const screenOf = (path: string) => (path === '/map' || path.startsWith('/map/') ? '/map' : path);

// The event being handled while the address changes: her tap or key on the page, or the popstate of a Back the phone
// has already animated with its own edge swipe (Chrome and Safari say so on the event). A change made by a screen
// while it draws (a redirect) has neither.
const event = () => (window as Window & { event?: Event }).event;
const herMove = () => { const e = event(); return !!e && (e.type === 'click' || e.type === 'keydown' || e.type === 'keyup'); };
const phoneAnimated = () => {
  const e = event() as (Event & { hasUAVisualTransition?: boolean }) | undefined;
  return e?.type === 'popstate' && !!e.hasUAVisualTransition;
};

// ---------- where she was ----------
type FocusKey = NonNullable<ReturnType<typeof focusKey>>;
/** A photo tile and how far from the top of the screen it sat. */
export interface Anchor { tile: string; top: number }
/** Where she was on a screen as she left it: its scroll, the first tile wholly on screen, and the control she left by. */
export interface Place { y: number; anchor: Anchor | null; focus: FocusKey | null }
// By address (going back up to a shallower screen, or to a tab through the tab bar) and by history entry (Back and
// Forward), for the session.
const byPath = new Map<string, Place>();
const byEntry = new Map<string, Place>();

/**
 * The first photo tile wholly on screen, found by looking down the middle of the screen (so a tile under the sticky
 * search bar or the tab bar doesn't count), and where it sits. Groups further down the dex only have an estimated
 * height until they are drawn, so a return lands on this tile rather than on a number of pixels alone.
 */
export function anchorOf(view: ParentNode): Anchor | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const x = innerWidth / 2;
  for (let y = 8; y < innerHeight; y += 16) {
    const t = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tile]');
    if (!t || !view.contains(t)) continue;
    const r = t.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= innerHeight) return { tile: t.dataset.tile!, top: Math.round(r.top) };
    y = Math.max(y, r.bottom);
  }
  return null;
}

// The control she pressed last on the page (a tile, a row, a link), so going back can give focus back to it, and
// whether she is using keys (focus rings show) or touch.
let pressed: { el: Element; at: number } | null = null;
let keys = false;
/** True when her last input was a key, so a focus moved for her shows its ring. */
export const keyboardLast = () => keys;

// The tab bar is about to change the address (TabBar): going back to a tab's own screen returns to where she was.
let tabTap = false;
/** Called by the tab bar just before it changes the address. */
export function viaTabBar() {
  tabTap = true;
  setTimeout(() => { tabTap = false; });
}
/**
 * The tab she is on, tapped on its own screen: glide to the top (at once with reduced motion) and forget the place.
 * From far down the dex it first steps to a screen and a half from the top, so the glide is short and doesn't draw
 * and fetch every photo on the way up.
 */
export function toTop(path: string) {
  byPath.delete(path);
  if (!motionOK()) { window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  const near = Math.round(innerHeight * 1.5);
  if (scrollY > near) window.scrollTo(0, near);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Where the screen being drawn lands: its scroll and tile, the tile to keep in sight on going back from its species
// page, and the control to give focus back to.
let pending: { key: string; y: number; anchor: Anchor | null; tile: number | null; focus: FocusKey | null } | null = null;
// The history entry whose screen is on show (where she is on it is worth keeping when she leaves).
let drawnKey: string | null = null;
// After a return: the control she left the screen by, until RouteFocus asks for it.
let returning: { key: string; focus: FocusKey } | null = null;

/** While the screen for history entry `key` is being drawn: the scroll it will land on. The Dex draws the groups
 *  around that place first when it is where she left it (screens/Dex.tsx). */
export const landingScroll = (key: string) => (pending && pending.key === key ? pending.y : null);

/**
 * After going back to the screen for history entry `key`: the control she left it by (the tile she opened), if it is
 * on screen in `view`. Asked once, by RouteFocus.
 */
export function returnFocus(key: string, view: ParentNode): HTMLElement | null {
  if (!returning || returning.key !== key) return null;
  const el = findByKey(returning.focus, view);
  returning = null;
  return el && inView(el) ? el : null;
}

const THUMB = '.tile-img, .row-thumb, .botd-img, .cmp-img';
// A photo just tapped on its way to a species page, and which kind of photo opened each species page (a tile, Bird of
// the day, a row), so going back shrinks into that one.
let morph: { id: number; kind: string } | null = null;
const cameFrom = new Map<string, string>();
const thumbKind = (thumb: Element) => THUMB.split(', ').find((s) => thumb.matches(s)) || '';
// The photo itself flies, not its frame: the seen ring and tick stay behind and fade with the page.
const pic = (thumb: Element) => thumb.querySelector<HTMLElement>(':scope > img, :scope > .whole') || (thumb as HTMLElement);
const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 56 && r.top < innerHeight - 64; };
const birdId = (path: string) => Number(/^\/bird\/(\d+)$/.exec(path)?.[1]) || null;
const viewEl = () => document.getElementById('view');

// A photo in a dex group that skips drawing until it is near the screen (content-visibility: auto) isn't captured
// while the screen she is going back to is still being drawn, so the hero would have nothing to shrink into. The
// group is drawn for the length of the transition; it is on screen, so nothing moves when that ends.
const revealed: HTMLElement[] = [];
function reveal(el: Element) {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    if (getComputedStyle(a).getPropertyValue('content-visibility') === 'auto') {
      a.style.setProperty('content-visibility', 'visible');
      revealed.push(a);
    }
  }
}
const unreveal = () => { for (const a of revealed.splice(0)) a.style.removeProperty('content-visibility'); };

// Tapping a photo that links to a species names it, so the view transition grows it into that page's hero. Any press
// on a control is kept as the control she may leave the screen by.
function onPress(e: MouseEvent) {
  const target = e.target as Element | null;
  const control = target?.closest?.(FOCUSABLE);
  pressed = control ? { el: control, at: performance.now() } : null;
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !motionOK()) return;
  const a = target?.closest?.('a[href^="#/bird/"]');
  if (!a || a.getAttribute('href') === location.hash) return;
  const thumb = a.matches(THUMB) ? a : a.querySelector(THUMB);
  if (!thumb) return;
  const el = pic(thumb);
  const m = morph = { id: Number(a.getAttribute('href')!.split('/')[2]), kind: thumbKind(thumb) };
  nameFor(el, 'sp-hero');
  // If no navigation follows (a long press, a cancelled tap), take the name off again.
  setTimeout(() => { if (morph === m) { morph = null; if (!document.documentElement.dataset.nav) el.style.viewTransitionName = ''; } }, 700);
}
const onPointer = () => { keys = false; };
const onKey = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) keys = true; };

/** Where she is on the screen she is leaving, and the control she is leaving it by (pressed just now, or focused). */
function placeHere(): Place {
  const view = viewEl();
  const a = document.activeElement;
  const by = pressed && performance.now() - pressed.at < 1000 && view?.contains(pressed.el) ? pressed.el
    : a && a !== view && view?.contains(a) && !a.matches('h1') ? a : null;
  pressed = null;
  return { y: scrollY, anchor: view ? anchorOf(view) : null, focus: focusKey(by) };
}

// The browser makes an entry of its own, with no state, for a plain hash link (a species link in a map popup), a hash
// set by code (the sign-up nudge) or one typed into the address bar. Before the router reads it, it is given a key and
// its place in the count, as the router's own entries have, so Back and Forward can tell where it sits and what she
// left it at.
let atIdx = 0;
function keyBrowserEntry() {
  if (window.history.state != null) return;
  window.history.replaceState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: atIdx + 1 }, '');
}
// The address the app opened at keeps the key 'default' (screens read it as "opened from outside the app"), so it is
// remembered by its address only.
const entryKey = (key: string) => (key === 'default' ? null : key);

/**
 * `delta` is how far a popstate moved through history: -1 for Back, 1 for Forward, and null if the entry has no place
 * in the count (only if keyBrowserEntry couldn't run first), which is taken as a new entry like a tap's.
 */
function onRouteChange(prev: Location, next: Location, action: Action, delta: number | null, apply: () => void) {
  const from = prev.pathname + prev.search, to = next.pathname + next.search;
  const viaTab = tabTap;
  tabTap = false;
  // Only the history state changed (the same screen), or the first draw's redirect from an empty address.
  if (from === to || prev.pathname === '/') { apply(); return; }
  // Leaving the screen on show (not one a quick second tap is already replacing): keep where she was on it.
  if (prev.key === drawnKey) {
    const here = placeHere();
    byPath.set(from, here);
    const k = entryKey(prev.key);
    if (k) byEntry.set(k, here);
  }
  const nav = navKind(prev.pathname, next.pathname);
  // Back or Forward through entries (not a typed hash).
  const traverse = action === 'POP' && delta != null;
  const goingBack = nav === 'back' || (traverse && delta <= 0);
  const toId = birdId(next.pathname), fromId = birdId(prev.pathname);
  const tapped = morph && morph.id === toId ? morph : null;
  morph = null;
  if (tapped) cameFrom.set(to, tapped.kind);
  const plain = typeof (document as any).startViewTransition !== 'function' || document.hidden || !motionOK()
    || phoneAnimated() || screenOf(prev.pathname) === screenOf(next.pathname) || (action === 'REPLACE' && !herMove());
  // Going back from a species page, up to a shallower screen or with Back to a list beside it (not to another species
  // page): its hero shrinks back into the photo it came from, if that is on screen.
  let shrinkTo: number | null = null;
  const hero = !plain && !tapped && fromId && !toId && goingBack ? viewEl()?.querySelector<HTMLElement>('[data-hero-frame]') : null;
  if (hero && inView(hero)) { nameFor(hero, 'sp-hero'); shrinkTo = fromId; }
  // Where the new screen lands. Back and Forward: where she left that history entry (or, for an entry without its
  // own key or from before this session, where she was last at that address, going back). Going back up to a
  // shallower screen, or to a tab's own screen through the tab bar: where she was on it. Anything else starts at the
  // top.
  const k = entryKey(next.key);
  const back = traverse ? (k && byEntry.get(k)) || (delta <= 0 || nav === 'back' ? byPath.get(to) : undefined)
    : nav === 'back' || (viaTab && TAB_ROOTS.includes(to)) ? byPath.get(to) : undefined;
  pending = {
    key: next.key,
    y: back?.y ?? 0,
    anchor: back?.anchor ?? null,
    tile: fromId && goingBack && !shrinkTo ? fromId : null,
    focus: back?.focus ?? null,
  };
  const draw = () => { closeAllLayers('nav'); flushClosingSheets(); apply(); };
  // Drawn plainly, handed to React as it is: the change may come from a screen's effect (a redirect), where React
  // can't draw synchronously. A transition already running (the one that drew the screen now redirecting) carries on,
  // and clears its names when it ends.
  if (plain) {
    draw();
    if (!transitioning()) clearNames();
    return;
  }
  void vt(() => {
    flushSync(draw);
    const view = viewEl();
    const waits: unknown[] = [];
    if (landing) waits.push(landing.done);
    if (view && tapped) {
      const frame = view.querySelector<HTMLElement>('[data-hero-frame]');
      if (frame) {
        // The hero draws the photo she tapped (the same small address, already in memory) underneath while the large
        // one loads (SpeciesImage's hero mode). The new view waits a moment for it to decode, so the photo grows
        // into a photo rather than into its wash.
        const small = frame.querySelector<HTMLImageElement>('img.whole-bg[src]');
        if (small?.decode) waits.push(small.decode());
        nameFor(frame, 'sp-hero');
      }
    }
    if (view && shrinkTo) {
      // Back never scrolls the page to find a target: the photo shrinks into a copy of it that is already on screen,
      // preferring the kind she tapped, or the page simply fades back.
      const kind = cameFrom.get(from);
      const on = [...view.querySelectorAll<HTMLElement>(`[data-tile="${shrinkTo}"] :is(.tile-img, .row-thumb), a[href="#/bird/${shrinkTo}"] :is(${THUMB}), a[href="#/bird/${shrinkTo}"]:is(${THUMB})`)].filter(inView);
      const t = (kind && on.find((el) => el.matches(kind))) || on[0];
      if (t) {
        const el = pic(t);
        reveal(el);
        nameFor(el, 'sp-hero');
        // The tile's photo was shown this session, so it is in memory, but a lazy image just drawn hasn't asked for
        // it yet: ask now, so the hero shrinks into the photo rather than into an empty frame.
        const img = t.querySelector('img');
        if (img) {
          if (img.loading === 'lazy') img.loading = 'eager';
          if (img.decode) waits.push(img.decode());
        }
      }
    }
    return settle(Promise.all(waits), 150);
  }, { nav }).then(unreveal);
}

/**
 * Scroll to `y`, held to the anchor tile that was at the top of the screen, in case the screen above it drew a little
 * differently. True when the page could go that far.
 */
function land(view: HTMLElement | null, y: number, anchor: Anchor | null) {
  window.scrollTo(0, y);
  let want = y;
  const a = anchor && view?.querySelector(`[data-tile="${anchor.tile}"]`);
  if (a) {
    const off = a.getBoundingClientRect().top - anchor!.top;
    if (Math.abs(off) >= 1) { want = scrollY + off; window.scrollTo(0, want); }
  }
  return Math.abs(scrollY - want) < 2;
}

// A screen that draws its content a moment later (Learn reads her progress first, then draws the hub) isn't tall
// enough yet for the place she left it at: land there as soon as it is, within a second, unless she scrolls or taps
// first. The transition waits for it a moment (vt's update), so the swap shows the screen where she left it.
let landing: { stop: () => void; done: Promise<void> } | null = null;
const stopLanding = () => landing?.stop();
function landLate(view: HTMLElement | null, y: number, anchor: Anchor | null) {
  if (!view || typeof ResizeObserver !== 'function') return;
  let finish = () => {};
  const done = new Promise<void>((r) => { finish = r; });
  const ro = new ResizeObserver(() => { if (land(view, y, anchor)) stop(); });
  const hers = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const timer = setTimeout(() => stop(), 1000);
  const me = { stop, done };
  function stop() {
    ro.disconnect();
    clearTimeout(timer);
    for (const t of hers) removeEventListener(t, stop, true);
    if (landing === me) landing = null;
    finish();
  }
  for (const t of hers) addEventListener(t, stop, { capture: true, passive: true });
  ro.observe(view);
  landing = me;
}

/**
 * The app's router: react-router's HashRouter, with every change of address drawn through onRouteChange. Scroll is
 * remembered by the app (going back returns to it), not restored by the browser mid-transition. A quick second tap
 * before the first screen is drawn draws only the newest address.
 */
export function MotionHashRouter({ children }: { children: ReactNode }) {
  const historyRef = useRef<History | null>(null);
  historyRef.current ??= createHashHistory({ v5Compat: true });
  const history = historyRef.current;
  const [state, setState] = useState(() => ({ action: history.action, location: history.location }));
  const shown = useRef(state.location);
  const latest = useRef(state);

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    document.addEventListener('click', onPress, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    // Before the router's own popstate listener (added by listen below), so it reads the key given here.
    window.addEventListener('popstate', keyBrowserEntry, true);
    atIdx = window.history.state?.idx ?? 0;
    const off = history.listen(({ action, location: next, delta }) => {
      atIdx = window.history.state?.idx ?? atIdx;
      const prev = shown.current;
      shown.current = next;
      latest.current = { action, location: next };
      onRouteChange(prev, next, action, delta, () => setState(latest.current));
    });
    return () => {
      off();
      window.removeEventListener('popstate', keyBrowserEntry, true);
      document.removeEventListener('click', onPress, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [history]);

  useLayoutEffect(() => {
    drawnKey = state.location.key;
    if (!pending || pending.key !== state.location.key) return;
    const { y, anchor, tile, focus } = pending;
    pending = null;
    stopLanding();
    const view = viewEl();
    if (!land(view, y, anchor)) landLate(view, y, anchor);
    // Make sure the tile she opened is in sight.
    const t = tile ? view?.querySelector(`[data-tile="${tile}"]`) : null;
    if (t && !inView(t)) t.scrollIntoView({ block: 'center' });
    returning = focus ? { key: state.location.key, focus } : null;
  }, [state.location]);

  return (
    <Router location={state.location} navigationType={state.action} navigator={history} useTransitions={false}>
      {children}
    </Router>
  );
}

/** Forget every place (tests). */
export function forgetPlaces() {
  byPath.clear();
  byEntry.clear();
  cameFrom.clear();
  pending = null;
  returning = null;
  pressed = null;
  drawnKey = null;
  tabTap = false;
  stopLanding();
}
