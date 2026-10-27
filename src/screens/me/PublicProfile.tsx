import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KINDS, byId, kindsPresent, type PublicProfileRow } from '../../lib/data';
import { useSeen, useMedia } from '../../lib/hooks';
import { SpeciesImage } from '../../components/SpeciesImage';
import { CountUp } from '../../components/Motion';
import { configured, signedIn, getMyCloud, myName, initProfile, loadPublicProfile, avatarUrl, memberSince, dayPick, getPublicProfileCache, problem } from '../../core/profile.js';
import { onAuth } from '../../core/cloud.js';
import { authSettled } from '../../core/account.js';
import { applyTint } from '../../lib/look';
import './me.css';

const back = <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;

export default function PublicProfile() {
  const { publicId = '' } = useParams();
  const seen = useSeen();
  useMedia();
  const [row, setRow] = useState<PublicProfileRow | null>(getPublicProfileCache(publicId) as PublicProfileRow | null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'offline' | 'signedout'>(row ? 'ready' : 'loading');
  const [err, setErr] = useState('');
  const [authDone, setAuthDone] = useState(false);
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const off = onAuth(() => { if (alive) setAuthTick((n) => n + 1); });
    authSettled.then(() => { if (alive) { setAuthDone(true); setAuthTick((n) => n + 1); } });
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    void initProfile();
    if (!configured) { setState('error'); setErr('Profiles need accounts, which are not set up in this copy of the app.'); return; }
    if (!signedIn()) { setState(authDone ? 'signedout' : 'loading'); return; }
    if (!navigator.onLine) { setState(row ? 'ready' : 'offline'); return; }
    let alive = true;
    void loadPublicProfile(publicId)
      .then((r: PublicProfileRow) => { if (alive) { setRow(r); setState('ready'); } })
      .catch((x: any) => { if (alive) { setErr(/not found/i.test(x?.message || '') ? "This profile isn't available. It may be private, or the link may be wrong." : problem(x)); setState(row ? 'ready' : 'error'); } });
    return () => { alive = false; };
  }, [publicId, authDone, authTick]);

  const mine = getMyCloud();
  const isMe = mine?.publicId === publicId;
  const backHref = isMe ? '/me' : '/leaderboard';
  useEffect(() => {
    if (!row) return;
    const hero = document.querySelector('.me-hero') as HTMLElement | null;
    const img = hero?.querySelector('[data-hero-frame] img') as HTMLImageElement | null;
    if (hero && img) void applyTint(hero, img.src);
    document.querySelectorAll<HTMLElement>('.me-rings').forEach((el) => el.classList.add('is-in'));
  }, [row]);

  const dex = useMemo(() => (row?.dex || []).map((n) => byId.get(n)).filter(Boolean), [row]);
  const mineSeen = seen;
  const both = dex.filter((sp) => sp && mineSeen.has(sp.id)).length;
  const cover = byId.get(Number(row?.avatar_species_id)) || dex[dex.length - 1] || dayPick(row?.display_name?.length || 0);
  const first = row?.is_me ? 'You' : (row?.display_name || 'They').split(' ')[0];
  const counts = Object.fromEntries(kindsPresent.map((k) => [k, (row as any)?.[k] || 0]));

  if (state === 'signedout') {
    return (
      <div className="me">
        <header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24">{back}</svg></Link><h1>Profile</h1></header>
        <div className="me-msg"><p>Sign in to see other people's profiles. It's free, and your dex comes with you.</p><Link className="btn btn--primary" to="/me/signin">Sign in</Link></div>
      </div>
    );
  }
  if (state === 'loading') {
    return <div className="me me--loading"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24">{back}</svg></Link><h1>Loading profile</h1></header><div className="me-msg"><p className="muted" role="status">Loading…</p></div></div>;
  }
  if (state === 'offline') {
    return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24">{back}</svg></Link><h1>Profile</h1></header><div className="me-msg"><p>Profiles need a connection. Your own dex works offline as usual.</p></div></div>;
  }
  if (state === 'error' || !row) {
    return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24">{back}</svg></Link><h1>Profile</h1></header><div className="me-msg"><p>{err || 'This profile could not be loaded.'}</p></div></div>;
  }

  return (
    <div className="me me--profile">
      <section className="me-hero">
        <div className="me-cover" data-hero-frame aria-hidden="true">{cover && <SpeciesImage sp={cover} size="large" whole />}</div>
        <div className="me-scrim" aria-hidden="true" />
        <div className="page-head--back me-back"><Link className="iconbtn me-glassbtn glass" to={backHref} aria-label={isMe ? 'Back to Me' : 'Back to the leaderboard'}><svg viewBox="0 0 24 24">{back}</svg></Link></div>
        <div className="me-id">
          <span className="me-av-ring">
            <span className={`acct-av me-av${row.avatar_path ? ' acct-av--photo' : ''}`} aria-hidden="true">
              {row.avatar_path ? <img src={avatarUrl(row.avatar_path)} alt="" /> : byId.get(Number(row.avatar_species_id)) ? <SpeciesImage sp={byId.get(Number(row.avatar_species_id))!} size="large" /> : <span className="acct-av-letter">{(row.display_name || '?').slice(0, 1).toUpperCase()}</span>}
            </span>
          </span>
          <div className="me-id-txt">
            <h1 className="me-name">{row.display_name || 'Birder'}</h1>
            {row.member_since && <p className="me-sub">{memberSince(row.member_since)}</p>}
            {row.is_me && <p className="me-sub me-you">This is how other people see you</p>}
          </div>
        </div>
      </section>
      <div className="me-sheet">
        <section className="me-card me-dex" aria-label="Found so far">
          <ul className="me-rings" role="list">
            {kindsPresent.map((k) => {
              const n = counts[k] || 0;
              const total = Math.max(n, 1);
              return (
                <li key={k} className={`me-ring-item kind--${k}`}>
                  <span className="sr-only">{n} {KINDS[k]?.label}</span>
                  <span className="me-ring" style={{ '--p': (n ? 0.03 : 0) } as React.CSSProperties} aria-hidden="true"><svg viewBox="0 0 48 48"><circle className="me-ring-track" cx="24" cy="24" r="20" /><circle className="me-ring-fill" cx="24" cy="24" r="20" pathLength="100" /></svg><b className="me-ring-n"><CountUp value={n} /></b></span>
                  <span className="me-ring-l" aria-hidden="true">{KINDS[k]?.label}</span>
                </li>
              );
            })}
          </ul>
          <dl className="me-stats"><div><dt>Species</dt><dd><CountUp value={row.species || 0} /></dd></div><div><dt>Badges</dt><dd><CountUp value={row.badges || 0} /></dd></div><div><dt>Outings</dt><dd><CountUp value={row.outings || 0} /></dd></div></dl>
        </section>
        {isMe && <div className="me-acts me-acts--one"><Link className="me-act me-act--primary" to="/me/edit"><span>Edit profile</span></Link></div>}
        <section className="me-sec" aria-labelledby="me-found-h">
          <div className="me-sec-h"><h2 id="me-found-h">{isMe ? "Species you've found" : `Species ${first} has found`}</h2></div>
          {dex.length ? (
            <>
              <p className="me-sec-sub">{dex.length} species{!isMe ? `. You have both found ${both}.` : ''}{isMe && !row.show_dex ? ' Only you can see this list. Turn on "Show the species I\'ve found" in Edit profile to share it.' : ''}</p>
              <ul className="me-grid" role="list">
                {dex.map((sp) => sp && (
                  <li key={sp.id}>
                    <Link className={`me-tile kind--${sp.kind}`} to={`/bird/${sp.id}`}>
                      <span className="tile-img"><SpeciesImage sp={sp} />{!isMe && mineSeen.has(sp.id) && <span className="me-both">✓<span>You too</span></span>}</span>
                      <span className="me-tile-name">{sp.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="me-empty">{isMe ? (row.dex ? 'Nothing found yet. Your first sighting starts the list.' : 'Your list shows here once your sightings have synced.') : `${first} keeps the species they've found private.`}</p>}
        </section>
      </div>
    </div>
  );
}
