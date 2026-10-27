import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SPECIES, byId, type Species } from '../../lib/data';
import { useSeen, useMedia } from '../../lib/hooks';
import { SpeciesImage } from '../../components/SpeciesImage';
import { Sheet } from '../../components/Sheet';
import { syncStatus } from '../../core/account.js';
import {
  signedIn, configured, getProfile, getMyCloud, initProfile, saveMyProfile, setCloud,
  uploadAvatarPhoto, removeAvatarPhoto, avatarUrl, problem, resizeImage, squareJpeg,
} from '../../core/profile.js';
import './me.css';

const I = {
  back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  cam: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" /></>,
  leaf: <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  search: <><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
};

export default function EditProfile() {
  const navigate = useNavigate();
  const seen = useSeen();
  const fileRef = useRef<HTMLInputElement>(null);
  useMedia();
  const [tick, setTick] = useState(0);
  const [name, setName] = useState('');
  const [showLb, setShowLb] = useState(true);
  const [showDex, setShowDex] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    void initProfile(() => setTick((n) => n + 1)).then((p: any) => {
      setName(p.displayName || '');
      setShowLb(p.showOnLeaderboard !== false);
      setShowDex(!!getMyCloud()?.showDex);
    });
  }, []);

  const prof = getProfile();
  const m = getMyCloud();
  const sync = syncStatus();
  const u = signedIn();

  if (!configured) return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24">{I.back}</svg></Link><h1>Edit profile</h1></header><div className="me-msg"><p>Profiles need accounts, which are not set up in this copy of the app.</p></div></div>;
  if (!u) return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24">{I.back}</svg></Link><h1>Edit profile</h1></header><div className="me-msg"><p>Sign in to edit your profile.</p><Link className="btn btn--primary" to="/me/signin">Sign in</Link></div></div>;

  const saveName = async () => {
    const v = name.trim().slice(0, 40);
    if (v === (prof.displayName || '')) return;
    await saveMyProfile({ displayName: v });
    setMsg('Name saved.');
  };
  const choose = async (sp: Species | null) => {
    if (!sp) { setPicking(false); return; }
    await saveName();
    await saveMyProfile({ avatarSpeciesId: sp.id });
    let note = `${sp.name} is your picture.`;
    if (getMyCloud()?.avatarPath) {
      if (navigator.onLine) { try { await removeAvatarPhoto(); } catch (x) { note = problem(x); } }
      else note = 'Saved. Your photo shows until you are back online and remove it.';
    }
    setMsg(note); setPicking(false); setTick((n) => n + 1);
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (!navigator.onLine) { setMsg('Uploading a photo needs signal. Your species picture works offline.'); return; }
    setBusy(true); setMsg('');
    try {
      const blob = await resizeImage(file, 1400);
      if (!blob) throw new Error("That file couldn't be opened as a photo.");
      const url = URL.createObjectURL(blob);
      const img = new Image(); img.src = url;
      await img.decode();
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const out = await squareJpeg(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side);
      URL.revokeObjectURL(url);
      await uploadAvatarPhoto(out);
      setMsg('Photo saved. It shows on your profile and the leaderboard.');
      setTick((n) => n + 1);
    } catch (x) { setMsg(problem(x)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!navigator.onLine) { setMsg('Removing your photo needs a connection.'); return; }
    setBusy(true);
    try { await removeAvatarPhoto(); setMsg('Photo removed.'); setTick((n) => n + 1); }
    catch (x) { setMsg(problem(x)); }
    finally { setBusy(false); }
  };

  const results = SPECIES.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (Number(seen.has(b.id)) - Number(seen.has(a.id))) || a.id - b.id)
    .slice(0, 60);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24">{I.back}</svg></Link>
        <h1>Edit profile</h1>
      </header>
      <div className="me me--edit pad-x">
        <div className="me-edit-av">
          <span className="me-edit-pic">
            <span className={`acct-av me-av-xl${m?.avatarPath ? ' acct-av--photo' : ''}`} aria-hidden="true">
              {m?.avatarPath ? <img src={avatarUrl(m.avatarPath)} alt="" /> : byId.get(Number(prof.avatarSpeciesId)) ? <SpeciesImage sp={byId.get(Number(prof.avatarSpeciesId))!} size="large" /> : <span className="acct-av-letter">{(name || 'You').slice(0, 1).toUpperCase()}</span>}
            </span>
          </span>
          <div className="me-edit-picks">
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => fileRef.current?.click()}><svg viewBox="0 0 24 24">{I.cam}</svg> {m?.avatarPath ? 'New photo' : 'Upload a photo'}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f); }} />
            <button type="button" className="btn btn--small" onClick={() => setPicking(true)}><svg viewBox="0 0 24 24">{I.leaf}</svg> Choose a species</button>
            {m?.avatarPath && <button type="button" className="btn btn--small btn--quiet btn--danger" disabled={busy} onClick={() => void remove()}>Remove photo</button>}
          </div>
        </div>
        <p className="small me-edit-msg" role="status" aria-live="polite">{msg}</p>
        <label className="field"><span>Display name</span><input maxLength={40} autoComplete="nickname" value={name} placeholder={prof.displayName || 'You'} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } }} /></label>
        <label className="check check--card me-check">
          <input type="checkbox" checked={showLb} onChange={async (e) => { setShowLb(e.target.checked); await saveMyProfile({ showOnLeaderboard: e.target.checked }); setMsg(e.target.checked ? 'You show on the leaderboard.' : 'You are hidden from the Everyone board.'); }} />
          <span><strong>Show me on the leaderboard</strong><span className="small muted">Only your name, picture and counts are shown, never your sightings, places, notes or photos. Groups you join always show you to their members.</span></span>
        </label>
        <label className="check check--card me-check">
          <input type="checkbox" checked={showDex} disabled={busy || !navigator.onLine} onChange={async (e) => {
            const on = e.target.checked;
            setShowDex(on); setBusy(true);
            try { await setCloud({ show_dex: on }); setMsg(on ? 'Your found species show on your profile.' : 'Your found species are hidden.'); }
            catch (x) { setShowDex(!on); setMsg(problem(x)); }
            finally { setBusy(false); }
          }} />
          <span><strong>Show the species I've found on my profile</strong><span className="small muted">People who can open your profile see which species you have found. Never where or when, your notes or your photos.</span></span>
        </label>
        <p className="small muted" data-state={sync.state}>{sync.text || ''}</p>
        <div className="row-end"><button type="button" className="btn btn--primary" onClick={async () => { await saveName(); navigate('/me'); }}>Done</button></div>
      </div>

      <Sheet open={picking} onClose={() => choose(null)} label="Choose an avatar" wide>
        <h2 className="sheet-title">Choose an avatar</h2>
        <div className="searchbox"><svg viewBox="0 0 24 24">{I.search}</svg><input type="search" placeholder="Search species" aria-label="Search species" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <ul className="rows acct-picklist">
          {results.map((s) => (
            <li key={s.id}><button type="button" className="row row--sp" onClick={() => void choose(s)}><span className="row-thumb"><SpeciesImage sp={s} /></span><span className="row-main"><strong>{s.name}</strong>{seen.has(s.id) && <span className="small muted">In your dex</span>}</span></button></li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
