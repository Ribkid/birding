import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { sized } from '../core/media.js';
import { dexCode, RARITY, type Species } from '../lib/data';
import { mediaSettled, useMedia } from '../lib/hooks';
import { washFor } from '../lib/wash';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// Photos fade in the first time they arrive (img.fade in app.css) and shimmer while they load (look.css and
// learn.css). Ones already shown this session come back at full strength, so a redraw (a filter, a sync, a kind
// tab) doesn't make them blink. One set for the whole app: v1's js/app.js `shown` and js/learn.js `shownSrc`.
const shown = new Set<string>();
/** The photos already shown this session, for a screen that draws photos of its own (the species gallery). */
export const shownPhotos = shown;

type Look = 'wait' | 'in' | 'failed';

/**
 * Resolves once a plain <img> given this address would draw it at once (v1 decoded a copy first). A copy of the
 * same photo fetched with CORS at the same moment (the hero's tint reads its colour) can take its place in the
 * memory cache, and the <img> would then blank while it fetched again, so this checks and decodes once more.
 */
async function decoded(url: string) {
  for (let i = 0; i < 3; i++) {
    const next = new Image();
    next.src = url;
    if (next.complete && next.naturalWidth) return;
    await next.decode();
  }
}

/**
 * The loading state of one photo, v1's settleImages and patchSpeciesImages:
 * - a photo already shown this session, or already complete when drawn (memory cache), shows at once, no fade;
 * - any other fades in once it has loaded (with `develop`, once it has loaded and decoded, so the first frames of
 *   the hero's develop never paint an empty image);
 * - when a better address arrives later (the photo index, gallery.json), a photo already on screen stays until
 *   the new one has decoded, so it never blanks; one still loading, or one that failed, switches at once.
 */
function usePhotoLoad(url: string | null | undefined, { develop = false } = {}) {
  const [src, setSrc] = useState<string | null>(url || null);
  const [look, setLook] = useState<Look>(() => (url && shown.has(url) ? 'in' : 'wait'));
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!url || url === src) return; // no address any more: keep the one on screen, as v1 did
    const el = ref.current;
    if (look !== 'in' || !el || !el.complete || !el.naturalWidth) {
      setSrc(url);
      setLook(shown.has(url) ? 'in' : 'wait');
      return;
    }
    let alive = true;
    decoded(url).then(
      () => {
        if (!alive) return;
        shown.add(url);
        setSrc(url);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [url, src, look]);

  // Complete when drawn (memory cache): in before the first paint, so it never fades.
  useLayoutEffect(() => {
    const el = ref.current;
    if (look !== 'wait' || !src || !el) return;
    if (el.complete && el.naturalWidth) {
      shown.add(src);
      setLook('in');
    }
  }, [src, look]);

  const arrive = (at: string | null) => {
    if (at) shown.add(at);
    setLook('in');
  };
  return {
    ref,
    src,
    look,
    onLoad: () => {
      const el = ref.current;
      if (!develop || !el?.decode) {
        arrive(src);
        return;
      }
      const at = src;
      const done = () => {
        if (el.isConnected && el.getAttribute('src') === at) arrive(at);
      };
      el.decode().then(done, done);
    },
    onError: () => setLook('failed'),
  };
}

/**
 * A photo by its address with v1's loading look (js/learn.js imgTag and wireFaces): it shimmers in its frame,
 * fades in once, and if it can't load it hides (.is-gone) so the card's own colour shows instead. Learn uses it, so
 * it never draws a wash or any other photo: the neutral frame can't give an answer away.
 */
export function FadeImage({ src, alt = '', className }: { src: string; alt?: string; className?: string }) {
  const p = usePhotoLoad(src);
  return (
    <img
      ref={p.ref}
      className={cx(className, 'fade', p.look === 'in' && 'in', p.look === 'failed' && 'is-gone')}
      src={p.src || undefined}
      alt={alt}
      decoding="async"
      onLoad={p.onLoad}
      onError={p.onError}
    />
  );
}

/** The species page hero's photo: the address the page drew it with, and the same photo at tile size. */
export interface HeroPhotoSrc {
  /** Undefined while the slide isn't woken yet, or while the photo index and gallery.json are still being read. */
  src?: string;
  /** The tile-sized copy (sized(id, 'small'), the same address as the dex tile), or none for a gallery photo. */
  small?: string | null;
}

interface Props {
  sp: Species;
  size?: 'small' | 'large';
  className?: string;
  /** Show the whole photo (letterboxed over a blurred copy) instead of cropping. */
  whole?: boolean;
  /** v1 birdImg's alt: the name, or '' where the name is written right beside it, so it isn't read twice. */
  alt?: string;
  /** The hero photo: fetched first rather than lazily (v1 prioritiseHero). */
  eager?: boolean;
  /**
   * Hero mode, for the species page: the small photo underneath, soft, while the large one loads; the large one
   * develops in over it once decoded; if it can't load (no signal) the small one stays, sharper. Under both, the
   * plumage wash, so the hero is never an empty block.
   */
  hero?: HeroPhotoSrc;
}

/**
 * The dex photo for a species: v1's birdImg, with its fallbacks and its loading look (shimmer, a single fade-in,
 * no fade for a photo already shown, a better photo swapped in without blanking).
 */
export function SpeciesImage(props: Props) {
  // A different species starts afresh rather than keeping the old one's photo until the new one has decoded.
  if (props.hero) return <HeroPhoto key={props.sp.id} {...props} hero={props.hero} />;
  return <SpeciesPhoto key={props.sp.id} {...props} />;
}

function SpeciesPhoto({ sp, size = 'small', className, whole = false, alt = sp.name, eager = false }: Props) {
  useMedia();
  const p = usePhotoLoad(sized(sp.id, size) as string | null);
  if (!p.src || p.look === 'failed') {
    // The saved photo index or gallery.json isn't read yet: the photo is on its way, so it shimmers in its frame.
    if (!p.src && !mediaSettled()) return <img className={cx(className, 'fade')} alt="" aria-hidden="true" />;
    // No photo, or it wouldn't load: v1's striped no-photo block rather than a broken image.
    return <span className={cx(className, 'img-missing')} {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })} />;
  }
  const fade = p.look === 'in' ? 'fade in' : 'fade';
  const load = { loading: eager ? 'eager' : 'lazy', fetchPriority: eager ? 'high' : undefined, decoding: 'async' } as const;
  if (whole) {
    return (
      <span className={cx('whole', className)}>
        <img className={cx('whole-bg', fade)} src={p.src} alt="" aria-hidden="true" {...load} />
        <img ref={p.ref} className={cx('whole-fg', fade)} src={p.src} alt={alt} {...load} onLoad={p.onLoad} onError={p.onError} />
      </span>
    );
  }
  return <img ref={p.ref} className={cx(className, fade)} src={p.src} alt={alt} {...load} onLoad={p.onLoad} onError={p.onError} />;
}

/**
 * Hero mode (species.css draws it): two stacked photos in a `.whole` frame painted with the plumage wash.
 * - .whole-bg: the small photo (memory, HTTP or service-worker cache, as the dex tile drew it), soft and a touch
 *   larger than the frame;
 * - .whole-fg: the large photo, which develops in (opacity and blur) once it has loaded and decoded.
 * A photo already shown this session is drawn at once. If the large one fails, .is-small keeps the small one; with
 * no small one either, the frame is v1's no-photo block (.img-missing), as before.
 */
function HeroPhoto({ sp, hero, className, alt = sp.name, eager = false }: Props & { hero: HeroPhotoSrc }) {
  const top = usePhotoLoad(hero.src, { develop: true });
  const base = usePhotoLoad(hero.small && hero.small !== hero.src ? hero.small : null);
  // A small copy once drawn stays, even if a later photo index no longer offers one for this photo (the hero keeps
  // the photos it was drawn with), so the frame never empties under a large photo still on its way.
  const small = base.src && base.src !== top.src ? base.src : null;
  const failed = top.look === 'failed';
  const keepSmall = failed && !!small && base.look !== 'failed';
  const loading = eager ? 'eager' : 'lazy';
  return (
    <span
      className={cx('whole', className, keepSmall && 'is-small', failed && !keepSmall && 'img-missing')}
      style={{ '--wash': washFor(sp) } as CSSProperties}
    >
      {small ? (
        <img
          ref={base.ref}
          className={cx('whole-bg', 'fade', base.look === 'in' && 'in')}
          src={small}
          alt=""
          aria-hidden="true"
          loading={loading}
          onLoad={base.onLoad}
          onError={base.onError}
        />
      ) : null}
      <img
        ref={top.ref}
        className={cx('whole-fg', 'fade', top.look === 'in' && 'in')}
        src={top.src || undefined}
        alt={alt}
        loading={loading}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
        onLoad={top.onLoad}
        onError={top.onError}
      />
    </span>
  );
}

/** The green-ringed dex number badge shown on tiles and rows. */
export function Band({ sp, seen }: { sp: Species; seen: boolean }) {
  return (
    <span
      className={`band band--${sp.kind} ${seen ? 'band--on' : ''}`}
      aria-label={`Dex number ${dexCode(sp.id)}`}
    >
      {dexCode(sp.id)}
    </span>
  );
}

/** Five-dot rarity pips. */
export function Pips({ rarity }: { rarity: number }) {
  return (
    <span className={`pips pips--${rarity}`} title={RARITY[rarity]?.label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= rarity ? 'on' : ''} />
      ))}
    </span>
  );
}
