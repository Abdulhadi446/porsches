import {
  CLIENT_GENERATIONS,
  clientVariants,
  type ClientGeneration,
  type ClientVariant,
} from "#lib/client-catalog";
import { fieldScore, normaliseQuery } from "./fuzzy";
import type { BodyStyle, GenerationId } from "#data/schema";

/**
 * Reads the SLIM client catalogue (`#lib/client-catalog`), not the raw
 * generation JSON: importing `#lib/generations` here shipped ~2 MB of initial
 * JS (gallery blur placeholders, credits and source URLs) to every route.
 * Server components still use `#lib/generations` for full-fidelity data.
 */
const GENERATIONS = CLIENT_GENERATIONS;
/** Local aliases so the helper signatures read the same as the full schema. */
type Variant = ClientVariant;
type Generation = ClientGeneration;

/**
 * NAV-UX CATALOGUE — owned by NAV-UX.
 *
 * One static index built at module scope from `allVariants()`: the fuzzy
 * palette, the `/search` facets, the `/variants` grid and the `/compare`
 * diff table all read from here. No network access, no `fetch`, and the
 * same module powers the RSC pages and the client components, so results are
 * byte-identical on both sides of hydration.
 *
 * URL contract (shared by /search and /variants):
 *   ?q=…&gen=996,997&body=coupe&engine=turbo&drive=rwd&year=1998-2005&sort=power&page=2
 * `gen`/`body`/`engine`/`drive` are comma separated multi-selects, `year` is
 * an inclusive `min-max` pair, and every param is omitted when it equals the
 * default so shared links stay short.
 */

export type EngineFamily = "air" | "water" | "turbo" | "hybrid";
export type DriveLayout = "rwd" | "awd";
export type SortKey =
  | "year-desc"
  | "year-asc"
  | "power-desc"
  | "power-asc"
  | "name-asc"
  | "gen-asc";

/* ------------------------------------------------------------------ *
 * Small shared utilities (kept local so NAV-UX owns no cross-tree deps)
 * ------------------------------------------------------------------ */

/** Hex → `rgba()`. Returns the input untouched when it is not hex. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const hex = match[1].length === 3 ? match[1].replace(/./g, "$&$&") : match[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function yearLabel(start: number, end: number | null): string {
  return `${start}\u2013${end ?? "today"}`;
}

const CURRENT_YEAR = new Date().getFullYear();

/* ------------------------------------------------------------------ *
 * Parsers — the data files are prose-heavy, so every numeric spec is
 * extracted with a tolerant regex instead of being trusted as a number.
 * ------------------------------------------------------------------ */

function numbersIn(text: string | null | undefined, re: RegExp): number[] {
  if (!text) return [];
  const out: number[] = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  for (const match of text.matchAll(new RegExp(re.source, flags))) {
    const value = Number.parseFloat((match[1] ?? match[0]).replace(/,/g, ""));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Peak output in PS. Falls back to bhp/hp when PS is absent. */
export function parsePowerPs(variant: Variant): number | null {
  if (typeof variant.powerPs === "number") return variant.powerPs;
  const ps = numbersIn(variant.power, /(\d{2,4}(?:\.\d+)?)\s*PS\b/i);
  if (ps.length) return Math.max(...ps);
  const hp = numbersIn(
    variant.power,
    /(\d{2,4}(?:\.\d+)?)\s*(?:bhp|hp)\b/i,
  );
  if (hp.length) return Math.max(...hp);
  return null;
}

/** Fastest published 0–100 km/h time in seconds. */
export function parseAccel(variant: Variant): number | null {
  const found = numbersIn(variant.acceleration, /(\d+(?:\.\d+)?)\s*s\b/i);
  return found.length ? Math.min(...found) : null;
}

/** Highest published top speed in km/h. */
export function parseTopSpeed(variant: Variant): number | null {
  const found = numbersIn(variant.topSpeed, /(\d{2,3})\s*km\/h/i);
  return found.length ? Math.max(...found) : null;
}

/** Lightest published kerb weight in kg. */
export function parseWeightKg(variant: Variant): number | null {
  const found = numbersIn(variant.weight, /([\d,]{3,6})\s*kg/i);
  return found.length ? Math.min(...found) : null;
}

/** 911s that are air-cooled by era: 901, G-series and the 993. */
const AIR_COOLED_ERAS = new Set<string>(["901", "gseries", "993"]);

export function engineFamilies(
  variant: Variant,
  generation: Generation,
): EngineFamily[] {
  const text = `${variant.name} ${variant.engine} ${variant.transmission ?? ""}`.toLowerCase();
  const families: EngineFamily[] = [];
  if (/hybrid|electric|e-hybrid|t-hybrid/.test(text)) families.push("hybrid");
  if (/turbo|turbine/.test(text)) families.push("turbo");
  if (/water-cool|liquid-cool/.test(text)) families.push("water");
  else if (/air-cool/.test(text)) families.push("air");
  else if (AIR_COOLED_ERAS.has(generation.id)) families.push("air");
  else families.push("water");
  return families;
}

export function driveLayouts(drivetrain: string | null | undefined): DriveLayout[] {
  const text = (drivetrain ?? "").toLowerCase();
  if (!text.trim()) return [];
  const out: DriveLayout[] = [];
  if (/all-wheel|all wheel|allwheel|\bawd\b|\b4wd\b/.test(text)) out.push("awd");
  if (/rear-wheel|rear wheel|\brwd\b/.test(text)) out.push("rwd");
  return out;
}

/* ------------------------------------------------------------------ *
 * Facet vocabularies
 * ------------------------------------------------------------------ */

export interface FacetOption<T extends string> {
  id: T;
  label: string;
}

export const BODY_FACETS: FacetOption<BodyStyle>[] = [
  { id: "coupe", label: "Coupé" },
  { id: "cabriolet", label: "Cabriolet" },
  { id: "targa", label: "Targa" },
  { id: "speedster", label: "Speedster" },
  { id: "roadster", label: "Roadster" },
  { id: "other", label: "Other" },
];

export const ENGINE_FACETS: FacetOption<EngineFamily>[] = [
  { id: "air", label: "Air-cooled" },
  { id: "water", label: "Water-cooled" },
  { id: "turbo", label: "Turbo" },
  { id: "hybrid", label: "Hybrid" },
];

export const DRIVE_FACETS: FacetOption<DriveLayout>[] = [
  { id: "rwd", label: "Rear-wheel drive" },
  { id: "awd", label: "All-wheel drive" },
];

export const SORT_OPTIONS: FacetOption<SortKey>[] = [
  { id: "year-asc", label: "Year — oldest first" },
  { id: "year-desc", label: "Year — newest first" },
  { id: "power-desc", label: "Power — most first" },
  { id: "power-asc", label: "Power — least first" },
  { id: "name-asc", label: "Name — A to Z" },
  { id: "gen-asc", label: "Generation" },
];

/* ------------------------------------------------------------------ *
 * The index
 * ------------------------------------------------------------------ */

export interface IndexedGeneration {
  id: GenerationId;
  code: string;
  name: string;
  tagline: string;
  accent: string;
  index: number;
  yearsStart: number;
  yearsEnd: number | null;
  years: string;
  variantCount: number;
  href: string;
  /** lowercase haystacks for the fuzzy matcher */
  f: { name: string; years: string; body: string };
}

export interface IndexedVariant {
  /** `${generationId}/${variantId}` — the /compare and deep-link key */
  key: string;
  id: string;
  name: string;
  href: string;
  generation: GenerationId;
  genCode: string;
  genName: string;
  genAccent: string;
  genIndex: number;
  years: string;
  yearStart: number;
  yearEnd: number;
  engine: string;
  power: string;
  powerPs: number | null;
  torque: string | null;
  accel: number | null;
  accelText: string | null;
  topSpeed: number | null;
  topSpeedText: string | null;
  weight: string | null;
  weightKg: number | null;
  drivetrain: string;
  drive: DriveLayout[];
  driveLabel: string;
  transmission: string;
  bodyStyles: BodyStyle[];
  bodyLabel: string;
  families: EngineFamily[];
  familyLabel: string;
  special: boolean;
  production: string | null;
  /** lowercased haystacks, grouped by field weight */
  f: {
    name: string;
    alias: string;
    gen: string;
    engine: string;
    years: string;
    spec: string;
    keys: string;
  };
}

const BODY_WORDS: Record<BodyStyle, string> = {
  coupe: "coupe coupé",
  cabriolet: "cabriolet convertible",
  targa: "targa",
  speedster: "speedster",
  roadster: "roadster spyder",
  other: "other body",
};

const ENGINE_WORDS: Record<EngineFamily, string> = {
  air: "air cooled aircooled naturally aspirated",
  water: "water cooled liquid cooled",
  turbo: "turbocharged turbo turbcharged",
  hybrid: "hybrid electric e hybrid t hybrid",
};

function driveWords(drive: DriveLayout[]): string {
  if (drive.length === 2) return "awd 4wd all wheel drive rwd rear wheel drive";
  if (drive[0] === "awd") return "awd 4wd all wheel drive";
  if (drive[0] === "rwd") return "rwd rear wheel drive";
  return "";
}

function bodyLabel(bodies: BodyStyle[]): string {
  const lookup = new Map(BODY_FACETS.map((f) => [f.id, f.label]));
  return bodies.map((b) => lookup.get(b) ?? b).join(" · ");
}

function familyLabel(families: EngineFamily[]): string {
  const lookup = new Map(ENGINE_FACETS.map((f) => [f.id, f.label]));
  return families.map((f) => lookup.get(f) ?? f).join(" · ");
}

export const GENERATION_INDEX: IndexedGeneration[] = GENERATIONS.map(
  (generation) => ({
    id: generation.id,
    code: generation.code,
    name: generation.name,
    tagline: generation.tagline ?? "",
    accent: generation.accent,
    index: generation.index,
    yearsStart: generation.yearsStart,
    yearsEnd: generation.yearsEnd ?? null,
    years: yearLabel(generation.yearsStart, generation.yearsEnd ?? null),
    variantCount: generation.variants.length,
    href: `/911/${generation.id}`,
    f: {
      name: `${generation.code} ${generation.name}`.toLowerCase(),
      years: `${generation.yearsStart} ${generation.yearsEnd ?? "today now"}`,
      body: generation.variants.map((v) => v.name).join(" ").toLowerCase(),
    },
  }),
).sort((a, b) => a.index - b.index);

function buildVariant(
  generation: ClientGeneration,
  variant: ClientVariant,
): IndexedVariant {
  const yearStart = variant.yearsStart ?? generation.yearsStart;
  const yearEnd = variant.yearsEnd ?? generation.yearsEnd ?? CURRENT_YEAR;
  const drive = driveLayouts(variant.drivetrain);
  const families = engineFamilies(variant, generation);
  const bodyStyles = variant.bodyStyles ?? [];
  const driveLabel =
    drive.length === 2
      ? "RWD / AWD"
      : drive[0] === "awd"
        ? "AWD"
        : drive[0] === "rwd"
          ? "RWD"
          : "—";
  const transmission = variant.transmission ?? "";
  return {
    key: `${generation.id}/${variant.id}`,
    id: variant.id,
    name: variant.name,
    href: `/911/${generation.id}/${variant.id}`,
    generation: generation.id,
    genCode: generation.code,
    genName: generation.name,
    genAccent: generation.accent,
    genIndex: generation.index,
    years: variant.years || yearLabel(yearStart, yearEnd),
    yearStart,
    yearEnd,
    engine: variant.engine,
    power: variant.power,
    powerPs: parsePowerPs(variant),
    torque: variant.torque ?? null,
    accel: parseAccel(variant),
    accelText: variant.acceleration ?? null,
    topSpeed: parseTopSpeed(variant),
    topSpeedText: variant.topSpeed ?? null,
    weight: variant.weight ?? null,
    weightKg: parseWeightKg(variant),
    drivetrain: variant.drivetrain ?? "",
    drive,
    driveLabel,
    transmission,
    bodyStyles,
    bodyLabel: bodyLabel(bodyStyles),
    families,
    familyLabel: familyLabel(families),
    special: variant.special === true,
    production: variant.production ?? null,
    f: {
      name: variant.name.toLowerCase(),
      alias: `${variant.id.replace(/[-_]+/g, " ")} ${variant.id} ${generation.code}`.toLowerCase(),
      gen: `${generation.code} ${generation.name} ${generation.id}`.toLowerCase(),
      engine: variant.engine.toLowerCase(),
      years: `${yearStart} ${yearEnd} ${variant.years}`.toLowerCase(),
      spec: [
        variant.power,
        transmission,
        variant.torque,
        variant.acceleration,
        variant.topSpeed,
        variant.weight,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      keys: [
        ...bodyStyles.map((b) => BODY_WORDS[b] ?? b),
        ...families.map((f) => ENGINE_WORDS[f] ?? f),
        driveWords(drive),
        variant.special ? "special edition limited rare" : "",
        "911 porsche",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

export const VARIANT_INDEX: IndexedVariant[] = clientVariants()
  .map(({ generationId, ...variant }) =>
    buildVariant(
      CLIENT_GENERATIONS.find((g) => g.id === generationId) as ClientGeneration,
      variant as ClientVariant,
    ),
  )
  .sort((a, b) => a.genIndex - b.genIndex || a.yearStart - b.yearStart || a.name.localeCompare(b.name));

export const VARIANT_BY_KEY: ReadonlyMap<string, IndexedVariant> = new Map(
  VARIANT_INDEX.map((v) => [v.key, v]),
);

export const YEAR_MIN = VARIANT_INDEX.reduce(
  (min, v) => Math.min(min, v.yearStart),
  CURRENT_YEAR,
);
export const YEAR_MAX = VARIANT_INDEX.reduce(
  (max, v) => Math.max(max, v.yearEnd),
  YEAR_MIN,
);

export const VARIANT_COUNT = VARIANT_INDEX.length;

/* ------------------------------------------------------------------ *
 * Fuzzy matching
 * ------------------------------------------------------------------ */

const WEIGHTS = {
  name: 12,
  alias: 9,
  gen: 6,
  keys: 5,
  engine: 4,
  spec: 3,
  years: 3,
} as const;

function variantScore(variant: IndexedVariant, query: string): number {
  let total = 0;
  for (const token of query.split(/\s+/)) {
    if (!token) continue;
    const best = Math.max(
      fieldScore(variant.f.name, token) * WEIGHTS.name,
      fieldScore(variant.f.alias, token) * WEIGHTS.alias,
      fieldScore(variant.f.gen, token) * WEIGHTS.gen,
      fieldScore(variant.f.keys, token) * WEIGHTS.keys,
      fieldScore(variant.f.engine, token) * WEIGHTS.engine,
      fieldScore(variant.f.spec, token) * WEIGHTS.spec,
      fieldScore(variant.f.years, token) * WEIGHTS.years,
    );
    if (best <= 0) return 0;
    total += best;
  }
  if (variant.f.name === query) total += 24;
  else if (variant.f.name.startsWith(query)) total += 10;
  if (variant.special) total += 1.5;
  return total;
}

function generationScore(generation: IndexedGeneration, query: string): number {
  let total = 0;
  for (const token of query.split(/\s+/)) {
    if (!token) continue;
    const best = Math.max(
      fieldScore(generation.f.name, token) * 12,
      fieldScore(generation.f.years, token) * 3,
      fieldScore(generation.f.body, token) * 4,
    );
    if (best <= 0) return 0;
    total += best;
  }
  return total * 0.8;
}

export interface PaletteEntry {
  kind: "generation" | "variant";
  key: string;
  label: string;
  /** secondary line: years, engine, power … */
  meta: string;
  href: string;
  accent: string;
  /** 0 for generations, the timeline chapter for variants */
  ordinal: number;
}

export interface SearchResults {
  generations: PaletteEntry[];
  variants: PaletteEntry[];
  total: number;
}

/** Fuzzy search over the static index. Never throws, never fetches. */
export function searchIndex(query: string, limit = 60): SearchResults {
  const q = normaliseQuery(query);
  if (!q) return { generations: [], variants: [], total: 0 };

  const generations: Array<{ entry: PaletteEntry; score: number }> = [];
  for (const generation of GENERATION_INDEX) {
    const score = generationScore(generation, q);
    if (score <= 0) continue;
    generations.push({
      score,
      entry: {
        kind: "generation",
        key: generation.id,
        label: `${generation.code} — ${generation.name}`,
        meta: `${generation.years} · ${generation.variantCount} variants`,
        href: generation.href,
        accent: generation.accent,
        ordinal: 0,
      },
    });
  }

  const variants: Array<{ entry: PaletteEntry; score: number }> = [];
  for (const variant of VARIANT_INDEX) {
    const score = variantScore(variant, q);
    if (score <= 0) continue;
    variants.push({
      score,
      entry: {
        kind: "variant",
        key: variant.key,
        label: variant.name,
        meta: [
          variant.genCode,
          variant.years,
          variant.power ? `${variant.powerPs ?? ""} PS`.trim() || variant.power : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: variant.href,
        accent: variant.genAccent,
        ordinal: variant.genIndex,
      },
    });
  }

  generations.sort((a, b) => b.score - a.score);
  variants.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label));

  return {
    generations: generations.slice(0, limit).map((r) => r.entry),
    variants: variants.slice(0, limit).map((r) => r.entry),
    total: generations.length + variants.length,
  };
}

/* ------------------------------------------------------------------ *
 * Filters + URL contract
 * ------------------------------------------------------------------ */

export const PAGE_SIZE = 24;

export interface VariantFilters {
  q: string;
  gens: string[];
  bodies: BodyStyle[];
  engines: EngineFamily[];
  drives: DriveLayout[];
  yearFrom: number;
  yearTo: number;
  sort: SortKey;
  page: number;
}

export const DEFAULT_SORT: SortKey = "year-desc";

export function defaultFilters(): VariantFilters {
  return {
    q: "",
    gens: [],
    bodies: [],
    engines: [],
    drives: [],
    yearFrom: YEAR_MIN,
    yearTo: YEAR_MAX,
    sort: DEFAULT_SORT,
    page: 1,
  };
}

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function readParam(source: ParamSource, key: string): string[] {
  if (!source) return [];
  if (source instanceof URLSearchParams) {
    return source.getAll(key).flatMap((v) => v.split(","));
  }
  const raw = source[key];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values.flatMap((v) => String(v).split(","));
}

function cleanList<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && (allowed as readonly string[]).includes(trimmed) && !out.includes(trimmed as T)) {
      out.push(trimmed as T);
    }
  }
  return out;
}

const BODY_IDS = BODY_FACETS.map((f) => f.id);
const ENGINE_IDS = ENGINE_FACETS.map((f) => f.id);
const DRIVE_IDS = DRIVE_FACETS.map((f) => f.id);
const GEN_IDS = GENERATION_INDEX.map((g) => g.id);
const SORT_IDS = SORT_OPTIONS.map((o) => o.id);

/** Tolerant parser: unknown / malformed params fall back to the defaults. */
export function filtersFromParams(source: ParamSource): VariantFilters {
  const filters = defaultFilters();
  if (!source) return filters;

  filters.q = readParam(source, "q")[0]?.trim() ?? "";
  filters.gens = cleanList(readParam(source, "gen"), GEN_IDS);
  filters.bodies = cleanList(readParam(source, "body"), BODY_IDS);
  filters.engines = cleanList(readParam(source, "engine"), ENGINE_IDS);
  filters.drives = cleanList(readParam(source, "drive"), DRIVE_IDS);

  const year = readParam(source, "year")[0]?.trim() ?? "";
  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(year);
  const single = /^(\d{4})$/.exec(year);
  if (range) {
    const from = clamp(Number.parseInt(range[1], 10), YEAR_MIN, YEAR_MAX);
    const to = clamp(Number.parseInt(range[2], 10), YEAR_MIN, YEAR_MAX);
    filters.yearFrom = Math.min(from, to);
    filters.yearTo = Math.max(from, to);
  } else if (single) {
    const only = clamp(Number.parseInt(single[1], 10), YEAR_MIN, YEAR_MAX);
    filters.yearFrom = only;
    filters.yearTo = only;
  }

  const sort = readParam(source, "sort")[0]?.trim();
  if (sort && (SORT_IDS as string[]).includes(sort)) filters.sort = sort as SortKey;

  const page = Number.parseInt(readParam(source, "page")[0] ?? "1", 10);
  filters.page = Number.isFinite(page) && page > 0 ? page : 1;

  return filters;
}

/** Query string (no leading `?`) with every default omitted. */
export function filtersToQuery(filters: VariantFilters): string {
  const parts: string[] = [];
  if (filters.q.trim()) parts.push(`q=${encodeURIComponent(filters.q.trim())}`);
  if (filters.gens.length) parts.push(`gen=${filters.gens.join(",")}`);
  if (filters.bodies.length) parts.push(`body=${filters.bodies.join(",")}`);
  if (filters.engines.length) parts.push(`engine=${filters.engines.join(",")}`);
  if (filters.drives.length) parts.push(`drive=${filters.drives.join(",")}`);
  if (filters.yearFrom !== YEAR_MIN || filters.yearTo !== YEAR_MAX) {
    parts.push(`year=${filters.yearFrom}-${filters.yearTo}`);
  }
  if (filters.sort !== DEFAULT_SORT) parts.push(`sort=${filters.sort}`);
  if (filters.page > 1) parts.push(`page=${filters.page}`);
  return parts.join("&");
}

export function filtersHref(path: string, filters: VariantFilters): string {
  const query = filtersToQuery(filters);
  return query ? `${path}?${query}` : path;
}

export type FilterGroup = "gens" | "bodies" | "engines" | "drives";

/** Add or remove one facet value — the primitive behind every filter chip. */
export function toggleFilterValue(
  filters: VariantFilters,
  group: FilterGroup,
  value: string,
): VariantFilters {
  const next: VariantFilters = { ...filters, page: 1 };
  const list = filters[group] as string[];
  next[group] = (
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  ) as never;
  return next;
}

export function setSort(filters: VariantFilters, sort: SortKey): VariantFilters {
  return { ...filters, sort, page: 1 };
}

export function setQuery(filters: VariantFilters, q: string): VariantFilters {
  return { ...filters, q, page: 1 };
}

export function setYearRange(
  filters: VariantFilters,
  yearFrom: number,
  yearTo: number,
): VariantFilters {
  const from = clamp(Math.min(yearFrom, yearTo), YEAR_MIN, YEAR_MAX);
  const to = clamp(Math.max(yearFrom, yearTo), YEAR_MIN, YEAR_MAX);
  return { ...filters, yearFrom: from, yearTo: to, page: 1 };
}

export function setPage(filters: VariantFilters, page: number): VariantFilters {
  return { ...filters, page: Math.max(1, page) };
}

/** First value of a `?a=1&a=2` style param, tolerant of missing values. */
export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function activeFilterCount(filters: VariantFilters): number {
  return (
    filters.gens.length +
    filters.bodies.length +
    filters.engines.length +
    filters.drives.length +
    (filters.q.trim() ? 1 : 0) +
    (filters.yearFrom !== YEAR_MIN || filters.yearTo !== YEAR_MAX ? 1 : 0)
  );
}

function intersects<T extends string>(a: T[], b: T[]): boolean {
  return a.some((value) => b.includes(value));
}

function matchesText(variant: IndexedVariant, query: string): boolean {
  if (!query) return true;
  return variantScore(variant, query) > 0;
}

/** Year overlap: a variant passes when its span intersects the range. */
function matchesYears(variant: IndexedVariant, from: number, to: number): boolean {
  return variant.yearStart <= to && variant.yearEnd >= from;
}

export function filterVariants(
  filters: VariantFilters,
  list: readonly IndexedVariant[] = VARIANT_INDEX,
): IndexedVariant[] {
  const query = normaliseQuery(filters.q);
  return list.filter(
    (variant) =>
      (!filters.gens.length || filters.gens.includes(variant.generation)) &&
      (!filters.bodies.length ||
        variant.bodyStyles.some((b) => filters.bodies.includes(b))) &&
      (!filters.engines.length || intersects(variant.families, filters.engines)) &&
      (!filters.drives.length || intersects(variant.drive, filters.drives)) &&
      matchesYears(variant, filters.yearFrom, filters.yearTo) &&
      matchesText(variant, query),
  );
}

export function sortVariants(
  list: IndexedVariant[],
  sort: SortKey,
): IndexedVariant[] {
  const sorted = [...list];
  switch (sort) {
    case "year-asc":
      sorted.sort(
        (a, b) => a.yearStart - b.yearStart || a.name.localeCompare(b.name),
      );
      break;
    case "power-desc":
      sorted.sort(
        (a, b) => (b.powerPs ?? -1) - (a.powerPs ?? -1) || a.name.localeCompare(b.name),
      );
      break;
    case "power-asc":
      sorted.sort(
        (a, b) => (a.powerPs ?? Number.MAX_SAFE_INTEGER) - (b.powerPs ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
      );
      break;
    case "name-asc":
      sorted.sort(
        (a, b) => a.name.localeCompare(b.name) || a.yearStart - b.yearStart,
      );
      break;
    case "gen-asc":
      sorted.sort(
        (a, b) => a.genIndex - b.genIndex || a.yearStart - b.yearStart,
      );
      break;
    case "year-desc":
    default:
      sorted.sort(
        (a, b) => b.yearStart - a.yearStart || a.name.localeCompare(b.name),
      );
      break;
  }
  return sorted;
}

export function applyFilters(
  filters: VariantFilters,
  list: readonly IndexedVariant[] = VARIANT_INDEX,
): IndexedVariant[] {
  return sortVariants(filterVariants(filters, list), filters.sort);
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function pageSlice(list: IndexedVariant[], page: number): IndexedVariant[] {
  const start = clamp((page - 1) * PAGE_SIZE, 0, list.length);
  return list.slice(start, start + PAGE_SIZE);
}

/* ------------------------------------------------------------------ *
 * Compare slots — `?a=996/carrera&b=993/turbo`
 * ------------------------------------------------------------------ */

export const COMPARE_SLOT_KEYS = ["a", "b", "c", "d"] as const;
export type CompareSlotKey = (typeof COMPARE_SLOT_KEYS)[number];

export interface CompareSlot {
  key: CompareSlotKey;
  /** `generation/variant` — the canonical value written to the URL */
  value: string;
  variant: IndexedVariant | null;
  /** set when the URL carried something unrecognised */
  invalid: string;
}

/**
 * Resolve one slot param. Accepts `<gen>/<variant>` (the deep-link format the
 * variant pages emit) and a bare `<gen>` (which snaps to that generation's
 * first variant). Anything else resolves to an empty, pickable slot.
 */
export function resolveSlot(
  key: CompareSlotKey,
  raw: string | null | undefined,
): CompareSlot {
  const value = (raw ?? "").trim();
  const base: CompareSlot = { key, value: "", variant: null, invalid: "" };
  if (!value) return base;

  const [genId, variantId] = value.split("/");
  const generation = GENERATION_INDEX.find((g) => g.id === genId);
  if (!generation) return { ...base, invalid: value };

  if (!variantId) {
    const first = VARIANT_INDEX.find((v) => v.generation === genId);
    if (!first) return { ...base, invalid: value };
    return { key, value: first.key, variant: first, invalid: "" };
  }

  const variant = VARIANT_BY_KEY.get(`${genId}/${variantId}`);
  if (!variant) return { ...base, invalid: value };
  return { key, value: variant.key, variant, invalid: "" };
}

export function slotsToQuery(slots: CompareSlot[]): string {
  const parts = COMPARE_SLOT_KEYS.map((key) => {
    const slot = slots.find((s) => s.key === key);
    return slot?.value ? `${key}=${encodeURIComponent(slot.value)}` : "";
  }).filter(Boolean);
  return parts.join("&");
}
