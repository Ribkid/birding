import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KINDS, byId, kindsPresent, ofKind, type PublicProfileRow } from '../../lib/data';
import { useSeen, useMedia } from '../../lib/hooks';
import { SpeciesImage } from '../../components/SpeciesImage';
import { configured, signedIn, initProfile, loadPublicProfile, memberSince, dayPick, getPublicProfileCache, problem } from '../../core/profile.js';
import { onAuth } from '../../core/cloud.js';
import { authSettled } from '../../core/account.js';
import { applyTint, stagger } from '../../lib/look';
import { AccountAvatar, AccountCta } from './accountBits';
import { Count } from './Count';
import { onAccountSheetClosed, openEditProfile } from './AccountSheets';
import './me.css';

const back = <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;
// The hero's glass back button uses v1 me.js I.back, a bare path that me.css strokes (.me-glassbtn svg).
const heroBack = <path d="M15 5l-7 7 7 7" />;
const edit = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>;
const tick = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

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
    const cached = getPublicProfileCache(publicId) as PublicProfileRow | null;
    setRow(cached);
    setState(cached ? 'ready' : 'loading');
    setErr('');
    void initProfile();
    if (!/^[0-9a-f-]{36}$/i.test(publicId)) { setState('error'); setErr("This profile isn't available. It may be private, or the link may be wrong."); return; }
    if (!configured) { setState('error'); setErr('Profiles need accounts, which are not set up in this copy of the app.'); return; }
    if (!signedIn()) { setState(authDone ? 'signedout' : 'loading'); return; }
    if (!navigator.onLine) { setState(row ? 'ready' : 'offline'); return; }
    let alive = true;
    void loadPublicProfile(publicId)
      .then((r: PublicProfileRow) => { if (alive) { setRow(r); setState('ready'); } })
      .catch((x: any) => { if (alive) { setErr(/not found/i.test(x?.message || '') ? "This profile isn't available. It may be private, or the link may be wrong." : problem(x)); setState(row ? 'ready' : 'error'); } });
    return () => { alive = false; };
  }, [publicId, authDone, authTick]);

  const isMe = !!row?.is_me;
  const backHref = isMe ? '/me' : '/leaderboard';
  // v1 rerenderMine: your own profile is fetched again once Edit profile closes over it.
  useEffect(() => onAccountSheetClosed((kind) => { if (kind === 'edit' && isMe) setAuthTick((n) => n + 1); }), [isMe]);
  useEffect(() => {
    if (!row) return;
    const hero = document.querySelector('.me-hero') as HTMLElement | null;
    const img = hero?.querySelector('[data-hero-frame] img') as HTMLImageElement | null;
    if (hero && img) void applyTint(hero, img.src);
    document.querySelectorAll<HTMLElement>('.me-rings').forEach((el) => el.classList.add('is-in'));
    // The species tiles rise in once per profile per session (v1 paintProfile: stagger '.me-grid > li').
    const id = requestAnimationFrame(() => stagger(document.querySelector('.me--profile'), '.me-grid > li', { key: `me-u-${publicId}`, max: 15 }));
    return () => cancelAnimationFrame(id);
  }, [row, publicId]);

  const dex = useMemo(() => (row?.dex || []).map((n) => byId.get(n)).filter(Boolean), [row]);
  const mineSeen = seen;
  const both = dex.filter((sp) => sp && mineSeen.has(sp.id)).length;
  const cover = byId.get(Number(row?.avatar_species_id)) || dex[dex.length - 1] || dayPick(row?.display_name?.length || 0);
  const first = row?.is_me ? 'You' : (row?.display_name || 'They').split(' ')[0];
  const counts = Object.fromEntries(kindsPresent.map((k) => [k, (row as any)?.[k] || 0]));

  if (state === 'signedout') {
    return (
      <div className="me">
        <header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true">{back}</svg></Link><h1>Profile</h1></header>
        <div className="me-msg"><p>Sign in to see other people's profiles. It's free, and your dex comes with you.</p><AccountCta /></div>
      </div>
    );
  }
  if (state === 'loading') {
    return <div className="me me--loading"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true">{back}</svg></Link><h1>Loading profile</h1></header><div className="me-msg"><p className="muted" role="status">Loading…</p></div></div>;
  }
  if (state === 'offline') {
    return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true">{back}</svg></Link><h1>Profile</h1></header><div className="me-msg"><p>Profiles need a connection. Your own dex works offline as usual.</p></div></div>;
  }
  if (state === 'error' || !row) {
    return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to={backHref} aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true">{back}</svg></Link><h1>Profile</h1></header><div className="me-msg"><p>{err || 'This profile could not be loaded.'}</p></div></div>;
  }

  return (
    <div className="me me--profile">
      <section className="me-hero">
        <div className="me-cover" data-hero-frame aria-hidden="true">{cover && <SpeciesImage sp={cover} size="large" />}</div>
        <div className="me-scrim" aria-hidden="true" />
        <div className="page-head--back me-back"><Link className="iconbtn me-glassbtn glass" to={backHref} aria-label={isMe ? 'Back to Me' : 'Back to the leaderboard'}><svg viewBox="0 0 24 24" aria-hidden="true">{heroBack}</svg></Link></div>
        <div className="me-id">
          <span className="me-av-ring">
            <AccountAvatar spId={row.avatar_species_id} path={row.avatar_path} name={row.display_name} cls="acct-av me-av" size="large" />
          </span>
          <div className="me-id-txt">
            <h1 className="me-name">{row.display_name || 'Birder'}</h1>
            {row.member_since && <p className="me-sub">{memberSince(row.member_since)}</p>}
            {row.is_me && <p className="me-sub me-you">This is how other people see you</p>}
          </div>
        </div>
      </section>
      <div className="me-sheet">
        <section className="me-card me-dex" data-ckey={`p-${publicId}`} aria-label="Found so far">
          <ul className="me-rings" role="list">
            {kindsPresent.map((k) => {
              const n = counts[k] || 0;
              const total = ofKind(k).length;
              const p = total ? Math.max(n ? 0.03 : 0, n / total) : 0;
              return (
                <li key={k} className={`me-ring-item kind--${k}`}>
                  <span className="sr-only">{n} of {total} {KINDS[k]?.label.toLowerCase()}</span>
                  <span className="me-ring" style={{ '--p': p.toFixed(4) } as React.CSSProperties} aria-hidden="true"><svg viewBox="0 0 48 48"><circle className="me-ring-track" cx="24" cy="24" r="20" /><circle className="me-ring-fill" cx="24" cy="24" r="20" pathLength="100" /></svg><Count k={`p-${publicId}:ring-${k}`} n={n} className="me-ring-n" /></span>
                  <span className="me-ring-l" aria-hidden="true">{KINDS[k]?.label}</span><span className="me-ring-of" aria-hidden="true">of {total}</span>
                </li>
              );
            })}
          </ul>
          <dl className="me-stats"><div><dt>Species</dt><Count tag="dd" k={`p-${publicId}:species`} n={row.species || 0} /></div><div><dt>Badges</dt><Count tag="dd" k={`p-${publicId}:badges`} n={row.badges || 0} /></div><div><dt>Outings</dt><Count tag="dd" k={`p-${publicId}:outings`} n={row.outings || 0} /></div></dl>
        </section>
        {isMe && <div className="me-acts me-acts--one"><button type="button" className="me-act me-act--primary" data-edit onClick={openEditProfile}>{edit}<span>Edit profile</span></button></div>}
        <section className="me-sec" aria-labelledby="me-found-h">
          <div className="me-sec-h"><h2 id="me-found-h">{isMe ? "Species you've found" : `Species ${first} has found`}</h2></div>
          {dex.length ? (
            <>
              <p className="me-sec-sub">{dex.length} species{!isMe ? `. You have both found ${both}.` : ''}{isMe && !row.show_dex ? ' Only you can see this list. Turn on "Show the species I\'ve found" in Edit profile to share it.' : ''}</p>
              <ul className="me-grid" role="list">
                {dex.map((sp) => sp && (
                  <li key={sp.id}>
                    <Link className={`me-tile kind--${sp.kind}`} to={`/bird/${sp.id}`} data-tile={sp.id}>
                      <span className="tile-img"><SpeciesImage sp={sp} />{!isMe && mineSeen.has(sp.id) && <span className="me-both">{tick}<span>You too</span></span>}</span>{' '}
                      <span className="me-tile-name">{sp.name}</span>{!isMe && mineSeen.has(sp.id) && <span className="sr-only">Seen by you too</span>}
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
