import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ANIMALS,
  SPECIES,
  byId,
  kindsPresent,
  type Species,
} from '../../lib/data';
import { useMedia, useSightings } from '../../lib/hooks';
import { audioUrl, calls, sized } from '../../core/media.js';
import { loadSeq } from '../../core/seqdata.js';
import { Icon } from '../../components/Icon';
import './progress.css';

type Mode = 'photo' | 'call';
type Scope = 'all' | 'seen';

interface Question {
  sp: Species;
  options: Species[];
  picked: number | null;
}

interface Game {
  mode: Mode;
  scope: Scope;
  qs: Question[];
  i: number;
  score: number;
}

interface Result {
  isBest: boolean;
  best: number | null;
}

const ROUND = 10;
const BEST_KEY = 'quizBest';

function readBest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeBest(best: Record<string, number>) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* private mode / storage full: the round still works */
  }
}

function shuffle<T>(source: T[]): T[] {
  const list = source.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function pickOptions(answer: Species): Species[] {
  // Mix in look-alikes from the same group so it is not too easy.
  const same = shuffle(SPECIES.filter((s) => s.group === answer.group && s.id !== answer.id)).slice(0, 2);
  const chosen = new Set([answer.id, ...same.map((s) => s.id)]);
  const rest = shuffle(SPECIES.filter((s) => s.kind === answer.kind && !chosen.has(s.id))).slice(
    0,
    Math.max(0, 3 - same.length),
  );
  let options = [answer, ...same, ...rest];
  if (options.length < 4) {
    const used = new Set(options.map((s) => s.id));
    options = [...options, ...shuffle(SPECIES.filter((s) => !used.has(s.id))).slice(0, 4 - options.length)];
  }
  return shuffle(options);
}

const firstSentence = (sp: Species) => {
  const first = (sp.notes || '').split('.')[0]?.trim();
  return first ? `${first}.` : '';
};

export default function Quiz() {
  useMedia();
  const sightings = useSightings();
  const [scope, setScope] = useState<Scope>('all');
  const [game, setGame] = useState<Game | null>(null);
  const [notice, setNotice] = useState('');
  const [starting, setStarting] = useState(false);
  const [best, setBest] = useState<Record<string, number>>(() => readBest());
  const [result, setResult] = useState<Result | null>(null);
  const [callStatus, setCallStatus] = useState('Tap to listen');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resultForRef = useRef<Game | null>(null);

  const finished = !!game && game.qs.length > 0 && game.i >= game.qs.length;
  const q = game && !finished ? game.qs[game.i] : undefined;

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
  }, []);

  const startGame = useCallback(
    async (mode: Mode) => {
      setStarting(true);
      setNotice('');
      setResult(null);
      stopAudio();
      audioRef.current = null;
      setCallStatus('Tap to listen');
      const seenSet = new Set(sightings.map((s) => s.speciesId));
      let pool = ANIMALS.filter((s) => scope === 'all' || seenSet.has(s.id));

      if (mode === 'call') {
        // Calls in the regional data are the ones we know can be offered without a search.
        const data = (await loadSeq()) as { species?: Record<number, { calls?: unknown[] }> } | null;
        pool = pool.filter((s) => (data?.species?.[s.id]?.calls?.length ?? 0) > 0);
      } else {
        const withPhoto = pool.filter((s) => !!sized(s.id));
        if (withPhoto.length >= 4) pool = withPhoto;
      }

      if (pool.length < 4) {
        setStarting(false);
        setGame(null);
        setResult(null);
        setNotice(
          scope === 'seen'
            ? 'See a few more species first, or play with all animals.'
            : mode === 'call'
              ? 'There are not enough recordings available yet. Try again with a connection, or play from photos.'
              : 'There are not enough photos available yet. Check your connection and try again.',
        );
        return;
      }

      const qs = shuffle(pool)
        .slice(0, ROUND)
        .map((sp) => ({ sp, options: pickOptions(sp), picked: null as number | null }));
      setGame({ mode, scope, qs, i: 0, score: 0 });
      setStarting(false);
    },
    [scope, sightings, stopAudio],
  );

  const answer = useCallback(
    (id: number) => {
      stopAudio();
      setGame((prev) => {
        if (!prev) return prev;
        const current = prev.qs[prev.i];
        if (!current || current.picked != null) return prev;
        const qs = prev.qs.slice();
        qs[prev.i] = { ...current, picked: id };
        return { ...prev, qs, score: prev.score + (id === current.sp.id ? 1 : 0) };
      });
    },
    [stopAudio],
  );

  const next = useCallback(() => {
    stopAudio();
    setGame((prev) => (prev ? { ...prev, i: prev.i + 1 } : prev));
  }, [stopAudio]);

  const quit = useCallback(() => {
    stopAudio();
    audioRef.current = null;
    setCallStatus('Tap to listen');
    setGame(null);
    setResult(null);
    setNotice('');
  }, [stopAudio]);

  // Record the personal best once the last question has been answered. The ref keeps
  // StrictMode's double effect run from turning a new best back into "not a best".
  useEffect(() => {
    if (!finished || !game) return;
    if (resultForRef.current === game) return;
    resultForRef.current = game;
    const key = game.mode;
    const saved = readBest();
    const previous = saved[key] ?? null;
    const isBest = previous == null || game.score > previous;
    if (isBest) {
      saved[key] = game.score;
      writeBest(saved);
    }
    setBest(saved);
    setResult({ isBest, best: isBest ? game.score : previous });
  }, [finished, game]);

  // Question changes start with a fresh call status and no audio playing.
  useEffect(() => {
    setCallStatus('Tap to listen');
    stopAudio();
  }, [game?.i, game?.mode, stopAudio]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  // Keyboard 1-4 selects an answer; Enter moves on once answered; Escape quits.
  useEffect(() => {
    if (!game) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const current = game.qs[game.i];
      if (!current) return;
      if (current.picked == null && /^[1-4]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          answer(option.id);
        }
      } else if (current.picked != null && event.key === 'Enter') {
        event.preventDefault();
        next();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        quit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, answer, next, quit]);

  const playCall = async () => {
    if (!q) return;
    const existing = audioRef.current;
    if (existing) {
      if (existing.paused) {
        try {
          await existing.play();
          setCallStatus('Playing');
        } catch {
          setCallStatus('Could not play this recording.');
        }
      } else {
        existing.pause();
        setCallStatus('Tap to hear it again');
      }
      return;
    }

    setCallStatus('Loading the call…');
    try {
      const data = (await loadSeq()) as {
        species?: Record<number, { calls?: { src?: string }[] }>;
      } | null;
      let list: { src?: string }[] = data?.species?.[q.sp.id]?.calls ?? [];
      if (!list.length) {
        try {
          list = (await calls(q.sp)) as { src?: string }[];
        } catch {
          list = [];
        }
      }
      const src = list.find((entry) => entry.src)?.src;
      if (!src) {
        setCallStatus('No recording for this one. Have a guess.');
        return;
      }
      const audio = new Audio(await audioUrl(src));
      audioRef.current = audio;
      audio.onended = () => setCallStatus('Tap to hear it again');
      await audio.play();
      setCallStatus('Playing');
    } catch {
      setCallStatus('Could not play this recording.');
    }
  };

  const animalWord = kindsPresent.length > 1 ? 'animal' : 'bird';

  if (!game) {
    return (
      <>
        <header className="page-head">
          <h1>Guess the bird</h1>
        </header>
        <div className="pad-x quiz-intro">
          <p className="muted">{ROUND} quick questions. Practise your ID before you head out.</p>
          <div className="chips chips--flush" role="group" aria-label="Which birds">
            <button
              type="button"
              className={`chip ${scope === 'all' ? 'chip--on' : ''}`}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              All {ANIMALS.length} {kindsPresent.length > 1 ? 'animals' : 'birds'}
            </button>
            <button
              type="button"
              className={`chip ${scope === 'seen' ? 'chip--on' : ''}`}
              aria-pressed={scope === 'seen'}
              onClick={() => setScope('seen')}
            >
              Only birds I've seen
            </button>
          </div>
          {notice && (
            <p className="form-error" role="alert">
              {notice}
            </p>
          )}
          <button
            type="button"
            className="quiz-mode"
            disabled={starting}
            onClick={() => void startGame('photo')}
          >
            <strong>From a photo</strong>
            <span>
              Name the {animalWord} in the picture.
              {best.photo != null ? ` Best: ${best.photo}/${ROUND}` : ''}
            </span>
          </button>
          <button
            type="button"
            className="quiz-mode"
            disabled={starting}
            onClick={() => void startGame('call')}
          >
            <strong>From its call</strong>
            <span>
              Listen, then pick the {kindsPresent.includes('frog') ? 'bird or frog' : 'bird'}.
              {best.call != null ? ` Best: ${best.call}/${ROUND}` : ''}
            </span>
          </button>
          <p className="small muted quiz-keyhint">Number keys 1–4 pick an answer during a round.</p>
        </div>
      </>
    );
  }

  if (finished) {
    const score = game.score;
    const message =
      score === ROUND
        ? 'Perfect round.'
        : score >= 7
          ? 'Sharp eyes and ears.'
          : 'Keep practising, it comes quickly.';
    return (
      <>
        <header className="page-head">
          <h1>Guess the bird</h1>
        </header>
        <div className="quiz-done pad-x">
          <p className="quiz-score">
            <b>{score}</b>/{ROUND}
          </p>
          <p>
            {message}
            {result?.isBest ? ' New personal best.' : ''}
          </p>
          <ul className="rows">
            {game.qs.map((item) => {
              const got = item.picked === item.sp.id;
              return (
                <li key={item.sp.id}>
                  <Link className="row" to={`/bird/${item.sp.id}`}>
                    <span className="row-main">
                      <strong>{item.sp.name}</strong>
                      <span className="small muted">
                        {got
                          ? 'Got it'
                          : `You picked ${byId.get(item.picked ?? -1)?.name ?? 'nothing'}`}
                      </span>
                    </span>
                    <span className={`quiz-mark ${got ? 'ok' : 'no'}`}>{got ? '✓' : '✗'}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="row-start">
            <button className="btn btn--primary" onClick={() => void startGame(game.mode)}>
              Play again
            </button>
            <button className="btn" onClick={quit}>
              Change mode
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!q) return null;

  const answered = q.picked != null;
  const photoUrl = sized(q.sp.id, 'large') as string | null;

  return (
    <>
      <header className="page-head page-head--back">
        <button className="iconbtn" onClick={quit} aria-label="Quit quiz">
          <Icon name="back" />
        </button>
        <div>
          <h1>Question {game.i + 1}</h1>
          <p className="muted small">{game.score} correct so far</p>
        </div>
      </header>
      <div className="quiz-q">
        {game.mode === 'photo' ? (
          <div className="quiz-photo">
            {photoUrl ? (
              <span className="whole">
                <img className="whole-bg" src={photoUrl} alt="" aria-hidden="true" />
                <img className="whole-fg" src={photoUrl} alt="Mystery bird" />
              </span>
            ) : (
              <span className="img-missing" role="img" aria-label="Mystery bird" />
            )}
          </div>
        ) : (
          <div className="quiz-call">
            <button
              type="button"
              className="playbtn playbtn--big"
              onClick={() => void playCall()}
              aria-label="Play the call"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            </button>
            <p className="muted small" data-qstatus>
              {callStatus}
            </p>
          </div>
        )}

        <div className="quiz-options">
          {q.options.map((option, index) => {
            const cls = !answered
              ? ''
              : option.id === q.sp.id
                ? 'right'
                : option.id === q.picked
                  ? 'wrong'
                  : 'dim';
            return (
              <button
                type="button"
                key={option.id}
                className={`quiz-opt ${cls}`}
                onClick={() => answer(option.id)}
                disabled={answered}
              >
                <span className="small muted" aria-hidden="true">
                  {index + 1}.{' '}
                </span>
                {option.name}
              </button>
            );
          })}
        </div>

        {answered ? (
          <>
            <p className="quiz-fb" aria-live="polite">
              {q.picked === q.sp.id ? 'Correct.' : `It was the ${q.sp.name}.`}{' '}
              <span className="muted">{firstSentence(q.sp)}</span>
            </p>
            <button className="btn btn--primary btn--block" onClick={next}>
              {game.i + 1 >= game.qs.length ? 'See score' : 'Next bird'}
            </button>
          </>
        ) : (
          <p className="small muted quiz-keyhint">Use the number keys 1–4 to answer.</p>
        )}
      </div>
    </>
  );
}
