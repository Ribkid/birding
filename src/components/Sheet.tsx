import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, focusFirst, openLayer, type Layer } from '../lib/layers';
import { motionOK } from '../lib/motion';

const ms = (t: string) => { const v = parseFloat(t); return Number.isFinite(v) ? (/ms$/.test(t.trim()) ? v : v * 1000) : 0; };

/**
 * v1 closeSheet/exitSheet: a sheet she dismisses (Escape, the scrim, a button) slides back down before it goes, and
 * under reduced motion fades where it is. React has already taken the closed sheet out of the page, so its last
 * frame is put back, inert and marked data-closing, and plays out to motion.css's closing styles.
 */
function playOut(wrap: HTMLElement, scrollTop: number) {
  const sheet = wrap.querySelector<HTMLElement>('.sheet');
  const scrim = wrap.querySelector<HTMLElement>('.sheet-scrim');
  if (!sheet || typeof sheet.animate !== 'function' || !wrap.classList.contains('open')) return;
  wrap.setAttribute('data-closing', '');
  wrap.inert = true;
  // A sheet opening as this one leaves may use the same ids.
  wrap.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  document.body.append(wrap);
  try {
    sheet.scrollTop = scrollTop;
    const to = getComputedStyle(sheet);
    // The first of each list; a timing function such as cubic-bezier(.5, 0, .75, 0) has commas of its own.
    const easing = /^\s*([a-z-]+(\([^)]*\))?)/i.exec(to.transitionTimingFunction)?.[1] || 'ease-in';
    const timing = { duration: ms(to.transitionDuration.split(',')[0]) || 200, easing };
    const anims = [sheet.animate([{ transform: 'none', opacity: 1 }, { transform: to.transform, opacity: to.opacity }], timing)];
    if (scrim) anims.push(scrim.animate([{ opacity: 1 }, { opacity: getComputedStyle(scrim).opacity }], timing));
    void Promise.race([Promise.allSettled(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 450))]).then(() => wrap.remove());
  } catch {
    wrap.remove();
  }
}

/** A route change doesn't wait for a sheet that is still sliding away (v1 flushClosingSheets). */
export function flushClosingSheets() {
  document.querySelectorAll('.sheet-wrap[data-closing]').forEach((w) => w.remove());
}

interface SheetProps {
  open: boolean;
  /** How it was closed: 'escape' or 'nav' from the layer stack, 'scrim' for a tap outside it. */
  onClose: (reason?: string) => void;
  children: ReactNode;
  label?: string;
  /** The id of a heading that names the sheet, when it changes with the step (the Add sheet's outing form). */
  labelledBy?: string;
  wide?: boolean;
  cls?: string;
  /** false keeps the page usable behind the sheet (e.g. the patch sheet over the map). */
  modal?: boolean;
  lock?: boolean;
  /** Change it when the sheet swaps its content for another step, so the new step's first control takes focus. */
  step?: string | number;
}

/** A bottom sheet on the shared layer stack: scrim, focus trap, Escape and inert page behind it. */
export function Sheet({ open, onClose, children, label, labelledBy, wide = false, cls = '', modal = true, lock = true, step }: SheetProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 'open' is part of the rendered class, so a sheet that changes its cls (the Add sheet's outing step) keeps it.
  const [shown, setShown] = useState(false);
  // How the layer stack last closed it ('escape', 'nav'...), and how far its content was scrolled.
  const reason = useRef<string | undefined>(undefined);
  const scrolled = useRef(0);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    const layer: Layer = openLayer(wrap, {
      dialog: card,
      label,
      labelledBy,
      modal,
      lock,
      close: (why) => { reason.current = why; closeRef.current(why); },
    });
    const raf = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(raf);
      setShown(false);
      closeLayer(layer);
    };
  }, [open, label, labelledBy, modal, lock]);

  // Closing (open turns false, or the owner drops the sheet) plays the exit unless a route change did it: v1 removed
  // a sheet at once for 'nav', and the hash has already moved when the screen that held it unmounts.
  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const hash = location.hash;
    reason.current = undefined;
    return () => {
      const why = reason.current;
      reason.current = undefined;
      if (!wrap || why === 'nav') return;
      const top = scrolled.current;
      queueMicrotask(() => { if (!wrap.isConnected && location.hash === hash) playOut(wrap, top); });
    };
  }, [open]);

  // A new step replaces the sheet's content. v1 opened a new sheet over the same scrim for it, which slid up from
  // below, so the new step does the same.
  const lastStep = useRef(step);
  useEffect(() => {
    if (!open) { lastStep.current = step; return; }
    if (lastStep.current === step) return;
    lastStep.current = step;
    const card = cardRef.current;
    if (card && motionOK() && typeof card.animate === 'function') {
      card.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }, [open, step]);

  // Take the person into the sheet, as v1's openSheet did: its first control gets focus after 50 ms.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const wrap = wrapRef.current, card = cardRef.current;
      if (wrap && card && wrap.isConnected && !wrap.hasAttribute('data-closing')) focusFirst(card);
    }, 50);
    return () => clearTimeout(t);
  }, [open, step]);

  if (!open) return null;
  return createPortal(
    <div ref={wrapRef} className={`sheet-wrap ${cls}${shown ? ' open' : ''}`} data-closing={undefined}>
      <div className="sheet-scrim" data-close="" onClick={() => onClose('scrim')} />
      <div ref={cardRef} className={`sheet ${wide ? 'sheet--wide' : ''}`.trim()} onScroll={(e) => { scrolled.current = e.currentTarget.scrollTop; }}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
