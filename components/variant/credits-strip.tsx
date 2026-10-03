import Link from "next/link";
import type { CreditRow, ModelAttribution } from "./lib/credits";

/**
 * Section (g) — the credits strip for this variant's own media.
 *
 * Server-rendered on purpose: attribution should be in the HTML, not behind a
 * disclosure that a crawler or a reader without JS never sees.
 *
 * `data/credits.json` is empty until ASSET-IMAGES lands its records, and every
 * `ImageRef.creditId` currently resolves to nothing — so the strip has a real
 * empty state rather than a spinner or a blank band. Unresolvable ids are
 * dropped instead of rendered as empty rows.
 */

export interface CreditsStripProps {
  rows: CreditRow[];
  attribution: ModelAttribution | null;
  headingId: string;
  accent: string;
}

export function CreditsStrip({ rows, attribution, headingId, accent }: CreditsStripProps) {
  const empty = rows.length === 0 && !attribution;

  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-[--space-16] border-t border-ink-4 px-[--gutter] py-[--space-12]"
    >
      <div className="mx-auto w-full max-w-[--maxw]">
        <div className="flex flex-wrap items-end justify-between gap-[--space-4]">
          <div>
            <p className="label flex items-center gap-[--space-3]">
              <span
                aria-hidden="true"
                className="inline-block h-px w-8"
                style={{ backgroundColor: accent }}
              />
              Credits
            </p>
            <h2 id={headingId} className="mt-[--space-3] text-display-3 text-metal-100">
              Media on this page
            </h2>
          </div>
          <Link
            href="/credits"
            className="label inline-flex items-center gap-[--space-2] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-2] transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Full licence register →
          </Link>
        </div>

        {empty ? (
          <p className="mt-[--space-6] max-w-[--maxw-prose] font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-500">
            Nothing third-party is embedded on this page yet — the hero frame is the
            site&apos;s own placeholder and the videos are YouTube embeds, which are
            linked rather than rehosted. Every asset that does ship gets an author and a
            licence recorded in /credits.
          </p>
        ) : (
          <ul className="mt-[--space-6] grid grid-cols-1 gap-[--space-3] md:grid-cols-2">
            {rows.map((row) => (
              <li
                key={row.credit.assetId}
                className="border border-ink-4 bg-ink-2 p-[--space-4]"
              >
                <p className="label">{row.context}</p>
                <p className="mt-[--space-2] text-body-2 text-metal-100">
                  {row.credit.author ?? "Author unrecorded"}
                </p>
                <p className="mt-1 font-mono text-mono-xs tracking-[--tracking-mono] text-metal-500">
                  {[row.credit.license, row.credit.source].filter(Boolean).join(" · ")}
                </p>
                <a
                  href={row.credit.url}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="mt-[--space-2] inline-block font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 underline decoration-ink-4 underline-offset-4 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  Source
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
            {attribution ? (
              <li className="border border-ink-4 bg-ink-2 p-[--space-4]">
                <p className="label">3D model</p>
                <p className="mt-[--space-2] text-body-2 text-metal-100">
                  {attribution.author ?? "Author unrecorded"}
                </p>
                <p className="mt-1 font-mono text-mono-xs tracking-[--tracking-mono] text-metal-500">
                  {[attribution.license, attribution.sourceId].filter(Boolean).join(" · ")}
                </p>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}