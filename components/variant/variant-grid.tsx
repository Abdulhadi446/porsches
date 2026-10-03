import Link from "next/link";
import type { Generation } from "#data/schema";
import { getImage } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { bodyStyleList, cx } from "./lib/format";

/**
 * The generation's variant grid — every variant, linked, never collapsed.
 *
 * Server-rendered, no client JavaScript: 162 static pages already ship enough
 * of it. Each card carries the figure that distinguishes it (years, power,
 * drivetrain) so the grid is scannable, and a `special` badge for the
 * homologation cars. Images come from `getImage()`, so a missing hero resolves
 * to the placeholder rather than a 404.
 */

export interface VariantGridProps {
  generation: Generation;
  accent: string;
  headingId: string;
}

export function VariantGrid({ generation, accent, headingId }: VariantGridProps) {
  const variants = generation.variants;

  return (
    <section
      id="variants"
      aria-labelledby={headingId}
      className="scroll-mt-(--space-16) px-(--gutter) py-(--space-16)"
    >
      <div className="mx-auto w-full max-w-(--maxw)">
        <div className="flex flex-wrap items-end justify-between gap-(--space-4)">
          <div>
            <p className="label flex items-center gap-(--space-3)">
              <span
                aria-hidden="true"
                className="inline-block h-px w-8"
                style={{ backgroundColor: accent }}
              />
              The range
            </p>
            <h2 id={headingId} className="mt-(--space-3) text-display-3 text-metal-100">
              {variants.length} variants
            </h2>
          </div>
          <p className="label">{generation.code} · every entry linked</p>
        </div>

        {variants.length === 0 ? (
          <p className="mt-(--space-8) font-mono text-mono-sm text-metal-500">
            Variant data for this generation has not been published yet.
          </p>
        ) : (
          <ul className="mt-(--space-8) grid grid-cols-1 gap-(--space-4) sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {variants.map((variant) => {
              const image = getImage(variant.heroImage, {
                alt: `${variant.name} — ${variant.years}`,
              });
              return (
                <li key={variant.id}>
                  <Link
                    href={`/911/${generation.id}/${variant.id}`}
                    className={cx(
                      "group flex h-full flex-col overflow-hidden border border-ink-4 bg-ink-2 transition-colors hover:border-metal-500",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
                    )}
                  >
                    <span className="relative block aspect-[3/2] w-full overflow-hidden bg-ink-3">
                      <SafeImage
                        image={image}
                        decorative
                        fill
                        sizes="(min-width: 1280px) 24vw, (min-width: 640px) 44vw, 92vw"
                        className={cx(
                          "object-cover transition-transform duration-(--dur-slow) group-hover:scale-[1.04]",
                          image.fallback && "opacity-45 grayscale",
                        )}
                      />
                      {variant.special ? (
                        <span
                          className="absolute left-(--space-2) top-(--space-2) rounded-(--radius-sm) px-(--space-2) py-1 font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-ink"
                          style={{ backgroundColor: accent }}
                        >
                          Limited
                        </span>
                      ) : null}
                    </span>

                    <span className="flex flex-1 flex-col gap-(--space-2) p-(--space-4)">
                      <span className="font-display text-mono-md uppercase leading-tight tracking-(--tracking-display) text-metal-100">
                        {variant.name}
                      </span>
                      <span className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500">
                        {variant.years}
                      </span>
                      <span className="font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
                        {variant.power}
                      </span>
                      <span className="mt-auto flex flex-wrap items-center gap-x-(--space-3) gap-y-1 pt-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700">
                        {variant.drivetrain ?? "drivetrain —"}
                        <span aria-hidden="true">·</span>
                        {bodyStyleList(variant.bodyStyles)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}