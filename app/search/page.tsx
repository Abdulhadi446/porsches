import type { Metadata } from "next";
import Link from "next/link";
import { PaletteLauncher } from "#components/nav/command-palette";
import {
  applyFilters,
  BODY_FACETS,
  DRIVE_FACETS,
  ENGINE_FACETS,
  filtersFromParams,
  filtersHref,
  GENERATION_INDEX,
  pageCount,
  pageSlice,
  PAGE_SIZE,
  setPage,
  toggleFilterValue,
  VARIANT_COUNT,
  YEAR_MAX,
  YEAR_MIN,
  type FilterGroup,
  type IndexedVariant,
  type VariantFilters,
} from "#components/nav/catalog";

/**
 * /search — owned by NAV-UX.
 *
 * A fully server-rendered result list over the same static index the palette
 * uses, with the same facet vocabulary and the same URL contract as
 * `/variants` (`?q=…&gen=…&body=…&engine=…&drive=…&year=…&sort=…&page=…`).
 * Every control is a real `<form>` or a real `<Link>`, so the page works with
 * JavaScript disabled, is crawlable and is fully keyboard operable; the
 * command palette is offered as a progressive enhancement.
 */

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search every Porsche 911 generation and variant by name, year, engine, body style, drivetrain or power — with shareable faceted URLs.",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = filtersFromParams(params);
  const results = applyFilters(filters);
  const pages = pageCount(results.length);
  const page = Math.min(filters.page, pages);
  const visible = pageSlice(results, page);
  const query = filters.q.trim();

  return (
    <div className="px-[--gutter] pt-[calc(var(--nav-h,64px)+var(--space-12))] pb-[--space-24]">
      <div className="mx-auto max-w-[--maxw]">
        <header className="mb-[--space-8] max-w-[--maxw-prose]">
          <p className="label mb-[--space-2]">
            {VARIANT_COUNT} variants · {GENERATION_INDEX.length} generations
          </p>
          <h1 className="text-display-2 mb-[--space-4]">
            {query ? (
              <>
                Results for <span className="text-guards-text">“{query}”</span>
              </>
            ) : (
              <>
                Every <span className="text-guards-text">911</span>
              </>
            )}
          </h1>
          <p className="text-metal-500">
            Fuzzy search across names, years, engines, power figures, body styles
            and keywords. Refine with the facets — every filter is a link, so
            the URL is always shareable.
          </p>
        </header>

        <form action="/search" method="get" role="search" className="mb-[--space-8] flex flex-wrap gap-[--space-3]">
          <label htmlFor="q" className="sr-only">
            Search 911 variants
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="gt3 rs, 996 turbo, air-cooled targa, 1974…"
            className="min-w-[16rem] flex-1 rounded-[--radius-sm] border border-ink-4 bg-ink-2 px-[--space-4] py-[--space-3] font-mono text-mono-sm text-metal-100 outline-none placeholder:text-metal-700 focus-visible:border-guards"
          />
          <input type="hidden" name="sort" value={filters.sort} />
          <button
            type="submit"
            className="rounded-[--radius-sm] bg-guards px-[--space-5] py-[--space-3] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Search
          </button>
          <PaletteLauncher
            seed={filters.q}
            label="Quick search"
            className="px-[--space-5] py-[--space-3]"
          />
        </form>

        <div className="grid gap-[--space-8] lg:grid-cols-[17rem_1fr]">
          <div className="lg:sticky lg:top-[calc(var(--nav-h,64px)+var(--space-6))] lg:self-start">
            <Facets filters={filters} />
            <Link
              href={filtersHref("/variants", filters)}
              className="mt-[--space-6] inline-block font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 underline-offset-4 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
            >
              Open in the filterable grid →
            </Link>
          </div>

          <div>
            <p className="mb-[--space-4] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
              {results.length} result{results.length === 1 ? "" : "s"}
              {results.length > PAGE_SIZE && (
                <>
                  {" "}
                  · page {page} of {pages}
                </>
              )}
            </p>

            {visible.length === 0 ? (
              <div className="border border-ink-4 bg-ink-2 p-[--space-12] text-center">
                <p className="font-display text-2xl uppercase">Nothing matches</p>
                <p className="mx-auto mt-[--space-3] max-w-[--maxw-prose] text-metal-500">
                  No variant satisfies every filter at once. Try removing a
                  facet or widening the year range to{" "}
                  {YEAR_MIN}–{YEAR_MAX}.
                </p>
                <Link
                  href="/search"
                  className="mt-[--space-6] inline-block rounded-[--radius-sm] border border-guards px-[--space-4] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-guards-text transition-colors hover:bg-guards hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  Reset the search
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-[--space-2]">
                {visible.map((variant) => (
                  <li key={variant.key}>
                    <ResultRow variant={variant} />
                  </li>
                ))}
              </ul>
            )}

            {pages > 1 && (
              <SearchPagination
                filters={filters}
                page={page}
                pages={pages}
                total={results.length}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Facets — plain links, so they work with JS off
 * ------------------------------------------------------------------ */

function Facets({ filters }: { filters: VariantFilters }) {
  const groups: Array<{
    legend: string;
    group: FilterGroup;
    options: Array<{ id: string; label: string; accent?: string }>;
    selected: string[];
  }> = [
    {
      legend: "Generation",
      group: "gens",
      options: GENERATION_INDEX.map((generation) => ({
        id: generation.id,
        label: generation.code,
        accent: generation.accent,
      })),
      selected: filters.gens,
    },
    {
      legend: "Body style",
      group: "bodies",
      options: BODY_FACETS.map((facet) => ({ id: facet.id, label: facet.label })),
      selected: filters.bodies,
    },
    {
      legend: "Engine family",
      group: "engines",
      options: ENGINE_FACETS.map((facet) => ({ id: facet.id, label: facet.label })),
      selected: filters.engines,
    },
    {
      legend: "Drivetrain",
      group: "drives",
      options: DRIVE_FACETS.map((facet) => ({ id: facet.id, label: facet.label })),
      selected: filters.drives,
    },
  ];

  return (
    <div className="flex flex-col gap-[--space-6]">
      {groups.map((entry) => (
        <fieldset key={entry.group}>
          <legend className="label mb-[--space-2]">{entry.legend}</legend>
          <ul className="flex flex-wrap gap-[--space-2]">
            {entry.options.map((option) => {
              const on = entry.selected.includes(option.id);
              const next = toggleFilterValue(filters, entry.group, option.id);
              return (
                <li key={option.id}>
                  <Link
                    href={filtersHref("/search", next)}
                    aria-pressed={on}
                    className={`inline-block rounded-[--radius-sm] border px-[--space-2] py-1 font-mono text-mono-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
                      on
                        ? "border-guards bg-guards/15 text-metal-100"
                        : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
                    }`}
                    style={on && option.accent ? { borderColor: option.accent } : undefined}
                  >
                    {option.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <fieldset>
        <legend className="label mb-[--space-2]">Years</legend>
        <ul className="flex flex-wrap gap-[--space-2] font-mono text-mono-xs text-metal-500">
          <li>
            {filters.yearFrom} – {filters.yearTo}
          </li>
          {(filters.yearFrom !== YEAR_MIN || filters.yearTo !== YEAR_MAX) && (
            <li>
              <Link
                href={filtersHref("/search", {
                  ...filters,
                  yearFrom: YEAR_MIN,
                  yearTo: YEAR_MAX,
                  page: 1,
                })}
                className="text-guards-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                reset years
              </Link>
            </li>
          )}
        </ul>
      </fieldset>
    </div>
  );
}

function ResultRow({ variant }: { variant: IndexedVariant }) {
  return (
    <article className="relative border border-ink-4 bg-ink-2 p-[--space-4] transition-colors hover:border-guards">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ backgroundColor: variant.genAccent }}
      />
      <div className="flex flex-wrap items-baseline gap-x-[--space-3] gap-y-1">
        <h2 className="font-display text-xl leading-tight">
          <Link
            href={variant.href}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-guards"
          >
            {variant.name}
          </Link>
        </h2>
        <p className="font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
          {variant.genCode} · {variant.years} · {variant.driveLabel}
          {variant.special ? " · limited" : ""}
        </p>
      </div>
      <p className="mt-[--space-2] max-w-[--maxw-prose] text-mono-xs leading-relaxed text-metal-300">
        {variant.engine || "Engine data pending."}
      </p>
      <dl className="mt-[--space-3] flex flex-wrap gap-x-[--space-6] gap-y-1 font-mono text-mono-xs">
        <div className="flex gap-[--space-2]">
          <dt className="text-metal-700">Power</dt>
          <dd className="text-metal-100">
            {variant.powerPs ? `${variant.powerPs} PS` : variant.power || "—"}
          </dd>
        </div>
        <div className="flex gap-[--space-2]">
          <dt className="text-metal-700">0–100</dt>
          <dd className="text-metal-100">
            {variant.accel ? `${variant.accel} s` : "—"}
          </dd>
        </div>
        <div className="flex gap-[--space-2]">
          <dt className="text-metal-700">Top</dt>
          <dd className="text-metal-100">
            {variant.topSpeed ? `${variant.topSpeed} km/h` : "—"}
          </dd>
        </div>
        <div className="flex gap-[--space-2]">
          <dt className="text-metal-700">Body</dt>
          <dd className="text-metal-100">{variant.bodyLabel || "—"}</dd>
        </div>
      </dl>
      <p className="mt-[--space-3] flex gap-[--space-4]">
        <Link
          href={`/compare?a=${variant.key}`}
          className="relative z-content font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Compare this →
        </Link>
        <Link
          href={`/variants?gen=${variant.generation}`}
          className="relative z-content font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          All {variant.genCode} variants →
        </Link>
      </p>
    </article>
  );
}

function SearchPagination({
  filters,
  page,
  pages,
  total,
}: {
  filters: VariantFilters;
  page: number;
  pages: number;
  total: number;
}) {
  const link = (target: number) =>
    filtersHref("/search", setPage(filters, target));
  const numbers: number[] = [];
  const from = Math.max(1, page - 2);
  const to = Math.min(pages, page + 2);
  for (let i = from; i <= to; i += 1) numbers.push(i);

  return (
    <nav aria-label="Search results pages" className="mt-[--space-12] flex items-center gap-[--space-2]">
      <PageLink href={link(Math.max(1, page - 1))} disabled={page <= 1} label="Previous page">
        ←
      </PageLink>
      {numbers.map((entry) => (
        <PageLink key={entry} href={link(entry)} label={`Page ${entry}`} current={entry === page}>
          {entry}
        </PageLink>
      ))}
      <PageLink
        href={link(Math.min(pages, page + 1))}
        disabled={page >= pages}
        label="Next page"
      >
        →
      </PageLink>
      <p className="ml-auto font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700">
        {PAGE_SIZE} per page · {total} total
      </p>
    </nav>
  );
}

function PageLink({
  href,
  children,
  label,
  current,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
}) {
  const className = `inline-flex min-w-10 items-center justify-center rounded-[--radius-sm] border px-[--space-2] py-[--space-1] font-mono text-mono-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
    current
      ? "border-guards bg-guards/15 text-metal-100"
      : disabled
        ? "pointer-events-none border-ink-4 text-metal-700 opacity-40"
        : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
  }`;
  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}
