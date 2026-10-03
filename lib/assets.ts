import type {
  Generation,
  ImageRef,
  Model3D,
  Variant,
  VideoRef,
} from "#data/schema";

/**
 * ASSET LOADER CONTRACT — owned by LEAD.
 * All media access goes through these helpers so fallbacks, credits and
 * missing-asset handling stay consistent across the site.
 *
 * Rules:
 *  - never throw: a missing asset returns a typed fallback (null / placeholder)
 *  - every returned object carries a creditId when it exists
 *  - `missing` arrays from data files are the source of truth for STATUS.md
 */

export interface ImageResult extends ImageRef {
  /** true when we synthesised a placeholder instead of a real file */
  fallback: boolean;
}

export const PLACEHOLDER_IMAGE: ImageResult = {
  src: "/images/_placeholder/911-silhouette.svg",
  alt: "Porsche 911 silhouette placeholder",
  blurDataURL:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMTMxMzE3Ii8+PC9zdmc+",
  creditId: undefined,
  fallback: true,
};

/** Resolve a hero/gallery image with a guaranteed fallback. */
export function getImage(
  ref: ImageRef | null | undefined,
  opts: { alt?: string } = {},
): ImageResult {
  if (!ref || !ref.src) {
    return { ...PLACEHOLDER_IMAGE, alt: opts.alt ?? PLACEHOLDER_IMAGE.alt };
  }
  return {
    ...ref,
    alt: ref.alt || opts.alt || PLACEHOLDER_IMAGE.alt,
    fallback: false,
  };
}

/** Pick the best gallery image (never throws). */
export function getGallery(variant: Pick<Variant, "gallery">): ImageResult[] {
  const list = variant.gallery ?? [];
  if (list.length === 0) return [{ ...PLACEHOLDER_IMAGE }];
  return list.map((g) => getImage(g));
}

export interface ModelResult {
  kind: "glb" | "embed" | "turntable" | "none";
  glb?: string;
  embedUrl?: string;
  turntable?: string;
  /** true when the frames are a parallax pan of one photo, not a real orbit */
  turntableSynthetic?: boolean;
  license?: string | null;
  author?: string | null;
  sourceId?: string | null;
  bytes?: number | null;
}

/** Resolve the 3D representation for a car: local glb > embed > turntable. */
export function getModel(
  model: Model3D | null | undefined,
): ModelResult {
  if (!model) return { kind: "none" };
  if (model.glb) {
    return {
      kind: "glb",
      glb: model.glb,
      license: model.license,
      author: model.author,
      sourceId: model.sourceId,
      bytes: model.bytes ?? null,
    };
  }
  if (model.embedUrl) {
    return {
      kind: "embed",
      embedUrl: model.embedUrl,
      license: model.license,
      author: model.author,
      sourceId: model.sourceId,
    };
  }
  if (model.turntable) {
    return {
      kind: "turntable",
      turntable: model.turntable,
      turntableSynthetic: model.turntableSynthetic === true,
      license: model.license,
      author: model.author,
      sourceId: model.sourceId,
    };
  }
  return { kind: "none" };
}

export interface VideoResult extends VideoRef {
  embedUrl: string;
  fallback: boolean;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Build a lazy YouTube embed URL; invalid ids are reported as fallback. */
export function getVideo(
  video: VideoRef | null | undefined,
): VideoResult | null {
  if (!video || !YT_ID.test(video.id)) return null;
  return {
    ...video,
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1`,
    poster:
      video.poster ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    fallback: false,
  };
}

export function getVideos(
  videos: VideoRef[] | null | undefined,
): VideoResult[] {
  return (videos ?? [])
    .map((v) => getVideo(v))
    .filter((v): v is VideoResult => v !== null);
}

/** All missing-asset declarations for a generation (for STATUS.md). */
export function collectMissing(gen: Generation): string[] {
  const out = [...(gen.missing ?? [])];
  for (const v of gen.variants) {
    for (const m of v.missing ?? []) out.push(`${gen.id}/${v.id}: ${m}`);
  }
  return out;
}
