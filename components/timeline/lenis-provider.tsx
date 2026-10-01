"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type Lenis from "lenis";

/**
 * Lenis smooth scroll, owned by SCROLL-TIMELINE.
 *
 * - GSAP + ScrollTrigger + Lenis are imported dynamically inside the effect so
 *   nothing touches `window` during SSR or at module-evaluation time.
 * - Lenis is driven from `gsap.ticker` (with `lagSmoothing` disabled) which
 *   keeps a single rAF loop for the whole page and keeps Lenis and
 *   ScrollTrigger inside the same frame budget.
 * - `prefers-reduced-motion` disables smoothing entirely (native scroll only)
 *   and is re-evaluated live if the user flips the OS setting.
 * - The instance is published through a tiny context so the timeline can
 *   intercept rail clicks without re-rendering the tree on scroll frames.
 */

export interface SmoothScrollApi {
  /** live Lenis instance, or `null` when smoothing is off / unavailable */
  lenis: Lenis | null;
  /** true once the provider resolved (either created Lenis or opted out) */
  ready: boolean;
  /** the user's `prefers-reduced-motion` preference */
  reducedMotion: boolean;
}

const IDLE: SmoothScrollApi = {
  lenis: null,
  ready: false,
  reducedMotion: true,
};

const SmoothScrollContext = createContext<SmoothScrollApi>(IDLE);

export function useSmoothScroll(): SmoothScrollApi {
  return useContext(SmoothScrollContext);
}

/** Convenience hook for components that only need the instance. */
export function useLenis(): Lenis | null {
  return useContext(SmoothScrollContext).lenis;
}

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<SmoothScrollApi>(IDLE);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }, { default: LenisCtor }] =
        await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
          import("lenis"),
        ]);
      if (disposed) return;

      gsap.registerPlugin(ScrollTrigger);

      const motionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      let lenis: Lenis | null = null;
      let unsubscribe: (() => void) | null = null;
      let raf: ((time: number) => void) | null = null;

      const stopLenis = () => {
        if (raf) {
          gsap.ticker.remove(raf);
          raf = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (lenis) {
          lenis.destroy();
          lenis = null;
        }
        // restore GSAP's default lag smoothing so nothing else regresses
        gsap.ticker.lagSmoothing(500, 33);
      };

      const startLenis = () => {
        if (lenis) return;
        lenis = new LenisCtor({
          autoRaf: false,
          lerp: 0.085,
          wheelMultiplier: 0.95,
          touchMultiplier: 1.3,
          smoothWheel: true,
          syncTouch: false,
          autoResize: true,
          anchors: false,
          overscroll: false,
          respectReducedMotion: true,
        });
        lenis.scrollTo(window.scrollY, { immediate: true, force: true });
        unsubscribe = lenis.on("scroll", () => ScrollTrigger.update());
        raf = (time: number) => {
          lenis?.raf(time * 1000);
        };
        gsap.ticker.add(raf);
        gsap.ticker.lagSmoothing(0);
      };

      const publish = () => {
        if (disposed) return;
        setApi({
          lenis,
          ready: true,
          reducedMotion: motionQuery.matches,
        });
      };

      const sync = () => {
        if (motionQuery.matches) {
          stopLenis();
        } else {
          startLenis();
        }
        ScrollTrigger.refresh();
        publish();
      };

      motionQuery.addEventListener("change", sync);
      sync();

      // ScrollTrigger measures while webfonts are still swapping in.
      if (document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (!disposed) ScrollTrigger.refresh();
        });
      }

      dispose = () => {
        motionQuery.removeEventListener("change", sync);
        stopLenis();
      };
    })().catch(() => {
      // Scrolling must never depend on this provider: fall back to native scroll.
      if (!disposed) {
        setApi({ lenis: null, ready: true, reducedMotion: true });
      }
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return (
    <SmoothScrollContext.Provider value={api.ready ? api : IDLE}>
      {children}
    </SmoothScrollContext.Provider>
  );
}

/**
 * Smooth-scroll to a chapter. A no-op (native hash jump) whenever Lenis is not
 * running — no JS, reduced motion, or a viewport too short to animate.
 */
export function useScrollTo(): (
  target: HTMLElement | null,
  options?: { offset?: number },
) => void {
  const { lenis } = useSmoothScroll();
  return useCallback(
    (target, options) => {
      if (!lenis || !target) return;
      lenis.scrollTo(target, {
        offset: options?.offset ?? 0,
        duration: 1.2,
        easing: (t: number) => 1 - Math.pow(1 - t, 4),
        programmatic: true,
      });
    },
    [lenis],
  );
}