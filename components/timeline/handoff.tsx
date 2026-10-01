import Link from "next/link";
import type { CSSProperties } from "react";
import { withAlpha } from "./format";

/**
 * Timeline seams.
 *
 * Boundary note: the hero (components/hero, owned by 3D-HERO) is rendered
 * ABOVE this section by app/page.tsx and is deliberately NOT imported here.
 * These two bands only guarantee a clean, ink-to-ink seam on both edges so the
 * pinned stage can fade in and out without ever flashing the page background.
 */

/** Fade up from the hero into the pinned stage. */
export function TimelineLeadIn() {
  return (
    <div className="relative overflow-hidden px-[--gutter] pt-[--space-32] pb-[--space-16]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[--space-24] bg-gradient-to-b from-ink to-transparent"
      />
      <div className="relative mx-auto w-full max-w-[--maxw]">
        <p className="label">1963 → today · nine chapters</p>
        <h2 className="mt-[--space-6] max-w-[--maxw-prose] font-display text-display-2 text-metal-100">
          Every 911, one continuous line
        </h2>
        <p className="mt-[--space-4] max-w-[--maxw-prose] text-body-2 text-metal-500">
          Nine generations, from the 901 prototype shown in Frankfurt in
          September 1963 to the T-Hybrid era. Scroll to travel; jump with the
          rail, or open any chapter directly.
        </p>
      </div>
    </div>
  );
}

/** Fade out of the pinned stage into whatever section follows. */
export function TimelineHandoff() {
  return (
    <section
      aria-label="End of the generation timeline"
      data-owner="scroll-timeline"
      data-handoff="hero"
      className="relative overflow-hidden border-t border-ink-4 px-[--gutter] pt-[--space-24] pb-[--space-24]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[--space-32] bg-gradient-to-b from-ink to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[--space-16] bg-gradient-to-t from-ink to-transparent"
      />

      <div className="relative mx-auto flex w-full max-w-[--maxw] flex-col gap-[--space-8] md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-[--space-4]">
          <p className="label">End of the scroll · six decades</p>
          <h2
            className="font-display text-display-2 text-transparent"
            style={
              {
                WebkitTextStroke: "1px var(--color-metal-700)",
              } as CSSProperties
            }
          >
            Nine chapters,
            <br />
            one silhouette
          </h2>
          <p className="max-w-[--maxw-prose] text-body-2 text-metal-500">
            Follow a generation into the archive to reach every variant, or put
            two of them side by side.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[--space-4]">
          <Link
            href="/compare"
            className="rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-3] font-mono text-mono-sm uppercase tracking-[--tracking-mono] text-metal-100 transition-colors duration-[--dur-base] hover:border-metal-500 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Compare generations →
          </Link>
          <Link
            href="/credits"
            className="label rounded-[--radius-sm] px-[--space-2] py-[--space-3] hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Image credits
          </Link>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="relative mt-[--space-16] h-px w-full"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--color-guards) 0%, ${withAlpha("#d5001c", 0.25)} 24%, var(--color-ink-4) 60%, transparent 100%)`,
        }}
      />
    </section>
  );
}