import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, focusFirst, openLayer, type Layer } from '../lib/layers';
import { motionOK } from '../lib/motion';

interface SheetProps {
  open: boolean;
  onClose: () => void;
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
      close: () => closeRef.current(),
    });
    const raf = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(raf);
      setShown(false);
      closeLayer(layer);
    };
  }, [open, label, labelledBy, modal, lock]);

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
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={cardRef} className={`sheet ${wide ? 'sheet--wide' : ''}`.trim()}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
