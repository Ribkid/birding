// "Guess the bird": photo, call and trivia questions.
import { SPECIES, byId } from './species.js';
import { sized } from './media.js';
import { buildTrivia } from './trivia.js';

const ROUND = 10;
let game = null;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

function pickOptions(answer) {
  // Mix in look-alikes from the same group so it's not too easy.
  const same = shuffle(SPECIES.filter(s => s.group === answer.group && s.id !== answer.id)).slice(0, 2);
  const rest = shuffle(SPECIES.filter(s => s.id !== answer.id && !same.includes(s))).slice(0, 3 - same.length);
  return shuffle([answer, ...same, ...rest]);
}

export function renderQuiz(ctx, opts = {}) {
  const { view, esc, icon } = ctx;
  if (opts.start && opts.mode === 'trivia') {
    const pool = game?.scope === 'seen' ? SPECIES.filter(s => ctx.seenSet().has(s.id)) : SPECIES;
    if (pool.length < 8) { ctx.toast('See at least 8 birds first, or play with all birds.'); return renderQuiz(ctx); }
    game = { mode: 'trivia', scope: game?.scope || 'all', qs: buildTrivia(pool, ROUND), i: 0, score: 0 };
    return renderTrivia(ctx);
  }
  if (game?.mode === 'trivia' && game.qs) return renderTrivia(ctx);
  if (opts.start) {
    const pool = SPECIES.filter(s => (game?.scope === 'seen' ? ctx.seenSet().has(s.id) : true)
      && (opts.mode === 'call' ? ctx.hasCalls(s.id) : !!sized(s.id)));
    if (pool.length < 4) { ctx.toast('See a few more birds first, or play with all birds.'); return renderQuiz(ctx); }
    const qs = shuffle(pool.slice()).slice(0, ROUND).map(sp => ({ sp, options: pickOptions(sp), picked: null }));
    game = { mode: opts.mode, scope: game?.scope || 'all', qs, i: 0, score: 0 };
  }
  if (!game || !game.qs) {
    const best = JSON.parse(localStorageGet('quizBest') || '{}');
    game = { scope: game?.scope || 'all' };
    view.innerHTML = `
      <header class="page-head"><h1>Guess the bird</h1></header>
      <div class="pad-x quiz-intro">
        <p class="muted">${ROUND} quick questions. Practise your ID before you head out.</p>
        <div class="chips chips--flush" role="group" aria-label="Which birds">
          <button class="chip ${game.scope === 'all' ? 'chip--on' : ''}" data-scope="all">All ${SPECIES.length} birds</button>
          <button class="chip ${game.scope === 'seen' ? 'chip--on' : ''}" data-scope="seen">Only birds I've seen</button>
        </div>
        <button class="quiz-mode" data-mode="photo"><strong>From a photo</strong><span>Name the bird in the picture.${best.photo != null ? ` Best: ${best.photo}/${ROUND}` : ''}</span></button>
        <button class="quiz-mode quiz-mode--trivia" data-mode="trivia"><strong>Bird trivia</strong><span>Seasons, rarity, best spots, names and more, with the source for every answer.${best.trivia != null ? ` Best: ${best.trivia}/${ROUND}` : ''}</span></button>
        <button class="quiz-mode" data-mode="call"><strong>From its call</strong><span>Listen, then pick the bird.${best.call != null ? ` Best: ${best.call}/${ROUND}` : ''}</span></button>
      </div>`;
    view.onclick = e => {
      const sc = e.target.closest('[data-scope]'); if (sc) { game.scope = sc.dataset.scope; renderQuiz(ctx); }
      const m = e.target.closest('[data-mode]'); if (m) renderQuiz(ctx, { start: true, mode: m.dataset.mode });
    };
    view.onchange = null;
    return;
  }
  const q = game.qs[game.i];
  if (!q) {
    const best = JSON.parse(localStorageGet('quizBest') || '{}');
    const isBest = best[game.mode] == null || game.score > best[game.mode];
    if (isBest) { best[game.mode] = game.score; localStorageSet('quizBest', JSON.stringify(best)); }
    view.innerHTML = `
      <header class="page-head"><h1>Guess the bird</h1></header>
      <div class="quiz-done pad-x">
        <p class="quiz-score"><b>${game.score}</b>/${ROUND}</p>
        <p>${game.score === ROUND ? 'Perfect round.' : game.score >= 7 ? 'Sharp eyes and ears.' : 'Keep practising, it comes quickly.'}${isBest ? ' New personal best.' : ''}</p>
        <ul class="rows">${game.qs.map(x => `<li><a class="row" href="#/bird/${x.sp.id}"><span class="row-main"><strong>${esc(x.sp.name)}</strong><span class="small muted">${x.picked === x.sp.id ? 'Got it' : `You picked ${esc(byId.get(x.picked)?.name || 'nothing')}`}</span></span><span class="quiz-mark ${x.picked === x.sp.id ? 'ok' : 'no'}">${x.picked === x.sp.id ? '✓' : '✗'}</span></a></li>`).join('')}</ul>
        <div class="row-start"><button class="btn btn--primary" data-again>Play again</button><button class="btn" data-menu>Change mode</button></div>
      </div>`;
    view.onclick = e => {
      if (e.target.closest('[data-again]')) renderQuiz(ctx, { start: true, mode: game.mode });
      if (e.target.closest('[data-menu]')) { game = { scope: game.scope }; renderQuiz(ctx); }
    };
    return;
  }
  const answered = q.picked != null;
  view.innerHTML = `
    <header class="page-head page-head--back"><button class="iconbtn" data-quit aria-label="Quit quiz">${icon.back}</button>
      <div><h1>Question ${game.i + 1}</h1><p class="muted small">${game.score} correct so far</p></div></header>
    <div class="quiz-q">
      ${game.mode === 'photo'
        ? `<div class="quiz-photo"><span class="whole"><img class="whole-bg" src="${esc(sized(q.sp.id, 'large'))}" alt="" aria-hidden="true"><img class="whole-fg" src="${esc(sized(q.sp.id, 'large'))}" alt="Mystery bird"></span></div>`
        : `<div class="quiz-call"><button class="playbtn playbtn--big" data-qplay aria-label="Play the call">${icon.play}</button><p class="muted small" data-qstatus>Tap to listen</p></div>`}
      <div class="quiz-options">${q.options.map(o => {
        const cls = !answered ? '' : o.id === q.sp.id ? 'right' : o.id === q.picked ? 'wrong' : 'dim';
        return `<button class="quiz-opt ${cls}" data-pick="${o.id}" ${answered ? 'disabled' : ''}>${esc(o.name)}</button>`;
      }).join('')}</div>
      ${answered ? `<p class="quiz-fb">${q.picked === q.sp.id ? 'Correct.' : `It was the ${esc(q.sp.name)}.`} <span class="muted">${esc(q.sp.notes.split('.')[0])}.</span></p>
        <button class="btn btn--primary btn--block" data-next>${game.i + 1 === ROUND ? 'See score' : 'Next bird'}</button>` : ''}
    </div>`;
  let audio = null;
  view.onclick = async e => {
    if (e.target.closest('[data-quit]')) { audio?.pause(); game = { scope: game.scope }; renderQuiz(ctx); return; }
    const p = e.target.closest('[data-pick]');
    if (p && !answered) {
      q.picked = Number(p.dataset.pick);
      if (q.picked === q.sp.id) { game.score++; navigator.vibrate?.(30); } else navigator.vibrate?.([40, 60, 40]);
      audio?.pause();
      renderQuiz(ctx);
    }
    if (e.target.closest('[data-next]')) { game.i++; renderQuiz(ctx); }
    if (e.target.closest('[data-qplay]')) {
      const st = view.querySelector('[data-qstatus]');
      if (audio) { audio.paused ? audio.play() : audio.pause(); return; }
      st.textContent = 'Loading the call…';
      const list = await ctx.getCalls(q.sp);
      if (!list.length) { st.textContent = 'No recording for this one. Have a guess.'; return; }
      audio = new Audio(await ctx.audioUrl(list[0].src));
      audio.play().then(() => { st.textContent = 'Playing'; }).catch(() => { st.textContent = 'Could not play this recording.'; });
      audio.onended = () => { st.textContent = 'Tap to hear it again'; };
    }
  };
  window.addEventListener('hashchange', () => audio?.pause(), { once: true });
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

// ---------- trivia rounds ----------
function renderTrivia(ctx) {
  const { view, esc, icon } = ctx;
  const n = game.qs.length;
  const q = game.qs[game.i];
  if (!q) {
    const best = JSON.parse(localStorageGet('quizBest') || '{}');
    const isBest = best.trivia == null || game.score > best.trivia;
    if (isBest) { best.trivia = game.score; localStorageSet('quizBest', JSON.stringify(best)); }
    view.innerHTML = `
      <header class="page-head"><h1>Bird trivia</h1></header>
      <div class="quiz-done pad-x">
        <p class="quiz-score"><b>${game.score}</b>/${n}</p>
        <p>${game.score === n ? 'Perfect round. You really know your SEQ birds.' : game.score >= 7 ? 'Great knowledge.' : 'Every round teaches something new.'}${isBest ? ' New personal best.' : ''}</p>
        <ul class="rows">${game.qs.map(x => {
          const ok = x.picked === x.answer;
          const sp = byId.get(x.focus);
          return `<li><a class="row" href="#/bird/${x.focus}"><span class="row-main"><strong>${esc(x.prompt)}</strong><span class="small muted">Answer: ${esc(x.options.find(o => o.key === x.answer)?.label || '')}${sp && sp.name !== x.options.find(o => o.key === x.answer)?.label && !x.prompt.includes(sp.name) ? ` (${esc(sp.name)})` : ''}</span></span><span class="quiz-mark ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'}</span></a></li>`;
        }).join('')}</ul>
        <div class="row-start"><button class="btn btn--primary" data-again>Play again</button><button class="btn" data-menu>Change mode</button></div>
      </div>`;
    view.onclick = e => {
      if (e.target.closest('[data-again]')) renderQuiz(ctx, { start: true, mode: 'trivia' });
      if (e.target.closest('[data-menu]')) { game = { scope: game.scope }; renderQuiz(ctx); }
    };
    return;
  }
  const answered = q.picked != null;
  const right = q.options.find(o => o.key === q.answer);
  const src = q.source.url
    ? `Source: <a href="${esc(q.source.url)}" target="_blank" rel="noopener">${esc(q.source.title)}</a>`
    : `Source: ${esc(q.source.title)}`;
  view.innerHTML = `
    <header class="page-head page-head--back"><button class="iconbtn" data-quit aria-label="Quit trivia">${icon.back}</button>
      <div><h1>Question ${game.i + 1}</h1><p class="muted small">${q.type}. ${game.score} correct so far</p></div></header>
    <div class="quiz-q">
      ${q.img && sized(q.img, 'large') ? `<div class="quiz-photo quiz-photo--short"><span class="whole"><img class="whole-bg" src="${esc(sized(q.img, 'large'))}" alt="" aria-hidden="true"><img class="whole-fg" src="${esc(sized(q.img, 'large'))}" alt="${esc(byId.get(q.img)?.name || '')}"></span></div>` : ''}
      <p class="trivia-q">${esc(q.prompt)}</p>
      <div class="quiz-options">${q.options.map(o => {
        const cls = !answered ? '' : o.key === q.answer ? 'right' : o.key === q.picked ? 'wrong' : 'dim';
        return `<button class="quiz-opt ${cls} ${q.italic ? 'quiz-opt--sci' : ''}" data-tpick="${esc(o.key)}" ${answered ? 'disabled' : ''}>${esc(o.label)}</button>`;
      }).join('')}</div>
      ${answered ? `<div class="trivia-fb">
          <p><strong>${q.picked === q.answer ? 'Correct.' : `Not quite. It's ${esc(right?.label || '')}.`}</strong> ${esc(q.explain)}</p>
          <p class="small muted">${src}</p>
          <a class="small" href="#/bird/${q.focus}">Open the ${esc(byId.get(q.focus)?.name || 'bird')} page</a>
        </div>
        <button class="btn btn--primary btn--block" data-next>${game.i + 1 === n ? 'See score' : 'Next question'}</button>` : ''}
    </div>`;
  view.onclick = e => {
    if (e.target.closest('[data-quit]')) { game = { scope: game.scope }; renderQuiz(ctx); return; }
    const p = e.target.closest('[data-tpick]');
    if (p && !answered) {
      q.picked = p.dataset.tpick;
      if (q.picked === q.answer) { game.score++; navigator.vibrate?.(30); } else navigator.vibrate?.([40, 60, 40]);
      renderTrivia(ctx);
    }
    if (e.target.closest('[data-next]')) { game.i++; renderTrivia(ctx); window.scrollTo(0, 0); }
  };
  view.onchange = null;
}
