"use client";

import Link from "next/link";
import { memo, type CSSProperties } from "react";
import type { Generation } from "#data/schema";
import { getImage } from "#lib/assets";
import { YearNumeral } from "./year-numeral";
import {
  chapterOrdinal,
  eraStamp,
  withAlpha,
  yearLabel,
} from "./format";

/**
 * One generation chapter.
 *
 * Layout contract — the same markup serves both modes:
 *   static  (`data-motion="off"`, or no JS): full-height stacked sections
 *   motion  (`data-motion="on"`): all chapters share one 100dvh grid cell and
 *           the master ScrollTrigger timeline cross-fades them in place.
 *
 * Chapters 2..n ship hidden so the first paint is never a stack of nine
 * overlapping sections; `data-[motion=off]:*` puts them back for the
 * no-JS / reduced-motion layout.
 */
export interface ChapterProps {
  generation: Generation;
  index: number;
  total: number;
}

function Chapter({ generation, index, total }: ChapterProps) {
  const image = getImage(generation.timelineImage ?? generation.heroImage);
  const headlineId = `gen-${generation.id}-title`;
  const stats = generation.stats ?? [];

  return (
    <article
      id={`gen-${generation.id}`}
      aria-labelledby={headlineId}
      data-ts-chapter
      data-generation={generation.id}
      style={
        {
          "--chapter-accent": generation.accent,
        } as CSSProperties
      }
      className={`relative isolate flex min-h-dvh scroll-mt-[--space-16] flex-col justify-end px-[--gutter] pb-[--space-16] pt-[--space-24] data-[motion=on]:col-start-1 data-[motion=on]:row-start-1 md:justify-center md:py-[--space-24] [@media(max-height:760px)]:pb-[--space-8] [@media(max-height:760px)]:pt-[--space-16] ${
        index === 0
          ? ""
          : "invisible opacity-0 data-[motion=off]:visible data-[motion=off]:opacity-100"
      }`}
    >
      {/* ---------- per-chapter accent wash (carries the colour shift in
             static mode, where the shared backdrop is disabled) ---------- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundImage: `radial-gradient(120% 70% at 78% 10%, ${withAlpha(generation.accent, 0.22)} 0%, transparent 64%), radial-gradient(80% 60% at 4% 100%, ${withAlpha(generation.accent, 0.12)} 0%, transparent 60%)`,
        }}
      />
      {/* ---------- diagonal image drift (decorative) ---------- */}
      <div
        data-ts-drift
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 md:inset-y-[9%] md:left-auto md:right-[--gutter] md:top-1/2 md:w-[min(44vw,44rem)] md:-translate-y-1/2 md:rotate-[-1.6deg] md:border md:border-ink-4 md:bg-ink-2 md:shadow-[0_2rem_6rem_-2rem_var(--color-ink)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-ts-drift-img
            src={image.src}
            alt=""
            width={image.width ?? 1600}
            height={image.height ?? 900}
            loading={index < 2 ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover opacity-25 grayscale md:opacity-85"
            style={
              image.blurDataURL
                ? { backgroundImage: `url(${image.blurDataURL})` }
                : undefined
            }
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-tr from-ink via-ink/10 to-transparent"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(105deg, ${withAlpha(generation.accent, 0.18)} 0%, transparent 48%)`,
            }}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-[--space-3] border-t border-ink-4/70 bg-ink/70 px-[--space-3] py-[--space-2] font-mono text-mono-xs tracking-[--tracking-mono] text-metal-500 uppercase">
            <span>{generation.code}</span>
            <span className="truncate">{image.fallback ? "Imagery pending" : "Archive plate"}</span>
          </div>
        </div>
      </div>

      {/* ---------- legibility scrim ---------- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-ink/55 md:bg-gradient-to-r md:from-ink md:via-ink/85 md:to-transparent"
      />

      <YearNumeral year={generation.yearsStart} />

      {/* ---------- copy column ---------- */}
      <div className="relative mx-auto flex w-full max-w-[--maxw] flex-col gap-[--space-4] [@media(max-height:760px)]:gap-[--space-3] md:max-w-[min(46rem,58%)] md:gap-[--space-6]">
        <p className="label flex flex-wrap items-center gap-x-[--space-3] gap-y-1">
          <span style={{ color: generation.accent }}>
            {chapterOrdinal(index, total)}
          </span>
          <span aria-hidden="true" className="h-px w-8 bg-ink-4" />
          <span>{generation.code}</span>
          <span aria-hidden="true" className="text-ink-4">
            /{generation.eraType === "mono" ? "mono" : "display"} era
          </span>
          <span className="text-metal-300">
            {yearLabel(generation.yearsStart, generation.yearsEnd)}
          </span>
        </p>

        <div className="flex flex-col gap-[--space-3]">
          <h2
            id={headlineId}
            className="font-display text-display-2 text-metal-100 [@media(max-height:760px)]:text-display-3"
          >
            {generation.name}
          </h2>
          {generation.tagline ? (
            <p className="max-w-[--maxw-prose] font-display text-display-3 leading-[1.02] text-metal-300">
              {generation.tagline}
            </p>
          ) : null}
        </div>

        {generation.description ? (
          <p className="line-clamp-4 max-w-[--maxw-prose] text-body-2 text-metal-500">
            {generation.description.split("\n\n")[0]}
          </p>
        ) : null}

        {stats.length > 0 ? (
          <dl className="spec-grid grid grid-cols-2 gap-x-[--space-6] gap-y-[--space-3] border-t border-ink-4 pt-[--space-4] sm:grid-cols-3">
            {stats.slice(0, 6).map((stat) => (
              <div key={stat.label} className="flex flex-col gap-1">
                <dt className="label">{stat.label}</dt>
                <dd
                  className="text-mono-md text-metal-100"
                  style={{ color: generation.accent }}
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-[--space-6] gap-y-[--space-3] pt-[--space-2]">
          <Link
            href={`/911/${generation.id}`}
            className="group inline-flex items-center gap-[--space-3] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-3] font-mono text-mono-sm uppercase tracking-[--tracking-mono] text-metal-100 transition-[background-color,border-color,color] duration-[--dur-base] hover:border-metal-500 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Explore the {generation.code}
            <span
              aria-hidden="true"
              className="transition-transform duration-[--dur-base] group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
          {generation.variants.length > 0 ? (
            <p className="font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
              {generation.variants.length} variants catalogued
            </p>
          ) : null}
        </div>
      </div>

      {/* ---------- era typographic accent (decorative, scrubs in) ---------- */}
      <p
        data-ts-era
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-0 top-[--space-8] origin-left px-[--gutter] text-center font-display text-[clamp(2.5rem,11vw,9rem)] leading-[0.9] uppercase opacity-0 mix-blend-screen select-none text-transparent data-[motion=off]:visible data-[motion=off]:opacity-20 md:inset-y-0 md:top-0 md:flex md:items-center md:text-right md:text-[clamp(3rem,13vw,11rem)]"
        style={{ WebkitTextStroke: "1px var(--chapter-accent)" }}
      >
        {eraStamp(generation)}
      </p>
    </article>
  );
}

export const TimelineChapter = memo(Chapter);