// How a spot reads on its card and its page: its tidied eBird name, whether it's restricted, the bird it leads with
// and how long ago something was seen. Pure, so the list, the page and the tests share one answer.
import { byId, type Species } from './data';

/** eBird hotspot names put "--" between a place and a part of it, and access notes in brackets. */
export function tidySpotName(raw: string): { name: string; restricted: boolean } {
  const restricted = /\((?:some areas )?restricted access\)/i.test(raw);
  const name = raw
    .replace(/\s*\((?:some areas )?restricted access\)\s*/gi, ' ')
    .replace(/\s*--\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, restricted };
}

// A small stable hash, so a spot always leads with the same bird while its neighbours differ.
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * The birds at a spot she hasn't seen, most findable first: fairly common and uncommon birds come before the very
 * common (nearly everywhere, so they say little about the spot) and the rare (unlikely on the day).
 */
export function birdsToFind(ids: number[], seen: Set<number>, key: string): Species[] {
  return ids
    .filter((id) => !seen.has(id))
    .map((id) => byId.get(id))
    .filter((s): s is Species => Boolean(s))
    .sort((a, b) => Math.abs(a.rarity - 2.5) - Math.abs(b.rarity - 2.5) || (hash(key + a.id) % 997) - (hash(key + b.id) % 997));
}

/** The bird a spot leads with: one she could find there, or else one recorded there. */
export function featureBird(ids: number[], seen: Set<number>, key: string): Species | undefined {
  const toFind = birdsToFind(ids, seen, key)[0];
  if (toFind) return toFind;
  const all = ids.map((id) => byId.get(id)).filter((s): s is Species => Boolean(s));
  return all.length ? all[hash(key) % all.length] : undefined;
}

/** "Today", "Yesterday" or "3 days ago"; the date itself once it's more than a fortnight back. */
export function seenAgo(date: string, now = Date.now()): string {
  const then = new Date(date.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(new Date(now)) - day(then)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 14) return `${days} days ago`;
  return then.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
