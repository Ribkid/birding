// The speaker that reads a species' dex entry aloud, and stops it. Not drawn where the phone has no speech.
import type { Species } from '../lib/data';
import { canSpeak, speakEntry, stopSpeaking, useSpeakingId } from '../screens/dexVoice';

const SpeakerIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    {on ? <path d="M17 9v6M21 9v6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13" />}
  </svg>
);

export function DexVoiceButton({ sp, className = '' }: { sp: Species; className?: string }) {
  const speaking = useSpeakingId() === sp.id;
  if (!canSpeak()) return null;
  return (
    <button
      type="button"
      className={className}
      data-dexvoice=""
      aria-pressed={speaking}
      aria-label={speaking ? `Stop reading the ${sp.name} entry` : `Read the ${sp.name} entry aloud`}
      onClick={() => { if (speaking) stopSpeaking(); else speakEntry(sp); }}
    >
      <SpeakerIcon on={speaking} />
    </button>
  );
}
