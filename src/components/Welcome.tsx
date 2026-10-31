import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ANIMALS, BIRDS, byId, ofKind, type Species } from '../lib/data';
import { db } from '../core/db.js';
import { sized } from '../core/media.js';
import { configured, signedIn } from '../core/profile.js';
import { myFirstName } from '../lib/dexName';
import { closeLayer, openLayer, type Layer } from '../lib/layers';
import { useMedia } from '../lib/hooks';
import { promptInstall, useCanInstall } from '../lib/install';
import { SpeciesImage } from './SpeciesImage';
import { useTint } from './Motion';

const listeners = new Set<() => void>();

/** Re-open the first-run card from Settings. */
export function openWelcome() {
  for (const fn of listeners) fn();
}

const plus = <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />;
const scan = <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /></>;
const learn = <path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;

/**
 * v1's first-run card (js/app.js showWelcome). It is a layer: the page behind is inert, Tab stays in the card, and
 * Escape, a route change and Start exploring all close it, mark kv 'welcomed', and (except on a route change) put
 * focus back where it was.
 */
export function Welcome() {
  useMedia();
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState(false);
  const ovRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<Layer | null>(null);
  const install = useCanInstall();
  const robin = (byId.get(165) || BIRDS[0] || ANIMALS[0]) as Species;
  const plants = ofKind('plant').length;
  const cardRef = useTint<HTMLDivElement>(open ? (sized(robin.id, 'large') as string | null) : null, null);

  useEffect(() => {
    let alive = true;
    void db.kvGet('welcomed').then((value: unknown) => { if (alive && !value) setOpen(true); }).catch(() => {});
    const fn = () => { if (!layerRef.current) { setOut(false); setOpen(true); } };
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, []);

  // Escape, Back and Start exploring all mean the same thing: she has seen it.
  const done = (reason = 'button') => {
    const layer = layerRef.current;
    if (!layer || !closeLayer(layer, { restore: reason !== 'nav' })) return;
    layerRef.current = null;
    setOut(true);
    setTimeout(() => { setOpen(false); setOut(false); }, 220);
    void db.kvSet('welcomed', true);
  };
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    if (!open) return;
    const ov = ovRef.current, card = cardRef.current;
    if (!ov || !card) return;
    const layer = openLayer(ov, { dialog: card, close: (reason) => doneRef.current(reason) });
    layerRef.current = layer;
    startRef.current?.focus({ preventScroll: true });
    return () => {
      if (layerRef.current === layer) { closeLayer(layer, { restore: false }); layerRef.current = null; }
    };
  }, [open, cardRef]);

  const installNow = async () => {
    await promptInstall();
    // The Install button goes once the offer is used; keep focus in the card.
    const a = document.activeElement;
    if (layerRef.current && (!a || a === document.body || !a.isConnected)) startRef.current?.focus({ preventScroll: true });
  };

  if (!open) return null;
  const first = myFirstName();
  return createPortal(
    <div ref={ovRef} className={`welcome${out ? ' welcome--out' : ''}`} data-closing={out ? '' : undefined} inert={out}>
      <div ref={cardRef} className="welcome-card">
        <div className="welcome-hero">
          <SpeciesImage sp={robin} size="large" />
          <h1>{first ? `Hi ${first}` : 'Welcome to BirdyDex'}</h1>
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
            {install && <button type="button" className="btn" onClick={() => void installNow()}>Install app</button>}
            <button ref={startRef} type="button" className="btn btn--primary" onClick={() => done('button')}>Start exploring</button>
          </div>
          {configured && !signedIn() && (
            <div className="welcome-acct">
              <p className="small muted">Back up your dex and join the leaderboard. It's free, and the app works without it.</p>
              <div className="me-cta">
                <Link className="btn btn--primary btn--small" to="/me/signup" onClick={() => done('nav')}>Sign up free</Link>
                <Link className="btn btn--small" to="/me/signin" onClick={() => done('nav')}>Sign in</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
