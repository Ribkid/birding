// The photo-first, glassy look: a frosted top bar that takes over the page title once the big title scrolls away,
// colours drawn from a species photo, and a one-time staggered entrance for grids. No dependencies.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
let bar: HTMLElement | null = null, io: IntersectionObserver | null = null, watched: Element | null = null;

export function initLook() {
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'topbar';
  bar.className = 'topbar glass';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<button type="button" class="topbar-back" tabindex="-1" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><span class="topbar-title"></span>';
  document.body.prepend(bar);
  bar.addEventListener('click', e => {
    const b = bar!;
    if ((e.target as Element).closest('.topbar-back')) { (b as any)._back?.click(); return; }
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

export function lookAfterDraw(view: HTMLElement | null) {
  if (!view) return;
  if (!bar) initLook();
  const b = bar!;
  const h1 = $('h1', view);
  const hero = $('[data-hero-zone], .bird-hero, .dex-hero', view);
  let title = '';
  if (h1) {
    const c = h1.cloneNode(true) as HTMLElement;
    c.querySelectorAll('small, .sr-only').forEach(n => n.remove());
    title = (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  $('.topbar-title', b)!.textContent = title;
  const back = $('.page-head--back .iconbtn, .bird-hero .iconbtn--float:not(.iconbtn--right), [data-quit]', view);
  (b as any)._back = back || null;
  ($('.topbar-back', b) as HTMLElement).hidden = !back;
  document.body.classList.toggle('has-hero', !!hero);
  for (const k of ['--tint', '--tint-deep', '--tint-soft', '--tint-soft-dark', '--tint-ink-dark']) view.style.removeProperty(k);
  view.classList.remove('tinted');
  const heroImgs = [...view.querySelectorAll<HTMLImageElement>('.bird-hero img.whole-fg, .bird-hero .slide img, [data-hero-frame] img')];
  const heroImg = heroImgs.find(i => readable(i.currentSrc || i.src || ''));
  if (heroImg) void applyTint(view, heroImg.currentSrc || heroImg.src);
  const own = $('.dex-tools, .mapwrap, [data-own-topbar]', view);
  const target = own ? null : hero || h1;
  if (io && watched !== target) { io.disconnect(); io = null; }
  if (!target) { document.body.classList.remove('is-scrolled'); return; }
  if (!io) {
    io = new IntersectionObserver(([en]) => document.body.classList.toggle('is-scrolled', !en.isIntersecting && en.boundingClientRect.top < 0),
      { rootMargin: `-${hero ? 120 : 60}px 0px 0px 0px` });
    io.observe(target);
    watched = target;
  }
}

// ---------- colour from a photo ----------
const tints = new Map<string, Promise<{ rgb: number[] } | null>>();
// Only hosts that send CORS headers can be read back from a canvas; asking any other host logs an error.
const READABLE = /^(https:\/\/(upload|thumb)\.wikimedia\.org\/|https:\/\/inaturalist-open-data\.s3\.amazonaws\.com\/|blob:|data:)/;
const readable = (url: string) => READABLE.test(url) || url.startsWith(location.origin);

export function tintFrom(url: string): Promise<{ rgb: number[] } | null> {
  if (!url || !readable(url)) return Promise.resolve(null);
  if (tints.has(url)) return tints.get(url)!;
  const p = new Promise<{ rgb: number[] } | null>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const n = 24, c = document.createElement('canvas'); c.width = n; c.height = n;
        const cx = c.getContext('2d', { willReadFrequently: true });
        if (!cx) { resolve(null); return; }
        cx.drawImage(img, 0, 0, n, n);
        const d = cx.getImageData(0, 0, n, n).data;
        // Weight each pixel by how colourful and mid-bright it is, so a green leaf or a red breast wins over sky and shadow.
        let r = 0, g = 0, bl = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = mx ? (mx - mn) / mx : 0, val = mx / 255;
          const wt = sat * sat * (1 - Math.abs(val - 0.55) * 1.4) + 0.02;
          if (wt <= 0) continue;
          r += R * wt; g += G * wt; bl += B * wt; w += wt;
        }
        resolve(w ? { rgb: [r / w, g / w, bl / w].map(Math.round) } : null);
      } catch (_) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tints.set(url, p);
  return p;
}

const toHsl = ([r, g, b]: number[]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
// WCAG contrast of white text on an HSL colour, so the accent can be darkened until white text passes 4.5:1.
function whiteContrast(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const ch = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const Y = 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(8)) + 0.0722 * lin(ch(4));
  return 1.05 / (Y + 0.05);
}

export async function applyTint(el: HTMLElement | null, url: string, fallback: string | null = null) {
  const t = await tintFrom(url);
  if (!el?.isConnected) return;
  if (!t) { if (fallback) el.style.setProperty('--tint', fallback); return; }
  const [h, s0] = toHsl(t.rgb), s = Math.min(0.75, Math.max(0.28, s0));
  let L = 0.36;
  while (L > 0.18 && whiteContrast(h, s, L) < 4.6) L -= 0.02;
  el.style.setProperty('--tint', hsl(h, s, L));
  el.style.setProperty('--tint-deep', hsl(h, Math.min(0.6, s), 0.16));
  el.style.setProperty('--tint-soft', hsl(h, Math.min(0.5, s), 0.92));
  el.style.setProperty('--tint-soft-dark', hsl(h, Math.min(0.45, s), 0.2));
  el.style.setProperty('--tint-ink-dark', hsl(h, Math.min(0.7, s + 0.1), 0.74));
  el.classList.add('tinted');
}

// ---------- entrances ----------
const played = new Set<string>();
export function stagger(root: ParentNode | null, selector: string, { key = selector, max = 18 }: { key?: string; max?: number } = {}) {
  if (!root || played.has(key) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  played.add(key);
  const items = [...root.querySelectorAll<HTMLElement>(selector)].slice(0, max);
  items.forEach((el, i) => { el.style.setProperty('--i', String(i)); el.classList.add('enter'); });
  setTimeout(() => items.forEach(el => el.classList.remove('enter')), 1400);
}
export const tintable = (src: string) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src) || (!!src && new URL(src, location.href).origin === location.origin);
