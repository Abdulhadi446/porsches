import creditsFile from "#data/credits.json";
import type { Credit, ImageRef, Model3D, Variant } from "#data/schema";
import type { ImageResult } from "#lib/assets";

/**
 * Credit resolution.
 *
 * Every `ImageRef.creditId` points into `data/credits.json`. That file is
 * written by ASSET-IMAGES and is legitimately empty until assets land, so:
 *  - a missing record is dropped (never rendered as a blank row);
 *  - when *no* record can be resolved the strip renders an honest
 *    "credits pending" line instead of inventing attribution.
 */

export interface CreditRow {
  /** what the credit belongs to, e.g. "Gallery image 3" */
  context: string;
  credit: Credit;
}

const CREDITS: Credit[] = (creditsFile as { credits?: Credit[] }).credits ?? [];

const BY_ID = new Map<string, Credit>();
for (const credit of CREDITS) {
  if (credit && typeof credit.assetId === "string") BY_ID.set(credit.assetId, credit);
}

export function allCredits(): Credit[] {
  return CREDITS;
}

export function lookupCredit(assetId: string | undefined | null): Credit | undefined {
  return assetId ? BY_ID.get(assetId) : undefined;
}

/**
 * Credits for one variant: the variant's own `credits[]` (data agent
 * provenance) plus anything resolvable from the images we are about to
 * render. Deduplicated by `assetId`.
 */
export function creditsForVariant(
  variant: Variant,
  images: readonly (ImageRef | ImageResult | null | undefined)[],
): CreditRow[] {
  const rows: CreditRow[] = [];
  const seen = new Set<string>();

  const push = (context: string, credit: Credit | undefined) => {
    if (!credit || seen.has(credit.assetId)) return;
    seen.add(credit.assetId);
    rows.push({ context, credit });
  };

  (variant.credits ?? []).forEach((credit, index) => {
    push(credit?.kind === "image" ? `Image ${index + 1}` : "Source", credit);
  });

  images.forEach((image, index) => {
    if (!image) return;
    const context = index === 0 ? "Hero image" : `Gallery image ${index + 1}`;
    push(context, lookupCredit(image.creditId));
  });

  return rows;
}

export interface ModelAttribution {
  author: string | null;
  license: string | null;
  sourceId: string | null;
}

/** Attribution straight from `Model3D` — only what the data actually says. */
export function modelAttribution(model: Model3D | null | undefined): ModelAttribution | null {
  if (!model) return null;
  const { author, license, sourceId } = model;
  if (!author && !license && !sourceId) return null;
  return { author: author ?? null, license: license ?? null, sourceId: sourceId ?? null };
}