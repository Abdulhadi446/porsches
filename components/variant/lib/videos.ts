import videosFile from "#data/videos.json";
import { getVideos, type VideoResult } from "#lib/assets";
import type { Generation, Variant, VideoRef } from "#data/schema";

/**
 * Video lookup. `data/videos.json` is the ONLY source of truth — the
 * `videos[]` arrays inside the generation JSONs are currently empty and stay
 * authoritative if an asset agent fills them in.
 *
 * ###### hoisting warning ######
 * `entries` is keyed by `<genId>` or `<genId>/<variantId>`, and five of the
 * generation ids are *integer-like* ("901", "964", "991", "993", "996",
 * "997"). JS reorders integer-like keys ahead of string keys, so iterating
 * `Object.entries()` does NOT walk the generations in timeline order. Every
 * list built here is therefore sorted by `Generation.index`, never by object
 * key order — see `orderedVideoKeys`.
 *
 * Single-key reads (`entries[genId]`) are unaffected and stay O(1).
 */

export interface ScopedVideo extends VideoResult {
  scope: "variant" | "generation";
}

type Entries = Record<string, VideoRef[]>;

const ENTRIES: Entries = (videosFile as { entries?: Entries }).entries ?? {};

export function videosUpdatedAt(): string {
  return (videosFile as { updatedAt?: string }).updatedAt ?? "";
}

/**
 * All keys that belong to a generation, ordered by `Generation.index` — the
 * hoisting-safe order. O(#keys) which is 44 today.
 */
export function orderedVideoKeys(generations: readonly Generation[]): string[] {
  const rank = new Map<string, number>(
    generations.map((generation) => [generation.id, generation.index]),
  );
  return Object.keys(ENTRIES).sort((a, b) => {
    const genA = rank.get(a.split("/")[0]) ?? Number.MAX_SAFE_INTEGER;
    const genB = rank.get(b.split("/")[0]) ?? Number.MAX_SAFE_INTEGER;
    if (genA !== genB) return genA - genB;
    const perVariantA = a.includes("/") ? 1 : 0;
    const perVariantB = b.includes("/") ? 1 : 0;
    if (perVariantA !== perVariantB) return perVariantA - perVariantB;
    return a.localeCompare(b);
  });
}

/** Generation-level curated videos (single key read). */
export function generationVideos(generation: Generation): ScopedVideo[] {
  return getVideos(ENTRIES[generation.id]).map((video) => ({
    ...video,
    scope: "generation" as const,
  }));
}

/**
 * Videos for one variant: variant-level entries first (they are the most
 * specific), then the generation's curated set. Merged and de-duplicated by
 * YouTube id, and enriched with `variant.videos[]` when a data file has it.
 */
export function variantVideos(
  generation: Generation,
  variant: Variant,
): ScopedVideo[] {
  const own = getVideos(ENTRIES[`${generation.id}/${variant.id}`]).map((video) => ({
    ...video,
    scope: "variant" as const,
  }));
  const fromData = getVideos(variant.videos).map((video) => ({
    ...video,
    scope: "variant" as const,
  }));
  const wide = generationVideos(generation);

  const seen = new Set<string>();
  const out: ScopedVideo[] = [];
  for (const video of [...own, ...fromData, ...wide]) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    out.push(video);
  }
  return out;
}

/** How many curated videos exist for a generation (for the /911 index). */
export function generationVideoCount(generationId: string): number {
  let total = getVideos(ENTRIES[generationId]).length;
  const prefix = `${generationId}/`;
  for (const key of Object.keys(ENTRIES)) {
    if (key.startsWith(prefix)) total += getVideos(ENTRIES[key]).length;
  }
  return total;
}