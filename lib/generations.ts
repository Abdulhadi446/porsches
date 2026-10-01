import type { Generation, Variant } from "#data/schema";
import g901 from "#data/generations/901.json";
import gGseries from "#data/generations/gseries.json";
import g964 from "#data/generations/964.json";
import g993 from "#data/generations/993.json";
import g996 from "#data/generations/996.json";
import g997 from "#data/generations/997.json";
import g991 from "#data/generations/991.json";
import g9921 from "#data/generations/992-1.json";
import g9922 from "#data/generations/992-2.json";

/** Timeline order — 1963 → today. */
export const GENERATIONS: Generation[] = [
  g901 as Generation,
  gGseries as Generation,
  g964 as Generation,
  g993 as Generation,
  g996 as Generation,
  g997 as Generation,
  g991 as Generation,
  g9921 as Generation,
  g9922 as Generation,
].sort((a, b) => a.index - b.index);

export function getGeneration(id: string): Generation | undefined {
  return GENERATIONS.find((g) => g.id === id);
}

export function getVariant(
  generationId: string,
  variantId: string,
): { generation: Generation; variant: Variant } | undefined {
  const generation = getGeneration(generationId);
  if (!generation) return undefined;
  const variant = generation.variants.find((v) => v.id === variantId);
  if (!variant) return undefined;
  return { generation, variant };
}

export function allVariants(): Array<{
  generation: Generation;
  variant: Variant;
}> {
  return GENERATIONS.flatMap((generation) =>
    generation.variants.map((variant) => ({ generation, variant })),
  );
}

/** 1963 → today, in one line (used by the timeline scrubber). */
export function timelineRange(): [number, number] {
  const start = Math.min(...GENERATIONS.map((g) => g.yearsStart));
  const end = Math.max(
    ...GENERATIONS.map((g) => g.yearsEnd ?? new Date().getFullYear()),
  );
  return [start, end];
}
