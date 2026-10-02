import Image from "next/image";
import type { CSSProperties } from "react";
import type { ImageRef } from "#data/schema";
import type { ImageResult } from "#lib/assets";
import { cx } from "./lib/format";

/**
 * Media wrapper that never breaks.
 *
 * `next/image` is used for every raster asset (they are pre-converted
 * AVIF/WebP in /public, so the optimizer has real work to do). Two cases
 * cannot go through the optimizer:
 *
 *  - **SVG** (`/images/_placeholder/911-silhouette.svg`) — the Next image
 *    optimizer refuses SVG unless `dangerouslyAllowSVG` is enabled in
 *    next.config.ts, which is lead-owned. Every variant currently resolves to
 *    that placeholder, so the fallback path must work without the optimizer.
 *  - **remote posters** (`i.ytimg.com`) — `remotePatterns` is not configured,
 *    so those go through the video facade instead.
 *
 * Both branches keep an explicit intrinsic size (or an explicit fill box), so
 * the placeholder never causes layout shift.
 */

export interface SafeImageProps {
  image: ImageRef | ImageResult;
  /** override the alt text from the data */
  alt?: string;
  /** decorative image: rendered with `alt=""` and `aria-hidden` */
  decorative?: boolean;
  /** fill the nearest positioned parent (next/image) */
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  /** forwarded to the DOM node (GSAP targets, test hooks) */
  "data-hero-media"?: string;
}

const FILL = "absolute inset-0 h-full w-full";

export function SafeImage({
  image,
  alt,
  decorative = false,
  fill = false,
  width,
  height,
  sizes,
  priority = false,
  className,
  style,
  "data-hero-media": heroMedia,
}: SafeImageProps) {
  const src = image.src;
  const resolvedAlt = decorative ? "" : (alt ?? image.alt ?? "");
  const blurDataURL = image.blurDataURL ?? undefined;

  if (/\.svg($|\?)/i.test(src)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG placeholders cannot pass through the Next optimizer (see note above)
      <img
        src={src}
        alt={resolvedAlt}
        aria-hidden={decorative ? true : undefined}
        width={fill ? undefined : (width ?? image.width ?? 1600)}
        height={fill ? undefined : (height ?? image.height ?? 900)}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        data-hero-media={heroMedia}
        className={cx(className, fill && FILL)}
        style={
          fill
            ? { backgroundImage: blurDataURL ? `url(${blurDataURL})` : undefined, ...style }
            : style
        }
      />
    );
  }

  return (
    <Image
      src={src}
      alt={resolvedAlt}
      aria-hidden={decorative ? true : undefined}
      fill={fill}
      width={fill ? undefined : (width ?? image.width ?? 1600)}
      height={fill ? undefined : (height ?? image.height ?? 900)}
      sizes={sizes ?? (fill ? "100vw" : undefined)}
      priority={priority}
      placeholder={blurDataURL ? "blur" : "empty"}
      blurDataURL={blurDataURL}
      data-hero-media={heroMedia}
      className={cx(className, fill && FILL)}
      style={style}
    />
  );
}