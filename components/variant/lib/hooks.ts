"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * Client-side plumbing for components/variant. Every hook starts in the
 * *safe* value (reduced motion = true, not-in-view = false) so server markup
 * and the first client render always agree — no hydration warnings, no
 * flash of animation, no canvas before it is needed.
 */

/* ------------------------------------------------------------------ */
/* reduced motion                                                     */
/* ------------------------------------------------------------------ */

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** `true` until the media query has been measured (i.e. on the server). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(REDUCE_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------ */
/* viewport gating                                                    */
/* ------------------------------------------------------------------ */

export interface InViewOptions {
  /** fire as soon as the element is within this margin of the viewport */
  rootMargin?: string;
  /** fire once and never again (default) */
  once?: boolean;
  /** fire when the tab is hidden as well as when on screen */
  ignoreVisibility?: boolean;
}

/**
 * IntersectionObserver + `document.hidden`, combined into one flag. Used to
 * gate every heavy thing on the page: the WebGL canvas, the turntable
 * preloader, the counter animations and the lazy video iframes.
 */
export function useInView<T extends HTMLElement>(
  options: InViewOptions = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const { rootMargin = "200px", once = true, ignoreVisibility = false } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const seenRef = useRef(false);
  const onScreenRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const publish = () => {
      const next = onScreenRef.current && (ignoreVisibility || !document.hidden);
      if (next) seenRef.current = true;
      if (once && seenRef.current) {
        setInView(true);
        return;
      }
      setInView(next);
    };

    if (typeof IntersectionObserver === "undefined") {
      onScreenRef.current = true;
      publish();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onScreenRef.current = true;
          } else if (!once) {
            onScreenRef.current = false;
          }
        }
        publish();
      },
      { rootMargin, threshold: 0 },
    );
    observer.observe(element);

    const onVisibility = () => publish();
    if (!ignoreVisibility) {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      observer.disconnect();
      if (!ignoreVisibility) {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [ignoreVisibility, once, rootMargin]);

  return { ref, inView };
}

/* ------------------------------------------------------------------ */
/* count-up                                                           */
/* ------------------------------------------------------------------ */

export interface CountUpOptions {
  /** run the tween (typically: the section is on screen and motion is ok) */
  active: boolean;
  decimals: number;
  durationMs?: number;
  /** when true the final value is rendered immediately, no rAF at all */
  reduced?: boolean;
  format: (value: number, decimals: number) => string;
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

interface TweenSample {
  /** the figure this sample belongs to — a new figure restarts at 0 */
  target: number;
  value: number;
}

/**
 * Eased numeric tween, written so the *only* state updates happen inside the
 * rAF callback (never synchronously in the effect body).
 *
 * Resolution order:
 *  - `target === null`      → `"—"` (never a number we do not have);
 *  - reduced motion / idle → the final value, on first paint;
 *  - active                 → the tween, starting from 0 on the frame the
 *                             section actually became visible.
 */
export function useCountUp(
  target: number | null,
  { active, decimals, durationMs = 1200, reduced = false, format }: CountUpOptions,
): string {
  const [sample, setSample] = useState<TweenSample | null>(null);

  useEffect(() => {
    if (target === null || reduced || !active) return;

    const started = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = clamp01((now - started) / Math.max(120, durationMs));
      setSample({
        target,
        value: progress >= 1 ? target : target * easeOutExpo(progress),
      });
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, durationMs, reduced, target]);

  if (target === null) return "—";

  const shouldTween = active && !reduced;
  // no tween, or no sample for this figure yet → the run is at its start
  const value =
    shouldTween && sample !== null && sample.target === target
      ? sample.value
      : shouldTween
        ? 0
        : target;

  return format(value, decimals);
}

/* ------------------------------------------------------------------ */
/* misc client helpers                                                */
/* ------------------------------------------------------------------ */

const noopSubscribe = () => () => {};

/**
 * `false` on the server, `true` after hydration — without an effect, so the
 * first client render cannot cascade. Used to gate browser-only rendering
 * (portals, `next/dynamic` with `ssr: false`).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Media query as a boolean, measured after mount (SSR-safe default). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}