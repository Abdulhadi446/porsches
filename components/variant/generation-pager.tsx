import Link from "next/link";
import type { Generation } from "#data/schema";
import { cx } from "./lib/format";

/**
 * Previous / next generation pager + the jump back to the timeline.
 *
 * Computed from the `index` field in timeline order (never from array order
 * heuristics), so the pager always walks 901 → 992.2 and wraps at the ends.
 */

export interface GenerationPagerProps {
  generation: Generation;
  previous: Generation | null;
  next: Generation | null;
}

export function GenerationPager({ generation, previous, next }: GenerationPagerProps) {
  return (
    <nav
      aria-label="Generation navigation"
      className="border-t border-ink-4 bg-ink-2 px-(--gutter) py-(--space-12)"
    >
      <div className="mx-auto flex w-full max-w-(--maxw) flex-col gap-(--space-6) lg:flex-row lg:items-stretch lg:justify-between">
        {previous ? (
          <PagerLink generation={previous} direction="previous" />
        ) : (
          <span aria-hidden="true" className="hidden lg:block" />
        )}

        <div className="flex flex-col items-start gap-(--space-2) lg:items-center">
          <p className="label">You are at {generation.code}</p>
          <Link
            href="/#timeline"
            className={cx(
              "inline-flex min-h-11 items-center gap-(--space-3) rounded-(--radius-sm) border border-ink-4 px-4 py-3 font-mono text-mono-sm uppercase tracking-(--tracking-mono) text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
            )}
          >
            <span aria-hidden="true">↑</span>
            Back to the timeline
          </Link>
          <Link
            href="/911"
            className="label inline-flex min-h-6 items-center rounded-(--radius-sm) px-3 py-1 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            All nine generations
          </Link>
        </div>

        {next ? <PagerLink generation={next} direction="next" /> : <span aria-hidden="true" className="hidden lg:block" />}
      </div>
    </nav>
  );
}

function PagerLink({
  generation,
  direction,
}: {
  generation: Generation;
  direction: "previous" | "next";
}) {
  const isNext = direction === "next";
  return (
    <Link
      href={`/911/${generation.id}`}
      rel={isNext ? "next" : "prev"}
      className={cx(
        "group flex min-w-0 flex-1 flex-col gap-(--space-1) rounded-(--radius-md) border border-ink-4 bg-ink px-(--space-5) py-(--space-4) transition-colors hover:border-metal-500",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
        isNext ? "lg:items-end lg:text-right" : "lg:items-start",
      )}
    >
      <span className="label">
        {isNext ? "Next" : "Previous"} · {generation.yearsStart}–
        {generation.yearsEnd ?? "today"}
      </span>
      <span className="font-display text-display-3 leading-none tracking-(--tracking-display) text-metal-100">
        {generation.code}
      </span>
      <span className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500">
        {generation.name}
      </span>
      <span
        aria-hidden="true"
        className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700 transition-transform duration-(--dur-base) group-hover:text-metal-300"
        style={{ alignSelf: isNext ? "flex-end" : "flex-start" }}
      >
        {isNext ? "→" : "←"}
      </span>
    </Link>
  );
}