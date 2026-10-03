"use client";

/**
 * The hero's HTML layer — typography and UI, never inside the canvas.
 *
 * Two motion systems, deliberately separated:
 *  - framer-motion owns the *entrance* (once, on mount, and fully disabled under
 *    `prefers-reduced-motion`);
 *  - GSAP + ScrollTrigger owns the *scroll* response (`use-hero-scroll.ts`),
 *    scrubbing opacity / transform on the elements marked `data-hero-*`.
 *
 * GSAP writes inline `opacity` / `visibility` / `transform`, which always beats
 * the Tailwind classes below; `gsap.context().revert()` takes them off again.
 */

import { motion } from "framer-motion";
import {
  HERO_KICKER,
  HERO_SCROLL_HINT,
  HERO_STANDFIRST,
  HERO_TITLE_ACCENT,
  HERO_TITLE_LEAD,
  type EraSpec,
} from "./hero-data";

export interface HeroContentProps {
  specs: readonly EraSpec[];
  /** no entrance animation, no scroll-hint loop */
  reducedMotion: boolean;
  /** a WebGL canvas sits behind this copy */
  live: boolean;
  /** which spec is visible before the scroll takes over */
  initialIndex: number;
}

/** `--ease-out-expo`, typed as the cubic-bezier tuple framer-motion expects. */
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Entrance props. `initial: false` skips the animation entirely. */
function enter(delay: number, reduced: boolean) {
  if (reduced) {
    return {
      initial: false as const,
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0 },
    };
  }
  return {
    initial: { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1.1, delay, ease: EASE },
  };
}

/**
 * Paint-safe entrance: the <h1> is the LCP element, so it must be painted
 * immediately. It animates position only — opacity stays 1 from the start.
 */
function enterPaintSafe(delay: number, reduced: boolean) {
  if (reduced) {
    return {
      initial: false as const,
      animate: { y: 0 },
      transition: { duration: 0 },
    };
  }
  return {
    initial: { y: 18 },
    animate: { y: 0 },
    transition: { duration: 0.7, delay, ease: EASE },
  };
}

export function HeroContent({
  specs,
  reducedMotion,
  live,
  initialIndex,
}: HeroContentProps) {
  return (
    <div
      data-hero-content=""
      className="pointer-events-none absolute inset-0 z-content flex flex-col justify-between px-(--gutter) pb-(--space-8) pt-(--space-12)"
    >
      {/* ---- top rail ---- */}
      <div className="flex items-start justify-between gap-(--space-6)">
        <motion.p
          {...enter(0.15, reducedMotion)}
          data-hero-kicker=""
          className="label flex items-center gap-(--space-3) text-metal-300"
        >
          <span
            aria-hidden="true"
            className="inline-block h-[2px] w-(--space-8) bg-guards"
          />
          {HERO_KICKER}
        </motion.p>
        <motion.p {...enter(0.3, reducedMotion)} className="label hidden text-right md:block">
          Nine generations
          <br />
          One silhouette
        </motion.p>
      </div>

      {/* ---- headline block ---- */}
      <div className="max-w-(--maxw)">
        <motion.h1
          {...enterPaintSafe(0.05, reducedMotion)}
          data-hero-title=""
          className="font-display text-display-1 text-metal-100"
        >
          {HERO_TITLE_LEAD}
          <br />
          <span className="text-guards-text">{HERO_TITLE_ACCENT}</span>
        </motion.h1>
        <motion.p
          {...enter(0.6, reducedMotion)}
          className="mt-(--space-4) max-w-(--maxw-prose) text-body-2 text-metal-500"
        >
          {HERO_STANDFIRST}
        </motion.p>
      </div>

      {/* ---- spec strip + hint ---- */}
      <div className="flex items-end justify-between gap-(--space-8)">
        <div
          data-hero-specs=""
          className="relative h-(--space-24) min-w-[15rem] flex-1 sm:max-w-[26rem]"
        >
          {specs.map((spec, index) => (
            <div
              key={spec.code}
              data-hero-spec={spec.code}
              data-spec=""
              data-first={index === initialIndex}
              className="absolute inset-x-0 bottom-0 opacity-0 data-[first=true]:opacity-100"
            >
              <p className="label" style={{ color: spec.accent }}>
                {String(index + 1).padStart(2, "0")}/{String(specs.length).padStart(2, "0")}
                {" · "}
                {spec.code} · {spec.years}
              </p>
              <p className="mt-(--space-1) font-mono text-mono-md tracking-(--tracking-mono) text-metal-100">
                {spec.power}
              </p>
              <p className="label mt-(--space-1)">{spec.name}</p>
            </div>
          ))}
        </div>

        <motion.div
          {...enter(0.8, reducedMotion)}
          data-hero-hint=""
          className="flex shrink-0 items-center gap-(--space-3) pb-(--space-2)"
        >
          <span className="label text-metal-300">{HERO_SCROLL_HINT}</span>
          <motion.span
            aria-hidden="true"
            className="block h-(--space-8) w-px bg-gradient-to-b from-metal-300 to-transparent"
            animate={reducedMotion ? undefined : { scaleY: [0.35, 1, 0.35], originY: [0, 0, 0] }}
            transition={
              reducedMotion
                ? undefined
                : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
        </motion.div>
      </div>

      {/* ---- orbit progress hairline ---- */}
      <div
        aria-hidden="true"
        className="absolute inset-x-(--gutter) bottom-0 h-px bg-ink-4"
      >
        <div
          data-hero-progress=""
          className="h-px origin-left scale-x-0 bg-gradient-to-r from-guards via-guards-glow to-transparent"
        />
      </div>

      <p className="sr-only">
        {live
          ? "An interactive 3D Porsche 911 hero. Scrolling rotates the camera a full circle around the car and steps the specification strip through every generation."
          : "A static poster of a Porsche 911. Scrolling steps the specification strip through every generation."}
      </p>
    </div>
  );
}
