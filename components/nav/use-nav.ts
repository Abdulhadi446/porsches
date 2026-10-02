"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLenis } from "#components/timeline/lenis-provider";

/**
 * NAV-UX RUNTIME HOOKS — owned by NAV-UX.
 *
 * Small, dependency-free primitives shared by the mega-nav, the command
 * palette, the variant grid, the compare table, the cursor and the loading
 * screen. All of them are SSR-safe: the first client render always matches
 * the server markup, and capability detection is wired to external stores
 * (`matchMedia`, `localStorage`) rather than to `setState` inside effects.
 */

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, audio[controls], video[controls], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const noopSubscribe = () => () => {};

/** Live `matchMedia`, read through an external store so nothing re-renders twice. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Live `prefers-reduced-motion`. False on the server and on first paint. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** True only for a desktop-class fine pointer with no motion restrictions. */
export function useCursorEligible(): boolean {
  const fine = useMediaQuery("(pointer: fine) and (hover: hover)");
  const reduced = usePrefersReducedMotion();
  return fine && !reduced;
}

/** `true` once the client has hydrated — the SSR-safe "client only" flag. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/* ------------------------------------------------------------------ *
 * Focus management
 * ------------------------------------------------------------------ */

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      el.offsetWidth > 0 ||
      el.offsetHeight > 0 ||
      el === document.activeElement,
  );
}

/**
 * Modal focus trap: moves focus in, wraps Tab/Shift+Tab, and restores the
 * previously focused element on close. `#main` is marked `inert` too (where
 * supported) so the rest of the page leaves the accessibility tree.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  options?: {
    initialFocus?: React.RefObject<HTMLElement | null>;
    inertMain?: boolean;
  },
): void {
  const initialFocus = options?.initialFocus;
  const inertMain = options?.inertMain ?? true;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const main = inertMain ? document.getElementById("main") : null;
    const supportsInert = "inert" in HTMLElement.prototype;
    if (main && supportsInert) main.setAttribute("inert", "");

    const raf = requestAnimationFrame(() => {
      const target =
        initialFocus?.current ?? focusableIn(container)[0] ?? container ?? null;
      target?.focus?.();
    });

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableIn(containerRef.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (current === first || !container?.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !container?.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      if (main && supportsInert) main.removeAttribute("inert");
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocus, inertMain]);
}

/**
 * Freeze page scroll while a dialog owns the screen. Lenis is stopped through
 * its own API (never by touching `overflow` on a running smooth scroller);
 * the native fallback compensates for the scrollbar so nothing shifts.
 */
export function useScrollLock(active: boolean): void {
  const lenis = useLenis();
  useEffect(() => {
    if (!active) return;
    if (lenis) {
      lenis.stop();
      return () => lenis.start();
    }
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const gap = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [active, lenis]);
}

/* ------------------------------------------------------------------ *
 * Combobox list navigation
 * ------------------------------------------------------------------ */

export interface ListNavigation {
  /** index clamped into the current list length */
  active: number;
  setActive: (index: number) => void;
  /**
   * Key handler for ↑/↓/PageUp/PageDown/Home/End plus Enter. `commit` is passed
   * in by the caller so the handler never closes over a stale render.
   */
  keys: (event: ReactKeyboardEvent, commit: () => void) => void;
}

export function useListNavigation(count: number): ListNavigation {
  const [raw, setRaw] = useState(0);
  const active = count > 0 ? Math.min(raw, count - 1) : 0;

  const setActive = useCallback(
    (index: number) => setRaw(Math.max(0, Math.min(index, Math.max(count - 1, 0)))),
    [count],
  );

  const keys = useCallback(
    (event: ReactKeyboardEvent, commit: () => void) => {
      if (count <= 0) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setRaw((current) => (current + 1) % count);
          break;
        case "ArrowUp":
          event.preventDefault();
          setRaw((current) => (current - 1 + count) % count);
          break;
        case "PageDown":
          event.preventDefault();
          setRaw((current) => Math.min(count - 1, current + 8));
          break;
        case "PageUp":
          event.preventDefault();
          setRaw((current) => Math.max(0, current - 8));
          break;
        case "Home":
          event.preventDefault();
          setRaw(0);
          break;
        case "End":
          event.preventDefault();
          setRaw(count - 1);
          break;
        case "Enter":
          event.preventDefault();
          commit();
          break;
        default:
          break;
      }
    },
    [count],
  );

  return { active, setActive, keys };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const STORE_EVENT = "911-nav:store";

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** `localStorage` as an external store: SSR-safe, never throws. */
export function useStoredString(
  key: string,
): [string, (next: string) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    const handler = () => onChange();
    window.addEventListener(STORE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(STORE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => "",
  );

  const write = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* quota or disabled storage */
      }
      window.dispatchEvent(new Event(STORE_EVENT));
    },
    [key],
  );

  return [raw, write];
}

/** `localStorage`-backed string list (recent searches). */
export function useStoredList(key: string): [string[], (next: string[]) => void] {
  const [raw, write] = useStoredString(key);
  const list = useMemo(() => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    } catch {
      return [];
    }
  }, [raw]);
  const update = useCallback(
    (next: string[]) => write(JSON.stringify(next.slice(0, 8))),
    [write],
  );
  return [list, update];
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export const prefersMedia = (query: string): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
};
