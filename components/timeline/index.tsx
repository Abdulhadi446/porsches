import Link from "next/link";
import { GENERATIONS } from "#lib/generations";

/** STUB — owned by SCROLL-TIMELINE subagent (pinned ScrollTrigger chapters). */
export function Timeline() {
  return (
    <section
      className="relative px-[--gutter] py-[--space-32]"
      data-owner="scroll-timeline"
      aria-label="Generation timeline"
    >
      <div className="mx-auto max-w-[--maxw]">
        <p className="label mb-8">The timeline</p>
        <ol className="divide-y divide-ink-4 border-y border-ink-4">
          {GENERATIONS.map((g) => (
            <li key={g.id}>
              <Link
                href={`/911/${g.id}`}
                className="group flex items-baseline justify-between gap-6 py-6 transition-colors hover:bg-ink-2"
                style={{ ["--accent" as string]: g.accent }}
              >
                <span className="font-display text-display-3 transition-transform duration-[--dur-base] group-hover:translate-x-2">
                  {g.code}
                </span>
                <span className="label">{g.name}</span>
                <span className="font-mono text-mono-sm text-metal-500">
                  {g.yearsStart}–{g.yearsEnd ?? "today"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
