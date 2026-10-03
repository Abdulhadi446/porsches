"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  COMPARE_SLOT_KEYS,
  resolveSlot,
  searchIndex,
  slotsToQuery,
  VARIANT_COUNT,
  VARIANT_INDEX,
  type CompareSlot,
  type CompareSlotKey,
  type IndexedVariant,
  type PaletteEntry,
} from "./catalog";
import { useListNavigation } from "./use-nav";

/**
 * COMPARE TABLE — owned by NAV-UX.
 *
 * Reads `?a=996/carrera&b=993/turbo` (the deep-link format the variant pages
 * emit) and also `c` / `d` for a four-way comparison. Every slot is a real
 * combobox: type to fuzzy-search the 911 index, ↑/↓ to move, Enter to pick,
 * Esc to dismiss — no mouse required. Unresolvable params are reported in
 * place instead of crashing, and any state change is written back with
 * `history.replaceState` so the URL is always a shareable permalink.
 *
 * Rows that differ between the selected cars are highlighted; rows where every
 * value matches are muted. Power, top speed and 0–100 km/h get bars, and a
 * hint appears when two or more picks come from the same generation.
 */

export interface CompareTableProps {
  initialSlots: CompareSlot[];
}

interface Row {
  key: string;
  label: string;
  value: (variant: IndexedVariant) => string;
  /** numeric projection used by the bar charts */
  metric?: (variant: IndexedVariant) => number | null;
  unit?: string;
  /** true when a smaller number is better (0–100 km/h) */
  lowerIsBetter?: boolean;
}

const ROWS: Row[] = [
  {
    key: "generation",
    label: "Generation",
    value: (v) => `${v.genCode} — ${v.genName}`,
  },
  { key: "years", label: "Years", value: (v) => v.years },
  { key: "engine", label: "Engine", value: (v) => v.engine || "—" },
  { key: "powerText", label: "Power (as published)", value: (v) => v.power || "—" },
  {
    key: "powerPs",
    label: "Power",
    value: (v) => (v.powerPs ? `${v.powerPs} PS` : "—"),
    metric: (v) => v.powerPs,
    unit: "PS",
  },
  { key: "torque", label: "Torque", value: (v) => v.torque || "—" },
  {
    key: "accel",
    label: "0–100 km/h",
    value: (v) => v.accelText || (v.accel ? `${v.accel} s` : "—"),
    metric: (v) => v.accel,
    unit: "s",
    lowerIsBetter: true,
  },
  {
    key: "topSpeed",
    label: "Top speed",
    value: (v) => v.topSpeedText || (v.topSpeed ? `${v.topSpeed} km/h` : "—"),
    metric: (v) => v.topSpeed,
    unit: "km/h",
  },
  { key: "weight", label: "Weight", value: (v) => v.weight || "—" },
  {
    key: "weightKg",
    label: "Kerb weight",
    value: (v) => (v.weightKg ? `${v.weightKg.toLocaleString("en-GB")} kg` : "—"),
    metric: (v) => v.weightKg,
    unit: "kg",
    lowerIsBetter: true,
  },
  { key: "drivetrain", label: "Drivetrain", value: (v) => v.drivetrain || "—" },
  { key: "drive", label: "Layout", value: (v) => v.driveLabel },
  { key: "transmission", label: "Transmission", value: (v) => v.transmission || "—" },
  { key: "bodies", label: "Body styles", value: (v) => v.bodyLabel || "—" },
  { key: "cooling", label: "Cooling / family", value: (v) => v.familyLabel || "—" },
  { key: "production", label: "Production", value: (v) => v.production || "—" },
  { key: "special", label: "Limited run", value: (v) => (v.special ? "Yes" : "No") },
];

export function CompareTable({ initialSlots }: CompareTableProps) {
  const pathname = usePathname() ?? "/compare";
  const [slots, setSlots] = useState<CompareSlot[]>(() =>
    COMPARE_SLOT_KEYS.map((key) =>
      initialSlots.find((slot) => slot.key === key) ??
        resolveSlot(key, ""),
    ),
  );
  const [four, setFour] = useState(() =>
    initialSlots.some((slot) => slot.key === "c" && slot.value) ||
    initialSlots.some((slot) => slot.key === "d" && slot.value),
  );
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const visibleKeys: CompareSlotKey[] = four
    ? [...COMPARE_SLOT_KEYS]
    : [COMPARE_SLOT_KEYS[0], COMPARE_SLOT_KEYS[1]];
  const chosen = visibleKeys
    .map((key) => slots.find((slot) => slot.key === key) ?? null)
    .filter((slot): slot is CompareSlot => !!slot && !!slot.variant);
  const picked = chosen
    .map((slot) => slot.variant)
    .filter((variant): variant is IndexedVariant => !!variant);

  useEffect(() => {
    const query = slotsToQuery(slots);
    window.history.replaceState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname,
    );
  }, [pathname, slots]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSlots(
        COMPARE_SLOT_KEYS.map((key) =>
          resolveSlot(key, params.get(key) ?? ""),
        ),
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const select = useCallback((key: CompareSlotKey, value: string) => {
    setSlots((current) =>
      current.map((slot) =>
        slot.key === key ? resolveSlot(key, value) : slot,
      ),
    );
    if (key === "c" || key === "d") setFour(true);
  }, []);

  const clear = useCallback((key: CompareSlotKey) => {
    setSlots((current) =>
      current.map((slot) => (slot.key === key ? resolveSlot(key, "") : slot)),
    );
  }, []);

  const swap = useCallback(() => {
    setSlots((current) => {
      const a = current.find((slot) => slot.key === COMPARE_SLOT_KEYS[0]);
      const b = current.find((slot) => slot.key === COMPARE_SLOT_KEYS[1]);
      if (!a || !b) return current;
      return current.map((slot) =>
        slot.key === a.key
          ? { ...b, key: a.key }
          : slot.key === b.key
            ? { ...a, key: b.key }
            : slot,
      );
    });
  }, []);

  const randomise = useCallback(() => {
    const pool = [...Array(VARIANT_COUNT).keys()];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const a = resolveSlot("a", keyAt(pool[0]));
    const b = resolveSlot("b", keyAt(pool[1]));
    setSlots((current) =>
      current.map((slot) =>
        slot.key === "a" ? a : slot.key === "b" ? b : resolveSlot(slot.key, ""),
      ),
    );
  }, []);

  const share = useCallback(() => {
    const url = window.location.href;
    const done = () => {
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2200);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(done).catch(done);
    } else {
      done();
    }
  }, []);

  const sharedGenerations: string[] = [];
  for (const variant of picked) {
    if (!sharedGenerations.includes(variant.generation)) {
      const alreadySeen = picked.filter(
        (entry) => entry.generation === variant.generation,
      ).length;
      if (alreadySeen > 1) sharedGenerations.push(variant.generation);
    }
  }

  const enough = picked.length >= 2;

  return (
    <div className="mt-[--space-8]">
      <div className="grid gap-[--space-4] md:grid-cols-2 xl:grid-cols-4">
        {visibleKeys.map((key) => {
          const slot = slots.find((entry) => entry.key === key) ?? resolveSlot(key, "");
          return (
            <SlotCard
              key={key}
              slotKey={key}
              slot={slot}
              onSelect={select}
              onClear={clear}
            />
          );
        })}
      </div>

      <div className="mt-[--space-6] flex flex-wrap items-center gap-[--space-3]">
        <button
          type="button"
          onClick={() => {
            const next = !four;
            setFour(next);
            if (!next) {
              setSlots((current) =>
                current.map((slot) =>
                  slot.key === "c" || slot.key === "d"
                    ? resolveSlot(slot.key, "")
                    : slot,
                ),
              );
            }
          }}
          aria-pressed={four}
          className={`rounded-[--radius-sm] border px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
            four
              ? "border-guards bg-guards/15 text-metal-100"
              : "border-ink-4 text-metal-500 hover:border-metal-700 hover:text-metal-300"
          }`}
        >
          {four ? "Two selected" : "Compare four"}
        </button>
        <button
          type="button"
          onClick={swap}
          className="rounded-[--radius-sm] border border-ink-4 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Swap A ⇄ B
        </button>
        <button
          type="button"
          onClick={randomise}
          className="rounded-[--radius-sm] border border-ink-4 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          Surprise me
        </button>
        <button
          type="button"
          onClick={share}
          className="rounded-[--radius-sm] border border-ink-4 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
        >
          {copied ? "Link copied" : "Copy shareable link"}
        </button>
        <p aria-live="polite" role="status" className="sr-only">
          {copied ? "Comparison link copied to the clipboard." : ""}
        </p>
      </div>

      {sharedGenerations.length > 0 && (
        <p className="mt-[--space-4] border-l-2 border-signal bg-ink-2 px-[--space-4] py-[--space-3] font-mono text-mono-sm text-metal-300">
          {sharedGenerations.length === 1
            ? `Every pick is from the ${
                picked.find((entry) => entry.generation === sharedGenerations[0])
                  ?.genCode ?? sharedGenerations[0]
              } — swap one for a cross-era car to see what actually changed.`
            : `${sharedGenerations
                .map(
                  (id) =>
                    picked.find((entry) => entry.generation === id)?.genCode ?? id,
                )
                .join(" and ")} each appear more than once — try one pick from each era.`}
        </p>
      )}

      {!enough ? (
        <div className="mt-[--space-8] border border-ink-4 bg-ink-2 p-[--space-12] text-center">
          <p className="font-display text-2xl uppercase">Pick two 911s</p>
          <p className="mx-auto mt-[--space-3] max-w-[--maxw-prose] text-metal-500">
            Choose at least two variants above — type a model name, a code or a
            year in either box. Every spec below comes straight from the dataset
            and is cited on each variant page.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-[--space-8] grid gap-[--space-4] md:grid-cols-2 xl:grid-cols-4">
            {ROWS.filter((row) => row.metric).map((row) => (
              <MetricCard
                key={row.key}
                row={row}
                variants={picked}
                labels={chosen.map((slot) => slot.variant?.name ?? "")}
                colours={chosen.map((slot) => slot.variant?.genAccent ?? "")}
              />
            ))}
          </div>

          <div className="mt-[--space-8] overflow-x-auto border border-ink-4">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Specification differences between the selected 911 variants
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-content bg-ink-3 px-[--space-4] py-[--space-3] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-500"
                  >
                    Spec
                  </th>
                  {chosen.map((slot) => (
                    <th
                      key={slot.key}
                      scope="col"
                      className="min-w-[12rem] border-l border-ink-4 px-[--space-4] py-[--space-3]"
                    >
                      <span
                        aria-hidden="true"
                        className="mb-[--space-2] block h-0.5 w-10"
                        style={{ backgroundColor: slot.variant?.genAccent }}
                      />
                      <Link
                        href={slot.variant?.href ?? "#"}
                        className="font-display text-lg uppercase hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                      >
                        {slot.variant?.name ?? "—"}
                      </Link>
                      <span className="mt-1 block font-mono text-mono-xs text-metal-500">
                        {slot.variant?.genCode} · {slot.variant?.years}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const values = chosen.map(
                    (slot) => row.value(slot.variant as IndexedVariant),
                  );
                  const differs = new Set(values).size > 1;
                  return (
                    <tr
                      key={row.key}
                      data-differs={differs ? "" : undefined}
                      className="border-t border-ink-4 align-top data-[differs]:bg-guards/5"
                    >
                      <th
                        scope="row"
                        className={`sticky left-0 z-content bg-ink-2 px-[--space-4] py-[--space-3] font-mono text-mono-xs uppercase tracking-[--tracking-label] ${
                          differs ? "text-guards-text" : "text-metal-700"
                        }`}
                      >
                        {differs && (
                          <span aria-hidden="true" className="mr-[--space-2]">
                            ▸
                          </span>
                        )}
                        {row.label}
                        {differs && <span className="sr-only"> (differs)</span>}
                      </th>
                      {values.map((value, index) => (
                        <td
                          key={`${row.key}-${chosen[index].key}`}
                          className={`border-l border-ink-4 px-[--space-4] py-[--space-3] font-mono text-mono-xs leading-relaxed ${
                            differs ? "text-metal-100" : "text-metal-700"
                          }`}
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
        </>
      )}
    </div>
  );
}

function keyAt(index: number): string {
  return VARIANT_INDEX[index]?.key ?? "";
}

/* ------------------------------------------------------------------ *
 * Slot picker — a keyboard-first combobox per slot
 * ------------------------------------------------------------------ */

function SlotCard({
  slotKey,
  slot,
  onSelect,
  onClear,
}: {
  slotKey: CompareSlotKey;
  slot: CompareSlot;
  onSelect: (key: CompareSlotKey, value: string) => void;
  onClear: (key: CompareSlotKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => (query.trim() ? searchIndex(query, 40).variants : []),
    [query],
  );

  const { active, setActive, keys } = useListNavigation(results.length);
  const activeEntry = results[active] ?? null;

  const commit = useCallback(
    (entry: PaletteEntry | null) => {
      if (!entry) return;
      onSelect(slotKey, entry.key);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect, slotKey],
  );

  return (
    <div className="flex flex-col border border-ink-4 bg-ink-2 p-[--space-4]">
      <div className="mb-[--space-3] flex items-center gap-[--space-2]">
        <span className="label">Slot {slotKey.toUpperCase()}</span>
        {slot.variant && (
          <button
            type="button"
            onClick={() => onClear(slotKey)}
            className="ml-auto font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Clear
          </button>
        )}
      </div>

      {slot.variant && !open && (
        <div className="flex items-start gap-[--space-3]">
          <span
            aria-hidden="true"
            className="mt-1 h-10 w-0.5 shrink-0"
            style={{ backgroundColor: slot.variant.genAccent }}
          />
          <div className="min-w-0">
            <p className="truncate font-display text-lg uppercase">
              {slot.variant.name}
            </p>
            <p className="truncate font-mono text-mono-xs text-metal-500">
              {slot.variant.genCode} · {slot.variant.years} ·{" "}
              {slot.variant.powerPs ? `${slot.variant.powerPs} PS` : "—"}
            </p>
            <Link
              href={slot.variant.href}
              className="mt-[--space-2] inline-block font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
            >
              Open variant page →
            </Link>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setQuery("");
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="ml-auto shrink-0 rounded-[--radius-sm] border border-ink-4 px-[--space-2] py-1 font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            Change
          </button>
        </div>
      )}

      {!slot.variant && !open && (
        <p className="text-mono-sm text-metal-500">
          Nothing selected — type a model, code or year below.
        </p>
      )}

      {(open || !slot.variant) && (
        <div className="relative mt-[--space-2]">
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              open && results[active] ? `${listId}-opt-${results[active].key}` : undefined
            }
            aria-label={`Search a 911 for slot ${slotKey.toUpperCase()}`}
            placeholder="911 GT3 RS…"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                inputRef.current?.blur();
                return;
              }
              if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
                setOpen(true);
                return;
              }
              keys(event, () => commit(activeEntry));
            }}
            className="w-full rounded-[--radius-sm] border border-ink-4 bg-ink-3 px-[--space-3] py-[--space-2] font-mono text-mono-sm text-metal-100 outline-none placeholder:text-metal-700 focus-visible:border-guards"
          />

          {open && query.trim() && (
            <ul
              id={listId}
              role="listbox"
              aria-label={`Matches for slot ${slotKey.toUpperCase()}`}
              className="absolute inset-x-0 top-[calc(100%+4px)] z-[var(--z-overlay)] max-h-64 overflow-y-auto overscroll-contain border border-ink-4 bg-ink-2"
            >
              {results.length === 0 && (
                <li className="px-[--space-3] py-[--space-3] text-mono-sm text-metal-500">
                  No match for “{query.trim()}”.
                </li>
              )}
              {results.map((entry, index) => (
                <li
                  key={entry.key}
                  role="presentation"
                  onMouseEnter={() => setActive(index)}
                >
                  <button
                    id={`${listId}-opt-${entry.key}`}
                    role="option"
                    aria-selected={index === active}
                    type="button"
                    onClick={() => commit(entry)}
                    className={`flex w-full items-center gap-[--space-2] px-[--space-3] py-[--space-2] text-left font-mono text-mono-xs transition-colors ${
                      index === active
                        ? "bg-ink-4 text-metal-100"
                        : "text-metal-300 hover:bg-ink-3"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-0.5 shrink-0"
                      style={{ backgroundColor: entry.accent }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    <span className="shrink-0 truncate text-metal-700">
                      {entry.meta}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {slot.invalid && (
        <p className="mt-[--space-3] border-l-2 border-guards bg-guards/5 px-[--space-3] py-[--space-2] font-mono text-mono-xs text-metal-300">
          No 911 matches “{slot.invalid}” — pick one above.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Metric bars
 * ------------------------------------------------------------------ */

function MetricCard({
  row,
  variants,
  labels,
  colours,
}: {
  row: Row;
  variants: IndexedVariant[];
  labels: string[];
  colours: string[];
}) {
  const metric = row.metric;
  if (!metric) return null;
  const values = variants.map(metric);
  const known = values.filter((value): value is number => typeof value === "number");
  const max = known.length ? Math.max(...known) : 0;
  const min = known.length ? Math.min(...known) : 0;
  const span = Math.max(max - min, 1e-6);

  return (
    <div className="border border-ink-4 bg-ink-2 p-[--space-4]">
      <p className="label mb-[--space-3]">
        {row.label}
        {row.lowerIsBetter && (
          <span className="ml-2 normal-case tracking-normal text-metal-700">
            lower is better
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-[--space-3]">
        {variants.map((variant, index) => {
          const value = values[index];
          const ratio =
            typeof value !== "number" || max === min
              ? null
              : row.lowerIsBetter
                ? 0.25 + 0.75 * (1 - (value - min) / span)
                : 0.25 + 0.75 * ((value - min) / span);
          return (
            <li key={`${row.key}-${variant.key}`}>
              <div className="mb-1 flex items-baseline justify-between gap-[--space-2]">
                <span className="truncate font-mono text-mono-xs text-metal-500">
                  {labels[index] || variant.name}
                </span>
                <span className="shrink-0 font-mono text-mono-sm text-metal-100">
                  {typeof value === "number" ? `${value} ${row.unit ?? ""}`.trim() : "—"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden bg-ink-4">
                <div
                  className="h-full transition-[width] duration-[--dur-slow] ease-[--ease-out-expo]"
                  style={{
                    width: `${Math.round((ratio ?? 0.04) * 100)}%`,
                    backgroundColor:
                      colours[index] && colours[index] !== ""
                        ? colours[index]
                        : "var(--color-guards)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
