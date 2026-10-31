// @vitest-environment jsdom
// Whose BirdyDex it is: plain "BirdyDex" for everyone, "Tom's BirdyDex" once signed in with a name.
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ signed: false, displayName: '', googleName: '' }));
vi.mock('../core/profile.js', () => ({
  signedIn: () => state.signed,
  getProfile: () => ({ displayName: state.displayName }),
}));
vi.mock('../core/cloud.js', () => ({
  user: () => (state.signed ? { id: 'u', email: 'tmb@example.com', name: state.googleName } : null),
}));

import { dexTitle, firstName, myFirstName, rememberFirstName, storedFirstName } from '../lib/dexName';

afterEach(() => { Object.assign(state, { signed: false, displayName: '', googleName: '' }); localStorage.clear(); });

describe('whose dex', () => {
  it('is plain BirdyDex for everyone who is not signed in', () => {
    expect(myFirstName()).toBe('');
    expect(dexTitle(myFirstName())).toBe('BirdyDex');
  });

  it("says the first name from her profile once she is signed in", () => {
    Object.assign(state, { signed: true, displayName: 'Tom Smith' });
    expect(dexTitle(myFirstName())).toBe("Tom's BirdyDex");
  });

  it('falls back to her Google name, and never to her email', () => {
    Object.assign(state, { signed: true, googleName: 'Adam Jones' });
    expect(myFirstName()).toBe('Adam');
    Object.assign(state, { googleName: '' });
    expect(myFirstName()).toBe('');
  });

  it('keeps a first name short and trims spaces', () => {
    expect(firstName('  Sarah  ')).toBe('Sarah');
    expect(firstName('Bartholomew-Alexander-Fitzgerald Smith')).toHaveLength(20);
    expect(firstName(null)).toBe('');
  });

  it('remembers the name in this browser for the shell, and forgets it', () => {
    rememberFirstName('Tom');
    expect(storedFirstName()).toBe('Tom');
    rememberFirstName('');
    expect(storedFirstName()).toBe('');
  });
});
