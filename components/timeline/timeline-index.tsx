"use client";

import Link from "next/link";
import { memo } from "react";
import type { ClientGeneration as Generation } from "#lib/client-catalog";
import { chapterOrdinal, yearLabel } from "./format";

/**
 * Always-rendered generation index.
 *
 * This is the durable, dependency-free half of the experience: a real
 * `<nav><ol>` of links to `/911/{id}` that works with JS, without JS, and
 * under `prefers-reduced-motion`. The pinned sequence is pure enhancement on
 * top of it.
 */
export interface TimelineIndexProps {
  generations: Generation[];
}

function TimelineIndex({ generations }: TimelineIndexProps) {
  return (
    <nav
      aria-label="All 911 generations"
      className="relative border-t border-ink-4 px-(--gutter) py-(--space-16)"
    >
      <div className="mx-auto w-full max-w-(--maxw)">
        <div className="mb-(--space-8) flex flex-wrap items-baseline justify-between gap-(--space-4)">
          <h2 className="font-display text-display-3 text-metal-100">
            The index
          </h2>
          <p className="label">
            {generations.length} generations · 1963 → today
          </p>
        </div>

        <ol className="divide-y divide-ink-4 border-y border-ink-4">
          {generations.map((generation, index) => (
            <li key={generation.id}>
              <Link
                href={`/911/${generation.id}`}
                className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-x-(--space-4) gap-y-1 py-(--space-4) transition-colors duration-(--dur-base) hover:bg-ink-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-guards md:grid-cols-[4rem_9rem_1fr_10rem_auto]"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-mono-xs tracking-(--tracking-mono) text-metal-700"
                >
                  {chapterOrdinal(index, generations.length)}
                </span>
                <span className="font-display text-display-3 leading-none transition-transform duration-(--dur-base) group-hover:translate-x-1 md:text-display-3">
                  {generation.code}
                </span>
                <span className="col-span-2 text-body-2 text-metal-500 md:col-span-1">
                  {generation.name}
                </span>
                <span className="font-mono text-mono-sm tracking-(--tracking-mono) text-metal-300">
                  {yearLabel(generation.yearsStart, generation.yearsEnd)}
                </span>
                <span className="flex items-center gap-(--space-3)">
                  <span
                    aria-hidden="true"
                    className="hidden h-px w-8 transition-[width,background-color] duration-(--dur-base) group-hover:w-12 md:inline-block"
                    style={{ backgroundColor: generation.accent }}
                  />
                  <span className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700 group-hover:text-metal-300">
                    {generation.variants.length > 0
                      ? `${generation.variants.length} variants`
                      : "Open"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

export const TimelineGenerationIndex = memo(TimelineIndex);