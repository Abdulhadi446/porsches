import type { BodyStyle } from "#data/schema";

/**
 * Pure formatting helpers shared by every components/variant module.
 *
 * Server-safe (no "use client"): imported by server pages *and* client
 * leaves. Nothing here touches `window`, the DOM or the filesystem.
 */

/* ------------------------------------------------------------------ */
/* class names                                                        */
/* ------------------------------------------------------------------ */

export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* em dash — the ONLY thing we render for a field the data could not    */
/* verify. Never a zero, never a guess.                                */
/* ------------------------------------------------------------------ */

export const DASH = "—";

export function dash(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : DASH;
}

export function hasValue(
  value: string | number | null | undefined,
): value is string | number {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return value.trim().length > 0;
}

/* ------------------------------------------------------------------ */
/* years                                                              */
/* ------------------------------------------------------------------ */

/** "1963–1973" · "1963–present" · "1963". */
export function yearRange(start: number, end: number | null): string {
  const from = Math.trunc(start);
  const to = end === null ? null : Math.trunc(end);
  if (to === null || to === from) return String(from);
  return `${from}–${to}`;
}

/* ------------------------------------------------------------------ */
/* leading-figure extraction (drives the count-up counters)            */
/* ------------------------------------------------------------------ */

export interface LeadFigure {
  /** parsed value, e.g. 4.1 */
  value: number;
  /** decimals as written in the source string, e.g. 1 */
  decimals: number;
  /** the unit that immediately follows the number, e.g. "km/h" */
  suffix: string;
  /** everything after the figure, cleaned up — "(183 mph) Coupé" */
  rest: string;
}

/** Digits, grouping separators, spaces and one trailing decimal part. */
const LEAD_RE = /^[\s ]*(\d[\d., ]*\d|\d)[\s ]*([^\s,(]*)/;

/**
 * A countable suffix has to be a *unit*: letters, digits-free, optionally
 * slashed (`km/h`, `lb/ft`, `Nm`). This is what rejects the two shapes that
 * would otherwise turn into nonsense counters:
 *
 *  - `"0–100 km/h 13.5 s (porsche.com)"`  → leading "0" + suffix "–100"
 *  - `"5-speed manual (Typ 901)"`          → leading "5" + suffix "-speed"
 *
 * Both stay plain text, which is the honest presentation for them.
 */
const UNIT_SUFFIX_RE = /^(?:[A-Za-z°%]{1,10})?(?:[·/][A-Za-z]{1,10})?$/;

function parseNumeric(raw: string): { value: number; decimals: number } {
  let text = raw.replace(/[\s ]/g, "");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const separator = Math.max(lastDot, lastComma);
  let decimals = 0;
  let decimalPart = false;

  if (separator >= 0) {
    const tail = text.slice(separator + 1);
    // a trailing group of 1–2 digits is a decimal part ("4.1"), a trailing
    // group of 3 is a thousands separator ("1,520")
    if (/^\d{1,2}$/.test(tail)) {
      decimals = tail.length;
      decimalPart = true;
      text = `${text.slice(0, separator)}.${tail}`;
    }
  }

  // only strip grouping separators when the dot is not a decimal point
  if (!decimalPart) text = text.replace(/[.,]/g, "");

  const value = Number.parseFloat(text);
  return { value, decimals };
}

/**
 * Pull the headline figure out of a spec string.
 *
 * `"4.1 s (0–100 km/h; 3.9 s with Sport Chrono)"` →
 *   `{ value: 4.1, decimals: 1, suffix: "s", rest: "(0–100 km/h; …)" }`
 *
 * Returns `null` when the string does not *start* with a number — a figure
 * buried mid-sentence is never promoted, because animating it would imply a
 * precision the source does not claim.
 */
export function leadFigure(input: string | null | undefined): LeadFigure | null {
  if (!input) return null;
  const match = LEAD_RE.exec(input);
  if (!match) return null;
  const { value, decimals } = parseNumeric(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = (match[2] ?? "").trim();
  if (!UNIT_SUFFIX_RE.test(suffix)) return null;
  const rest = input
    .slice(match[0].length)
    .replace(/^[\s ]*[(–—,;:]?[\s ]*/, "");
  return { value, decimals, suffix, rest };
}

const NUMBER_FORMAT = new Map<number, Intl.NumberFormat>();

/** 1520/0 → "1,520" · 4.1/1 → "4.1" — stable between server and client. */
export function formatNumber(value: number, decimals: number): string {
  let formatter = NUMBER_FORMAT.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    NUMBER_FORMAT.set(decimals, formatter);
  }
  return formatter.format(value);
}

/* ------------------------------------------------------------------ */
/* body styles                                                        */
/* ------------------------------------------------------------------ */

const BODY_STYLE_LABELS: Record<BodyStyle, string> = {
  coupe: "Coupé",
  cabriolet: "Cabriolet",
  targa: "Targa",
  speedster: "Speedster",
  roadster: "Roadster",
  other: "Other",
};

export function bodyStyleLabel(style: BodyStyle): string {
  return BODY_STYLE_LABELS[style] ?? style;
}

export function bodyStyleList(styles: readonly BodyStyle[] | undefined): string {
  if (!styles || styles.length === 0) return DASH;
  return styles.map(bodyStyleLabel).join(" · ");
}

/* ------------------------------------------------------------------ */
/* misc                                                               */
/* ------------------------------------------------------------------ */

/** Clamp + round helper used by the easing maths in the counters. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}