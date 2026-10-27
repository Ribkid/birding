// The page title and the frosted top bar's title come from the screen's heading, as v1's afterDraw did
// (js/app.js:952). v1 read it after every draw and again when a screen's data arrived; here a MutationObserver on
// #view does the same, so a heading that renders late (Learn, a round's prompt, an outing's place) is picked up.

const text = (h1: Element, strip: string) => {
  const c = h1.cloneNode(true) as Element;
  c.querySelectorAll(strip).forEach(n => n.remove());
  return (c.textContent || '').replace(/\s+/g, ' ').trim();
};

/** v1: the heading without its <small> line, or "Sarah's BirdyDex" when there is none or it already says so. */
export function titleFor(view: ParentNode | null): string {
  const h1 = view?.querySelector('h1');
  const t = h1 ? text(h1, 'small') : '';
  return !t || /BirdyDex/.test(t) ? "Sarah's BirdyDex" : `${t} – BirdyDex`;
}

let lastH1: Element | null = null;
let lastRaw: string | null = null;

/** Bring document.title and the top bar's title up to date with the heading in view. */
export function syncTitle(view: HTMLElement, { force = false } = {}) {
  const h1 = view.querySelector('h1');
  const raw = h1 ? h1.textContent : null;
  if (!force && h1 === lastH1 && raw === lastRaw) return;
  lastH1 = h1;
  lastRaw = raw;
  const t = titleFor(view);
  if (document.title !== t) document.title = t;
  // The frosted bar (lib/look.ts) shows the same heading without <small> or screen-reader-only text.
  const bar = document.querySelector('#topbar .topbar-title');
  const bt = h1 ? text(h1, 'small, .sr-only') : '';
  if (bar && bar.textContent !== bt) bar.textContent = bt;
}

/** Keep the titles in step with #view for as long as it lives. Returns a stop function. */
export function watchTitle(view: HTMLElement): () => void {
  const mo = new MutationObserver(() => syncTitle(view));
  mo.observe(view, { childList: true, subtree: true, characterData: true });
  syncTitle(view, { force: true });
  return () => mo.disconnect();
}
