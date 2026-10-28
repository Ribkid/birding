// The Learn hub's photos, as v1 picked them (js/learn.js faceSrc, tintable, modeFaces, heroFace and packCovers): the
// same species from the same seeds, the practice cards' and covers' picks kept for the day once made.
import { byId, SPECIES, type Species } from '../../lib/data';
import * as Q from '../../core/quiz.js';
import { dayStr, packs as PACKS } from '../../core/learn.js';

export const faceSrc = (id: number, size = 'small') => Q.photosFor(id, { size, prefer: 'wiki' })[0]?.src || '';
// Only pictures served with CORS (Wikimedia, or this app's own files) can lend their colour; reading any other
// would fail and log an error, so those cards keep their kind colour.
export const tintable = (src: string) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src) || (!!src && new URL(src, location.href).origin === location.origin);

// One photo per practice card, the same all day for a kind: commoner species, none twice, a look-alike pair for duels.
let faceCache: { key: string; v: Record<string, number[]> | null } = { key: '', v: null };
export function modeFaces(kind: string): Record<string, number[]> {
  const key = `${dayStr()}|${kind}`;
  if (faceCache.key === key && faceCache.v) return faceCache.v;
  const all: Species[] = Q.speciesFor(kind).filter(Q.hasPhoto);
  if (!all.length) return {}; // no photos yet: try again next time
  const rng = Q.seeded(Q.hashStr(`faces|${key}`));
  const common = all.filter((s) => s.rarity <= 2);
  const pool: Species[] = Q.shuffle((common.length >= 12 ? common : all).slice(), rng);
  const inKind = (s?: Species) => !!s && Q.hasPhoto(s) && (kind === 'animals' ? s.kind !== 'plant' : s.kind === kind);
  const pairs = (Q.lookalikePairs() as { a: number; b: number }[]).filter((x) => inKind(byId.get(x.a)) && inKind(byId.get(x.b)));
  const pair = Q.shuffle(pairs, rng)[0] as { a: number; b: number } | undefined;
  const used = new Set<number>(pair ? [pair.a, pair.b] : []);
  const v: Record<string, number[]> = {};
  if (pair) v.duel = [pair.a, pair.b];
  for (const m of Q.MODES as string[]) {
    if (v[m]) continue;
    const ok = m === 'call' ? (s: Species) => Q.CALL_KINDS.includes(s.kind) && Q.hasCall(s.id) : () => true;
    const s = pool.find((x) => !used.has(x.id) && ok(x)) || pool.find((x) => !used.has(x.id));
    if (s) { used.add(s.id); v[m] = [s.id]; }
  }
  faceCache = { key, v };
  return v;
}
// The challenge card takes its colour from a species about this month that isn't in today's set (that set is drawn
// from the commonest, 80% of peak and up), so the picture never gives an answer away.
export function heroFace(month: number): Species | null {
  const rate = (s: Species) => Q.relRate(s.id, month) ?? 0;
  let list = SPECIES.filter((s) => rate(s) >= 0.5 && rate(s) < 0.8 && Q.hasPhoto(s));
  if (!list.length) list = SPECIES.filter((s) => s.rarity <= 2 && Q.hasPhoto(s));
  const tinted = list.filter((s) => tintable(faceSrc(s.id)));
  if (tinted.length) list = tinted;
  return list.length ? list[(Q.seeded(Q.hashStr(`hero|${dayStr()}`))() * list.length) | 0] : null;
}
// A cover photo per pack, the same all day, no species on two covers; commoner ones where the pack has them.
let coverCache: { key: string; v: Record<string, number> | null } = { key: '', v: null };
export function packCovers(): Record<string, number> {
  const key = dayStr();
  if (coverCache.key === key && coverCache.v) return coverCache.v;
  const used = new Set<number>();
  const v: Record<string, number> = {};
  for (const p of PACKS as { key: string }[]) {
    let list: Species[] = Q.packSpecies(p.key).filter(Q.hasPhoto);
    if (!list.length) continue;
    const framed = list.filter((s) => tintable(faceSrc(s.id))); // Wikipedia lead photos are framed on the animal
    if (framed.length >= 3) list = framed;
    const common = list.filter((s) => s.rarity <= 3);
    const pool: Species[] = Q.shuffle((common.length >= 3 ? common : list).slice(), Q.seeded(Q.hashStr(`pack|${key}|${p.key}`)));
    const s = pool.find((x) => !used.has(x.id)) || pool[0];
    used.add(s.id);
    v[p.key] = s.id;
  }
  if (Object.keys(v).length >= PACKS.length - 2) coverCache = { key, v }; // keep trying until the photos are in
  return v;
}
