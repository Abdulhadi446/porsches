"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  useFocusTrap,
  useListNavigation,
  usePrefersReducedMotion,
  useScrollLock,
  useStoredList,
} from "./use-nav";
import { matchPositions } from "./fuzzy";

/**
 * COMMAND PALETTE PANEL — owned by NAV-UX.
 *
 * The panel itself, split out of `command-palette.tsx` so that it (and with it
 * framer-motion, 45 kB gzip) is only fetched when the palette is actually opened:
 * the provider in `command-palette.tsx` pulls this module in with
 * `next/dynamic({ ssr: false })` and warms it during idle time, so ⌘K never waits
 * on the network but the library is no longer in the initial JS of all 179 routes.
 *
 * Everything below is the previous implementation, unchanged.
 */

type Catalog = typeof import("./catalog");

const RECENTS_KEY = "911-nav:palette-recents";
const RECENTS_MAX = 6;
const MAX_RESULTS = 40;

/* ------------------------------------------------------------------ *
 * Panel shell — props in, portal out
 * ------------------------------------------------------------------ */

export function CommandPalettePanel({
  seed,
  onClose,
}: {
  seed: string;
  onClose: () => void;
}) {
  const reduced = usePrefersReducedMotion();

  return createPortal(
    reduced ? (
      <div data-nav-palette="static">
        <PalettePanel seed={seed} onClose={onClose} />
      </div>
    ) : (
      <motion.div
        data-nav-palette="animated"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <PalettePanel seed={seed} onClose={onClose} />
      </motion.div>
    ),
    document.body,
  );
}

/* ------------------------------------------------------------------ *
 * Panel — mounted per open, so no state has to be reset in an effect
 * ------------------------------------------------------------------ */

interface FlatOption {
  id: string;
  group: "recent" | "generation" | "variant" | "action";
  label: string;
  meta: string;
  href: string;
  accent: string;
  query?: string;
}

interface PaletteGroups {
  recent: FlatOption[];
  generation: FlatOption[];
  variant: FlatOption[];
  action: FlatOption[];
}

const EMPTY: PaletteGroups = { recent: [], generation: [], variant: [], action: [] };

function PalettePanel({
  seed,
  onClose,
}: {
  seed: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const [query, setQuery] = useState(seed);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [recents, setRecents] = useStoredList(RECENTS_KEY);

  useFocusTrap(true, dialogRef, { initialFocus: inputRef });
  useScrollLock(true);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void import("./catalog")
      .then((mod) => {
        if (!cancelled) setCatalog(mod);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<PaletteGroups>(() => {
    if (!catalog) return EMPTY;
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        recent: recents.slice(0, RECENTS_MAX).map((value, position) => ({
          id: `recent-${position}`,
          group: "recent" as const,
          label: value,
          meta: "Recent search",
          href: `/search?q=${encodeURIComponent(value)}`,
          accent: "var(--color-metal-500)",
          query: value,
        })),
        generation: catalog.GENERATION_INDEX.slice(0, 4).map((generation) => ({
          id: `generation-${generation.id}`,
          group: "generation" as const,
          label: `${generation.code} — ${generation.name}`,
          meta: `${generation.years} · ${generation.variantCount} variants`,
          href: generation.href,
          accent: generation.accent,
        })),
        variant: [],
        action: [],
      };
    }
    const results = catalog.searchIndex(trimmed, MAX_RESULTS);
    return {
      recent: [],
      generation: results.generations.map((entry) => ({
        id: `generation-${entry.key}`,
        group: "generation" as const,
        label: entry.label,
        meta: entry.meta,
        href: entry.href,
        accent: entry.accent,
      })),
      variant: results.variants.map((entry) => ({
        id: `variant-${entry.key}`,
        group: "variant" as const,
        label: entry.label,
        meta: entry.meta,
        href: entry.href,
        accent: entry.accent,
      })),
      action: [
        {
          id: "action-search-all",
          group: "action" as const,
          label: `Search every variant for “${trimmed}”`,
          meta: "Opens the faceted search page",
          href: `/search?q=${encodeURIComponent(trimmed)}`,
          accent: "var(--color-guards)",
        },
      ],
    };
  }, [catalog, query, recents]);

  const flat = useMemo<FlatOption[]>(
    () => [...groups.recent, ...groups.generation, ...groups.variant, ...groups.action],
    [groups],
  );

  const { active, setActive, keys } = useListNavigation(flat.length);

  const go = useCallback(
    (option: FlatOption) => {
      if (option.group === "recent" && option.query) {
        setQuery(option.query);
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      const value = query.trim();
      if (option.group !== "action" && value) {
        setRecents(
          [value, ...recents.filter((entry) => entry !== value)].slice(0, RECENTS_MAX),
        );
      }
      onClose();
      router.push(option.href);
    },
    [onClose, query, recents, router, setActive, setRecents],
  );

  const activeOption = flat[active];

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") return;
    keys(event, () => {
      if (activeOption) go(activeOption);
    });
  };

  useEffect(() => {
    if (!activeOption) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-cp-option="${CSS.escape(activeOption.id)}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeOption]);

  const total = flat.length;

  return (
    <div className="fixed inset-0 z-overlay flex items-start justify-center px-(--space-4) pt-[6vh] pb-(--space-8) sm:pt-[10vh]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink/80"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search every 911 generation and variant"
        className="relative flex max-h-[82dvh] w-full max-w-(--maxw-prose) flex-col overflow-hidden rounded-(--radius-lg) border border-ink-4 bg-ink-2"
      >
        <div className="flex items-center gap-(--space-3) border-b border-ink-4 px-(--space-4) py-(--space-3)">
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-mono-xs uppercase tracking-(--tracking-label) text-guards-text"
          >
            Search
          </span>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-expanded
            aria-controls={`${listId}-listbox`}
            aria-activedescendant={
              activeOption ? `${listId}-opt-${activeOption.id}` : undefined
            }
            aria-describedby={`${listId}-hint`}
            aria-label="Search generations and variants"
            placeholder="gt3 rs, 996 turbo, air-cooled targa, 1974…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent font-mono text-mono-md text-metal-100 outline-none placeholder:text-metal-700"
          />
        </div>

        <div
          ref={listRef}
          id={`${listId}-listbox`}
          role="listbox"
          aria-label="Search results"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--space-2) py-(--space-2)"
        >
          {!catalog && (
            <p className="px-(--space-3) py-(--space-8) text-center font-mono text-mono-sm text-metal-500">
              Indexing variants…
            </p>
          )}

          {catalog && total === 0 && (
            <p className="px-(--space-3) py-(--space-8) text-center text-metal-500">
              Nothing matches “{query.trim()}”. Try a model code, a name or a
              year.
            </p>
          )}

          {catalog ? (
            <>
              <PaletteGroup
                title="Recent"
                titleId={`${listId}-group-recent`}
                options={groups.recent}
                active={active}
                flat={flat}
                onHover={setActive}
                onPick={go}
                query={query}
                optionId={(id) => `${listId}-opt-${id}`}
              />
              <PaletteGroup
                title="Generations"
                titleId={`${listId}-group-generations`}
                options={groups.generation}
                active={active}
                flat={flat}
                onHover={setActive}
                onPick={go}
                query={query}
                optionId={(id) => `${listId}-opt-${id}`}
              />
              <PaletteGroup
                title="Variants"
                titleId={`${listId}-group-variants`}
                options={groups.variant}
                active={active}
                flat={flat}
                onHover={setActive}
                onPick={go}
                query={query}
                optionId={(id) => `${listId}-opt-${id}`}
              />
              <PaletteGroup
                title="More"
                titleId={`${listId}-group-actions`}
                options={groups.action}
                active={active}
                flat={flat}
                onHover={setActive}
                onPick={go}
                query=""
                optionId={(id) => `${listId}-opt-${id}`}
              />
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-(--space-4) border-t border-ink-4 px-(--space-4) py-(--space-2)">
          <p
            id={`${listId}-hint`}
            className="flex flex-wrap items-center gap-x-(--space-4) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700"
          >
            <span>↑↓ navigate</span>
            <span>⏎ open</span>
            <span>esc close</span>
            {catalog && (
              <span className="hidden sm:inline">
                {catalog.VARIANT_COUNT} variants indexed
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 rounded-(--radius-sm) border border-ink-4 px-(--space-2) py-1 font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function PaletteGroup({
  title,
  titleId,
  options,
  active,
  flat,
  onHover,
  onPick,
  query,
  optionId,
}: {
  title: string;
  titleId: string;
  options: FlatOption[];
  active: number;
  flat: FlatOption[];
  onHover: (index: number) => void;
  onPick: (option: FlatOption) => void;
  query: string;
  optionId: (id: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div role="group" aria-labelledby={titleId} className="mb-(--space-2)">
      <p id={titleId} className="label px-(--space-3) py-(--space-2)">
        {title}
      </p>
      <ul className="flex flex-col">
        {options.map((option) => {
          const index = flat.indexOf(option);
          const isActive = index === active;
          return (
            <li key={option.id} role="presentation" onMouseEnter={() => onHover(index)}>
              <Link
                id={optionId(option.id)}
                data-cp-option={option.id}
                role="option"
                aria-selected={isActive}
                href={option.href}
                scroll={false}
                onClick={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                className={`flex items-center gap-(--space-3) rounded-(--radius-sm) px-(--space-3) py-(--space-2) transition-colors duration-(--dur-fast) ${
                  isActive
                    ? "bg-ink-4 text-metal-100"
                    : "text-metal-300 hover:bg-ink-3 hover:text-metal-100"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-0.5 shrink-0"
                  style={{ backgroundColor: option.accent }}
                />
                <span className="min-w-0 flex-1">
                  <Highlight text={option.label} query={query} />
                  <span className="mt-0.5 block truncate font-mono text-mono-xs text-metal-500">
                    {option.meta}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-mono-xs text-metal-700"
                >
                  ⏎
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Marks the fuzzy-matched characters so the ranking is legible. */
function Highlight({ text, query }: { text: string; query: string }) {
  const positions = query ? new Set(matchPositions(text, query)) : null;
  if (!positions || positions.size === 0) {
    return <span className="block truncate font-mono text-mono-sm">{text}</span>;
  }
  return (
    <span className="block truncate font-mono text-mono-sm">
      {Array.from(text).map((char, index) =>
        positions.has(index) ? (
          <mark
            key={index}
            className="bg-transparent font-bold text-guards-text"
            style={{ textShadow: "0 0 12px var(--color-guards)" }}
          >
            {char}
          </mark>
        ) : (
          <span key={index}>{char}</span>
        ),
      )}
    </span>
  );
}
