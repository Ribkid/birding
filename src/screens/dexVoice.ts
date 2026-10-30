// The dex voice. When she catches something new, or taps the speaker on a species page, the phone reads its dex
// entry the way a collector's dex would: a short chirp, then the name, its number and group, the field note, its
// size and how common it is here. It uses the phone's own speech voices, so it costs nothing and works offline; where
// a browser has no speech, nothing plays and the speaker button is not drawn.
import { useSyncExternalStore } from 'react';
import { db } from '../core/db.js';
import { GROUPS, KINDS, RARITY, dexCode } from '../core/species.js';
import type { Species } from '../lib/data';
import { sizeFact } from './speciesFacts';

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const LETTERS: Record<string, string> = { M: 'M', R: 'R', F: 'F', B: 'B', P: 'P' };

/** "094" reads as "zero nine four", "M07" as "M zero seven", as a dex number is read out. */
export function spokenNumber(code: string): string {
  return code.split('').map(ch => (/\d/.test(ch) ? DIGITS[Number(ch)] : LETTERS[ch] || ch)).join(' ');
}

// Units a speech voice would otherwise read as letters.
const spokenUnits = (s: string) =>
  s.replace(/(\d)\s*cm\b/g, '$1 centimetres').replace(/(\d)\s*mm\b/g, '$1 millimetres').replace(/(\d)\s*m\b/g, '$1 metres')
    .replace(/(\d)\s*kg\b/g, '$1 kilograms').replace(/(\d)\s*g\b/g, '$1 grams');

const sentence = (s: string) => { const t = s.trim(); return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`; };

/** The words the dex reads for a species. */
export function dexEntry(sp: Species): string {
  const kind = (KINDS as Record<string, { one: string }>)[sp.kind]?.one || sp.kind;
  const group = (GROUPS as Record<string, string>)[sp.group];
  const size = sizeFact(sp);
  const rarity = (RARITY as Record<number, { label: string }>)[sp.rarity]?.label;
  return [
    sentence(sp.name),
    sentence(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} number ${spokenNumber(dexCode(sp.id))}${group ? `, from the ${group.toLowerCase().replace(/\s*&\s*/g, ' and ')}` : ''}`),
    sentence(sp.notes || ''),
    size ? sentence(spokenUnits(`${size[0]} ${size[1].charAt(0).toLowerCase()}${size[1].slice(1)}`)) : '',
    sp.nocturnal ? 'Most active at night.' : '',
    rarity ? sentence(`${rarity} in South East Queensland`) : '',
  ].filter(Boolean).join(' ');
}

export const canSpeak = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

// An Australian voice where the phone has one, then British, then any English voice.
function pickVoice(): SpeechSynthesisVoice | undefined {
  const en = window.speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  return en.find(v => /AU$/i.test(v.lang)) || en.find(v => /GB$/i.test(v.lang)) || en.find(v => v.default) || en[0];
}

// Two quick rising tones, the dex waking up. Quiet, and skipped where Web Audio is missing.
let audio: AudioContext | null = null;
function chirp() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ||= new Ctx();
    const t0 = audio.currentTime + 0.01;
    [880, 1320].forEach((hz, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'square';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.04, t0 + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.08);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t0 + i * 0.09);
      osc.stop(t0 + i * 0.09 + 0.09);
    });
  } catch { /* no sound is fine */ }
}

let speakingId: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

/** Read a species' entry aloud. Returns false where the phone has no speech. Any entry already playing stops. */
export function speakEntry(sp: Species): boolean {
  if (!canSpeak()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  chirp();
  const u = new SpeechSynthesisUtterance(dexEntry(sp));
  const voice = pickVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-AU';
  // A steady, slightly lower voice reads like a device, not a person.
  u.rate = 0.95;
  u.pitch = 0.8;
  const end = () => { if (speakingId === sp.id) { speakingId = null; notify(); } };
  u.onend = end;
  u.onerror = end;
  speakingId = sp.id;
  notify();
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
  if (speakingId != null) { speakingId = null; notify(); }
}

/** Which species is being read right now, or null. */
export function useSpeakingId(): number | null {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => listeners.delete(fn); },
    () => speakingId,
    () => null,
  );
}

/** "Read new finds aloud" in Settings; on unless she turned it off. */
export async function dexVoiceOn(): Promise<boolean> {
  try { return ((await db.kvGet('settings')) as { dexVoice?: boolean } | null)?.dexVoice !== false; } catch { return true; }
}

export async function setDexVoice(on: boolean) {
  const current = ((await db.kvGet('settings')) as Record<string, unknown> | null) || {};
  await db.kvSet('settings', { ...current, dexVoice: on });
  if (!on) stopSpeaking();
}
