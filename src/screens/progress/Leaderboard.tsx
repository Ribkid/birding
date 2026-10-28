import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { KINDS, kindsPresent } from '../../lib/data';
import {
  client,
  configured,
  onAuth,
  startAuth,
  user as currentUser,
} from '../../core/cloud.js';
import { schedule } from '../../core/sync.js';
import { Icon } from '../../components/Icon';
import { AccountAvatar } from '../me/accountBits';
import { ConfirmDialog } from '../lists/shared';
import { toast } from '../../lib/toast';
import './progress.css';

type Period = 'life' | 'year' | 'month';

interface AccountUser {
  id: string;
  email: string;
  name: string;
}

interface LeaderRow {
  rank: number;
  public_id?: string | null;
  display_name: string;
  avatar_species_id?: number | null;
  avatar_path?: string | null;
  outings: number;
  badges: number;
  species: number;
  bird: number;
  is_me: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

interface Group {
  id: string;
  name: string;
  code: string;
  members: number;
}

function friendly(error: unknown, offline = 'The leaderboard needs a connection.') {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  if (/fetch|network/i.test(message)) return offline;
  return message || 'Something went wrong. Try again.';
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export default function Leaderboard() {
  const location = useLocation();
  const groupsRef = useRef<HTMLElement>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has('groups')) return;
    const timer = window.setTimeout(() => groupsRef.current?.scrollIntoView({ block: 'start' }), 120);
    return () => window.clearTimeout(timer);
  }, [location.search]);

  const [period, setPeriod] = useState<Period>('life');
  const [kind, setKind] = useState('');
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [reload, setReload] = useState(0);

  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [groupMsg, setGroupMsg] = useState('');
  const [groupError, setGroupError] = useState(false);
  // One group request at a time. The buttons stay enabled (as in v1), because disabling the one she pressed would
  // drop her focus to the page.
  const groupBusy = useRef(false);
  const setGroupBusy = (on: boolean) => { groupBusy.current = on; };
  const [leaveAsk, setLeaveAsk] = useState<Group | null>(null);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    const offAuth = onAuth((nextUser: AccountUser | null) => {
      if (alive) setAccountUser(nextUser);
    });
    (async () => {
      try {
        const nextUser = (await startAuth()) as AccountUser | null;
        if (alive) setAccountUser(nextUser);
      } catch {
        if (alive) setAccountUser(currentUser() as AccountUser | null);
      } finally {
        if (alive) setAuthReady(true);
      }
    })();
    return () => {
      alive = false;
      offAuth();
    };
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!configured || !authReady || !accountUser) return;
    if (!online) {
      setRows(null);
      setBoardError('');
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setBoardError('');
    setRows(null);
    schedule(0); // send any waiting sightings first so your own row is current
    (async () => {
      try {
        const supabase = await client();
        const { data, error } = await supabase.rpc('get_leaderboard', {
          p_period: period,
          p_kind: kind || null,
          p_group: group || null,
          p_limit: 50,
        });
        if (error) throw error;
        if (alive) setRows((data ?? []) as LeaderRow[]);
      } catch (err) {
        if (alive) setBoardError(friendly(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [configured, authReady, accountUser, online, period, kind, group, reload]);

  const loadGroups = async () => {
    const supabase = await client();
    const { data, error } = await supabase.rpc('my_groups');
    if (error) throw error;
    const list = (data ?? []) as Group[];
    setGroups(list);
    setGroup((current) => (current && !list.some((g) => g.id === current) ? '' : current));
    return list;
  };

  useEffect(() => {
    if (!configured || !authReady || !accountUser || !online) return;
    let alive = true;
    (async () => {
      try {
        const supabase = await client();
        const { data, error } = await supabase.rpc('my_groups');
        if (error) throw error;
        if (!alive) return;
        const list = (data ?? []) as Group[];
        setGroups(list);
        setGroup((current) => (current && !list.some((g) => g.id === current) ? '' : current));
      } catch {
        /* groups are secondary; the board still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [configured, authReady, accountUser, online, reload]);

  const groupAction = async (
    fn: 'create_group' | 'join_group',
    args: Record<string, unknown>,
    message: (group: Group | null) => string,
  ): Promise<boolean> => {
    if (!navigator.onLine) {
      setGroupError(true);
      setGroupMsg('Groups need a connection.');
      return false;
    }
    if (groupBusy.current) return false;
    setGroupBusy(true);
    setGroupError(false);
    setGroupMsg('');
    try {
      const supabase = await client();
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      const result = (Array.isArray(data) ? data[0] : data) as Group | null;
      await loadGroups();
      if (result?.id) setGroup(result.id);
      toast(message(result));
      return true;
    } catch (err) {
      setGroupError(true);
      setGroupMsg(friendly(err, 'Groups need a connection.'));
      return false;
    } finally {
      setGroupBusy(false);
    }
  };

  const createGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    void groupAction('create_group', { p_name: name }, (created) =>
      created ? `${created.name} made. Its code is ${created.code}` : 'Group made.',
    ).then((ok) => {
      if (ok) setNewGroupName('');
    });
  };

  const joinGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    void groupAction('join_group', { p_code: code }, (joined) =>
      joined ? `You joined ${joined.name}` : 'Joined the group.',
    ).then((ok) => {
      if (ok) setJoinCode('');
    });
  };

  const shareGroup = async (target: Group) => {
    const text = `Join my BirdyDex group "${target.name}" with the code ${target.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(target.code);
        toast('Code copied');
      } else {
        toast(`Code: ${target.code}`);
      }
    } catch {
      /* sharing was cancelled */
    }
  };

  const leaveGroup = async (target: Group) => {
    setLeaveAsk(null);
    if (!navigator.onLine) {
      toast('Groups need a connection.');
      return;
    }
    if (groupBusy.current) return;
    setGroupBusy(true);
    try {
      const supabase = await client();
      const { error } = await supabase.rpc('leave_group', { p_group: target.id });
      if (error) throw error;
      if (group === target.id) setGroup('');
      await loadGroups();
      // v1 says nothing here; the group just goes. Focus has nowhere to return to, so the change is read out.
      toast(`You left ${target.name}`);
    } catch (err) {
      toast(friendly(err, 'Groups need a connection.'));
    } finally {
      setGroupBusy(false);
    }
  };

  const what = kind ? KINDS[kind]?.label.toLowerCase() ?? 'species' : 'species';
  const emptyMsg = `No one has logged any ${what} ${
    period === 'life' ? 'yet' : period === 'year' ? 'this year' : 'this month'
  }.`;

  // "120 birds, 19 mammals, 1 frog" under the name when the board mixes kinds (v1 js/account.js kindLine).
  const kindLine = (row: LeaderRow) => {
    if (kind || kindsPresent.length < 2) return null;
    const word = (k: string) => (Number(row[k] ?? 0) === 1 ? KINDS[k].one : KINDS[k].label.toLowerCase());
    const parts = kindsPresent
      .filter((k) => Number(row[k] ?? 0) > 0 && k !== 'bird')
      .map((k) => `${Number(row[k] ?? 0)} ${word(k)}`);
    // One text run, as in v1's markup, so the line shapes (kerns) the same.
    return parts.length ? <span className="small muted">{`${Number(row.bird ?? 0)} ${word('bird')}, ${parts.join(', ')}`}</span> : null;
  };

  const renderRow = (row: LeaderRow) => {
    const inner = (
      <>
        {/* The spaces keep the link's accessible name readable ("1 Alice Wren 12 outings…"); flex and grid
            layout ignore them, as with v1's markup whitespace. */}
        <span className="lb-rank">{row.rank}</span>{' '}
        <AccountAvatar spId={row.avatar_species_id} path={row.avatar_path} name={row.display_name} />{' '}
        <span className="row-main">
          <strong>
            {row.display_name}
            {row.is_me && <> <span className="lb-you">You</span></>}
          </strong>{' '}
          <span className="small muted">
            {`${plural(row.outings, 'outing')}, ${plural(row.badges, 'badge')}`}
          </span>{' '}
          {kindLine(row)}
        </span>{' '}
        <span className="row-n" aria-label={`${row.species} ${what}`}>
          {row.species}
        </span>
      </>
    );
    return (
      <li
        key={row.public_id ?? `${row.rank}-${row.display_name}`}
        className={`lb-row ${row.is_me ? 'lb-row--me' : ''}`}
        aria-current={row.is_me ? true : undefined}
      >
        {row.public_id ? <Link className="lb-link" to={`/u/${row.public_id}`}>{inner}</Link> : <span className="lb-link">{inner}</span>}
      </li>
    );
  };

  const topRows = rows?.filter((row) => row.rank <= 50 || !row.is_me) ?? [];
  const meBelow = rows?.find((row) => row.is_me && row.rank > 50);
  const hiddenFromBoard = !!rows && !rows.some((row) => row.is_me) && !group;

  const header = (
    <header className="page-head page-head--back">
      <Link className="iconbtn" to="/me" aria-label="Back to Me">
        <Icon name="back" />
      </Link>
      <h1>Leaderboard</h1>
    </header>
  );

  // Without accounts there is no leaderboard; v1 sends the route back to Me.
  if (!configured) return <Navigate to="/me" replace />;

  if (!authReady) {
    return (
      <>
        {header}
        <div className="empty">
          <p>Checking your account…</p>
        </div>
      </>
    );
  }

  if (!accountUser) {
    return (
      <>
        {header}
        <div className="empty">
          <p>Sign in to see how your dex compares with other birders and with your family.</p>
          <Link className="btn btn--primary" to="/me/signin">
            Sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="pad-x lb-controls">
        <select
          className={`chip chip--select ${group ? 'chip--on' : ''}`}
          data-scope
          aria-label="Whose leaderboard"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value="">Everyone</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="seg" role="tablist" aria-label="Period">
          {(
            [
              ['life', 'Life'],
              ['year', 'Year'],
              ['month', 'Month'],
            ] as [Period, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              className={`seg-btn ${period === value ? 'seg-btn--on' : ''}`}
              aria-selected={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {kindsPresent.length > 1 && (
        <div className="chips chips--scroll lb-kinds">
          {[['', 'All'], ...kindsPresent.map((k): [string, string] => [k, KINDS[k].label])].map(
            ([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                className={`chip ${kind === value ? 'chip--on' : ''}`}
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}

      <section className="block">
        <ol className="rows lb-list">
          {!online && (
            <li className="muted small lb-msg" role="status">
              The leaderboard needs a connection. Your dex works offline as usual.
            </li>
          )}
          {online && (loading || (!rows && !boardError)) && (
            <li className="muted small lb-msg" role="status">
              Loading…
            </li>
          )}
          {online && !loading && boardError && (
            <li className="form-error lb-msg" role="alert">
              {boardError}
              <div className="progress-actions">
                <button className="btn btn--small" onClick={() => setReload((n) => n + 1)}>
                  Try again
                </button>
              </div>
            </li>
          )}
          {online && !loading && !boardError && rows && rows.length === 0 && (
            <li className="muted small lb-msg">{emptyMsg}</li>
          )}
          {online &&
            !loading &&
            !boardError &&
            topRows.map(renderRow)}
          {online && !loading && !boardError && meBelow && (
            <li className="lb-gap" aria-hidden="true">
              ⋯
            </li>
          )}
          {online && !loading && !boardError && meBelow && renderRow(meBelow)}
        </ol>
        {online && !loading && !boardError && hiddenFromBoard && (
          <p className="small muted">
            You are hidden from the Everyone board. Turn on "Show me on the leaderboard" in{' '}
            <Link to="/me/edit">Edit profile</Link> to appear.
          </p>
        )}
      </section>

      <section className="block" id="groups" data-groups ref={groupsRef}>
        <h2 className="h2">Groups</h2>
        <p className="muted small">
          Make a group for family or friends. Share its code; anyone with it can join and see the
          group's board.
        </p>
        {groups.length > 0 && (
          <ul className="rows">
            {groups.map((g) => (
              <li className="row lb-group" key={g.id}>
                <span className="row-main">
                  <strong>{g.name}</strong>
                  <span className="small muted">
                    Code <b className="lb-code">{g.code}</b> · {g.members} member
                    {g.members === 1 ? '' : 's'}
                  </span>
                </span>
                <button className="btn btn--small" onClick={() => void shareGroup(g)}>
                  Share
                </button>
                <button
                  className="btn btn--small btn--quiet"
                  onClick={() => setLeaveAsk(g)}
                >
                  Leave
                </button>
              </li>
            ))}
          </ul>
        )}
        {leaveAsk && (
          <ConfirmDialog
            title="Leave this group?"
            body="You can join again with its code."
            confirmLabel="Leave group"
            onCancel={() => setLeaveAsk(null)}
            onConfirm={() => void leaveGroup(leaveAsk)}
          />
        )}
        <form className="form lb-form" onSubmit={createGroup}>
          <label className="field">
            <span>New group</span>
            <input
              name="name"
              maxLength={40}
              placeholder="e.g. Family"
              required
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
          <button className="btn">
            Create
          </button>
        </form>
        <form className="form lb-form" onSubmit={joinGroup}>
          <label className="field">
            <span>Join with a code</span>
            <input
              name="code"
              maxLength={8}
              placeholder="6 letters and numbers"
              autoCapitalize="characters"
              autoComplete="off"
              required
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
            />
          </label>
          <button className="btn">
            Join
          </button>
        </form>
        {groupMsg && groupError && (
          <p className="form-error" role="alert">
            {groupMsg}
          </p>
        )}
      </section>
    </>
  );
}
