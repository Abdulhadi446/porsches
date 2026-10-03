"use client";

import { memo, type MouseEvent } from "react";
import type { ClientGeneration as Generation } from "#lib/client-catalog";
import { chapterAnnouncement, yearLabel } from "./format";

/**
 * Fixed side rail: nine era markers that double as keyboard-accessible nav
 * links to the chapter anchors.
 *
 * Progressive enhancement: these are plain `<a href="#gen-…">` elements, so
 * with JS / GSAP / Lenis unavailable they simply jump. No JS is required for
 * the rail to exist or work.
 *
 * Compact (below `lg`, or very short) viewports get a thin decorative progress
 * bar instead; the accessible list is always in the DOM either way.
 */
export interface ProgressRailProps {
  generations: Generation[];
  /** index of the chapter in view, or -1 during the horizontal year sweep */
  activeIndex: number;
  /** false while the pinned sequence is off screen (motion mode only) */
  visible: boolean;
  onJump: (event: MouseEvent<HTMLAnchorElement>, generation: Generation) => void;
}

function ProgressRail({
  generations,
  activeIndex,
  visible,
  onJump,
}: ProgressRailProps) {
  const total = generations.length;
  const swept = activeIndex < 0;
  const fill = total > 0 ? ((Math.max(activeIndex, 0) + 1) / total) * 100 : 0;
  const active = swept ? undefined : generations[activeIndex];

  return (
    <>
      <nav
        aria-label="Timeline: jump to a generation"
        data-off={visible ? undefined : ""}
        className="pointer-events-none fixed inset-y-0 right-0 z-[var(--z-nav)] hidden w-(--space-32) items-center justify-center pr-(--space-4) transition-opacity duration-(--dur-base) data-[off]:invisible data-[off]:opacity-0 [@media(max-height:560px)]:hidden lg:flex xl:w-(--space-24)"
      >
        <ol className="pointer-events-auto flex flex-col gap-(--space-2)">
          {generations.map((generation, index) => {
            const isActive = !swept && index === activeIndex;
            return (
              <li key={generation.id} className="flex justify-end">
                <a
                  href={`#gen-${generation.id}`}
                  onClick={(event) => onJump(event, generation)}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${generation.code}, ${yearLabel(generation.yearsStart, generation.yearsEnd)}`}
                  className="group flex items-center gap-(--space-3) rounded-(--radius-sm) py-1 pl-(--space-2) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  <span
                    aria-hidden="true"
                    className={`font-mono text-mono-xs tracking-(--tracking-mono) transition-colors duration-(--dur-fast) ${
                      isActive
                        ? "text-metal-100"
                        : "text-metal-700 group-hover:text-metal-300"
                    }`}
                  >
                    {generation.yearsStart}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-px transition-[width,background-color] duration-(--dur-base) group-hover:w-10 group-focus-visible:w-10 ${
                      isActive ? "w-10" : "w-5"
                    }`}
                    style={{
                      backgroundColor: isActive
                        ? generation.accent
                        : "var(--color-ink-4)",
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`w-14 text-right font-mono text-mono-xs uppercase tracking-(--tracking-mono) transition-[color,opacity] duration-(--dur-fast) ${
                      isActive
                        ? "text-metal-100 opacity-100"
                        : "text-metal-500 opacity-60 group-hover:opacity-100"
                    }`}
                  >
                    {generation.code}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* compact viewports: decorative progress bar only */}
      <div
        aria-hidden="true"
        data-off={visible ? undefined : ""}
        className="pointer-events-none fixed top-1/2 right-0 z-[var(--z-sticky)] h-[34dvh] w-px -translate-y-1/2 bg-ink-4 transition-opacity duration-(--dur-base) data-[off]:opacity-0 lg:hidden"
      >
        <span
          className="absolute inset-x-0 top-0 bg-guards transition-[height] duration-(--dur-base)"
          style={{ height: `${fill}%` }}
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {swept
          ? "Sweeping the years from the first 911 to today."
          : active
            ? chapterAnnouncement(active, activeIndex, total)
            : ""}
      </p>
    </>
  );
}

export const TimelineProgressRail = memo(ProgressRail);