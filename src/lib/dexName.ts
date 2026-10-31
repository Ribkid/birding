// Whose BirdyDex this is: "Tom's BirdyDex" once someone is signed in with a name, plain "BirdyDex" for everyone else.
// The first name is kept in this browser too, so the static shell in index.html can say it before React runs.
import { getProfile, signedIn } from '../core/profile.js';
import { user } from '../core/cloud.js';

export const NAME_KEY = 'birddex-name';

/** The first word of a display name, at most 20 characters ("Tom Smith" → "Tom"). */
export function firstName(display: string | null | undefined): string {
  return (String(display || '').trim().split(/\s+/)[0] || '').slice(0, 20);
}

export const dexTitle = (first: string) => (first ? `${first}'s BirdyDex` : 'BirdyDex');

/** The signed-in person's first name from their profile or their Google name; never their email. */
export function myFirstName(): string {
  if (!signedIn()) return '';
  const p = getProfile() as { displayName?: string } | null;
  return firstName(p?.displayName || user()?.name || '');
}

export function storedFirstName(): string {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function rememberFirstName(first: string) {
  try {
    if (first) localStorage.setItem(NAME_KEY, first);
    else localStorage.removeItem(NAME_KEY);
  } catch { /* private mode: the shell just says BirdyDex */ }
}
