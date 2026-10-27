import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, onLayerKey, openLayer, type Layer } from '../lib/layers';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  wide?: boolean;
  cls?: string;
  /** false keeps the page usable behind the sheet (e.g. the patch sheet over the map). */
  modal?: boolean;
  lock?: boolean;
}

/** A bottom sheet on the shared layer stack: scrim, focus trap, Escape and inert page behind it. */
export function Sheet({ open, onClose, children, label, wide = false, cls = '', modal = true, lock = true }: SheetProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    const layer: Layer = openLayer(wrap, {
      dialog: card,
      label,
      modal,
      lock,
      close: () => closeRef.current(),
    });
    const raf = requestAnimationFrame(() => wrap.classList.add('open'));
    // v1 openSheet (js/app.js:229-231): once the sheet is up, focus its first control, unless the screen
    // already put focus inside it or the control opts out with data-noautofocus.
    const first = card.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]), select, textarea, button, a[href]');
    const focusTimer = first && !first.matches('[data-noautofocus]')
      ? setTimeout(() => { if (!card.contains(document.activeElement)) first.focus({ preventScroll: true }); }, 50)
      : undefined;
    const key = (e: KeyboardEvent) => { onLayerKey(e); };
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(focusTimer);
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key);
      closeLayer(layer);
    };
  }, [open, label, modal, lock]);

  if (!open) return null;
  return createPortal(
    <div ref={wrapRef} className={`sheet-wrap ${cls}`} data-closing={undefined}>
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={cardRef} className={`sheet glass ${wide ? 'sheet--wide' : ''}`.trim()}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
