"use client";

import type { SpecRow } from "./lib/specs";
import { DASH, cx, formatNumber, leadFigure } from "./lib/format";
import { useCountUp, useInView, useReducedMotion } from "./lib/hooks";
import { Eyebrow, Reveal } from "./reveal";

/**
 * Section (b) — the spec plate.
 *
 * The rows are computed on the server (`buildSpecRows`), this component only
 * animates the leading figure of each row. Guarantees:
 *
 *  - numerals are mono + tabular (`data-spec` in globals.css applies
 *    `font-variant-numeric: tabular-nums`), so nothing reflows while counting;
 *  - a dash is a dash. There is no fallback figure, no interpolation from a
 *    neighbouring variant, no "N/A" invented from a sibling;
 *  - the count is `aria-hidden` with a static, screen-reader-only copy of the
 *    final value, so assistive tech never reads "1,2,9,9,1,5";
 *  - reduced motion renders the final value on first paint — the number is
 *    correct before the tween would even start.
 */

export interface SpecCountersProps {
  rows: SpecRow[];
  accent: string;
  headingId: string;
  /** short line under the heading */
  lede?: string;
}

export function SpecCounters({ rows, accent, headingId, lede }: SpecCountersProps) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -8% 0px" });

  return (
    <section
      id="specs"
      aria-labelledby={headingId}
      className="scroll-mt-(--space-16) px-(--gutter) py-(--space-16) md:py-(--space-24)"
    >
      <div className="mx-auto w-full max-w-(--maxw)">
        <Eyebrow accent={accent}>Specification plate</Eyebrow>
        <h2 id={headingId} className="mt-(--space-3) text-display-3 text-metal-100">
          Numbers as published
        </h2>
        {lede ? (
          <p className="mt-(--space-4) max-w-(--maxw-prose) text-body-2 text-metal-500">
            {lede}
          </p>
        ) : null}

        <div ref={ref}>
          <dl className="mt-(--space-8) grid grid-flow-row-dense grid-cols-1 gap-px border border-ink-4 bg-ink-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <SpecCell
                key={row.key}
                row={row}
                accent={accent}
                active={inView}
                reduced={reduced}
              />
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function SpecCell({
  row,
  accent,
  active,
  reduced,
}: {
  row: SpecRow;
  accent: string;
  active: boolean;
  reduced: boolean;
}) {
  const count = row.count?.value ?? null;
  const decimals = row.count?.decimals ?? 0;
  const animated = useCountUp(count, {
    active,
    reduced,
    decimals,
    format: formatNumber,
  });
  const finalText = count === null ? DASH : formatNumber(count, decimals);

  return (
    <div
      className={cx(
        "flex min-h-[9rem] flex-col gap-(--space-2) bg-ink-2 p-(--space-5)",
        row.wide && "sm:col-span-2 lg:col-span-2",
      )}
    >
      <dt className="label">{row.label}</dt>

      <dd className="flex flex-1 flex-col gap-(--space-2)">
        {row.count ? (
          <p
            data-spec
            className="font-mono text-[clamp(1.5rem,3vw,2.25rem)] leading-none text-metal-100"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span aria-hidden="true" style={{ color: accent }}>
              {animated}
              {row.count.suffix ? (
                <span className="ml-1 text-[0.45em] uppercase tracking-(--tracking-mono) text-metal-500">
                  {row.count.suffix}
                </span>
              ) : null}
            </span>
            <span className="sr-only">{`${finalText}${row.count.suffix ? ` ${row.count.suffix}` : ""}`}</span>
          </p>
        ) : (
          <p
            data-spec
            className={cx(
              "font-mono leading-snug",
              row.missing
                ? "text-[clamp(1.5rem,3vw,2.25rem)] leading-none text-metal-700"
                : "text-mono-md text-metal-100",
            )}
          >
            {row.value}
          </p>
        )}

        {row.count && row.detail && row.detail !== row.value ? (
          <p className="font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
            {row.detail}
          </p>
        ) : null}

        {row.missing ? (
          <p className="font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-700">
            {row.note ? `Not published: ${row.note}` : "Not published in the source data"}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Generation-level stat strip (used on the generation landing). Same
 * contract as the variant plate: leading figure counts, rest is quoted.
 */
export function StatCounters({
  stats,
  accent,
  headingId,
}: {
  stats: Array<{ label: string; value: string }>;
  accent: string;
  headingId: string;
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -8% 0px" });

  return (
    <section aria-labelledby={headingId} className="px-(--gutter) py-(--space-12)">
      <div className="mx-auto w-full max-w-(--maxw)">
        <h2 id={headingId} className="sr-only">
          Generation summary figures
        </h2>
        <div ref={ref} className="grid grid-cols-1 gap-px border border-ink-4 bg-ink-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <GenerationStat
              key={stat.label}
              label={stat.label}
              value={stat.value}
              accent={accent}
              active={inView}
              reduced={reduced}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function GenerationStat({
  label,
  value,
  accent,
  active,
  reduced,
}: {
  label: string;
  value: string;
  accent: string;
  active: boolean;
  reduced: boolean;
}) {
  const figure = leadFigure(value);
  const animated = useCountUp(figure ? figure.value : null, {
    active,
    reduced,
    decimals: figure?.decimals ?? 0,
    format: formatNumber,
  });

  return (
    <Reveal className="flex flex-col gap-(--space-3) bg-ink-2 p-(--space-5)">
      <p className="label">{label}</p>
      {figure ? (
        <p
          data-spec
          className="font-mono text-[clamp(1.5rem,3vw,2.25rem)] leading-none text-metal-100"
        >
          <span aria-hidden="true" style={{ color: accent }}>
            {animated}
          </span>
          <span className="sr-only">{formatNumber(figure.value, figure.decimals)}</span>
          <span className="mt-(--space-2) block text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
            {figure.rest}
          </span>
        </p>
      ) : (
        <p className="font-mono text-mono-sm leading-relaxed tracking-(--tracking-mono) text-metal-100">
          {value}
        </p>
      )}
    </Reveal>
  );
}
