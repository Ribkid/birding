import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { countUp, motionOK } from '../lib/motion';
import { applyTint, stagger } from '../lib/look';

/** A number that counts up once, with the stamp. Reduced motion shows the final value. */
export function CountUp({ value, className, format, delay = 120 }: {
  value: number; className?: string; format?: (n: number) => string; delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    void countUp(ref.current, 0, value, { delay, format });
  }, [value, delay, format]);
  return <span ref={ref} className={className}>{format ? format(value) : value}</span>;
}

/** One-time staggered entrance for the first items matching a selector. */
export function useStagger<T extends HTMLElement>(selector: string, key: string, max = 16) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = requestAnimationFrame(() => stagger(el, selector, { key, max }));
    return () => cancelAnimationFrame(id);
  }, [selector, key, max]);
  return ref;
}

/** Paint a screen's tint from a photo, using look.js's readable-host allowlist and contrast loop. */
export function useTint<T extends HTMLElement>(url: string | null, fallback: string | null = null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const id = requestAnimationFrame(() => { if (alive) void applyTint(ref.current, url, fallback); });
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [url, fallback]);
  return ref;
}

/**
 * Navigate inside a same-document view transition. Falls back to a plain navigate when the browser has no
 * startViewTransition or the person prefers reduced motion.
 */
export function useViewTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback((to: To, options?: NavigateOptions & { nav?: 'forward' | 'back' | 'swap' }) => {
    const start = (document as any).startViewTransition;
    if (!start || !motionOK() || document.hidden) return navigate(to, options);
    const root = document.documentElement;
    root.dataset.nav = options?.nav ?? 'forward';
    try {
      const t = start.call(document, () => flushSync(() => navigate(to, options)));
      t.finished.finally(() => { delete root.dataset.nav; }).catch(() => {});
    } catch {
      delete root.dataset.nav;
      navigate(to, options);
    }
    return undefined;
  }, [navigate]);
}

export function StaggerOnMount({ selector, k, max = 16, children }: { selector: string; k: string; max?: number; children: ReactNode }) {
  const ref = useStagger<HTMLDivElement>(selector, k, max);
  return <div ref={ref}>{children}</div>;
}
