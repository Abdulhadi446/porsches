import type { ClientGeneration as Generation } from "#lib/client-catalog";

/**
 * Pure presentation helpers for the scroll timeline.
 * Everything here is derived from data files so the components upgrade
 * automatically once the data + asset agents land their content.
 */

/** "1963–1973" / "2024–today" */
export function yearLabel(start: number, end: number | null): string {
  return `${start}\u2013${end ?? "today"}`;
}

/** Short ordinal used by the rail + readouts: "03/09". */
export function chapterOrdinal(index: number, total: number): string {
  return `${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
}

/** Words that carry no typographic weight as an era stamp. */
const GENERIC_WORDS = /^(generation|gen|era|series|model|porsche|911|of|the)$/i;

/**
 * The oversized outlined word that stamps each chapter.
 * Derived from `name` first (stable), falling back to `tagline`, then `code`.
 */
export function eraStamp(generation: Generation): string {
  for (const source of [generation.name, generation.tagline]) {
    if (!source) continue;
    const words = source
      .split(/[\s/|,\u2014\u2013\u00b7]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2)
      .filter((word) => !GENERIC_WORDS.test(word))
      .filter((word) => !/^\d+(\.\d+)?$/.test(word));
    if (words.length > 0) {
      const stamp = words.slice(-2).join(" ").toUpperCase();
      return stamp.length > 26 ? `${stamp.slice(0, 25)}\u2026` : stamp;
    }
  }
  return generation.code.toUpperCase();
}

/** Hex -> `rgba()` so a generation accent can tint surfaces. Never throws. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const hex = match[1];
  const expand = (pair: string) => parseInt(pair, 16);
  const r =
    hex.length === 3 ? expand(hex[0] + hex[0]) : expand(hex.slice(0, 2));
  const g =
    hex.length === 3 ? expand(hex[1] + hex[1]) : expand(hex.slice(2, 4));
  const b =
    hex.length === 3 ? expand(hex[2] + hex[2]) : expand(hex.slice(4, 6));
  if ([r, g, b].some(Number.isNaN)) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** One entry per calendar year for the horizontal year scrub. */
export interface YearTick {
  year: number;
  /** true on every 10th year (plus the first) — gets a stronger tick */
  decade: boolean;
  /** "'70s" style caption for decades */
  caption: string;
}

export function yearTicks(start: number, end: number): YearTick[] {
  const ticks: YearTick[] = [];
  for (let year = start; year <= end; year += 1) {
    const decade = year % 10 === 0;
    ticks.push({
      year,
      decade,
      caption: decade ? `'${String(year).slice(2)}s` : "",
    });
  }
  return ticks;
}

/** Accessible sentence used for the rail's live region. */
export function chapterAnnouncement(
  generation: Generation,
  index: number,
  total: number,
): string {
  return `Chapter ${index + 1} of ${total}: ${generation.code}, ${generation.name}, ${yearLabel(generation.yearsStart, generation.yearsEnd)}.`;
}