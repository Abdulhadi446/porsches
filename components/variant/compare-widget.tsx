import Link from "next/link";
import type { Variant } from "#data/schema";
import { compareHref, type Sibling } from "./lib/siblings";
import { DIFF_LABELS, diffCells, diffRowKeys } from "./lib/specs";
import { cx } from "./lib/format";

/**
 * Section (f) — "compare with".
 *
 * Deliberately a **server** component: it is a table and a set of links, so it
 * costs zero client JavaScript on a page that already has a 3D viewer.
 *
 * Neighbour selection lives in `lib/siblings.ts` (body style, drivetrain,
 * transmission family, year distance, power distance — all from the data, all
 * deterministic). The table shows the compact leading figure per cell and
 * highlights rows where the variants actually disagree, so the widget answers
 * "what is different?" rather than reprinting four spec plates.
 */

export interface CompareWidgetProps {
  generation: { id: string; code: string };
  variant: Variant;
  variantKey: string;
  siblings: Sibling[];
  accent: string;
  headingId: string;
}

export function CompareWidget({
  generation,
  variant,
  variantKey,
  siblings,
  accent,
  headingId,
}: CompareWidgetProps) {
  if (siblings.length === 0) return null;

  const columns = [
    { key: variantKey, name: variant.name, years: variant.years, href: null as string | null },
    ...siblings.map((sibling) => ({
      key: sibling.key,
      name: sibling.variant.name,
      years: sibling.variant.years,
      href: sibling.href,
    })),
  ];

  const currentCells = diffCells(variant);
  const siblingCells = siblings.map((sibling) => diffCells(sibling.variant));
  const rows = diffRowKeys();

  const primary = siblings[0];

  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-[--space-16] bg-ink-2 px-[--gutter] py-[--space-16]"
    >
      <div className="mx-auto w-full max-w-[--maxw]">
        <p className="label flex items-center gap-[--space-3]">
          <span
            aria-hidden="true"
            className="inline-block h-px w-8"
            style={{ backgroundColor: accent }}
          />
          Compare
        </p>
        <h2 id={headingId} className="mt-[--space-3] text-display-3 text-metal-100">
          Set it against its neighbours
        </h2>

        <div className="mt-[--space-6] flex flex-wrap gap-[--space-3]">
          {siblings.map((sibling) => (
            <Link
              key={sibling.key}
              href={sibling.href}
              className={cx(
                "group flex flex-col gap-1 rounded-[--radius-md] border border-ink-4 bg-ink-3 px-[--space-4] py-[--space-3] transition-colors hover:border-metal-500",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
              )}
            >
              <span className="font-display text-mono-md uppercase tracking-[--tracking-display] text-metal-100">
                {sibling.variant.name}
              </span>
              <span className="font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
                {sibling.generation.id === generation.id
                  ? sibling.variant.years
                  : `${sibling.generation.code} · ${sibling.variant.years}`}
              </span>
              <span className="font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700">
                {sibling.reason}
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-[--space-8] overflow-x-auto border border-ink-4">
          <table className="spec-grid w-full min-w-[46rem] border-collapse text-left text-mono-sm tracking-[--tracking-mono]">
            <caption className="sr-only">
              Compact specification comparison between the {variant.name} and{" "}
              {siblings.map((sibling) => sibling.variant.name).join(", ")}
            </caption>
            <thead>
              <tr className="border-b border-ink-4">
                <th scope="col" className="label px-[--space-4] py-[--space-3]">
                  Spec
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-[--space-4] py-[--space-3] align-bottom"
                  >
                    {column.href ? (
                      <Link
                        href={column.href}
                        className="font-display text-mono-sm uppercase tracking-[--tracking-display] text-metal-100 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                      >
                        {column.name}
                      </Link>
                    ) : (
                      <span className="font-display text-mono-sm uppercase tracking-[--tracking-display] text-metal-100">
                        {column.name}
                        <span
                          aria-hidden="true"
                          className="mt-1 block h-px w-10"
                          style={{ backgroundColor: accent }}
                        />
                      </span>
                    )}
                    <span className="label mt-1 block font-normal">{column.years}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const values = [
                  currentCells[row] ?? "—",
                  ...siblingCells.map((cells) => cells[row] ?? "—"),
                ];
                const differs = new Set(values.map((value) => value.trim())).size > 1;
                return (
                  <tr key={row} className="border-b border-ink-4/70 last:border-0">
                    <th
                      scope="row"
                      className={cx(
                        "label px-[--space-4] py-[--space-3] align-top",
                        differs ? "text-metal-300" : "text-metal-700",
                      )}
                    >
                      {DIFF_LABELS[row] ?? row}
                      {differs ? null : (
                        <span className="sr-only"> — identical across all cars</span>
                      )}
                    </th>
                    {values.map((value, position) => (
                      <td
                        key={`${row}-${position}`}
                        data-spec
                        className={cx(
                          "px-[--space-4] py-[--space-3] align-top text-metal-300",
                          position === 0 && "bg-ink-3/60 text-metal-100",
                          differs ? "" : "text-metal-700",
                        )}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-[--space-6] flex flex-wrap items-center gap-[--space-4]">
          <Link
            href={compareHref(variantKey, primary.key)}
            className={cx(
              "inline-flex items-center gap-[--space-3] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-3] font-mono text-mono-sm uppercase tracking-[--tracking-mono] text-metal-100 transition-colors hover:border-metal-500 hover:bg-ink-3",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
            )}
          >
            Open the full comparison
            <span aria-hidden="true">→</span>
          </Link>
          <p className="label">
            Pairs load as /compare?a={variantKey}&b={primary.key}
          </p>
        </div>
      </div>
    </section>
  );
}