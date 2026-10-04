"use client";

/**
 * The hero's HTML layer — typography and UI, never inside the canvas.
 *
 * Two motion systems, deliberately separated:
 *  - CSS owns the *entrance* (once, on mount, and fully disabled under
 *    `prefers-reduced-motion`);
 *  - GSAP + ScrollTrigger owns the *scroll* response (`use-hero-scroll.ts`),
 *    scrubbing opacity / transform on the elements marked `data-hero-*`.
 *
 * GSAP writes inline `opacity` / `visibility` / `transform`, which always beats
 * the Tailwind classes below; `gsap.context().revert()` takes them off again.
 */

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

function entranceClass(reducedMotion: boolean): string {
  return reducedMotion ? "" : "hero-enter";
}

function entranceStyle(delay: number): React.CSSProperties {
  return { "--hero-delay": `${delay}s` } as React.CSSProperties;
}

function paintSafeClass(reducedMotion: boolean): string {
  return reducedMotion ? "" : "hero-enter-paint";
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
        <p
          data-hero-kicker=""
          className={`label flex items-center gap-(--space-3) text-metal-300 ${entranceClass(reducedMotion)}`}
          style={entranceStyle(0.15)}
        >
          <span
            aria-hidden="true"
            className="inline-block h-[2px] w-(--space-8) bg-guards"
          />
          {HERO_KICKER}
        </p>
        <p
          className={`label hidden text-right md:block ${entranceClass(reducedMotion)}`}
          style={entranceStyle(0.3)}
        >
          Nine generations
          <br />
          One silhouette
        </p>
      </div>

      {/* ---- headline block ---- */}
      <div className="max-w-(--maxw)">
        <h1
          data-hero-title=""
          className={`font-display text-display-1 text-metal-100 ${paintSafeClass(reducedMotion)}`}
          style={entranceStyle(0.05)}
        >
          {HERO_TITLE_LEAD}
          <br />
          <span className="text-guards-text">{HERO_TITLE_ACCENT}</span>
        </h1>
        <p
          className={`mt-(--space-4) max-w-(--maxw-prose) text-body-2 text-metal-500 ${entranceClass(reducedMotion)}`}
          style={entranceStyle(0.6)}
        >
          {HERO_STANDFIRST}
        </p>
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
                {String(index + 1).padStart(2, "0")}/
                {String(specs.length).padStart(2, "0")}
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

        <div
          data-hero-hint=""
          className={`flex shrink-0 items-center gap-(--space-3) pb-(--space-2) ${entranceClass(reducedMotion)}`}
          style={entranceStyle(0.8)}
        >
          <span className="label text-metal-300">{HERO_SCROLL_HINT}</span>
          <span
            aria-hidden="true"
            className={`block h-(--space-8) w-px bg-gradient-to-b from-metal-300 to-transparent ${reducedMotion ? "" : "hero-hint-line"}`}
          />
        </div>
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
