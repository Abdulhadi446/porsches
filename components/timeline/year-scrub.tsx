"use client";

import { memo } from "react";
import { yearTicks } from "./format";

/**
 * The signature moment: a horizontal scrub through every year between the
 * first 901 and today, inside the pinned sequence.
 *
 * motion mode  — `[data-ts-scrub-track]` is translated by the master timeline
 *                (`ease: "none"`), and `[data-ts-readout]` gets a mechanical
 *                odometer value written on tween update.
 * static mode  — the viewport falls back to native `overflow-x` scrolling.
 *
 * Decorative: the whole layer is `aria-hidden`; the same information is
 * available as real links in <ProgressRail> and <TimelineIndex>.
 */
export interface YearScrubProps {
  start: number;
  end: number;
  chapters: number;
}

function YearScrub({ start, end, chapters }: YearScrubProps) {
  const ticks = yearTicks(start, end);

  return (
    <div
      data-ts-scrub
      aria-hidden="true"
      className="relative flex flex-col justify-center gap-[--space-6] overflow-hidden border-y border-ink-4 py-[--space-12] opacity-100 data-[motion=on]:absolute data-[motion=on]:inset-0 data-[motion=on]:border-y-0 data-[motion=on]:py-0 data-[motion=on]:invisible data-[motion=on]:opacity-0"
    >
      <div className="flex items-center gap-[--space-4] px-[--gutter]">
        <span className="label">Every year</span>
        <span aria-hidden="true" className="h-px flex-1 bg-ink-4" />
        <span className="label text-metal-300">
          {start} → {end}
        </span>
      </div>

      <div className="relative overflow-x-auto overflow-y-hidden py-[--space-4] data-[motion=on]:overflow-hidden">
        <div
          data-ts-scrub-track
          className="flex w-max items-end gap-[--space-6] pr-[--gutter] pl-[--gutter] will-change-transform data-[motion=on]:pr-[50vw] data-[motion=on]:pl-[50vw]"
        >
          {ticks.map((tick) => (
            <span
              key={tick.year}
              className={`flex shrink-0 flex-col items-center gap-[--space-1] font-display leading-none ${
                tick.decade
                  ? "text-display-3 text-metal-700"
                  : "text-[clamp(1.5rem,3.4vw,3rem)] text-ink-4"
              }`}
            >
              {tick.decade ? (
                <span className="font-mono text-mono-xs tracking-[--tracking-mono] text-guards uppercase">
                  {tick.caption}
                </span>
              ) : null}
              {tick.year}
            </span>
          ))}
        </div>

        {/* needle the years slide under */}
        <span className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-guards data-[motion=on]:block" />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 hidden h-px bg-ink-4 data-[motion=on]:block"
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-[--space-6] px-[--gutter]">
        <p className="label max-w-[--maxw-prose]">
          {chapters} generations · one silhouette · {end - start + 1} years of
          compromise, iteration and obsession
        </p>
        <p className="flex items-baseline gap-[--space-3] border border-ink-4 bg-ink/70 px-[--space-4] py-[--space-2]">
          <span className="label">Readout</span>
          <span
            data-ts-readout
            className="font-mono text-mono-md text-guards tabular-nums"
          >
            {start}
          </span>
        </p>
      </div>
    </div>
  );
}

export const TimelineYearScrub = memo(YearScrub);