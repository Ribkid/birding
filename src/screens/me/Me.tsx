import { useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KINDS, byId, kindsPresent, ofKind, type Species } from '../../lib/data';
import { useOutings, useSightings, useMedia } from '../../lib/hooks';
import { db } from '../../core/db.js';
import { usePatches } from '../lists/shared';
import { totals, badges as computeBadges, MONTHS } from '../../core/stats.js';
import { learnReady, learnStats } from '../../core/learn.js';
import {
  getProfile, getMyCloud, signedIn, myName, memberSince, coverSpecies, kindCounts, dayPick, configured, myPublicId,
} from '../../core/profile.js';
import { onStatus, syncStatus } from '../../core/account.js';
import { SpeciesImage } from '../../components/SpeciesImage';
import { CountUp } from '../../components/Motion';
import { applyTint } from '../../lib/look';
import { AccountAvatar as Avatar, useProfile } from './accountBits';
import './me.css';

const I = {
  gear: <><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="none" stroke="currentColor" strokeWidth="2" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M10 17h4v3h-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  people: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  target: <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>,
  pin: <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM9.5 9.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0z" fill="none" stroke="currentColor" strokeWidth="2" />,
  outing: <path d="M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8v4.5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  chev: <path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5a4.5 4.5 0 0 0 1 9zM12 15.5v-5M9.5 12.5L12 10l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  person: <><circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
};



export default function Me() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useProfile();
  const sightings = useSightings();
  const outings = useOutings();
  const patches = usePatches();
  const navigate = useNavigate();
  const [profileMsg, setProfileMsg] = useState('');
  const [notNow, setNotNow] = useState(false);
  useMedia();

  useEffect(() => {
    void learnReady().then(() => force()).catch(() => {});
    let alive = true;
    void db.kvGet('me:notnow').then((value) => { if (alive) setNotNow(!!value); }).catch(() => {});
    const off = db.onChange((name: string) => { if (name === 'kv:me:notnow') void db.kvGet('me:notnow').then((value) => { if (alive) setNotNow(!!value); }); });
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => { const off = onStatus((state: typeof sync) => setSync(state)); return () => { off(); }; }, []);

  const prof = getProfile();
  const m = getMyCloud();
  const u = signedIn();
  const seen = useMemo(() => new Set(sightings.map((s) => s.speciesId)), [sightings]);
  const t = totals(sightings, new Date());
  const now = new Date();
  const counts = kindCounts(seen) as Record<string, number>;
  let learning: Record<string, number> = {};
  try { learning = learnStats() as Record<string, number>; } catch { /* not loaded yet */ }
  const list = computeBadges(sightings, outings, learning) as { key: string; name: string; desc: string; have: number; need: number; done: boolean }[];
  const earned = list.filter((b) => b.done);
  const cover = coverSpecies(sightings, prof.avatarSpeciesId) as Species | null;
  const nPatch = patches.length;
  const nOut = outings.length;
  const lastOut = outings.slice().sort((a, b) => ((b as any).startedAt ?? 0) - ((a as any).startedAt ?? 0))[0];
  const [sync, setSync] = useState(syncStatus());

  const openProfile = async () => {
    setProfileMsg('');
    if (!navigator.onLine) { setProfileMsg('Your public profile needs a connection.'); return; }
    try {
      const id = await myPublicId();
      if (id) navigate(`/u/${id}`);
      else setProfileMsg("Your profile hasn't reached the cloud yet. Try again in a minute.");
    } catch {
      setProfileMsg("Your profile hasn't reached the cloud yet. Try again in a minute.");
    }
  };

  const paint = () => {
    requestAnimationFrame(() => {
      const hero = document.querySelector('.me-hero') as HTMLElement | null;
      if (hero && cover) void applyTint(hero, (hero.querySelector('[data-hero-frame] img') as HTMLImageElement)?.src || '');
    });
  };
  useEffect(paint, [cover?.id, u]);
  // Rings and medals fill the first time they come into view (v1 js/me.js animateIn).
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.me-rings, .me-medals')].filter((el) => !el.classList.contains('is-in'));
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }, { threshold: 0.25 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [u, sightings.length]);

  const link = (href: string, ico: React.ReactNode, title: string, sub: string) => (
    <li><Link to={href}><span className="me-li-ico" aria-hidden="true"><svg viewBox="0 0 24 24">{ico}</svg></span><span className="me-li-main"><strong>{title}</strong><span>{sub}</span></span><span className="me-chev"><svg viewBox="0 0 24 24">{I.chev}</svg></span></Link></li>
  );
  const medals = () => {
    const show = earned.length ? earned.slice().sort((a, b) => b.need - a.need).slice(0, 6) : list.filter((b) => b.have > 0).sort((a, b) => b.have / b.need - a.have / a.need).slice(0, 3);
    const pick = show.length ? show : list.slice(0, 3);
    return (
      <ul className="me-medals" role="list">
        {pick.map((b) => {
          const p = b.done ? 1 : b.have / b.need;
          return (
            <li key={b.key} className={`me-medal ${b.done ? 'me-medal--done' : ''}`}>
              <Link to="/badges">
                <span className="me-medal-disc" style={{ '--p': p.toFixed(3) } as React.CSSProperties} aria-hidden="true">
                  <svg viewBox="0 0 64 64"><circle className="me-ring-track" cx="32" cy="32" r="29" /><circle className="me-ring-fill" cx="32" cy="32" r="29" pathLength="100" /></svg>
                  <span className="me-medal-face">{b.done ? <svg viewBox="0 0 24 24">{I.tick}</svg> : <b>{b.have}<small>/{b.need}</small></b>}</span>
                </span>
                <strong>{b.name}</strong>{' '}<span className="sr-only">{b.done ? 'Earned' : `${b.have} of ${b.need}`}. {b.desc}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };

  // Three of her own finds, newest last-logged first, topped up with today's species (v1 js/me.js joinCard).
  const mineSp = [...seen].map((id) => byId.get(id)).filter(Boolean).slice(-3).reverse() as Species[];
  const fan = mineSp.length >= 3 ? mineSp : [...mineSp, dayPick(0), dayPick(7), dayPick(19)].slice(0, 3) as Species[];

  return (
    <div className={`me ${u ? 'me--in' : 'me--guest'}`}>
      {u ? (
        <section className="me-hero">
          <div className="me-cover" data-hero-frame aria-hidden="true">{cover && <SpeciesImage sp={cover} size="large" />}</div>
          <div className="me-scrim" aria-hidden="true" />
          <div className="me-hero-top"><Link className="me-glassbtn glass" to="/settings" aria-label="Settings"><svg viewBox="0 0 24 24">{I.gear}</svg></Link></div>
          <div className="me-id">
            <span className="me-av-ring"><Avatar spId={prof.avatarSpeciesId} path={m?.avatarPath} name={myName()} cls="acct-av me-av" size="large" /></span>
            <div className="me-id-txt"><h1 className="me-name">{myName()}</h1>{m?.memberSince && <p className="me-sub">{memberSince(m.memberSince)}</p>}<p className="me-sub me-sync" data-state={sync.state} role="status">{sync.text || ''}</p></div>
          </div>
        </section>
      ) : (
        <>
          <header className="page-head me-head"><h1>Me</h1><Link className="iconbtn" to="/settings" aria-label="Settings"><svg viewBox="0 0 24 24">{I.gear}</svg></Link></header>
          {configured && (notNow ? (
            <section className="me-join me-join--slim" aria-labelledby="me-join-h">
              <div className="me-fan me-fan--mini" aria-hidden="true">{fan.map((sp, i) => <span className="me-fan-card" key={i}><SpeciesImage sp={sp} /></span>)}</div>
              <div className="me-join-body">
                <h2 className="me-join-h" id="me-join-h">Back up your dex</h2>
                <p>{seen.size ? `${seen.size} species saved on this phone only.` : 'Sign up free, use it on any phone.'}</p>
              </div>
              <Link className="btn btn--small me-join-go" to="/me/signup">Sign up</Link>
            </section>
          ) : (
            <section className="me-join" aria-labelledby="me-join-h">
              <div className="me-fan" aria-hidden="true">{fan.map((sp, i) => <span className="me-fan-card" key={i}><SpeciesImage sp={sp} /></span>)}</div>
              <div className="me-join-body">
                <h2 className="me-join-h" id="me-join-h">Keep your dex safe</h2>
                <p className="me-join-p">Sign up free to back up your dex, use it on any phone, join the leaderboard and see friends' profiles.</p>
                {seen.size > 0 && <p className="me-join-note"><svg viewBox="0 0 24 24">{I.cloud}</svg><span>{seen.size} species {seen.size === 1 ? 'is' : 'are'} saved on this phone only.</span></p>}
                <div className="me-join-acts"><Link className="btn me-join-go" to="/me/signup">Sign up free</Link><Link className="btn me-join-in" to="/me/signin">Sign in</Link></div>
                <button type="button" className="btn btn--quiet me-join-later" onClick={async () => { await db.kvSet('me:notnow', true); setNotNow(true); }}>Not now</button>
              </div>
            </section>
          ))}
        </>
      )}

      <div className="me-sheet">
        <section className="me-card me-dex" aria-labelledby="me-dex-h">
          <h2 className="me-card-h" id="me-dex-h">{u ? 'Found so far' : 'Your dex on this phone'}</h2>
          <ul className="me-rings" role="list">
            {kindsPresent.map((k) => {
              const n = counts[k] || 0;
              const total = ofKind(k).length;
              const p = total ? Math.max(n ? 0.03 : 0, n / total) : 0;
              return (
                <li key={k} className={`me-ring-item kind--${k}`}>
                  <span className="sr-only">{n} of {total} {KINDS[k]?.label.toLowerCase()}</span>
                  <span className="me-ring" style={{ '--p': p.toFixed(4) } as React.CSSProperties} aria-hidden="true"><svg viewBox="0 0 48 48"><circle className="me-ring-track" cx="24" cy="24" r="20" /><circle className="me-ring-fill" cx="24" cy="24" r="20" pathLength="100" /></svg><b className="me-ring-n"><CountUp value={n} /></b></span>
                  <span className="me-ring-l" aria-hidden="true">{KINDS[k]?.label}</span><span className="me-ring-of" aria-hidden="true">of {total}</span>
                </li>
              );
            })}
          </ul>
          <dl className="me-stats">
            <div><dt>Species</dt><dd><CountUp value={seen.size} /></dd></div>
            <div><dt>Badges</dt><dd><CountUp value={earned.length} /></dd></div>
            <div><dt>Outings</dt><dd><CountUp value={nOut} /></dd></div>
          </dl>
        </section>

        {u && (
          <nav className="me-acts" aria-label="Your profile">
            <Link className="me-act me-act--primary" to="/me/edit"><svg viewBox="0 0 24 24">{I.edit}</svg><span>Edit profile</span></Link>
            {m?.publicId ? (
              <Link className="me-act" to={`/u/${m.publicId}`}><svg viewBox="0 0 24 24">{I.eye}</svg><span>View my public profile</span></Link>
            ) : (
              <button type="button" className="me-act" onClick={() => void openProfile()}><svg viewBox="0 0 24 24">{I.eye}</svg><span>View my public profile</span></button>
            )}
            <Link className="me-act" to="/leaderboard"><svg viewBox="0 0 24 24">{I.trophy}</svg><span>Leaderboard</span></Link>
            <Link className="me-act" to="/leaderboard?groups=1"><svg viewBox="0 0 24 24">{I.people}</svg><span>Groups</span></Link>
          </nav>
        )}
        {profileMsg && <p className="small muted" role="status">{profileMsg}</p>}

        <section className="me-sec" aria-labelledby="me-lists-h">
          <div className="me-sec-h"><h2 id="me-lists-h">My lists</h2><Link to="/lists">Open lists</Link></div>
          <div className="me-totals">
            <Link to="/list/life"><b>{t.life}</b><span>Life list</span></Link>
            <Link to="/list/year"><b>{t.year}</b><span>{now.getFullYear()} list</span></Link>
            <Link to="/list/month"><b>{t.month}</b><span>{MONTHS[now.getMonth()]}</span></Link>
          </div>
          <ul className="me-links">
            {link('/targets', I.target, 'Targets', `Likely in ${MONTHS[now.getMonth()]} and not in your dex yet`)}
            {link('/lists', I.pin, 'Patches', nPatch ? `${nPatch} patch${nPatch === 1 ? '' : 'es'}` : 'Your yard or a local park, with its own list')}
            {link('/lists', I.outing, 'Outings', lastOut ? `${nOut} outing${nOut === 1 ? '' : 's'}, latest at ${lastOut.place || 'an unnamed place'}` : 'Tally everything at one spot with the + button')}
            {link('/log', I.list, 'All sightings', `${sightings.length} sighting${sightings.length === 1 ? '' : 's'}`)}
          </ul>
        </section>

        <section className="me-sec" aria-labelledby="me-badges-h">
          <div className="me-sec-h"><h2 id="me-badges-h">Badges</h2><Link to="/badges">See all</Link></div>
          <p className="me-sec-sub">{earned.length ? `${earned.length} of ${list.length} earned` : 'Closest to earning'}</p>
          {medals()}
        </section>

        <section className="me-sec" aria-label="More">
          <ul className="me-links">
            {link('/stats', I.chart, 'Stats', 'Your months, places and best days')}
            {link('/settings', I.gear, 'Settings', u ? 'Theme, offline, backup and account' : 'Theme, offline and backup')}
          </ul>
        </section>
      </div>
    </div>
  );
}
