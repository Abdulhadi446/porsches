import type { Variant } from "#data/schema";
import {
  DASH,
  bodyStyleList,
  dash,
  hasValue,
  leadFigure,
} from "./format";

/**
 * The spec plate.
 *
 * Rules that keep the page honest:
 *  - a field the data could not verify renders `"—"` and never `0`;
 *  - a count-up is only produced from a figure the source string *starts*
 *    with (`leadFigure`), so nothing is invented and nothing is truncated;
 *  - whenever the row is a dash we surface the matching `missing[]` note from
 *    the data file so the gap is explained rather than hidden.
 */

export interface SpecCount {
  value: number;
  decimals: number;
  suffix?: string;
}

export interface SpecRow {
  /** stable key, also the React key and the diff-table column id */
  key: string;
  label: string;
  /** headline text (starts with the counted figure when `count` is set) */
  value: string;
  /** the remainder of the source string, shown under the figure */
  detail?: string;
  /** the animated figure, when the source has one */
  count?: SpecCount;
  /** `true` when the row is a dash (rendered, and explained, not hidden) */
  missing: boolean;
  /** `missing[]` note that explains the dash, if the data offers one */
  note?: string;
  /** long strings get the full width */
  wide?: boolean;
}

/** keyword → row key, used to attach the right `missing[]` note to a row. */
const NOTE_HINTS: Array<[string, RegExp]> = [
  ["acceleration", /(0[\u2013-]100|accelerat|0-60|sprint)/i],
  ["topSpeed", /(top speed|max(imum)? speed|km\/h)/i],
  ["weight", /(weight|kerb|din)/i],
  ["production", /(production|built|how many|total|count|units)/i],
  ["power", /(power|ps\b|kw\b|output|torque)/i],
  ["engine", /(engine|displacement|litre|cc\b|capacity)/i],
  ["transmission", /(transmission|gearbox|manual|pdk|clutch)/i],
  ["drivetrain", /(all-wheel|awd|drivetrain|rear-wheel)/i],
];

/**
 * Pick the `missing[]` entry that explains a dashed row. Data files write
 * free-text notes, so this is keyword matching — it never invents a reason,
 * it only links a note the data agent already wrote.
 */
export function noteFor(
  missing: readonly string[] | undefined,
  key: string,
  used: Set<string>,
): string | undefined {
  const notes = missing ?? [];
  if (notes.length === 0) return undefined;
  const hint = NOTE_HINTS.find(([name]) => name === key)?.[1];
  if (hint) {
    const found = notes.find(
      (note) => !used.has(note) && hint.test(note),
    );
    if (found) {
      used.add(found);
      return found;
    }
  }
  const spare = notes.find((note) => !used.has(note));
  if (spare) used.add(spare);
  return spare;
}

function textRow(
  key: string,
  label: string,
  value: string | null | undefined,
  options: { wide?: boolean; missing?: readonly string[]; used: Set<string> } = { used: new Set() },
): SpecRow {
  const used = options.used ?? new Set<string>();
  const present = hasValue(value);
  const text = present ? (value as string).trim() : DASH;
  const figure = present ? leadFigure(text) : null;
  return {
    key,
    label,
    value: text,
    detail: figure && figure.rest ? figure.rest : undefined,
    count: figure
      ? { value: figure.value, decimals: figure.decimals, suffix: figure.suffix }
      : undefined,
    missing: !present,
    note: present ? undefined : noteFor(options.missing, key, used),
    wide: options.wide,
  };
}

/**
 * The nine spec counters the brief asks for, in reading order:
 * engine, power, 0–100, top speed, weight, drivetrain, transmission,
 * production, body styles.
 */
export function buildSpecRows(variant: Variant): SpecRow[] {
  const used = new Set<string>();
  const missing = variant.missing;
  const rows: SpecRow[] = [];

  rows.push(
    textRow("engine", "Engine", variant.engine, {
      wide: true,
      missing,
      used,
    }),
  );

  // Power: headline the metric figure (PS) when the data carries it, and keep
  // the full quoted string underneath. `powerPs` is data, never derived.
  if (hasValue(variant.powerPs) && typeof variant.powerPs === "number") {
    const full = dash(variant.power);
    rows.push({
      key: "power",
      label: "Power",
      value: full,
      detail: full,
      count: { value: variant.powerPs, decimals: 0, suffix: "PS" },
      missing: false,
      wide: true,
    });
  } else {
    rows.push(textRow("power", "Power", variant.power, { wide: true, missing, used }));
  }

  rows.push(textRow("acceleration", "0–100 km/h", variant.acceleration, { missing, used }));
  rows.push(textRow("topSpeed", "Top speed", variant.topSpeed, { missing, used }));
  rows.push(textRow("weight", "Weight", variant.weight, { missing, used }));
  rows.push(textRow("drivetrain", "Drivetrain", variant.drivetrain, { missing, used }));
  rows.push(textRow("transmission", "Transmission", variant.transmission, {
    wide: true,
    missing,
    used,
  }));
  rows.push(textRow("production", "Production", variant.production, { missing, used }));

  rows.push({
    key: "bodyStyles",
    label: "Body styles",
    value: bodyStyleList(variant.bodyStyles),
    missing: !variant.bodyStyles || variant.bodyStyles.length === 0,
    note:
      variant.bodyStyles && variant.bodyStyles.length > 0
        ? undefined
        : noteFor(missing, "bodyStyles", used),
    wide: true,
  });

  if (hasValue(variant.torque)) {
    rows.push(textRow("torque", "Torque", variant.torque, { wide: true, missing, used }));
  }

  return rows;
}

/** Rows used by the compact diff table (torque is a nice-to-have, not a column). */
export function diffRowKeys(): string[] {
  return [
    "years",
    "engine",
    "power",
    "acceleration",
    "topSpeed",
    "weight",
    "drivetrain",
    "transmission",
    "bodyStyles",
    "production",
  ];
}

export const DIFF_LABELS: Record<string, string> = {
  years: "Years",
  engine: "Engine",
  power: "Power",
  acceleration: "0–100 km/h",
  topSpeed: "Top speed",
  weight: "Weight",
  drivetrain: "Drivetrain",
  transmission: "Transmission",
  bodyStyles: "Body styles",
  production: "Production",
};

/**
 * Compact per-variant values for the compare table — the leading figure is
 * enough there; the full string lives on the spec plate.
 */
export function diffCells(variant: Variant): Record<string, string> {
  const cells: Record<string, string> = {
    years: variant.years,
    engine: variant.engine,
    power: variant.power,
    acceleration: dash(variant.acceleration),
    topSpeed: dash(variant.topSpeed),
    weight: dash(variant.weight),
    drivetrain: dash(variant.drivetrain),
    transmission: dash(variant.transmission),
    bodyStyles: bodyStyleList(variant.bodyStyles),
    production: dash(variant.production),
  };
  // keep cells readable: the headline figure plus its unit
  for (const key of ["acceleration", "topSpeed", "weight"]) {
    const figure = leadFigure(cells[key]);
    if (figure) cells[key] = `${formatLead(figure.value, figure.decimals)}${unitSuffix(figure.suffix)}`;
  }
  if (hasValue(variant.powerPs) && typeof variant.powerPs === "number") {
    cells.power = `${variant.powerPs} PS`;
  }
  return cells;
}

function formatLead(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function unitSuffix(suffix: string): string {
  return suffix ? ` ${suffix}` : "";
}