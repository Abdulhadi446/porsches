import type { Metadata } from "next";
import Link from "next/link";
import { GENERATIONS, getGeneration } from "#lib/generations";

/**
 * 404 for `/911/<generation>` and `/911/<generation>/<variant>`.
 *
 * Segment-level `not-found.tsx` catches `notFound()` from both nested routes,
 * and it stays useful: it offers the generation the visitor was probably after
 * plus the neighbouring ones, rather than a bare "not found".
 */

export const metadata: Metadata = { title: "Not in the catalogue" };

export default async function GenerationNotFound({
  params,
}: {
  // Next renders a segment `not-found` without params when the failure did not
  // come from a loader, so this has to tolerate `undefined`.
  params?: Promise<{ generation?: string }>;
}) {
  const resolved = params ? await params : undefined;
  const gen = resolved?.generation ? getGeneration(resolved.generation) : undefined;
  const position = gen
    ? GENERATIONS.findIndex((entry) => entry.id === gen.id)
    : -1;
  const neighbours = [
    position > 0 ? GENERATIONS[position - 1] : null,
    gen,
    position >= 0 && position < GENERATIONS.length - 1 ? GENERATIONS[position + 1] : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const suggestions = neighbours.length > 0 ? neighbours : GENERATIONS.slice(0, 4);

  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto w-full max-w-[--maxw]">
        <p className="label">404</p>
        <h1 className="text-display-2 mt-[--space-4] max-w-[20ch] text-metal-100">
          {gen ? `${gen.code} exists — that variant does not` : "Unknown 911"}
        </h1>
        <p className="mt-[--space-6] max-w-[--maxw-prose] text-body-2 text-metal-500">
          Every generation and variant on this site is generated at build time from the
          catalogue, so a missing id is a real missing id — not a slow query. Here is
          where you probably wanted to go.
        </p>

        {gen ? (
          <Link
            href={`/911/${gen.id}`}
            className="mt-[--space-8] inline-flex items-center gap-[--space-3] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-3] font-mono text-mono-sm uppercase tracking-[--tracking-mono] text-metal-100 transition-colors hover:border-metal-500 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Back to the {gen.code} index
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}

        <ul className="mt-[--space-12] grid grid-cols-2 gap-px border border-ink-4 bg-ink-4 sm:grid-cols-3 lg:grid-cols-5">
          {suggestions.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/911/${entry.id}`}
                className="flex h-full flex-col gap-1 bg-ink-2 p-[--space-4] transition-colors hover:bg-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                <span className="font-display text-display-3 leading-none tracking-[--tracking-display] text-metal-100">
                  {entry.code}
                </span>
                <span className="label">
                  {entry.yearsStart}–{entry.yearsEnd ?? "today"} · {entry.variants.length}{" "}
                  variants
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-[--space-8] text-body-2 text-metal-500">
          <Link
            href="/911"
            className="rounded-[--radius-sm] underline decoration-ink-4 underline-offset-4 transition-colors hover:text-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            All nine generations
          </Link>
        </p>
      </div>
    </div>
  );
}