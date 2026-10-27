// Settings (#/settings): a port of v1 renderSettings (birding-refresh js/app.js:2465-2570), the "Your profile" row
// (js/me.js profileRow) and the Account card (js/account.js renderAccountSection), on rest.css's grouped set-cards.
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { byId } from '../../lib/data';
import { db } from '../../core/db.js';
import { toEbirdCsv } from '../../core/ebird.js';
import { onAuth, user } from '../../core/cloud.js';
import { localProfile, onStatus, pendingCount, syncNow, syncStatus } from '../../core/sync.js';
import { accountStarted, authSettled, deleteAccount, signOutAccount } from '../../core/account.js';
import { configured, getMyCloud, getProfile, myName, saveMyProfile, signedIn } from '../../core/profile.js';
import { openWelcome } from '../../components/Welcome';
import { Icon } from '../../components/Icon';
import { stagger } from '../../lib/look';
import { focusables } from '../../lib/layers';
import { countUp } from '../../lib/motion';
import { ConfirmDialog, Modal, fmtDate, plural } from '../lists/shared';
import { AccountAvatar, SignInForm, trophyIcon, useProfile } from '../me/accountBits';
import { announce, toast } from '../toast';
import { FIELD, callWho, checkField, fieldJob, fieldJobs, fieldLabel, type FieldKey, type FieldReport, type FieldResult } from './fieldReady';
import { isInstalled, promptInstall, useInstallPrompt } from './install';
import { THEMES, saveTheme, storedSettings, type Theme } from './theme';
import './progress.css';

interface AccountUser { id: string; email: string; name: string }
interface SyncState { state: string; text?: string }
interface BackupData {
  app?: string;
  version?: number;
  savedAt?: string;
  sightings?: unknown[];
  outings?: unknown[];
  patches?: unknown[];
  settings?: Record<string, unknown>;
  photos?: { id: number; at?: number; data: string }[];
}

const chev = (
  <svg className="set-chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const person = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>;
const meChev = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>;
const tick = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(fr.error ?? new Error('Could not read the photo'));
  fr.readAsDataURL(b);
});
function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const message = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e ?? ''));

// v1's openSheet puts focus on the sheet's first control (Cancel, or "Keep a copy") once it is up
// (js/app.js openSheet); the shared Sheet leaves it on the page, so Settings' sheets do it here.
function useSheetFocus(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const sheet = document.querySelector<HTMLElement>('.sheet-wrap:not([data-closing]) .sheet');
      if (sheet && !sheet.contains(document.activeElement)) focusables(sheet)[0]?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(t);
  }, [open]);
}

// ---------- the "Your profile" row (v1 js/me.js profileRow) ----------
function ProfileRow() {
  const prof = getProfile();
  const u = signedIn();
  const sub = !configured ? 'Your lists, badges and stats' : u ? 'Photo, name, leaderboard and groups' : 'Sign up free to back up your dex';
  return (
    <Link className="me-row-link" to="/me">
      {u
        ? <AccountAvatar spId={prof.avatarSpeciesId} path={getMyCloud()?.avatarPath} name={myName()} cls="acct-av me-row-av" />
        : <span className="acct-av me-row-av me-row-av--guest">{person}</span>}
      <span className="me-row-main"><strong>{u ? myName() : 'Your profile'}</strong><span className="small muted">{sub}</span></span>
      <span className="me-chev">{meChev}</span>
    </Link>
  );
}

// ---------- Ready for the field (v1 js/app.js:2479-2489 and wireField, :2684+) ----------
type FieldRow = FieldResult & { busy?: boolean; prog?: number };

function ReadyCard() {
  const [field, setField] = useState<Partial<Record<FieldKey, FieldRow>>>({});
  const [summary, setSummary] = useState<{ text: string; n: number } | null>(null);
  const alive = useRef(true);
  const who = useRef('');
  const texts = useRef<Partial<Record<FieldKey, HTMLSpanElement | null>>>({});
  const num = useRef<HTMLElement>(null);
  const shown = useRef(0);

  const paint = (key: FieldKey, r: FieldResult) => {
    if (alive.current) setField((cur) => ({ ...cur, [key]: { ...r, busy: false } }));
  };
  const check = (key: FieldKey) => checkField(key, who.current)
    .catch(() => ({ ok: false, text: "Couldn't check this one. Open Settings again to retry." }))
    .then((r) => { paint(key, r); return r; });

  const follow = (key: FieldKey, job: ReturnType<typeof fieldJob>) => {
    const on: FieldReport = (f, t) => {
      if (!alive.current) return;
      setField((cur) => {
        const row = cur[key] || { ok: false, text: '' };
        return { ...cur, [key]: { ...row, busy: true, text: t || row.text, prog: f == null ? row.prog || 0 : Math.round(f * 100) } };
      });
    };
    setField((cur) => ({ ...cur, [key]: { ok: false, text: 'Saving…', busy: true, prog: 0 } }));
    job.subs.add(on);
    on(...job.last);
    job.p.then(() => {
      if (!alive.current) return;
      void navigator.storage?.persist?.();
      void check(key).then((r) => announce(`${fieldLabel(key)}: ${r.text || 'done'}`));
    }, (err: unknown) => {
      if (!alive.current) return;
      const msg = `Couldn't finish: ${message(err)}. Check the connection and try again.`;
      paint(key, { ok: false, text: msg, get: true });
      announce(`${fieldLabel(key)}: ${msg}`);
    }).finally(() => job.subs.delete(on));
  };

  const get = (key: FieldKey) => {
    if (!navigator.onLine) {
      setField((cur) => ({ ...cur, [key]: { ...(cur[key] || { ok: false }), get: true, busy: false, text: "You're offline. Connect to the internet, then try again." } }));
      return;
    }
    // The button turns into a "Saving" chip, so keep focus in the row on its status text (v1 follow()).
    texts.current[key]?.focus({ preventScroll: true });
    follow(key, fieldJob(key));
  };

  useEffect(() => {
    alive.current = true;
    void callWho().catch(() => '').then((w) => {
      who.current = w;
      for (const { key } of FIELD) {
        const running = fieldJobs.get(key);
        if (running) follow(key, running);
        else void check(key);
      }
    });
    return () => { alive.current = false; };
    // Checked once when Settings opens; a download keeps going if she leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The summary and ring wait until every row has an answer (and none is downloading), as v1 summary() does.
  const allIn = FIELD.every(({ key }) => field[key] && !field[key]?.busy);
  useEffect(() => {
    if (!allIn) return;
    const n = FIELD.filter(({ key }) => field[key]?.ok).length;
    setSummary({
      n,
      text: n === FIELD.length ? 'Everything here works with no signal.'
        : `${n} of ${FIELD.length} ready. ${navigator.onLine ? 'Get the rest while you have Wi-Fi.' : 'The rest needs signal to save.'}`,
    });
  }, [allIn, field]);
  useEffect(() => {
    const el = num.current;
    const n = summary?.n ?? 0;
    if (!el) return;
    if (shown.current !== n) void countUp(el, shown.current, n);
    else el.textContent = String(n);
    shown.current = n;
  }, [summary?.n]);

  const n = summary?.n ?? 0;
  return (
    <section className="set-card set-ready" aria-labelledby="field-h">
      <div className="ready-head">
        <span className={`ready-ring${summary && n === FIELD.length ? ' ready-ring--all' : ''}`} style={{ '--p': summary ? n / FIELD.length : 0 } as CSSProperties} aria-hidden="true">
          <svg viewBox="0 0 48 48"><circle className="ready-ring-track" cx="24" cy="24" r="20" /><circle className="ready-ring-fill" cx="24" cy="24" r="20" pathLength={100} /></svg>
          <b ref={num} />
        </span>
        <div className="ready-head-txt">
          <h2 className="set-title" id="field-h">Ready for the field</h2>
          <p className="small muted">{summary?.text ?? 'What works on this phone with no signal.'}</p>
        </div>
      </div>
      <ul className="ready-list">
        {FIELD.map(({ key, label }) => {
          const r = field[key];
          const cls = r?.busy ? ' ready-row--busy' : r ? (r.ok ? ' ready-row--ok' : ' ready-row--todo') : '';
          return (
            <li key={key} className={`ready-row${cls}`}>
              <strong className="ready-name">{label}</strong>
              <div className="ready-act">
                {!r ? <span className="ready-chip ready-chip--wait">Checking</span>
                  : r.busy ? <span className="ready-chip ready-chip--busy">Saving</span>
                    : r.ok ? <span className="ready-chip ready-chip--ok">{tick}Saved</span>
                      : r.get ? <button type="button" className="ready-chip ready-chip--get" onClick={() => get(key)} aria-label={`Get it now: ${label}`}>Get it now</button>
                        : r.link ? <Link className="ready-chip ready-chip--get" to={r.link.replace(/^#/, '')}>{r.linkText}</Link>
                          : <span className="ready-chip ready-chip--wait">Not yet</span>}
              </div>
              <span className="ready-text small muted" data-field-text tabIndex={-1} ref={(el) => { texts.current[key] = el; }}>{r?.text || 'Checking…'}</span>
              {r?.busy && (
                <div className="meter meter--thin" style={{ '--p': `${r.prog || 0}%` } as CSSProperties} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.prog || 0} aria-label={`${label}: saving`}>
                  <span />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- the Account card (v1 js/account.js renderAccountSection) ----------
function AccountCard({ onChange }: { onChange: () => void }) {
  const [ready, setReady] = useState(accountStarted());
  const [u, setU] = useState<AccountUser | null>(() => (accountStarted() ? (user() as AccountUser | null) : null));
  const [sync, setSync] = useState<SyncState>(() => syncStatus() as SyncState);
  const [pending, setPending] = useState(0);
  const [name, setName] = useState(() => getProfile().displayName || '');
  const [lb, setLb] = useState(() => getProfile().showOnLeaderboard !== false);
  const [signOutAsk, setSignOutAsk] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  useSheetFocus(signOutAsk || deleteAsk);

  const countPending = () => { void Promise.resolve(pendingCount()).then((n: number) => setPending(n || 0)).catch(() => {}); };
  const loadProfile = async () => {
    const p = (await localProfile()) as { displayName?: string; showOnLeaderboard?: boolean };
    setName(p.displayName || '');
    setLb(p.showOnLeaderboard !== false);
  };

  useEffect(() => {
    let alive = true;
    void authSettled.then(() => { if (alive) { setReady(true); setU(user() as AccountUser | null); } });
    const offAuth = onAuth((next: AccountUser | null) => {
      if (!alive) return;
      setU(next);
      void loadProfile();
      countPending();
      onChange();
    });
    const offStatus = onStatus((st: SyncState) => { if (alive) { setSync(st); countPending(); } });
    void loadProfile();
    countPending();
    return () => { alive = false; offAuth(); offStatus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!configured || !ready) return null;

  if (!u) {
    return (
      <section className="set-card set-acct" data-account>
        <h2 className="h2">Account</h2>
        <p className="muted small">Optional. Sign in to back up your sightings and photos, have them on your other devices, and join the leaderboard. Without an account everything still works, offline too.</p>
        <div data-signin><SignInForm /></div>
      </section>
    );
  }

  const prof = getProfile();
  const shown = myName();
  const saveName = async () => {
    const v = name.trim().slice(0, 40);
    if (v === (getProfile().displayName || '')) return;
    await saveMyProfile({ displayName: v });
    setName(v);
    toast('Name saved');
    onChange();
  };
  const doSync = async () => {
    if (!navigator.onLine) { toast('Offline, will sync when you are back online'); return; }
    await syncNow();
    countPending();
  };
  const doSignOut = async (wipeLocal: boolean) => {
    setSignOutAsk(false);
    await signOutAccount({ wipeLocal });
    toast(wipeLocal ? 'Signed out and removed from this device' : 'Signed out. Your data stays on this device.');
    setU(null);
    onChange();
  };
  const askDelete = () => {
    if (!navigator.onLine) { toast('Deleting your account needs a connection.'); return; }
    setDeleteAsk(true);
  };
  const doDelete = async () => {
    setDeleteAsk(false);
    try {
      toast('Deleting your account…');
      await deleteAccount();
      toast('Account deleted. Your sightings are still on this device.');
      setU(null);
      onChange();
    } catch (e) {
      toast(`Couldn't delete the account: ${message(e)}`);
    }
  };

  return (
    <section className="set-card set-acct" data-account>
      <h2 className="h2">Account</h2>
      <div className="acct-card">
        <AccountAvatar spId={prof.avatarSpeciesId} path={getMyCloud()?.avatarPath} name={shown} cls="acct-av acct-av--big" />
        <div className="acct-who">
          <strong>{shown}</strong>
          <span className="small muted">{u.email}</span>
          <span className="small acct-status" data-sync-status data-state={sync.state}>{sync.text || ''}</span>
        </div>
      </div>
      <label className="field">
        <span>Display name (shown on the leaderboard)</span>
        <input
          name="displayName"
          maxLength={40}
          value={name}
          placeholder={shown}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } }}
        />
      </label>
      <div className="acct-row"><span className="small muted">Photo, name and who sees your profile</span><Link className="btn btn--small" to="/me/edit">Edit profile</Link></div>
      <label className="check check--card me-check">
        <input type="checkbox" checked={lb} onChange={(e) => { const on = e.target.checked; setLb(on); void saveMyProfile({ showOnLeaderboard: on }); }} />
        <span><strong>Show me on the leaderboard</strong><span className="small muted">Only your name, picture and counts are shown, never your sightings, places, notes or photos. Groups you join always show you to their members.</span></span>
      </label>
      <div className="row-start">
        <Link className="btn" to="/leaderboard">{trophyIcon} Leaderboard</Link>
        <button type="button" className="btn" onClick={() => void doSync()}>Sync now</button>
        <button type="button" className="btn" onClick={() => { countPending(); setSignOutAsk(true); }}>Sign out</button>
      </div>
      {pending > 0 && <p className="small muted">{pending} change{pending === 1 ? '' : 's'} waiting to sync.</p>}
      <button type="button" className="btn btn--danger btn--quiet" onClick={askDelete}>Delete my account and cloud data</button>
      {signOutAsk && (
        <Modal title="Sign out" onClose={() => setSignOutAsk(false)}>
          <p className="muted">Keep a copy of your sightings, outings, patches and photos on this device? Your account keeps them either way.</p>
          {pending > 0 && (
            <p className="form-error">{pending} change{pending === 1 ? " hasn't" : "s haven't"} reached the cloud yet. Keep the copy, or sync first, so {pending === 1 ? "it isn't" : "they aren't"} lost.</p>
          )}
          <div className="acct-choices">
            <button type="button" className="btn btn--primary btn--block" onClick={() => void doSignOut(false)}>Keep a copy on this device</button>
            <button type="button" className={`btn btn--block ${pending ? 'btn--danger' : ''}`} onClick={() => void doSignOut(true)}>Remove it from this device</button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setSignOutAsk(false)}>Cancel</button>
          </div>
        </Modal>
      )}
      {deleteAsk && (
        <ConfirmDialog
          title="Delete your account?"
          body="This permanently deletes your account, your cloud copy of every sighting, outing, patch and photo, and your place on the leaderboard and in groups. What is on this device stays here, as a guest."
          confirmLabel="Delete my account"
          danger
          onCancel={() => setDeleteAsk(false)}
          onConfirm={() => void doDelete()}
        />
      )}
    </section>
  );
}

// ---------- the page ----------
function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="set-card" aria-labelledby={id}>
      <h2 className="set-title" id={id}>{title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useProfile();
  const canInstall = useInstallPrompt();
  const [theme, setTheme] = useState<Theme>('auto');
  const [usage, setUsage] = useState('');
  const [persisted, setPersisted] = useState(true);
  const [restore, setRestore] = useState<BackupData | null>(null);
  const [wipeAsk, setWipeAsk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useSheetFocus(wipeAsk || !!restore);

  useEffect(() => {
    let alive = true;
    void storedSettings().then((s) => { if (alive) setTheme(((s.theme as Theme) || 'auto')); });
    (async () => {
      try {
        const est = await navigator.storage.estimate();
        if (alive) setUsage(`${((est.usage || 0) / 1e6).toFixed(1)} MB used on this phone`);
      } catch { /* not every browser says */ }
      const p = await navigator.storage?.persisted?.().catch(() => false);
      if (alive) setPersisted(!!p);
    })();
    const raf = requestAnimationFrame(() => stagger(document.getElementById('view'), '.set-card', { key: 'settings', max: 8 }));
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  const changeTheme = async (t: Theme) => {
    setTheme(t);
    await saveTheme(t);
  };

  const exportEbird = async () => {
    const [sightings, outings] = await Promise.all([db.all('sightings'), db.all('outings')]);
    const list = sightings as { speciesId: number }[];
    if (!list.some((x) => byId.get(x.speciesId)?.kind === 'bird')) { toast('Log a bird first. eBird only takes birds.'); return; }
    download(`birddex-ebird-${todayStr()}.csv`, new Blob([toEbirdCsv(list, outings)], { type: 'text/csv' }));
  };

  const saveBackup = async () => {
    const photos = [];
    for (const p of (await db.all('photos')) as { id: number; at?: number; blob?: Blob }[]) {
      if (p.blob) photos.push({ id: p.id, at: p.at, data: await blobToDataUrl(p.blob) });
    }
    const [sightings, outings, patches, settings] = await Promise.all([db.all('sightings'), db.all('outings'), db.all('patches'), storedSettings()]);
    const data = { app: 'birddex', version: 1, savedAt: new Date().toISOString(), sightings, outings, patches, settings, photos };
    download(`birddex-backup-${todayStr()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  };

  const pickRestore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as BackupData;
      if (data?.app !== 'birddex' || !Array.isArray(data.sightings) || !Array.isArray(data.outings) || !Array.isArray(data.patches)) throw new Error('not a backup');
      setRestore(data);
    } catch {
      toast('That file is not a BirdyDex backup.');
    }
  };
  const doRestore = async () => {
    const data = restore;
    setRestore(null);
    if (!data) return;
    try {
      for (const s of ['sightings', 'outings', 'patches', 'photos']) await db.clear(s);
      for (const p of data.photos ?? []) {
        if (!p?.data) continue;
        const blob = await (await fetch(p.data)).blob();
        await db.put('photos', { id: p.id, blob, at: p.at });
      }
      for (const s of data.sightings ?? []) await db.put('sightings', s);
      for (const o of data.outings ?? []) await db.put('outings', o);
      for (const p of data.patches ?? []) await db.put('patches', p);
      if (data.settings) await db.kvSet('settings', data.settings);
      toast('Backup restored');
      navigate('/dex');
    } catch (err) {
      toast(`Couldn't restore that backup: ${message(err)}`);
    }
  };

  const doWipe = async () => {
    setWipeAsk(false);
    for (const s of ['sightings', 'outings', 'patches', 'photos']) await db.clear(s);
    await db.kvSet('activeOuting', null);
    toast('All sightings deleted');
    navigate('/dex');
  };

  const installed = isInstalled();
  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/me" aria-label="Back to Me"><Icon name="back" /></Link>
        <h1>Settings</h1>
      </header>
      <ProfileRow />
      <ReadyCard />
      <AccountCard onChange={force} />
      <Card id="phone-h" title="On this phone">
        <div className="set-list">
          <label className="set-row">
            <span className="set-row-l">Theme</span>
            <select className="set-select" value={theme} onChange={(e) => void changeTheme(e.target.value as Theme)}>
              {THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {canInstall ? (
            <button type="button" className="set-row" onClick={() => void promptInstall()}><span className="set-row-l">Install app on this phone</span>{chev}</button>
          ) : (
            <div className="set-row set-row--info"><span className="set-row-l">Install</span><span className="set-row-v">{installed ? 'Installed on this phone' : 'Open the browser menu, then Add to Home screen'}</span></div>
          )}
          <button type="button" className="set-row" onClick={openWelcome}><span className="set-row-l">Show the welcome screen</span>{chev}</button>
        </div>
      </Card>
      <Card id="ebird-h" title="Send to eBird">
        <p className="set-note small muted">Download your bird sightings as an eBird Record Format file (eBird only takes birds, so other animals and plants are left out). On a computer, go to ebird.org, then Submit, then Import data, and choose "eBird Record Format (Extended)". eBird may ask you to confirm a few bird names and locations.</p>
        <div className="set-list"><button type="button" className="set-row" onClick={() => void exportEbird()}><span className="set-row-l">Export for eBird</span>{chev}</button></div>
      </Card>
      <Card id="backup-h" title="Backup">
        <p className="set-note small muted">Your sightings and photos live only on this phone{persisted ? '' : ", and clearing the browser's site data would erase them"}. Save a backup now and then. {usage}</p>
        <div className="set-list">
          <button type="button" className="set-row" onClick={() => void saveBackup()}><span className="set-row-l">Save backup</span>{chev}</button>
          <button type="button" className="set-row" onClick={() => fileRef.current?.click()}><span className="set-row-l">Restore backup</span>{chev}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void pickRestore(e)} />
        </div>
      </Card>
      <Card id="about-h" title="About">
        <p className="small">Photos come from Wikipedia, Wikimedia Commons and iNaturalist contributors (via the Atlas of Living Australia), each credited on its page. Each species' write-up lists the sources it is based on. Calls are from iNaturalist (via the ALA) and Wikimedia Commons. The clips saved for offline are shortened, level-matched copies of iNaturalist recordings, each credited where it plays. Maps &copy; OpenStreetMap contributors; satellite imagery &copy; Esri, Maxar and Earthstar Geographics.</p>
        <p className="small">Hotspots, seasons and rarity come from Atlas of Living Australia records for SEQ since 2016 (including eBird and BirdLife Australia data). Birds: 40,000+ records is Common, 15,000+ Fairly common, 4,000+ Uncommon, 800+ Scarce and fewer is Rare. Other animals and plants are recorded far less often than birds, so each kind is ranked against its own kind: the most-recorded fifth of that kind is Common, the next fifth Fairly common, and so on down to Rare. Seasons are also compared within each kind. Record counts lean towards easy-to-see species and popular spots, so treat rarity as a guide.</p>
        <p className="small muted">Version 3.0</p>
      </Card>
      <Card id="over-h" title="Start over">
        <div className="set-list"><button type="button" className="set-row set-row--danger" onClick={() => setWipeAsk(true)}><span className="set-row-l">Delete all my sightings</span></button></div>
      </Card>
      {restore && (
        <ConfirmDialog
          title="Restore this backup?"
          body={`It replaces everything on this phone with ${plural((restore.sightings ?? []).length, 'sighting')} from ${fmtDate(restore.savedAt?.slice(0, 10))}.`}
          confirmLabel="Restore"
          onCancel={() => setRestore(null)}
          onConfirm={() => void doRestore()}
        />
      )}
      {wipeAsk && (
        <ConfirmDialog
          title="Delete all sightings?"
          body="Every sighting, outing, patch and photo will be erased from this phone, and from your account if you are signed in. Save a backup first if you might want them back."
          confirmLabel="Delete everything"
          danger
          onCancel={() => setWipeAsk(false)}
          onConfirm={() => void doWipe()}
        />
      )}
    </>
  );
}
