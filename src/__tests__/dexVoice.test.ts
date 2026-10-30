// @vitest-environment jsdom
// The dex voice: the words it reads for a species, and that it speaks through the phone's voice and stops cleanly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byId } from '../lib/data';
import type { Species } from '../lib/data';
import { canSpeak, dexEntry, speakEntry, spokenNumber, stopSpeaking } from '../screens/dexVoice';

const kookaburra = byId.get(94) as Species;

describe('the dex entry', () => {
  it('reads a number digit by digit, with its kind letter', () => {
    expect(spokenNumber('094')).toBe('zero nine four');
    expect(spokenNumber('M07')).toBe('M zero seven');
  });

  it('reads the name, number, group, field note, size and how common it is', () => {
    expect(dexEntry(kookaburra)).toBe(
      'Laughing Kookaburra. Bird number zero nine four, from the kingfishers and kin. ' +
      'The giant kingfisher with the famous laugh. Brown eye stripe and a little blue on the wing. ' +
      'Length 45 centimetres. Common in South East Queensland.',
    );
  });

  it('says an animal is active at night, and reads units as words', () => {
    const owl = [...byId.values()].find((s) => s.nocturnal && s.kind === 'bird') as Species;
    const text = dexEntry(owl);
    expect(text).toContain('Most active at night.');
    expect(text).not.toMatch(/\d\s*cm\b/);
  });

  it('gives every species an entry that ends each sentence', () => {
    for (const sp of byId.values()) {
      const text = dexEntry(sp);
      expect(text.startsWith(`${sp.name}.`)).toBe(true);
      expect(text).toMatch(/[.!?]$/);
      expect(text).not.toMatch(/\.\./);
    }
  });
});

describe('speaking', () => {
  const spoken: { text: string; pitch: number; rate: number; lang: string }[] = [];
  let cancelled = 0;
  beforeEach(() => {
    spoken.length = 0;
    cancelled = 0;
    class Utterance {
      text: string; pitch = 1; rate = 1; lang = ''; voice: unknown = null;
      onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'en-US', default: true }, { lang: 'en-AU', default: false }],
        speak: (u: Utterance) => spoken.push(u),
        cancel: () => { cancelled += 1; },
      },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads the entry in a steady, lower voice, preferring an Australian one', () => {
    expect(canSpeak()).toBe(true);
    expect(speakEntry(kookaburra)).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe(dexEntry(kookaburra));
    expect(spoken[0].lang).toBe('en-AU');
    expect(spoken[0].pitch).toBeLessThan(1);
  });

  it('stops whatever is playing before reading another, and on stop', () => {
    speakEntry(kookaburra);
    const before = cancelled;
    speakEntry(kookaburra);
    expect(cancelled).toBe(before + 1);
    stopSpeaking();
    expect(cancelled).toBe(before + 2);
  });
});
