// The photo-first, glassy look: a frosted top bar that takes over the page title once the big title scrolls away,
// colours drawn from a species photo, and a one-time staggered entrance for grids. No dependencies.
//
// API:
//   initLook()                    -> creates the #topbar once (call at boot)
//   lookAfterDraw(view)           -> after every screen draw: wire the top bar to this screen's title and back control
//   tintFrom(url) -> Promise<{ rgb: [r,g,b] } | null>   dominant, lively colour of a photo (null if the photo can't be read)
//   applyTint(el, url, fallback)  -> sets --tint, --tint-ink, --tint-soft and --tint-deep on el
//   stagger(root, selector, { key, max }) -> fade-and-rise the first items once per session per key

const $ = (s, r = document) => r.querySelector(s);
let bar = null, io = null, watched = null;

export function initLook() {
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'topbar';
  bar.className = 'topbar glass';
  bar.setAttribute('aria-hidden', 'true'); // the page's own heading and back control stay the accessible ones
  bar.innerHTML = '<button type="button" class="topbar-back" tabindex="-1" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><span class="topbar-title"></span>';
  document.body.prepend(bar);
  bar.addEventListener('click', e => {
    if (e.target.closest('.topbar-back')) { bar._back?.click(); return; }
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

// The top bar shows once the screen's big title (or its hero) has scrolled under it.
export function lookAfterDraw(view) {
  if (!bar) initLook();
  const h1 = $('h1', view);
  const hero = $('[data-hero-zone], .bird-hero, .dex-hero', view);
  let title = '';
  if (h1) { const c = h1.cloneNode(true); c.querySelectorAll('small, .sr-only').forEach(n => n.remove()); title = c.textContent.replace(/\s+/g, ' ').trim(); }
  $('.topbar-title', bar).textContent = title;
  const back = $('.page-head--back .iconbtn, .bird-hero .iconbtn--float:not(.iconbtn--right), [data-quit]', view);
  bar._back = back || null;
  $('.topbar-back', bar).hidden = !back;
  document.body.classList.toggle('has-hero', !!hero);
  // Colour from the species photo on screen; cleared on every other screen so it never leaks.
  for (const k of ['--tint', '--tint-deep', '--tint-soft', '--tint-soft-dark', '--tint-ink-dark']) view.style.removeProperty(k);
  view.classList.remove('tinted');
  const heroImg = $('.bird-hero img.whole-fg, .bird-hero .slide img, [data-hero] img', view);
  if (heroImg?.src) applyTint(view, heroImg.currentSrc || heroImg.src);
  // Screens with their own top controls (the dex's sticky search, the map's search bar) keep them instead.
  const own = $('.dex-tools, .mapwrap, [data-own-topbar]', view);
  const target = own ? null : hero || h1;
  if (io && watched !== target) { io.disconnect(); io = null; }
  if (!target) { document.body.classList.remove('is-scrolled'); return; }
  if (!io) {
    io = new IntersectionObserver(([en]) => document.body.classList.toggle('is-scrolled', !en.isIntersecting && en.boundingClientRect.top < 0),
      { rootMargin: `-${hero ? 120 : 60}px 0px 0px 0px` });
    io.observe(target); watched = target;
  }
}

// ---------- colour from a photo ----------
const tints = new Map();
export function tintFrom(url) {
  if (!url) return Promise.resolve(null);
  if (tints.has(url)) return tints.get(url);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const n = 24, c = document.createElement('canvas'); c.width = n; c.height = n;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, n, n);
        const d = cx.getImageData(0, 0, n, n).data;
        // Weight each pixel by how colourful and mid-bright it is, so a green leaf or a red breast wins over sky and shadow.
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = mx ? (mx - mn) / mx : 0, val = mx / 255;
          const wt = sat * sat * (1 - Math.abs(val - 0.55) * 1.4) + 0.02;
          if (wt <= 0) continue;
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        resolve(w ? { rgb: [r / w, g / w, b / w].map(Math.round) } : null);
      } catch (_) { resolve(null); } // a photo from a server without CORS taints the canvas
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tints.set(url, p);
  return p;
}

const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;

// Accent colours that stay readable: a mid tone for fills (white text passes), a deep tone for gradients behind
// white titles, and a soft wash for tinted surfaces. Dark mode lifts the ink tone.
export async function applyTint(el, url, fallback = null) {
  const t = await tintFrom(url);
  if (!el?.isConnected) return;
  if (!t) { if (fallback) el.style.setProperty('--tint', fallback); return; }
  const [h, s0] = toHsl(t.rgb), s = Math.min(0.75, Math.max(0.28, s0));
  el.style.setProperty('--tint', hsl(h, s, 0.36));
  el.style.setProperty('--tint-deep', hsl(h, Math.min(0.6, s), 0.16));
  el.style.setProperty('--tint-soft', hsl(h, Math.min(0.5, s), 0.92));
  el.style.setProperty('--tint-soft-dark', hsl(h, Math.min(0.45, s), 0.2));
  el.style.setProperty('--tint-ink-dark', hsl(h, Math.min(0.7, s + 0.1), 0.74));
  el.classList.add('tinted');
}

// ---------- entrances ----------
const played = new Set();
export function stagger(root, selector, { key = selector, max = 18 } = {}) {
  if (!root || played.has(key) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  played.add(key);
  const items = [...root.querySelectorAll(selector)].slice(0, max);
  items.forEach((el, i) => { el.style.setProperty('--i', i); el.classList.add('enter'); });
  setTimeout(() => items.forEach(el => el.classList.remove('enter')), 1400);
}
