"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { openCommandPalette } from "./command-palette";
import {
  activeFilterCount,
  applyFilters,
  BODY_FACETS,
  DRIVE_FACETS,
  ENGINE_FACETS,
  filtersToQuery,
  GENERATION_INDEX,
  PAGE_SIZE,
  pageCount,
  pageSlice,
  setPage,
  setQuery,
  setSort,
  setYearRange,
  SORT_OPTIONS,
  toggleFilterValue,
  VARIANT_COUNT,
  YEAR_MAX,
  YEAR_MIN,
  type IndexedVariant,
  type VariantFilters,
} from "./catalog";
import {
  useFocusTrap,
  useMounted,
  usePrefersReducedMotion,
  useScrollLock,
} from "./use-nav";

/**
 * VARIANT GRID — owned by NAV-UX.
 *
 * Every 911 variant in the dataset, filtered by generation, body style, engine
 * family, drivetrain, year range and free text, sortable by year, power or
 * name, and paginated. Filter state is the URL (`?gen=996&body=coupe&year=
 * 1998-2005&sort=power&page=2`) and is written back with
 * `history.replaceState`, so a view is shareable, survives a refresh and never
 * costs a server round trip while typing. Results are announced through a
 * polite live region; the mobile filter tray is a real modal dialog with a
 * focus trap.
 */

export interface VariantGridProps {
  initialFilters: VariantFilters;
}

export function VariantGrid({ initialFilters }: VariantGridProps) {
  const pathname = usePathname() ?? "/variants";
  const reduced = usePrefersReducedMotion();
  const [filters, setFilters] = useState<VariantFilters>(initialFilters);
  const [tray, setTray] = useState(false);
  const mounted = useMounted();
  const trayRef = useRef<HTMLDivElement>(null);
  const trayCloseRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useFocusTrap(tray, trayRef, { initialFocus: trayCloseRef });
  useScrollLock(tray);

  useEffect(() => {
    if (!mounted) return;
    const query = filtersToQuery(filters);
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [filters, mounted, pathname]);

  const results = useMemo(() => applyFilters(filters), [filters]);
  const pages = pageCount(results.length);
  const page = Math.min(filters.page, pages);
  const visible = pageSlice(results, page);
  const active = activeFilterCount(filters);

  const onToggle = useCallback(
    (group: "gens" | "bodies" | "engines" | "drives", value: string) => {
      setFilters((current) => toggleFilterValue(current, group, value));
    },
    [],
  );

  const clearAll = useCallback(() => {
    setFilters((current) => ({
      ...current,
      q: "",
      gens: [],
      bodies: [],
      engines: [],
      drives: [],
      yearFrom: YEAR_MIN,
      yearTo: YEAR_MAX,
      page: 1,
    }));
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      setFilters((current) => setPage(current, next));
      resultsRef.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    },
    [reduced],
  );

  return (
    <div className="px-(--gutter) pb-(--space-24) pt-[calc(var(--nav-h,64px)+var(--space-12))]">
      <div className="mx-auto max-w-(--maxw)">
        <header className="mb-(--space-8)">
          <p className="label mb-(--space-2)">
            {GENERATION_INDEX.length} generations · {VARIANT_COUNT} variants indexed
          </p>
          <h1 className="text-display-2 mb-(--space-4)">
            All <span className="text-guards-text">variants</span>
          </h1>
          <p className="max-w-(--maxw-prose) text-metal-500">
            Every 911 in the dataset with its real specifications. Filter, sort
            and share the view — the address bar always holds the current state.
          </p>
        </header>

        <div className="grid gap-(--space-8) lg:grid-cols-[17rem_1fr]">
          <div className="lg:sticky lg:top-[calc(var(--nav-h,64px)+var(--space-6))] lg:self-start">
            <div className="mb-(--space-4) flex items-center gap-(--space-3) lg:hidden">
              <button
                type="button"
                onClick={() => setTray(true)}
                aria-haspopup="dialog"
                className="flex-1 rounded-(--radius-sm) border border-ink-4 bg-ink-2 px-4 py-3 text-left font-mono text-mono-xs uppercase tracking-(--tracking-label) text-metal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                Filters
                {active > 0 && <span className="ml-2 text-guards-text">({active})</span>}
              </button>
            </div>

            <div className="hidden lg:block">
              <FilterPanel
                filters={filters}
                onToggle={onToggle}
                onQuery={(q) => setFilters((current) => setQuery(current, q))}
                onYears={(from, to) => setFilters((current) => setYearRange(current, from, to))}
                onSort={(sort) => setFilters((current) => setSort(current, sort))}
                onClear={clearAll}
                active={active}
              />
            </div>
          </div>

          <div ref={resultsRef} className="scroll-mt-[calc(var(--nav-h,64px)+var(--space-6))]">
            <div className="mb-(--space-4) flex flex-wrap items-center gap-(--space-3)">
              <p
                role="status"
                aria-live="polite"
                className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500"
              >
                {results.length} result{results.length === 1 ? "" : "s"}
                {active > 0 ? ` · ${active} filter${active === 1 ? "" : "s"}` : ""}
                {results.length > 0 && (
                  <>
                    {" "}
                    · page {page}/{pages}
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => openCommandPalette(filters.q)}
                className="ml-auto inline-flex min-h-6 items-center rounded-(--radius-pill) border border-ink-4 px-3 py-1 font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500 transition-colors hover:border-guards hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                ⌘K — search
              </button>
            </div>

            {active > 0 && (
              <ActiveChips
                filters={filters}
                onToggle={onToggle}
                onQuery={(q) => setFilters((current) => setQuery(current, q))}
                onYears={(from, to) => setFilters((current) => setYearRange(current, from, to))}
                onClear={clearAll}
              />
            )}

            {visible.length === 0 ? (
              <div className="border border-ink-4 bg-ink-2 p-(--space-12) text-center">
                <p className="font-display text-2xl uppercase">
                  Nothing matches
                </p>
                <p className="mx-auto mt-(--space-3) max-w-(--maxw-prose) text-metal-500">
                  No variant satisfies every filter at once. Try widening the
                  year range or removing a facet.
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-(--space-6) inline-flex min-h-6 items-center rounded-(--radius-sm) border border-guards px-4 py-2 font-mono text-mono-xs uppercase tracking-(--tracking-label) text-guards-text transition-colors hover:bg-guards hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <ul className="grid gap-(--space-3) sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((variant) => (
                  <li key={variant.key} className="min-w-0">
                    <VariantCard variant={variant} />
                  </li>
                ))}
              </ul>
            )}

            {pages > 1 && (
              <Pagination
                page={page}
                pages={pages}
                total={results.length}
                onGo={goToPage}
              />
            )}
          </div>
        </div>
      </div>

      {tray && (
        <div className="fixed inset-0 z-overlay flex items-end lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setTray(false)}
            className="absolute inset-0 bg-ink/80"
          />
          <div
            ref={trayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filter variants"
            className="relative flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-(--radius-lg) border-t border-ink-4 bg-ink-2"
          >
            <div className="flex items-center justify-between border-b border-ink-4 px-(--gutter) py-(--space-4)">
              <p className="font-display text-lg uppercase">Filters</p>
              <button
                ref={trayCloseRef}
                type="button"
                onClick={() => setTray(false)}
                className="inline-flex min-h-6 items-center rounded-(--radius-sm) border border-ink-4 px-3 py-2 font-mono text-mono-xs uppercase tracking-(--tracking-label) text-metal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--gutter) py-(--space-4)">
              <FilterPanel
                filters={filters}
                onToggle={onToggle}
                onQuery={(q) => setFilters((current) => setQuery(current, q))}
                onYears={(from, to) =>
                  setFilters((current) => setYearRange(current, from, to))
                }
                onSort={(sort) => setFilters((current) => setSort(current, sort))}
                onClear={clearAll}
                active={active}
              />
            </div>
            <div className="border-t border-ink-4 px-(--gutter) py-(--space-4)">
              <button
                type="button"
                onClick={() => setTray(false)}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-sm) bg-guards px-4 py-3 font-mono text-mono-xs uppercase tracking-(--tracking-label) text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                Show {results.length} result{results.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

interface FilterPanelProps {
  filters: VariantFilters;
  onToggle: (group: "gens" | "bodies" | "engines" | "drives", value: string) => void;
  onQuery: (q: string) => void;
  onYears: (from: number, to: number) => void;
  onSort: (sort: VariantFilters["sort"]) => void;
  onClear: () => void;
  active: number;
}

function FilterPanel({
  filters,
  onToggle,
  onQuery,
  onYears,
  onSort,
  onClear,
  active,
}: FilterPanelProps) {
  const searchId = useId();
  const fromId = `${searchId}-from`;
  const toId = `${searchId}-to`;
  const sortId = `${searchId}-sort`;

  return (
    <div className="flex flex-col gap-(--space-6)">
      <div>
        <label
          htmlFor={searchId}
          className="label mb-(--space-2) block"
        >
          Text search
        </label>
        <input
          id={searchId}
          type="search"
          value={filters.q}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="GT3 RS, targa, 1974…"
          className="w-full rounded-(--radius-sm) border border-ink-4 bg-ink-2 px-3 py-2 font-mono text-mono-sm text-metal-100 outline-none placeholder:text-metal-700 focus-visible:border-guards"
        />
      </div>

      <fieldset>
        <legend className="label mb-(--space-2)">Generation</legend>
        <div className="flex flex-wrap gap-(--space-2)">
          {GENERATION_INDEX.map((generation) => {
            const on = filters.gens.includes(generation.id);
            return (
              <button
                key={generation.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle("gens", generation.id)}
                className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-(--radius-sm) border px-2 py-1 font-mono text-mono-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
                  on
                    ? "border-guards bg-guards/15 text-metal-100"
                    : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
                }`}
                style={on ? { borderColor: generation.accent } : undefined}
              >
                {generation.code}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-(--space-2)">Body style</legend>
        <div className="flex flex-wrap gap-(--space-2)">
          {BODY_FACETS.map((facet) => {
            const on = filters.bodies.includes(facet.id);
            return (
              <button
                key={facet.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle("bodies", facet.id)}
                className={chipClass(on)}
              >
                {facet.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-(--space-2)">Engine family</legend>
        <div className="flex flex-wrap gap-(--space-2)">
          {ENGINE_FACETS.map((facet) => {
            const on = filters.engines.includes(facet.id);
            return (
              <button
                key={facet.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle("engines", facet.id)}
                className={chipClass(on)}
              >
                {facet.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-(--space-2)">Drivetrain</legend>
        <div className="flex flex-wrap gap-(--space-2)">
          {DRIVE_FACETS.map((facet) => {
            const on = filters.drives.includes(facet.id);
            return (
              <button
                key={facet.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle("drives", facet.id)}
                className={chipClass(on)}
              >
                {facet.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-(--space-2)">Years</legend>
        <p className="mb-(--space-2) font-mono text-mono-sm text-metal-100">
          {filters.yearFrom} – {filters.yearTo}
        </p>
        <div className="flex flex-col gap-(--space-2)">
          <label htmlFor={fromId} className="sr-only">
            Earliest year
          </label>
          <input
            id={fromId}
            type="range"
            min={YEAR_MIN}
            max={YEAR_MAX}
            step={1}
            value={filters.yearFrom}
            onChange={(event) =>
              onYears(Number(event.target.value), Math.max(filters.yearTo, Number(event.target.value)))
            }
            className="min-h-6 w-full accent-guards"
          />
          <label htmlFor={toId} className="sr-only">
            Latest year
          </label>
          <input
            id={toId}
            type="range"
            min={YEAR_MIN}
            max={YEAR_MAX}
            step={1}
            value={filters.yearTo}
            onChange={(event) =>
              onYears(Math.min(filters.yearFrom, Number(event.target.value)), Number(event.target.value))
            }
            className="min-h-6 w-full accent-guards"
          />
        </div>
      </fieldset>

      <div>
        <label htmlFor={sortId} className="label mb-(--space-2) block">
          Sort by
        </label>
        <select
          id={sortId}
          value={filters.sort}
          onChange={(event) =>
            onSort(event.target.value as VariantFilters["sort"])
          }
          className="w-full rounded-(--radius-sm) border border-ink-4 bg-ink-2 px-3 py-2 font-mono text-mono-sm text-metal-100 outline-none focus-visible:border-guards"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {active > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-6 self-start items-center rounded-(--radius-sm) border border-ink-4 px-3 py-2 font-mono text-mono-xs uppercase tracking-(--tracking-label) text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Clear {active} filter{active === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function chipClass(on: boolean): string {
  return `inline-flex min-h-6 min-w-6 items-center justify-center rounded-(--radius-sm) border px-2 py-1 font-mono text-mono-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
    on
      ? "border-guards bg-guards/15 text-metal-100"
      : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
  }`;
}

function ActiveChips({
  filters,
  onToggle,
  onQuery,
  onYears,
  onClear,
}: Omit<FilterPanelProps, "onSort" | "active">) {
  const cross = (
    <span aria-hidden="true" className="ml-2 text-metal-700">
      \u2715
    </span>
  );
  const yearsChanged =
    filters.yearFrom !== YEAR_MIN || filters.yearTo !== YEAR_MAX;
  const chip =
    "inline-flex min-h-6 items-center rounded-(--radius-pill) border border-ink-4 bg-ink-2 px-3 py-1 font-mono text-mono-xs text-metal-300 transition-colors hover:border-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards";
  const body = (id: string) => BODY_FACETS.find((f) => f.id === id)?.label ?? id;
  const engine = (id: string) => ENGINE_FACETS.find((f) => f.id === id)?.label ?? id;
  const drive = (id: string) => DRIVE_FACETS.find((f) => f.id === id)?.label ?? id;

  return (
    <ul className="mb-(--space-4) flex flex-wrap gap-(--space-2)">
      {filters.q.trim() && (
        <li>
          <button type="button" onClick={() => onQuery("")} className={chip}>
            \u201c{filters.q.trim()}\u201d
            {cross}
            <span className="sr-only">Clear text search</span>
          </button>
        </li>
      )}
      {filters.gens.map((id) => {
        const generation = GENERATION_INDEX.find((entry) => entry.id === id);
        return (
          <li key={`gen-${id}`}>
            <button
              type="button"
              onClick={() => onToggle("gens", id)}
              className={chip}
            >
              <span
                aria-hidden="true"
                className="mr-2 inline-block h-2 w-2"
                style={{
                  backgroundColor: generation?.accent ?? "var(--color-guards)",
                }}
              />
              {generation?.code ?? id}
              {cross}
              <span className="sr-only">Remove generation filter</span>
            </button>
          </li>
        );
      })}
      {filters.bodies.map((id) => (
        <li key={`body-${id}`}>
          <button
            type="button"
            onClick={() => onToggle("bodies", id)}
            className={chip}
          >
            {body(id)}
            {cross}
            <span className="sr-only">Remove body style filter</span>
          </button>
        </li>
      ))}
      {filters.engines.map((id) => (
        <li key={`engine-${id}`}>
          <button
            type="button"
            onClick={() => onToggle("engines", id)}
            className={chip}
          >
            {engine(id)}
            {cross}
            <span className="sr-only">Remove engine family filter</span>
          </button>
        </li>
      ))}
      {filters.drives.map((id) => (
        <li key={`drive-${id}`}>
          <button
            type="button"
            onClick={() => onToggle("drives", id)}
            className={chip}
          >
            {drive(id)}
            {cross}
            <span className="sr-only">Remove drivetrain filter</span>
          </button>
        </li>
      ))}
      {yearsChanged && (
        <li>
          <button
            type="button"
            onClick={() => onYears(YEAR_MIN, YEAR_MAX)}
            className={chip}
          >
            {filters.yearFrom}\u2013{filters.yearTo}
            {cross}
            <span className="sr-only">Reset the year range</span>
          </button>
        </li>
      )}
      <li>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-6 items-center rounded-(--radius-pill) border border-ink-4 px-3 py-1 font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Card + pagination
 * ------------------------------------------------------------------ */

function VariantCard({ variant }: { variant: IndexedVariant }) {
  return (
    <article className="group relative flex h-full min-w-0 flex-col border border-ink-4 bg-ink-2 p-(--space-4) transition-colors hover:border-guards">
      <span
        aria-hidden="true"
        className="mb-(--space-3) block h-0.5 w-8"
        style={{ backgroundColor: variant.genAccent }}
      />
      <h2 className="font-display text-xl leading-tight">
        <Link
          href={variant.href}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-guards"
        >
          {variant.name}
        </Link>
      </h2>
      <p className="mt-(--space-1) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500">
        {variant.genCode} · {variant.years}
      </p>
      <dl className="mt-(--space-3) flex min-w-0 flex-col gap-1 font-mono text-mono-xs text-metal-300">
        <div className="flex min-w-0 gap-(--space-2)">
          <dt className="shrink-0 text-metal-700">Engine</dt>
          <dd className="min-w-0 flex-1 truncate">{truncate(variant.engine, 58)}</dd>
        </div>
        <div className="flex min-w-0 gap-(--space-2)">
          <dt className="shrink-0 text-metal-700">Power</dt>
          <dd className="min-w-0 flex-1 truncate">
            {variant.powerPs ? `${variant.powerPs} PS` : truncate(variant.power, 40) || "—"}
          </dd>
        </div>
        <div className="flex min-w-0 gap-(--space-2)">
          <dt className="shrink-0 text-metal-700">Drive</dt>
          <dd className="min-w-0 flex-1 truncate">
            {variant.driveLabel} · {variant.bodyLabel || "—"}
          </dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center gap-(--space-3) pt-(--space-4)">
        {variant.special && (
          <span className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-guards-text">
            Limited
          </span>
        )}
        <Link
          href={`/compare?a=${variant.key}`}
          className="relative z-content ml-auto inline-flex min-h-6 items-center font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Compare →
        </Link>
      </div>
    </article>
  );
}

function truncate(value: string | null | undefined, max: number): string {
  // Some variants are deliberate placeholders (an announced car with no
  // published specs yet) and carry null spec fields.
  const text = (value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function Pagination({
  page,
  pages,
  total,
  onGo,
}: {
  page: number;
  pages: number;
  total: number;
  onGo: (page: number) => void;
}) {
  const numbers = pageWindow(page, pages);
  return (
    <nav
      aria-label="Pagination"
      className="mt-(--space-12) flex flex-wrap items-center gap-(--space-2)"
    >
      <PageButton
        label="Previous page"
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
      >
        ←
      </PageButton>
      {numbers.map((entry, index) =>
        entry === null ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-(--space-1) font-mono text-mono-sm text-metal-700"
          >
            …
          </span>
        ) : (
          <PageButton
            key={entry}
            label={`Page ${entry}`}
            current={entry === page}
            onClick={() => onGo(entry)}
          >
            {entry}
          </PageButton>
        ),
      )}
      <PageButton
        label="Next page"
        disabled={page >= pages}
        onClick={() => onGo(page + 1)}
      >
        →
      </PageButton>
      <p className="ml-auto font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700">
        {PAGE_SIZE} per page · {total} total
      </p>
    </nav>
  );
}

function PageButton({
  children,
  label,
  onClick,
  disabled,
  current,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-6 min-w-10 items-center justify-center rounded-(--radius-sm) border px-2 py-1 font-mono text-mono-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards disabled:cursor-not-allowed disabled:opacity-30 ${
        current
          ? "border-guards bg-guards/15 text-metal-100"
          : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
      }`}
    >
      {children}
    </button>
  );
}

function pageWindow(page: number, pages: number): Array<number | null> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const out: Array<number | null> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push(null);
  for (let i = from; i <= to; i += 1) out.push(i);
  if (to < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

