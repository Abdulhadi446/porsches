"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useMounted, usePrefersReducedMotion } from "./use-nav";

/**
 * LOADING SCREEN — owned by NAV-UX.
 *
 * A cinematic intro driven by *real* milestones, never by a timer that
 * pretends to know how much is left. Every milestone can only resolve once,
 * and each one carries its own fallback, so the bar can never stall:
 *
 *   18 %  mounted
 *   46 %  the browser finished loading and painted a frame
 *   74 %  webfonts settled (or an idle callback fired)
 *   92 %  an optional poster decoded — only when a `poster` path is supplied,
 *          and a 404 or a hung request can never block it
 *  100 %  dismissed
 *
 * A hard timeout (2.5 s, clamped) always dismisses, Escape / Enter / Space and
 * the Skip button dismiss early, and the intro runs once per browser session
 * per route (`sessionStorage`, SSR-guarded) so it is a first-visit moment
 * rather than a tax. `prefers-reduced-motion` renders nothing at all.
 *
 * Mounted by the pages NAV-UX owns (`/compare`, `/variants`); everywhere else
 * the route progress bar in `PageTransition` covers navigation.
 */

const HARD_TIMEOUT = 2500;
const SESSION_KEY = "911-nav:intro";
const STEPS = [18, 46, 74, 92, 100];

export interface LoadingScreenProps {
  /** optional poster to decode before 100 % — never required, never blocking */
  poster?: string;
  /** headline shown under the wordmark */
  caption?: string;
  /** sessionStorage bucket; defaults to the pathname */
  sessionKey?: string;
  /** ignore the session gate and play every time */
  always?: boolean;
  /** hard cap in ms, clamped to [600, 2500] */
  timeout?: number;
}

/** Decided once, on the client, before anything is painted. */
function shouldRun(bucket: string, always: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    const seen = window.sessionStorage.getItem(SESSION_KEY) === bucket;
    if (seen && !always) return false;
    window.sessionStorage.setItem(SESSION_KEY, bucket);
    return true;
  } catch {
    return true;
  }
}

export function LoadingScreen({
  poster,
  caption = "Six decades of the 911",
  sessionKey,
  always = false,
  timeout = HARD_TIMEOUT,
}: LoadingScreenProps) {
  const pathname = usePathname();
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  const bucket = sessionKey ?? pathname ?? "site";
  const [gate] = useState(() => shouldRun(bucket, always));
  const [progress, setProgress] = useState(STEPS[0]);
  const [label, setLabel] = useState("Booting");
  const [dismissed, setDismissed] = useState(false);
  const dismissRef = useRef<(() => void) | null>(null);

  const running = mounted && gate && !reduced && !dismissed;

  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };
    const step = (index: number, text: string) => {
      if (cancelled) return;
      setProgress(STEPS[index] ?? 100);
      setLabel(text);
    };
    const done = () => {
      if (cancelled) return;
      step(4, "Ready");
      later(() => setDismissed(true), 180);
    };
    dismissRef.current = () => {
      if (cancelled) return;
      setProgress(100);
      setLabel("Ready");
      setDismissed(true);
    };

    later(() => step(1, "First frame"), 90);
    const cap = Math.min(Math.max(timeout, 600), HARD_TIMEOUT);
    later(done, cap);

    const onReady = () => {
      if (cancelled || document.readyState !== "complete") return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => step(2, "Type & layout")),
      );
    };
    if (document.readyState === "complete") onReady();
    else window.addEventListener("load", onReady);

    const onIdle: (cb: () => void) => void =
      typeof window.requestIdleCallback === "function"
        ? (cb) => window.requestIdleCallback(cb, { timeout: 400 })
        : (cb) => later(cb, 140);
    onIdle(() => {
      const fonts = document.fonts as
        | (FontFaceSet & { ready?: Promise<unknown> })
        | undefined;
      const settled = fonts?.ready ?? Promise.resolve();
      void settled
        .catch(() => undefined)
        .then(() => {
          if (cancelled) return;
          step(3, poster ? "Decoding poster" : "Indexing");
          if (!poster) {
            later(done, 160);
            return;
          }
          let closed = false;
          const finish = () => {
            if (cancelled || closed) return;
            closed = true;
            later(done, 120);
          };
          const image = new Image();
          image.onload = finish;
          image.onerror = finish;
          image.src = poster;
          later(finish, 800);
        });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dismissRef.current?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("load", onReady);
      document.removeEventListener("keydown", onKeyDown);
      dismissRef.current = null;
    };
  }, [poster, running, timeout]);

  if (!running) return null;

  const dismiss = () => dismissRef.current?.();
  const pct = Math.round(progress);

  return (
    <div
      data-nav-loading={bucket}
      className="fixed inset-0 z-loader flex flex-col items-center justify-center bg-ink px-(--gutter)"
    >
      <div className="w-full max-w-(--space-32)">
        <p aria-hidden="true" className="label mb-(--space-3) text-center">
          {label} · {pct}%
        </p>
        <div
          className="h-px w-full overflow-hidden bg-ink-4"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Loading"
        >
          <motion.div
            className="h-full origin-left bg-guards"
            animate={{ scaleX: Math.max(pct, 4) / 100 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <p
          aria-hidden="true"
          className="mt-(--space-3) text-center font-display text-3xl uppercase"
        >
          911<span className="text-guards-text">.</span>SHOWCASE
        </p>
        <p
          aria-hidden="true"
          className="mt-(--space-2) text-center font-mono text-mono-xs uppercase tracking-(--tracking-label) text-metal-700"
        >
          {caption}
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {`Loading ${label.toLowerCase()}, ${pct} percent. Press escape to skip.`}
      </p>

      <button
        type="button"
        onClick={dismiss}
        className="absolute bottom-(--space-12) rounded-(--radius-sm) border border-ink-4 px-(--space-4) py-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-label) text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
      >
        Skip intro
      </button>
    </div>
  );
}
