// Extra photos (data/gallery.json) and sourced write-ups (data/info.json) for each species.
let gallery = null, info = null, loading = null;
const BASE = new URL('../data/', import.meta.url);

export function loadExtras() {
  if (loading) return loading;
  loading = Promise.all([
    fetch(new URL('gallery.json', BASE)).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch(new URL('info.json', BASE)).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([g, i]) => { gallery = g || {}; info = i || {}; });
  return loading;
}

const okPhoto = p => p && typeof p.src === 'string' && /^https:\/\//.test(p.src);
export const galleryFor = id => (gallery?.[id] || []).filter(okPhoto);
export const infoFor = id => {
  const x = info?.[id];
  if (!x || !x.text) return null;
  return { text: String(x.text), status: x.status || '', sources: (x.sources || []).filter(s => s && /^https?:\/\//.test(s.url || '')) };
};
// First gallery photo, used when Wikipedia has no picture for a species.
export function galleryCover(id, size = 'small') {
  const p = galleryFor(id)[0];
  if (!p) return null;
  return size === 'small' ? (p.thumb || p.src) : p.src;
}
