// Which photos the species hero shows, as v1 drew them (birding-refresh js/app.js renderBird and boot):
// - the photos known when the page is drawn;
// - drawn again when gallery.json arrives later (v1 drew the page again), unless she has already touched the gallery;
// - a photo index arriving later doesn't change a hero that has photos (v1 swapped better photos in only where it
//   could without redrawing, and drew a species page again only when its hero had no photo at all).
// A photo still on show takes the latest copy of itself (its credit can arrive after it).
export interface Drawn<T> { photos: T[]; gallery: string }

export function heroShown<T extends { src: string; wiki?: boolean }>(drawn: Drawn<T> | null, live: T[], touched: boolean): Drawn<T> {
  const gallery = live.filter((p) => !p.wiki).map((p) => p.src).join('|');
  const redraw = !drawn || !drawn.photos.length || (!touched && drawn.gallery !== gallery);
  return { photos: redraw ? live : drawn.photos.map((k) => live.find((l) => l.src === k.src) || k), gallery };
}
