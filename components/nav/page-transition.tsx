"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { usePrefersReducedMotion } from "./use-nav";

/**
 * PAGE TRANSITIONS — owned by NAV-UX.
 *
 * App Router never gives a layout the outgoing tree, so an `AnimatePresence`
 * exit would either not fire or would block the new route. Instead the
 * choreography is a three-layer "cut" that plays *over* the swap:
 *
 *   1. a 2 px route progress bar at the very top of the viewport,
 *   2. an opaque ink veil with a backdrop blur that wipes the old page away,
 *   3. a dim on the incoming tree that eases back to full opacity.
 *
 * Every value is a framer motion value driven by `animate()` inside an effect,
 * so a navigation causes **zero** extra React renders of the page subtree, and
 * nothing is ever awaited before the new route is interactive — the veil is
 * `pointer-events: none` for its whole life. Scroll is never read or written,
 * so Lenis keeps owning the scroller. Under `prefers-reduced-motion` the
 * effect returns early and the component renders plain, static children.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = usePrefersReducedMotion();
  const first = useRef(true);

  const veil = useMotionValue(0);
  const dim = useMotionValue(1);
  const bar = useMotionValue(0);
  const barFade = useMotionValue(0);
  const blur = useTransform(veil, (value) =>
    value > 0.002 ? `blur(${Math.round(value * 14)}px)` : "none",
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced || !pathname) {
      veil.set(0);
      dim.set(1);
      barFade.set(0);
      return;
    }

    veil.set(1);
    bar.set(0);
    barFade.set(1);

    const veilOut = animate(veil, 0, {
      duration: 0.52,
      ease: [0.16, 1, 0.3, 1],
    });
    const dimIn = animate(dim, [0.35, 1], {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    });
    const barRun = animate(bar, 1, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
    });
    const barOut = animate(barFade, 0, { duration: 0.28, delay: 0.3 });

    return () => {
      veilOut.stop();
      dimIn.stop();
      barRun.stop();
      barOut.stop();
    };
  }, [bar, barFade, dim, pathname, reduced, veil]);

  return (
    <>
      <motion.div
        style={{ opacity: dim }}
        data-nav-transition={pathname ?? "initial"}
      >
        {children}
      </motion.div>

      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[var(--z-sticky)]"
        style={{
          opacity: veil,
          backdropFilter: blur,
          WebkitBackdropFilter: blur,
        }}
      >
        <div className="absolute inset-0 bg-ink" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-guards/20 to-transparent" />
      </motion.div>

      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[calc(var(--z-nav)+1)] h-[2px]"
        style={{ opacity: barFade }}
      >
        <motion.div
          className="h-full w-full origin-left bg-gradient-to-r from-guards via-guards-glow to-gulf-orange"
          style={{ scaleX: bar }}
        />
      </motion.div>
    </>
  );
}
