import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { byId } from '../../lib/data';
import { db } from '../../core/db.js';
import { downloadAll } from '../../core/media.js';
import { toEbirdCsv } from '../../core/ebird.js';
import {
  configured,
  onAuth,
  sendEmailLink,
  signInWithGoogle,
  signOut,
  startAuth,
  verifyEmailCode,
} from '../../core/cloud.js';
import {
  forgetSync,
  localProfile,
  onStatus,
  pendingCount,
  saveProfile,
  startSync,
  syncNow,
  syncStatus,
} from '../../core/sync.js';
import { Icon } from '../../components/Icon';
import { SpeciesImage } from '../../components/SpeciesImage';
import { deleteAccount as deleteMyAccount } from '../../core/account.js';
import { ConfirmDialog } from '../lists/shared';
import './progress.css';

interface Settings {
  theme: 'auto' | 'light' | 'dark';
  colourUnseen: boolean;
}

interface AccountUser {
  id: string;
  email: string;
  name: string;
}

interface Profile {
  displayName?: string;
  avatarSpeciesId?: number | null;
  showOnLeaderboard?: boolean;
  updatedAt?: number;
}

interface SyncState {
  state: string;
  text?: string;
  at?: number;
}

interface BackupPhoto {
  id: number;
  at?: number;
  data: string;
}

interface BackupData {
  app?: string;
  version?: number;
  savedAt?: string;
  sightings?: unknown[];
  outings?: unknown[];
  patches?: unknown[];
  settings?: Partial<Settings>;
  photos?: BackupPhoto[];
}

const DEFAULT_SETTINGS: Settings = { theme: 'auto', colourUnseen: false };

function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function friendly(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  if (/rate limit|too many/i.test(message)) return 'Too many tries. Wait a minute, then try again.';
  if (/expired|invalid/i.test(message)) {
    return "That code didn't work. It may have expired, so ask for a new email.";
  }
  if (/fetch|network/i.test(message)) return 'Signing in needs a connection.';
  return message || 'Something went wrong. Try again.';
}

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo'));
    reader.readAsDataURL(blob);
  });

function AccountAvatar({
  sp,
  name,
  big = false,
}: {
  sp: ReturnType<typeof byId.get> | null;
  name: string;
  big?: boolean;
}) {
  return (
    <span className={`acct-av ${big ? 'acct-av--big' : ''}`}>
      {sp ? (
        <SpeciesImage sp={sp} />
      ) : (
        <span className="acct-av-letter">{(name || 'You').slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [usage, setUsage] = useState('');
  const [persisted, setPersisted] = useState(false);

  const [download, setDownload] = useState({
    running: false,
    done: 0,
    total: 0,
    text: '',
    error: false,
  });

  const [backupMsg, setBackupMsg] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<{ data: BackupData; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ebirdMsg, setEbirdMsg] = useState('');

  const [authReady, setAuthReady] = useState(!configured);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ state: 'off', text: '' });
  const [pendingSync, setPendingSync] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [authStage, setAuthStage] = useState<'idle' | 'code'>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountNote, setAccountNote] = useState('');
  const [signOutAsk, setSignOutAsk] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const refreshPending = async () => {
    try {
      setPendingSync((await pendingCount()) as number);
    } catch {
      /* the count is a hint, not a blocker */
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = (await db.kvGet('settings')) as Partial<Settings> | null | undefined;
        if (!alive) return;
        const next: Settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
        setSettings(next);
        applyTheme(next.theme);
      } catch {
        /* keep the defaults */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          if (alive && estimate.usage != null) {
            setUsage(`${(estimate.usage / 1e6).toFixed(1)} MB used on this device`);
          }
        }
      } catch {
        /* storage estimates are optional */
      }
      try {
        if (navigator.storage?.persisted) {
          const isPersisted = await navigator.storage.persisted();
          if (alive) setPersisted(!!isPersisted);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!configured) return;
    let alive = true;

    const offAuth = onAuth(async (nextUser: AccountUser | null) => {
      if (!alive) return;
      setAccountUser(nextUser);
      try {
        const nextProfile = (await localProfile()) as Profile;
        if (!alive) return;
        setProfile(nextProfile);
        setDisplayName(nextProfile.displayName ?? '');
      } catch {
        /* profile is loaded below as well */
      }
      if (nextUser) {
        startSync();
        void syncNow();
      }
      void refreshPending();
    });

    const offStatus = onStatus((nextState: SyncState) => {
      if (alive) setSyncState(nextState);
    });

    (async () => {
      setSyncState(syncStatus() as SyncState);
      try {
        const nextProfile = (await localProfile()) as Profile;
        if (alive) {
          setProfile(nextProfile);
          setDisplayName(nextProfile.displayName ?? '');
        }
        const nextUser = (await startAuth()) as AccountUser | null;
        if (!alive) return;
        setAccountUser(nextUser);
        setAuthReady(true);
        if (nextUser) {
          startSync();
          void syncNow();
        }
        void refreshPending();
      } catch {
        if (alive) setAuthReady(true);
      }
    })();

    return () => {
      alive = false;
      offAuth();
      offStatus();
    };
  }, []);

  useEffect(() => {
    if (!configured) return;
    if (syncState.state === 'saved' || syncState.state === 'error' || syncState.state === 'offline') {
      void refreshPending();
    }
  }, [syncState.state]);

  const updateSettings = async (patch: Partial<Settings>) => {
    const next: Settings = { ...settings, ...patch };
    setSettings(next);
    setSettingsMsg('');
    if (patch.theme) applyTheme(next.theme);
    try {
      await db.kvSet('settings', next);
    } catch (err) {
      setSettingsMsg(`Couldn't save that setting: ${friendly(err)}`);
    }
  };

  const runDownload = async () => {
    if (download.running) return;
    if (!navigator.onLine) {
      setDownload({
        running: false,
        done: 0,
        total: 0,
        text: 'You are offline. Downloading needs a connection.',
        error: true,
      });
      return;
    }
    setDownload({ running: true, done: 0, total: 0, text: 'Starting…', error: false });
    try {
      await downloadAll((done: number, total: number) => {
        setDownload({
          running: true,
          done,
          total,
          text: `Saving ${done} of ${total}…`,
          error: false,
        });
      });
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* persistence is a bonus */
      }
      setDownload((prev) => ({
        ...prev,
        running: false,
        text:
          prev.total > 0
            ? `Finished checking ${prev.total} species. Open a few photos offline to confirm they were kept.`
            : 'No photos were available to save. Check your connection and try again.',
        error: prev.total === 0,
      }));
    } catch (err) {
      setDownload((prev) => ({
        ...prev,
        running: false,
        text: `Couldn't finish the download: ${friendly(err)}. Try again with a connection.`,
        error: true,
      }));
    }
  };

  const exportBackup = async () => {
    setBackupMsg('Preparing the backup…');
    try {
      const [sightings, outings, patches, photos, storedSettings] = await Promise.all([
        db.all('sightings'),
        db.all('outings'),
        db.all('patches'),
        db.all('photos'),
        db.kvGet('settings'),
      ]);
      const photoData: BackupPhoto[] = [];
      for (const photo of photos as { id: number; at?: number; blob?: Blob }[]) {
        if (photo.blob) {
          photoData.push({
            id: photo.id,
            at: photo.at,
            data: await blobToDataUrl(photo.blob),
          });
        }
      }
      const data: BackupData = {
        app: 'birddex',
        version: 1,
        savedAt: new Date().toISOString(),
        sightings,
        outings,
        patches,
        settings: (storedSettings as Partial<Settings>) ?? settings,
        photos: photoData,
      };
      downloadBlob(
        `birddex-backup-${today()}.json`,
        new Blob([JSON.stringify(data)], { type: 'application/json' }),
      );
      setBackupMsg(
        `Saved a backup with ${(sightings as unknown[]).length} sightings and ${photoData.length} photos.`,
      );
    } catch (err) {
      setBackupMsg(`Couldn't save a backup: ${friendly(err)}`);
    }
  };

  const chooseRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupMsg('');
    try {
      const parsed = JSON.parse(await file.text()) as BackupData;
      if (
        !parsed ||
        parsed.app !== 'birddex' ||
        !Array.isArray(parsed.sightings) ||
        !Array.isArray(parsed.outings) ||
        !Array.isArray(parsed.patches)
      ) {
        throw new Error('not a backup');
      }
      setPendingBackup({ data: parsed, name: file.name });
    } catch {
      setPendingBackup(null);
      setBackupMsg('That file is not a BirdyDex backup.');
    }
  };

  const restoreBackup = async () => {
    if (!pendingBackup) return;
    setRestoring(true);
    setBackupMsg('Restoring…');
    try {
      const data = pendingBackup.data;
      for (const name of ['sightings', 'outings', 'patches', 'photos'] as const) {
        await db.clear(name);
      }
      for (const photo of data.photos ?? []) {
        if (!photo?.data) continue;
        const blob = await (await fetch(photo.data)).blob();
        await db.put('photos', { id: photo.id, blob, at: photo.at });
      }
      for (const sighting of data.sightings ?? []) await db.put('sightings', sighting);
      for (const outing of data.outings ?? []) await db.put('outings', outing);
      for (const patch of data.patches ?? []) await db.put('patches', patch);
      if (data.settings) {
        await db.kvSet('settings', data.settings);
        const next: Settings = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(next);
        applyTheme(next.theme);
      }
      setPendingBackup(null);
      setBackupMsg(`Restored ${(data.sightings ?? []).length} sightings from ${pendingBackup.name}.`);
    } catch (err) {
      setBackupMsg(`Couldn't restore that backup: ${friendly(err)}`);
    } finally {
      setRestoring(false);
    }
  };

  const exportEbird = async () => {
    setEbirdMsg('');
    try {
      const [sightings, outings] = await Promise.all([db.all('sightings'), db.all('outings')]);
      const list = sightings as { speciesId: number }[];
      if (!list.some((sighting) => byId.get(sighting.speciesId)?.kind === 'bird')) {
        setEbirdMsg('Log a bird first. eBird only takes birds.');
        return;
      }
      downloadBlob(
        `birddex-ebird-${today()}.csv`,
        new Blob([toEbirdCsv(list, outings)], { type: 'text/csv' }),
      );
      setEbirdMsg('Exported your bird sightings for eBird.');
    } catch (err) {
      setEbirdMsg(`Couldn't export for eBird: ${friendly(err)}`);
    }
  };

  const handleGoogle = async () => {
    setAccountError('');
    if (!navigator.onLine) {
      setAccountError('Signing in needs a connection.');
      return;
    }
    try {
      await signInWithGoogle();
    } catch (err) {
      setAccountError(friendly(err));
    }
  };

  const handleEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    setAccountError('');
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setAccountError('Type the email address you want to sign in with.');
      return;
    }
    if (!navigator.onLine) {
      setAccountError('Signing in needs a connection.');
      return;
    }
    setSending(true);
    try {
      await sendEmailLink(value);
      setEmail(value);
      setAuthStage('code');
    } catch (err) {
      setAccountError(friendly(err));
    } finally {
      setSending(false);
    }
  };

  const handleCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountError('');
    if (!code.trim()) {
      setAccountError('Type the code from the email.');
      return;
    }
    setVerifying(true);
    try {
      await verifyEmailCode(email, code);
      setAuthStage('idle');
      setCode('');
      setAccountNote('Signed in.');
    } catch (err) {
      setAccountError(friendly(err));
    } finally {
      setVerifying(false);
    }
  };

  const saveName = async () => {
    const name = displayName.trim().slice(0, 40);
    try {
      const next = (await saveProfile({ displayName: name })) as Profile;
      setProfile(next);
      setDisplayName(next.displayName ?? '');
      setAccountNote('Name saved');
    } catch (err) {
      setAccountError(friendly(err));
    }
  };

  const setLeaderboardVisibility = async (show: boolean) => {
    try {
      const next = (await saveProfile({ showOnLeaderboard: show })) as Profile;
      setProfile(next);
    } catch (err) {
      setAccountError(friendly(err));
    }
  };

  const doSync = async () => {
    setAccountError('');
    if (!navigator.onLine) {
      setAccountNote('Offline, will sync when you are back online');
      return;
    }
    setAccountNote('Syncing…');
    try {
      await syncNow();
      setSyncState(syncStatus() as SyncState);
      await refreshPending();
      setAccountNote('');
    } catch (err) {
      setAccountError(friendly(err));
    }
  };

  const askSignOut = () => {
    void refreshPending();
    setAccountError('');
    setSignOutAsk(true);
  };

  const doSignOut = async (wipeLocal: boolean) => {
    setSignOutBusy(true);
    setAccountError('');
    try {
      await signOut();
      await forgetSync({ wipeLocal });
      setAccountUser(null);
      setSignOutAsk(false);
      const nextProfile = (await localProfile()) as Profile;
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName ?? '');
      setAccountNote(
        wipeLocal
          ? 'Signed out and removed from this device.'
          : 'Signed out. Your data stays on this device.',
      );
      await refreshPending();
    } catch (err) {
      setAccountError(friendly(err));
    } finally {
      setSignOutBusy(false);
    }
  };

  const doDeleteAccount = async () => {
    setAccountError('');
    if (!navigator.onLine) {
      setDeleteAsk(false);
      setAccountNote('Deleting your account needs a connection.');
      return;
    }
    setDeleteBusy(true);
    setAccountNote('Deleting your account…');
    try {
      await deleteMyAccount();
      setAccountUser(null);
      setProfile((await localProfile()) as Profile);
      setDeleteAsk(false);
      setAccountNote('Account deleted. Your sightings are still on this device.');
      await refreshPending();
    } catch (err) {
      setAccountError(`Couldn't delete the account: ${friendly(err)}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  const avatarSp = profile?.avatarSpeciesId ? byId.get(profile.avatarSpeciesId) ?? null : null;
  const shownName =
    profile?.displayName ||
    accountUser?.name ||
    accountUser?.email.split('@')[0] ||
    'You';

  let accountBody;
  if (!configured) {
    accountBody = (
      <p className="small muted">
        Cloud accounts are not configured in this copy of the app, so there is no sign-in or
        cloud sync here. Everything else still works offline.
      </p>
    );
  } else if (!authReady) {
    accountBody = <p className="small muted">Checking your account…</p>;
  } else if (!accountUser) {
    accountBody = (
      <div className="account-signed-out">
        <p className="muted small">
          Optional. Sign in to back up your sightings and photos, have them on your other
          devices, and join the leaderboard. Without an account everything still works, offline
          too.
        </p>
        <button type="button" className="btn btn--block acct-google" onClick={() => void handleGoogle()}>
          Continue with Google
        </button>
        {authStage === 'idle' ? (
          <form className="form acct-email" onSubmit={handleEmail} noValidate>
            <label className="field">
              <span>Or sign in with your email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button className="btn btn--primary" disabled={sending}>
              {sending ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        ) : (
          <form className="form acct-code" onSubmit={handleCode} noValidate>
            <p className="small">Check your email. Tap the link in it, or type the 6-digit code here.</p>
            <label className="field">
              <span>Code from the email</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <div className="row-start">
              <button className="btn btn--primary" disabled={verifying}>
                {verifying ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setAuthStage('idle');
                  setCode('');
                  setAccountError('');
                }}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
        {accountError && (
          <p className="form-error" role="alert">
            {accountError}
          </p>
        )}
        {accountNote && (
          <p className="small muted" role="status">
            {accountNote}
          </p>
        )}
      </div>
    );
  } else {
    accountBody = (
      <div className="progress-stack">
        <div className="acct-card">
          <AccountAvatar sp={avatarSp} name={shownName} big />
          <div className="acct-who">
            <strong>{shownName}</strong>
            <span className="small muted">{accountUser.email}</span>
            <span className="small acct-status" data-sync-status data-state={syncState.state}>
              {syncState.text || (navigator.onLine ? 'Not synced yet.' : 'Offline, will sync')}
            </span>
          </div>
        </div>
        <label className="field">
          <span>Display name (shown on the leaderboard)</span>
          <input
            name="displayName"
            maxLength={40}
            value={displayName}
            placeholder={shownName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
        <label className="check check--card">
          <input
            type="checkbox"
            checked={profile?.showOnLeaderboard !== false}
            onChange={(event) => void setLeaderboardVisibility(event.target.checked)}
          />
          <span>
            Show me on the leaderboard. Only your name, avatar and counts are shown, never
            your sightings, places, notes or photos. Groups you join always show you to their
            members.
          </span>
        </label>
        <div className="row-start">
          <Link className="btn" to="/leaderboard">
            Leaderboard
          </Link>
          <button className="btn" onClick={() => void doSync()}>
            Sync now
          </button>
          <button className="btn" onClick={askSignOut}>
            Sign out
          </button>
          <button className="btn btn--danger btn--quiet" disabled={deleteBusy} onClick={() => setDeleteAsk(true)}>
            Delete my account and cloud data
          </button>
        </div>
        {deleteAsk && (
          <ConfirmDialog
            title="Delete your account?"
            body="This permanently deletes your account, your cloud copy of every sighting, outing, patch and photo, and your place on the leaderboard and in groups. What is on this device stays here, as a guest."
            confirmLabel={deleteBusy ? 'Deleting…' : 'Delete my account'}
            danger
            onCancel={() => setDeleteAsk(false)}
            onConfirm={() => void doDeleteAccount()}
          />
        )}
        {pendingSync > 0 && (
          <p className="small muted">
            {pendingSync} change{pendingSync === 1 ? '' : 's'} waiting to sync.
          </p>
        )}
        {signOutAsk && (
          <div className="empty-inline acct-choices" role="group" aria-label="Sign out options">
            <p className="muted">
              Keep a copy of your sightings, outings, patches and photos on this device? Your
              account keeps them either way.
            </p>
            {pendingSync > 0 && (
              <p className="form-error">
                {pendingSync} change{pendingSync === 1 ? " hasn't" : "s haven't"} reached the cloud
                yet. Keep the copy, or sync first, so {pendingSync === 1 ? "it isn't" : "they aren't"}{' '}
                lost.
              </p>
            )}
            <button
              className="btn btn--primary btn--block"
              disabled={signOutBusy}
              onClick={() => void doSignOut(false)}
            >
              Keep a copy on this device
            </button>
            <button
              className={`btn btn--block ${pendingSync ? 'btn--danger' : ''}`}
              disabled={signOutBusy}
              onClick={() => void doSignOut(true)}
            >
              Remove it from this device
            </button>
            <button
              className="btn btn--quiet btn--block"
              disabled={signOutBusy}
              onClick={() => setSignOutAsk(false)}
            >
              Cancel
            </button>
          </div>
        )}
        {accountError && (
          <p className="form-error" role="alert">
            {accountError}
          </p>
        )}
        {accountNote && (
          <p className="small muted" role="status">
            {accountNote}
          </p>
        )}
      </div>
    );
  }

  const downloadPct =
    download.total > 0 ? Math.round((download.done / download.total) * 100) : 0;
  const backupIsError = /Couldn't|not a BirdyDex/.test(backupMsg);

  return (
    <>
      <header className="page-head page-head--back">
        <Link className="iconbtn" to="/me" aria-label="Back to Me">
          <Icon name="back" />
        </Link>
        <h1>Settings</h1>
      </header>

      <section className="block">
        <h2 className="h2">Account</h2>
        {accountBody}
        <p className="small muted">
          Read the <a href="/privacy.html">privacy notice</a> and{' '}
          <a href="/terms.html">terms</a>.
        </p>
      </section>

      <section className="block">
        <h2 className="h2">Colour & contrast</h2>
        <p className="muted small">
          Light and dark change the screen's contrast. Match my phone follows your device's
          setting.
        </p>
        <label className="field">
          <span>Theme</span>
          <select
            value={settings.theme}
            onChange={(event) => void updateSettings({ theme: event.target.value as Settings['theme'] })}
          >
            <option value="auto">Match my phone</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="check check--card">
          <input
            type="checkbox"
            checked={settings.colourUnseen}
            onChange={(event) => void updateSettings({ colourUnseen: event.target.checked })}
          />
          <span>Show the photos of species I haven't seen in colour</span>
        </label>
        {settingsMsg && (
          <p className="form-error" role="alert">
            {settingsMsg}
          </p>
        )}
      </section>

      <section className="block">
        <h2 className="h2">Use it offline</h2>
        <p className="muted small">
          Download every photo and description so the dex works with no signal. Takes about 30
          MB. Calls are saved each time you play one.
        </p>
        <button className="btn" onClick={() => void runDownload()} disabled={download.running}>
          {download.running ? 'Downloading…' : 'Download for offline'}
        </button>
        {download.total > 0 && (
          <div
            className="meter meter--thin"
            style={{ '--p': `${downloadPct}%` } as CSSProperties}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={download.total}
            aria-valuenow={download.done}
            aria-label="Offline download progress"
          >
            <span />
          </div>
        )}
        {download.text && (
          <span
            className={`small progress-status ${download.error ? 'progress-status--error' : 'muted'}`}
            role="status"
          >
            {download.text}
          </span>
        )}
      </section>

      <section className="block">
        <h2 className="h2">Send to eBird</h2>
        <p className="muted small">
          Download your bird sightings as an eBird Record Format file (eBird only takes birds, so
          other animals and plants are left out). On a computer, go to ebird.org, then Submit,
          then Import data, and choose "eBird Record Format (Extended)". eBird may ask you to
          confirm a few bird names and locations.
        </p>
        <button className="btn" onClick={() => void exportEbird()}>
          Export for eBird
        </button>
        {ebirdMsg && (
          <p className="small muted progress-status" role="status">
            {ebirdMsg}
          </p>
        )}
      </section>

      <section className="block">
        <h2 className="h2">Backup</h2>
        <p className="muted small">
          Your sightings and photos are kept on this device
          {persisted ? '' : ", and clearing the browser's site data would erase the local copy"}.
          {accountUser ? ' Your account backs them up when a connection is available.' : ''} Save
          a backup now and then. {usage}
        </p>
        <div className="progress-actions">
          <button className="btn" onClick={() => void exportBackup()}>
            Save backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Restore backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void chooseRestoreFile(event)}
          />
        </div>
        {backupMsg && (
          <p
            className={`small progress-status ${backupIsError ? 'progress-status--error' : 'muted'}`}
            role="status"
          >
            {backupMsg}
          </p>
        )}
        {pendingBackup && (
          <div className="empty-inline backup-confirm">
            <p>
              Restore <strong>{pendingBackup.name}</strong>? It replaces everything on this device
              with {(pendingBackup.data.sightings ?? []).length} sightings from{' '}
              {pendingBackup.data.savedAt?.slice(0, 10) || 'that backup'}.
            </p>
            <div className="row-start">
              <button
                className="btn btn--primary"
                disabled={restoring}
                onClick={() => void restoreBackup()}
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </button>
              <button className="btn" disabled={restoring} onClick={() => setPendingBackup(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="block settings-about">
        <h2 className="h2">About</h2>
        <p className="small">
          Photos come from Wikipedia, Wikimedia Commons and iNaturalist contributors (via the
          Atlas of Living Australia), each credited on its page. Calls are from iNaturalist (via
          the ALA) and Wikimedia Commons. Maps © OpenStreetMap contributors; satellite imagery ©
          Esri, Maxar and Earthstar Geographics.
        </p>
        <p className="small">
          Read the <a href="/privacy.html">privacy notice</a> and{' '}
          <a href="/terms.html">terms</a> for what is kept and how it is used.
        </p>
        <p className="small muted">Version 3.0</p>
      </section>
    </>
  );
}
