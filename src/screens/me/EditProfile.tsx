import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SPECIES, byId, type Species } from '../../lib/data';
import { useSeen, useMedia } from '../../lib/hooks';
import { SpeciesImage } from '../../components/SpeciesImage';
import { Sheet } from '../../components/Sheet';
import { onStatus, syncStatus } from '../../core/account.js';
import {
  signedIn, configured, getProfile, getMyCloud, myName, initProfile, saveMyProfile, setCloud,
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
  const [crop, setCrop] = useState<{ url: string; img: HTMLImageElement; W: number; H: number; S: number; z: number; tx: number; ty: number } | null>(null);
  const [cropErr, setCropErr] = useState('');
  const [cropBusy, setCropBusy] = useState(false);
  const cropRef = useRef<HTMLDivElement>(null);
  const cropPts = useRef(new Map<number, { x: number; y: number }>());
  const cropLast = useRef<{ x: number; y: number; d?: number } | null>(null);
  const cropState = useRef(crop);
  cropState.current = crop;

  useEffect(() => {
    void initProfile(() => setTick((n) => n + 1)).then((p: any) => {
      setName(p.displayName || '');
      setShowLb(p.showOnLeaderboard !== false);
      setShowDex(!!getMyCloud()?.showDex);
    });
  }, []);

  useEffect(() => { const off = onStatus((state: typeof sync) => setSync(state)); return () => { off(); }; }, []);

  const prof = getProfile();
  const m = getMyCloud();
  const [sync, setSync] = useState(syncStatus());
  const u = signedIn();

  if (!configured) return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24">{I.back}</svg></Link><h1>Edit profile</h1></header><div className="me-msg"><p>Profiles need accounts, which are not set up in this copy of the app.</p></div></div>;
  if (!u) return <div className="me"><header className="page-head page-head--back"><Link className="iconbtn" to="/me" aria-label="Back to Me"><svg viewBox="0 0 24 24">{I.back}</svg></Link><h1>Edit profile</h1></header><div className="me-msg"><p>Sign in to edit your profile.</p><Link className="btn btn--primary" to="/me/signin">Sign in</Link></div></div>;

  const baseFor = (S: number, W: number, H: number) => S / Math.min(W, H);
  const clampCrop = (c: NonNullable<typeof crop>) => {
    const sc = baseFor(c.S, c.W, c.H) * c.z;
    return { ...c, tx: Math.min(0, Math.max(c.S - c.W * sc, c.tx)), ty: Math.min(0, Math.max(c.S - c.H * sc, c.ty)) };
  };
  const zoomTo = (nz: number, cx?: number, cy?: number) => {
    setCrop((cur) => {
      if (!cur) return cur;
      const next = Math.min(4, Math.max(1, nz));
      const k = next / cur.z;
      const ax = cx ?? cur.S / 2;
      const ay = cy ?? cur.S / 2;
      return clampCrop({ ...cur, z: next, tx: ax - (ax - cur.tx) * k, ty: ay - (ay - cur.ty) * k });
    });
  };
  const closeCrop = () => {
    if (cropState.current) URL.revokeObjectURL(cropState.current.url);
    setCrop(null);
    setCropErr('');
  };
  useEffect(() => () => { if (cropState.current) URL.revokeObjectURL(cropState.current.url); }, []);

  useEffect(() => {
    const stage = cropRef.current;
    if (!crop || !stage) return;
    const size = () => {
      const S = stage.clientWidth;
      setCrop((cur) => {
        if (!cur || !S) return cur;
        if (!cur.S) {
          const sc = baseFor(S, cur.W, cur.H);
          return clampCrop({ ...cur, S, tx: (S - cur.W * sc) / 2, ty: (S - cur.H * sc) / 2 });
        }
        return clampCrop({ ...cur, S, tx: cur.tx * S / cur.S, ty: cur.ty * S / cur.S });
      });
    };
    const raf = requestAnimationFrame(size);
    const observer = new ResizeObserver(() => size());
    observer.observe(stage);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [crop?.url]);

  const cropMid = () => {
    const [a, b] = [...cropPts.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const cropDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cropLast.current = cropPts.current.size === 2 ? cropMid() : { x: e.clientX, y: e.clientY };
  };
  const cropMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropPts.current.has(e.pointerId)) return;
    cropPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = e.currentTarget.getBoundingClientRect();
    if (cropPts.current.size >= 2) {
      const m2 = cropMid();
      setCrop((cur) => {
        if (!cur) return cur;
        let next = { ...cur, tx: cur.tx + m2.x - (cropLast.current?.x ?? m2.x), ty: cur.ty + m2.y - (cropLast.current?.y ?? m2.y) };
        const last = cropLast.current;
        if (last?.d) {
          const nz = Math.min(4, Math.max(1, next.z * (m2.d / last.d)));
          const k = nz / next.z;
          const ax = m2.x - r.left;
          const ay = m2.y - r.top;
          next = { ...next, z: nz, tx: ax - (ax - next.tx) * k, ty: ay - (ay - next.ty) * k };
        }
        return clampCrop(next);
      });
      cropLast.current = m2;
    } else {
      const last = cropLast.current;
      setCrop((cur) => cur ? clampCrop({ ...cur, tx: cur.tx + e.clientX - (last?.x ?? e.clientX), ty: cur.ty + e.clientY - (last?.y ?? e.clientY) }) : cur);
      cropLast.current = { x: e.clientX, y: e.clientY };
    }
  };
  const cropUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    cropPts.current.delete(e.pointerId);
    cropLast.current = cropPts.current.size === 2 ? cropMid() : cropPts.current.size === 1 ? [...cropPts.current.values()][0] : null;
  };
  const cropWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    zoomTo((crop?.z || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
  };
  const cropKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const mv = moves[e.key];
    if (mv) { e.preventDefault(); setCrop((cur) => cur ? clampCrop({ ...cur, tx: cur.tx + mv[0], ty: cur.ty + mv[1] }) : cur); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo((crop?.z || 1) * 1.1); }
    if (e.key === '-') { e.preventDefault(); zoomTo((crop?.z || 1) / 1.1); }
  };

  const useCrop = async () => {
    if (!crop) return;
    setCropErr('');
    if (!navigator.onLine) { setCropErr('Uploading needs signal. Try again when you have some.'); return; }
    setCropBusy(true);
    try {
      const sc = baseFor(crop.S, crop.W, crop.H) * crop.z;
      const out = await squareJpeg(crop.img, -crop.tx / sc, -crop.ty / sc, crop.S / sc);
      await uploadAvatarPhoto(out);
      closeCrop();
      setMsg('Photo saved. It shows on your profile and the leaderboard.');
      setTick((n) => n + 1);
    } catch (x) { setCropErr(problem(x)); }
    finally { setCropBusy(false); }
  };

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
    setMsg('');
    let url = '';
    try {
      const blob = await resizeImage(file, 1400);
      if (!blob) throw new Error("That file couldn't be opened as a photo.");
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error("That file couldn't be opened as a photo."); }
      setCrop({ url, img, W: img.naturalWidth, H: img.naturalHeight, S: 0, z: 1, tx: 0, ty: 0 });
    } catch (x) {
      if (url && !cropState.current) URL.revokeObjectURL(url);
      setMsg(problem(x));
    }
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
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => { if (!navigator.onLine) { setMsg('Uploading a photo needs signal. Your species picture works offline.'); return; } fileRef.current?.click(); }}><svg viewBox="0 0 24 24">{I.cam}</svg> {m?.avatarPath ? 'New photo' : 'Upload a photo'}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f); }} />
            <button type="button" className="btn btn--small" onClick={() => setPicking(true)}><svg viewBox="0 0 24 24">{I.leaf}</svg> Choose a species</button>
            {m?.avatarPath && <button type="button" className="btn btn--small btn--quiet btn--danger" disabled={busy} onClick={() => void remove()}>Remove photo</button>}
          </div>
        </div>
        <p className="small me-edit-msg" role="status" aria-live="polite">{msg}</p>
        <label className="field"><span>Display name</span><input maxLength={40} autoComplete="nickname" value={name} placeholder={myName()} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } }} /></label>
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

      <Sheet open={!!crop} onClose={closeCrop} label="Frame your photo" cls="me-crop-sheet">
        <h2 className="sheet-title">Frame your photo</h2>
        <p className="small muted">Drag to move it. Pinch or use the slider to zoom.</p>
        <div
          ref={cropRef}
          className="me-crop"
          tabIndex={0}
          role="group"
          aria-label="Photo framing. Arrow keys move the photo; plus and minus zoom."
          onPointerDown={cropDown}
          onPointerMove={cropMove}
          onPointerUp={cropUp}
          onPointerCancel={cropUp}
          onWheel={cropWheel}
          onKeyDown={cropKey}
        >
          {crop && (
            <img
              src={crop.url}
              alt=""
              draggable={false}
              style={{ transform: `translate(${crop.tx}px, ${crop.ty}px) scale(${crop.S ? baseFor(crop.S, crop.W, crop.H) * crop.z : 1})` }}
            />
          )}
          <span className="me-crop-mask" aria-hidden="true" />
        </div>
        <label className="field me-zoom"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value={crop?.z || 1} onChange={(e) => zoomTo(Number(e.target.value))} /></label>
        {cropErr && <p className="form-error" role="alert">{cropErr}</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={closeCrop}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={cropBusy} onClick={() => void useCrop()}>{cropBusy ? 'Uploading…' : 'Use this photo'}</button>
        </div>
      </Sheet>

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
