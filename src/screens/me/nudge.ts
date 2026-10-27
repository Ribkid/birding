// The one-time sign-up nudge after the third saved sighting (v1 js/me.js:648-675).
import { db } from '../../core/db.js';
import { configured, user } from '../../core/cloud.js';

let nudging = false;

export async function nudgeAfterSave(n: number) {
  if (!configured || user() || n < 3 || nudging) return;
  if (await db.kvGet('me:nudged')) return;
  nudging = true;

  // Wait for a celebration or sheet to finish first; if it stays busy, try after a later save.
  const started = Date.now();
  const busy = () => document.querySelector('.sheet-wrap, .celebrate');
  while (busy() && Date.now() - started < 90000) await new Promise((resolve) => setTimeout(resolve, 700));
  await new Promise((resolve) => setTimeout(resolve, 600));
  nudging = false;
  if (user() || busy() || document.querySelector('.me-nudge')) return;
  await db.kvSet('me:nudged', true);

  const banner = document.createElement('div');
  banner.className = 'me-nudge glass';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Back up your sightings');
  banner.innerHTML = `<span class="me-nudge-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5a4.5 4.5 0 0 0 1 9zM12 15.5v-5M9.5 12.5L12 10l2.5 2.5"/></svg></span>
    <p class="me-nudge-txt"><strong>Back up your sightings: sign up free</strong><span>So they're safe if something happens to this phone.</span></p>
    <div class="me-nudge-acts"><button type="button" class="btn btn--small btn--primary" data-nsign>Sign up</button><button type="button" class="btn btn--small btn--quiet" data-nno>Not now</button></div>
    <p class="sr-only" role="status" aria-live="polite">Back up your sightings: sign up free. Sign up or Not now, above the tab bar.</p>`;
  document.body.append(banner);

  const close = () => {
    banner.classList.add('me-nudge--out');
    setTimeout(() => banner.remove(), 300);
  };
  const timer = setTimeout(close, 20000);
  banner.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-nsign]')) {
      clearTimeout(timer);
      banner.remove();
      location.hash = '#/me/signup';
    }
    if (target.closest('[data-nno]')) {
      clearTimeout(timer);
      close();
    }
  });
}
