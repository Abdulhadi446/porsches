import Link from "next/link";
import type { Generation } from "#data/schema";
import { getImage } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { cx, yearRange } from "./lib/format";

/**
 * `/911` — the cinematic index of all nine generations.
 *
 * Alternating spans (6 / 4 / 4 / 2) so the page reads as a sequence rather
 * than a uniform table, with the giant outlined code as the anchor of each
 * card. Pure server component: nine cards, no client JavaScript.
 */

export interface GenerationGridProps {
  generations: Generation[];
  /** variant id totals per generation id, for the card counters */
  totals: Record<string, number>;
  /** curated video counts per generation id */
  videoCounts: Record<string, number>;
}

export function GenerationGrid({ generations, totals, videoCounts }: GenerationGridProps) {
  const totalVariants = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const totalVideos = Object.values(videoCounts).reduce((sum, value) => sum + value, 0);

  return (
    <>
      <header className="relative isolate overflow-hidden border-b border-ink-4 px-[--gutter] pb-[--space-12] pt-[--space-24]">
        <p className="label">Unofficial showcase · 1963 → today</p>
        <h1 className="text-display-2 mt-[--space-4] max-w-[16ch] text-metal-100">
          Nine generations, {totalVariants} variants
        </h1>
        <p className="mt-[--space-6] max-w-[--maxw-prose] text-body-2 leading-relaxed text-metal-500">
          Every catalogue entry has its own page: the specification plate the source
          actually published, the archive frames we were able to licence, the films
          worth watching, and the neighbours it is worth comparing against. Nothing here
          is invented — where a figure is not published, the page says so.
        </p>
        <dl className="spec-grid mt-[--space-10] grid grid-cols-2 gap-x-[--space-8] gap-y-[--space-4] sm:grid-cols-4">
          <div>
            <dt className="label">Generations</dt>
            <dd data-spec className="text-display-3 text-guards-text">
              {generations.length}
            </dd>
          </div>
          <div>
            <dt className="label">Variants</dt>
            <dd data-spec className="text-display-3 text-metal-100">
              {totalVariants}
            </dd>
          </div>
          <div>
            <dt className="label">Verified films</dt>
            <dd data-spec className="text-display-3 text-metal-100">
              {totalVideos}
            </dd>
          </div>
          <div>
            <dt className="label">Span</dt>
            <dd data-spec className="text-display-3 text-metal-100">
              {yearRange(
                Math.min(...generations.map((generation) => generation.yearsStart)),
                // `null` end = still in production today
                Math.max(
                  ...generations.map((generation) => generation.yearsEnd ?? 2026),
                ),
              )}
            </dd>
          </div>
        </dl>
      </header>

      <div className="px-[--gutter] py-[--space-16]">
        <ul className="mx-auto grid w-full max-w-[--maxw] grid-cols-1 gap-[--space-4] md:grid-cols-6">
          {generations.map((generation, index) => {
            const image = getImage(
              generation.heroImage ?? generation.timelineImage,
              { alt: `${generation.code} ${generation.name}` },
            );
            const span =
              index === 0
                ? "md:col-span-6"
                : index % 3 === 1
                  ? "md:col-span-4"
                  : "md:col-span-2";
            const tall = span === "md:col-span-2" ? "aspect-[3/4]" : "aspect-[16/9]";

            return (
              <li key={generation.id} className={span}>
                <Link
                  href={`/911/${generation.id}`}
                  className={cx(
                    "group relative isolate flex h-full flex-col justify-end overflow-hidden border border-ink-4 bg-ink-2 transition-colors hover:border-metal-500",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
                    tall,
                  )}
                >
                  <SafeImage
                    image={image}
                    decorative
                    fill
                    sizes={
                      index === 0
                        ? "(min-width: 768px) 92vw, 100vw"
                        : "(min-width: 768px) 44vw, 100vw"
                    }
                    className={cx(
                      "-z-10 object-cover transition-transform duration-[--dur-cinema] group-hover:scale-[1.05]",
                      image.fallback ? "opacity-40 grayscale" : "opacity-70",
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 -z-10"
                    style={{
                      backgroundImage:
                        "linear-gradient(to top, var(--color-ink) 2%, color-mix(in srgb, var(--color-ink) 35%, transparent) 55%, transparent 100%)",
                    }}
                  />

                  <p
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-[--space-4] top-[-0.15em] select-none font-display text-[clamp(3.5rem,9vw,7rem)] leading-[0.8] tracking-[--tracking-display] text-transparent opacity-70"
                    style={{ WebkitTextStroke: `1px ${generation.accent}` }}
                  >
                    {generation.code}
                  </p>

                  <span className="flex flex-col gap-[--space-2] p-[--space-5]">
                    <span className="label">
                      {String(generation.index).padStart(2, "0")} ·{" "}
                      {yearRange(generation.yearsStart, generation.yearsEnd)}
                    </span>
                    <span className="font-display text-display-3 leading-none tracking-[--tracking-display] text-metal-100">
                      {generation.name}
                    </span>
                    {generation.tagline ? (
                      <span className="max-w-[46ch] text-body-2 leading-snug text-metal-500">
                        {generation.tagline}
                      </span>
                    ) : null}
                    <span className="mt-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700">
                      {totals[generation.id] ?? 0} variants ·{" "}
                      {videoCounts[generation.id] ?? 0} films
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}