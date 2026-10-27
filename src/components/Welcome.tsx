import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ANIMALS, BIRDS, byId, ofKind, type Species } from '../lib/data';
import { db } from '../core/db.js';
import { configured, signedIn } from '../core/profile.js';
import { SpeciesImage } from './SpeciesImage';

const listeners = new Set<() => void>();

/** Re-open the first-run card from Settings. */
export function openWelcome() {
  for (const fn of listeners) fn();
}

const plus = <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />;
const scan = <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /></>;
const learn = <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;

export function Welcome() {
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const robin = (byId.get(165) || BIRDS[0] || ANIMALS[0]) as Species;
  const plants = ofKind('plant').length;

  useEffect(() => {
    let alive = true;
    void db.kvGet('welcomed').then((value) => { if (alive && !value) setOpen(true); }).catch(() => {});
    const fn = () => { setOut(false); setOpen(true); };
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const id = requestAnimationFrame(() => startRef.current?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(id); };
  }, [open]);

  const close = () => {
    void db.kvSet('welcomed', true);
    setOut(true);
    setTimeout(() => { setOpen(false); setOut(false); }, 220);
  };

  if (!open) return null;
  return (
    <div className={`welcome${out ? ' welcome--out' : ''}`} role="dialog" aria-modal="true" aria-labelledby="welcome-h">
      <div className="welcome-card">
        <div className="welcome-hero">
          <SpeciesImage sp={robin} size="large" />
          <h1 id="welcome-h">Hi Sarah</h1>
        </div>
        <div className="welcome-body">
          <p>
            This is your BirdyDex: {BIRDS.length} South East Queensland birds to find
            {ANIMALS.length > BIRDS.length ? `, plus ${ANIMALS.length - BIRDS.length} other native animals` : ''}
            {plants ? ` and ${plants} native plants` : ''}, starting with this {robin.name}.
          </p>
          <ul className="welcome-list">
            <li><span className="welcome-ico"><svg viewBox="0 0 24 24" aria-hidden="true">{plus}</svg></span><span><strong>Log</strong> anything you find with the + button, or press and hold a tile in the dex.</span></li>
            <li><span className="welcome-ico"><svg viewBox="0 0 24 24" aria-hidden="true">{scan}</svg></span><span><strong>Scan</strong> names any species in your dex from a photo, and <strong>Listen</strong> names birds by their calls.</span></li>
            <li><span className="welcome-ico"><svg viewBox="0 0 24 24" aria-hidden="true">{learn}</svg></span><span><strong>Learn</strong> has a daily challenge and look-alike games, and <strong>badges</strong> and <strong>targets</strong> show where to go next.</span></li>
          </ul>
          <div className="row-center">
            <button ref={startRef} type="button" className="btn btn--primary" onClick={close}>Start exploring</button>
          </div>
          {configured && !signedIn() && (
            <div className="welcome-acct">
              <p className="small muted">Back up your dex and join the leaderboard. It's free, and the app works without it.</p>
              <div className="row-center">
                <Link className="btn me-join-go" to="/me/signup" onClick={close}>Sign up free</Link>
                <Link className="btn" to="/me/signin" onClick={close}>Sign in</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
