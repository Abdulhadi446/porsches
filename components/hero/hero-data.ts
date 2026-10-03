/**
 * Hero copy + the data-derived pieces the scene needs.
 *
 * Everything here is derived from the generation JSON through the LEAD-owned
 * helpers in `#lib/assets` and `#lib/generations`, so the hero upgrades by
 * itself once ASSET-IMAGES / ASSET-3D land their files. No numbers are written
 * by hand: if the data says `missing`, the hero degrades to the placeholder.
 *
 * This module is pure and safe on both the server and the client.
 */

import { getImage, getModel, type ImageResult, type ModelResult } from "#lib/assets";
import { CLIENT_GENERATIONS } from "#lib/client-catalog";

const GENERATIONS = CLIENT_GENERATIONS;

/** Mono kicker above the headline. */
export const HERO_KICKER = "1963 → 2026 · Unofficial fan project";

/** Display headline, set as an outline second line in the markup. */
export const HERO_TITLE_LEAD = "Six decades";
export const HERO_TITLE_ACCENT = "of the 911";

/** Standfirst under the headline. */
export const HERO_STANDFIRST =
  "Nine generations, one silhouette. Scroll to walk the full circle — from the 901 prototype shown in Frankfurt in September 1963 to the 992.2 T-Hybrid.";

/**
 * Scroll length of the hero, in viewport heights. 100vh is the stage itself;
 * the extra 160vh is the runway the 360° orbit is scrubbed across.
 */
export const HERO_SCROLL_VH = 260;

export const HERO_SCROLL_HINT = "Scroll · 360°";

/** The generation the hero represents: the newest one. */
function currentGeneration() {
  return GENERATIONS[GENERATIONS.length - 1] ?? GENERATIONS[0];
}

/** Prefer the generation image, then any variant image. */
export function heroPosterImage(): ImageResult {
  const generation = currentGeneration();
  if (!generation) return getImage(null, { alt: "Porsche 911" });
  const alt = `Porsche 911 ${generation.code}`;
  const direct = getImage(generation.heroImage, { alt });
  if (!direct.fallback) return direct;
  for (const variant of generation.variants) {
    const image = getImage(variant.heroImage, { alt: `${variant.name} — ${alt}` });
    if (!image.fallback) return image;
  }
  return getImage(generation.timelineImage, { alt });
}

/**
 * The hero car. `getModel` already implements the documented preference order
 * (local `.glb` → Sketchfab embed → turntable images), so the moment ASSET-3D
 * records a licensed local GLB for the newest generation, `<Car />` picks it up
 * and the procedural silhouette steps aside. Sketchfab embeds cannot be drawn
 * inside this canvas, so `embed` / `turntable` / `none` all keep the procedural
 * body (see README.md).
 */
export function heroModel(): ModelResult {
  return getModel(currentGeneration()?.model3d);
}

export interface EraSpec {
  /** "901", "G-SERIES", … */
  code: string;
  /** generation start year */
  year: number;
  /** `${powerPs} PS`, or the raw power string when the data has no number */
  power: string;
  /** the variant the figure belongs to */
  name: string;
  /** production years of that variant */
  years: string;
  /** generation accent, used for the hairline + numeral tint */
  accent: string;
  /** one-line tagline, muted */
  tagline: string;
  /** 0-based position in the strip */
  index: number;
}

/**
 * One spec per generation, in timeline order.
 *
 * Selection rule (deterministic, no hand-picked ids): the earliest *non-special*
 * coupé with a numeric `powerPs`. That lands on the launch car of each era —
 * 130 PS for the 901, 394 PS for the 992.2 Carrera — which is exactly the
 * "1963 → today" story the strip tells.
 */
export function heroEraSpecs(): EraSpec[] {
  return GENERATIONS.map((generation, index) => {
    const candidates = generation.variants
      .filter(
        (variant) =>
          variant.powerPs != null &&
          variant.special !== true &&
          variant.bodyStyles.includes("coupe"),
      )
      .sort(
        (a, b) =>
          (a.yearsStart ?? Number.MAX_SAFE_INTEGER) -
            (b.yearsStart ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
      );
    const variant = candidates[0];
    const power = variant?.powerPs != null ? `${variant.powerPs} PS` : "—";
    return {
      code: generation.code,
      year: generation.yearsStart,
      power,
      name: variant?.name ?? generation.name,
      years: variant?.years ?? `${generation.yearsStart}–${generation.yearsEnd ?? "today"}`,
      accent: generation.accent,
      tagline: generation.tagline,
      index,
    };
  });
}
