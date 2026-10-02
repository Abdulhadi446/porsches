import type { Generation, Variant } from "#data/schema";

/**
 * "Compare with" candidate selection.
 *
 * Runs over ONE generation's variant list (13–23 entries), so the cost is
 * negligible and the result is fully deterministic: the same page always
 * shows the same neighbours. No randomisation, no filesystem, no fetching.
 *
 * Score, highest first:
 *   +3  shares a body style with the current variant (a GT3 RS wants a GT3,
 *       a Speedster wants a Cabriolet)
 *   +2  same drivetrain / same transmission family
 *   +1  special-edition peers (Carrera RS 2.7 next to Carrera RS 3.0)
 *   −   distance in years (each year away costs 1.5)
 *   −   distance in power, normalised against the generation's own spread
 */

export interface Sibling {
  generation: Generation;
  variant: Variant;
  /** `<genId>/<variantId>` */
  key: string;
  href: string;
  score: number;
  /** short, human justification rendered under the link */
  reason: string;
}

function powerOf(variant: Variant): number | null {
  return typeof variant.powerPs === "number" && Number.isFinite(variant.powerPs)
    ? variant.powerPs
    : null;
}

function yearOf(variant: Variant): number {
  return typeof variant.yearsStart === "number" ? variant.yearsStart : 0;
}

function transmissionFamily(variant: Variant): string {
  const text = (variant.transmission ?? "").toLowerCase();
  if (text.includes("manual")) return "manual";
  if (text.includes("pdk") || text.includes("dual-clutch")) return "pdk";
  if (text.includes("tiptronic")) return "tiptronic";
  return text ? "other" : "unknown";
}

function drivetrainFamily(variant: Variant): string {
  const text = (variant.drivetrain ?? "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("all-wheel") || text.includes("awd")) return "awd";
  if (text.includes("rear-wheel") || text.includes("rwd")) return "rwd";
  return "other";
}

function bodyOverlap(a: Variant, b: Variant): number {
  const styles = new Set(a.bodyStyles ?? []);
  return (b.bodyStyles ?? []).filter((style) => styles.has(style)).length;
}

/**
 * Roof families. A Speedster has no peer in the 993 catalogue that shares the
 * `speedster` body style, but "open" is the comparison a reader actually
 * wants — so Cabriolet / Targa / Speedster / Roadster count as neighbours.
 */
const BODY_FAMILY: Record<string, string> = {
  coupe: "closed",
  cabriolet: "open",
  targa: "open",
  speedster: "open",
  roadster: "open",
  other: "other",
};

function familyOf(variant: Variant): Set<string> {
  const families = new Set<string>();
  for (const style of variant.bodyStyles ?? []) {
    const family = BODY_FAMILY[style] ?? "other";
    if (family !== "other") families.add(family);
  }
  return families;
}

/** Which generation to mine for siblings when the current one is thin. */
function fallbackGenerations(
  generation: Generation,
  all: readonly Generation[],
): Generation[] {
  const byIndex = [...all].sort((x, y) => x.index - y.index);
  const start = Math.max(
    0,
    byIndex.findIndex((candidate) => candidate.id === generation.id) - 1,
  );
  return byIndex.slice(start, start + 3).filter((candidate) => candidate.id !== generation.id);
}

/**
 * 2–4 sensible siblings. Prefers the current generation; only reaches across
 * to the neighbours when it cannot find enough (thin generations such as 996
 * still get a full comparison set).
 */
export function pickSiblings(
  generation: Generation,
  variant: Variant,
  allGenerations: readonly Generation[],
  count = 3,
): Sibling[] {
  const max = Math.max(2, Math.min(4, count));
  const pool: Array<{ generation: Generation; variant: Variant }> = [
    ...generation.variants
      .filter((candidate) => candidate.id !== variant.id)
      .map((candidate) => ({ generation, variant: candidate })),
  ];

  if (pool.length < max) {
    for (const other of fallbackGenerations(generation, allGenerations)) {
      for (const candidate of other.variants) {
        pool.push({ generation: other, variant: candidate });
      }
    }
  }

  const powers = pool
    .map((entry) => powerOf(entry.variant))
    .filter((value): value is number => value !== null);
  const spread = Math.max(1, Math.max(...powers, 0) - Math.min(...powers, 0));

  const selfPower = powerOf(variant);
  const selfYear = yearOf(variant);
  const selfFamily = familyOf(variant);
  const selfTransmission = transmissionFamily(variant);
  const selfDrivetrain = drivetrainFamily(variant);

  const scored = pool.map((entry) => {
    const candidate = entry.variant;
    const overlap = bodyOverlap(variant, candidate);
    const candidateFamily = familyOf(candidate);
    const sameRoof = [...candidateFamily].some((family) => selfFamily.has(family));
    const powerDistance =
      selfPower !== null ? Math.abs(selfPower - (powerOf(candidate) ?? selfPower)) : 0;
    const yearDistance = Math.abs(selfYear - yearOf(candidate));

    let score = 0;
    score += overlap * 3;
    if (sameRoof) score += 2;
    if (transmissionFamily(candidate) === selfTransmission) score += 2;
    if (drivetrainFamily(candidate) === selfDrivetrain) score += 1;
    if (Boolean(candidate.special) === Boolean(variant.special)) score += 1;
    score -= yearDistance * 1.5;
    score -= (powerDistance / spread) * 4;

    return { ...entry, score, overlap, sameRoof, powerDistance, yearDistance };
  });

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
    // deterministic tie-breaks
    const powerA = powerOf(a.variant) ?? Number.POSITIVE_INFINITY;
    const powerB = powerOf(b.variant) ?? Number.POSITIVE_INFINITY;
    if (powerA !== powerB) return powerA - powerB;
    return a.variant.id.localeCompare(b.variant.id);
  });

  return scored.slice(0, max).map((entry) => ({
    generation: entry.generation,
    variant: entry.variant,
    key: `${entry.generation.id}/${entry.variant.id}`,
    href: `/911/${entry.generation.id}/${entry.variant.id}`,
    score: entry.score,
    reason: reasonFor(entry.overlap, entry.sameRoof, entry.yearDistance),
  }));
}

function reasonFor(overlap: number, sameRoof: boolean, yearDistance: number): string {
  if (overlap > 0 && yearDistance <= 1) return "Same body, same era";
  if (overlap > 0) return "Same body style";
  if (sameRoof && yearDistance <= 4) return "Same roofline, near in time";
  if (sameRoof) return "Same roofline";
  if (yearDistance <= 2) return "Nearest in time";
  return "Nearest in power";
}

/** `/compare?a=<genId>/<variantId>&b=<genId>/<variantId>` */
export function compareHref(aKey: string, bKey: string): string {
  return `/compare?a=${encodeURIComponent(aKey)}&b=${encodeURIComponent(bKey)}`;
}