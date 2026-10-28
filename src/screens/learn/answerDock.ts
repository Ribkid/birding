// What an answered question shows and where (Learn answer dock): pure helpers, so the layout rules are tested on
// their own. Nothing here scores or stores anything; learn.js and quiz.js stay the source of both.
import { byId, type QuizQuestion } from '../../lib/data';
import * as Q from '../../core/quiz.js';

/**
 * Where the verdict goes once she answers.
 * - photo: a glass footer grows under the mystery photo, in the same card (photo, silhouette, zoom, fact with a photo).
 * - card: the feedback card under the answers stays (Who am I?, call, fact without a photo).
 * - dock: the verdict line rides in the action dock, with the rest in a card (look-alike duels, odd one out).
 * - rapid: rapid fire's brief verdict and auto-advance, unchanged.
 */
export type AnswerLayout = 'photo' | 'card' | 'dock' | 'rapid';
const PHOTO_TYPES = new Set(['photo', 'silhouette', 'zoom']);

export function answerLayout(q: QuizQuestion, mode?: string): AnswerLayout {
  if (mode === 'rapid') return 'rapid';
  if (q.type === 'duel' || q.type === 'odd') return 'dock';
  if (PHOTO_TYPES.has(q.type) || (q.type === 'fact' && q.photos?.length)) return 'photo';
  return 'card';
}

/** One segment per question: how she went on it, the one she is on, or still to come. */
export type Seg = 'right' | 'wrong' | 'now' | 'todo';
export function trailOf(qs: QuizQuestion[], i: number): Seg[] {
  return qs.map((q, n) => (q.picked != null ? (q.picked === q.answer ? 'right' : 'wrong') : n === i ? 'now' : 'todo'));
}
/** The trail read out: where she is and how she is going. */
export function trailText(qs: QuizQuestion[], i: number) {
  const segs = trailOf(qs, i);
  const right = segs.filter((s) => s === 'right').length;
  const wrong = segs.filter((s) => s === 'wrong').length;
  const at = `Question ${Math.min(i + 1, qs.length)} of ${qs.length}`;
  return right + wrong ? `${at}. ${right} right, ${wrong} wrong so far.` : `${at}.`;
}

/** The answers that fold away under a photo once she has answered: neither her pick nor the right one. */
export function foldKeys(q: QuizQuestion, mode?: string): string[] {
  if (q.picked == null || answerLayout(q, mode) !== 'photo') return [];
  return q.options.filter((o) => o.key !== q.picked && o.key !== q.answer).map((o) => o.key);
}

export interface Verdict {
  right: boolean;
  /** 'Correct.' or 'Not quite.' */
  lead: string;
  /** The rest of the sentence before the species name, or the whole of it when there is no name to link. */
  rest: string;
  /** The answer species, named and linked in the photo footer. */
  name?: string;
  nameId?: number;
  tail?: string;
  /** The same sentence as plain text. */
  text: string;
  /** The one-line field mark (or the fact's explanation, or the call in words). */
  line: string;
  /** Odd one out adds the odd one's field mark. */
  mark: string;
  /** How to tell the two apart: the duel's tell, or her wrong pick against the answer. */
  tell: string;
  /** A question about a species (not a fact about one). */
  speciesQ: boolean;
}

/** The verdict the feedback has always given (v1 showAnswer), split so the species name can be a link. */
export function verdictOf(q: QuizQuestion): Verdict | null {
  const ans = byId.get(q.focus);
  if (!ans || q.picked == null) return null;
  const right = q.picked === q.answer;
  const pickedSp = (() => { const o = q.options.find((x) => x.key === q.picked); return o?.sp ? byId.get(o.sp) : null; })();
  const ansOpt = q.options.find((o) => o.key === q.answer);
  const ansLabel = ansOpt?.label || '';
  const speciesQ = q.type !== 'fact' || q.ttype === 'Calls';
  let lead = right ? 'Correct.' : 'Not quite.';
  let rest = '';
  let name: string | undefined;
  let nameId: number | undefined;
  let tail = '';
  if (right) {
    if (speciesQ) { rest = "It's the "; name = ans.name; nameId = ans.id; tail = '.'; }
  } else if (q.miss) {
    const m = String(q.miss);
    if (m.startsWith('Not quite.')) rest = m.slice('Not quite.'.length).trim();
    else { lead = m; rest = ''; }
  } else if (q.type === 'duel') {
    rest = `That one is the ${pickedSp?.name || ''}.`;
  } else if (speciesQ) {
    rest = "It's the "; name = ans.name; nameId = ans.id; tail = '.';
  } else if (ansOpt?.sp) {
    rest = `It's the ${ansLabel}.`;
  } else {
    rest = `It's ${ansLabel}.`;
  }
  const cw = q.type === 'call' ? Q.callWords(ans) : null;
  const line = String(q.explain || (cw ? cw.sentence : Q.fieldMark(ans)) || '');
  const mark = q.type === 'odd' ? String(Q.fieldMark(ans) || '') : '';
  const tell = String((q.type === 'duel' ? q.tell : !right && pickedSp ? Q.tellFor(ans.id, pickedSp.id) : '') || '');
  const text = [lead, `${rest}${name || ''}${tail}`].filter(Boolean).join(' ');
  return { right, lead, rest, name, nameId, tail, text, line, mark, tell, speciesQ };
}

/** The answer's extra actions, as chips in the dock: its call, the one she picked, and Compare. */
export interface DockAction { kind: 'play' | 'compare'; key: string; label: string; tone: 'right' | 'wrong' | 'plain'; which?: string; to?: string }
export function dockActions(q: QuizQuestion): DockAction[] {
  const ans = byId.get(q.focus);
  if (!ans || q.picked == null) return [];
  const right = q.picked === q.answer;
  const o = q.options.find((x) => x.key === q.picked);
  const pickedSp = o?.sp ? byId.get(o.sp) : null;
  const out: DockAction[] = [];
  if (q.type !== 'fact' && Q.hasCall(ans.id)) {
    const which = q.type === 'call' ? 'answer' : String(ans.id);
    out.push({ kind: 'play', key: `play-${which}`, which, label: q.type === 'call' ? 'Hear it again' : 'Hear its call', tone: 'right' });
  }
  if (!right && pickedSp && q.type !== 'fact' && Q.hasCall(pickedSp.id)) {
    out.push({ kind: 'play', key: `play-${pickedSp.id}`, which: String(pickedSp.id), label: 'Hear the one you picked', tone: 'wrong' });
  }
  if (!right && pickedSp && pickedSp.kind === ans.kind) {
    out.push({ kind: 'compare', key: 'compare', to: `/compare/${ans.id}/${pickedSp.id}`, label: 'Compare the two', tone: 'plain' });
  }
  return out;
}

/** Next's words: the same button, in the same place, on every question. */
export const nextLabel = (i: number, n: number) => (i + 1 >= n ? 'See results' : 'Next');
