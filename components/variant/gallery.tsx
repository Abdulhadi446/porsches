"use client";

import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { Lightbox } from "./lightbox";
import { useReducedMotion } from "./lib/hooks";
import { cx } from "./lib/format";

/**
 * Section (d) — the image gallery.
 *
 * - the grid is a plain `<ul>` of buttons, so it is keyboard-operable for
 *   free (Tab + Enter/Space) and each thumbnail carries
 *   `aria-label="Open image N of M"`;
 * - every frame has an explicit 3:2 box, so `next/image` never shifts the
 *   layout while decoding;
 * - thumbs below the fold are lazy (never `priority`);
 * - the lightbox is rendered through a portal and shares a `layoutId` with the
 *   thumb it came from, which is the framer-motion shared-element hop;
 * - when every image is the placeholder fallback the grid says so instead of
 *   pretending the car has been photographed.
 */

export interface GalleryProps {
  images: ImageResult[];
  carName: string;
  accent: string;
  headingId: string;
}

export function Gallery({ images, carName, accent, headingId }: GalleryProps) {
  const [index, setIndex] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const close = useCallback(() => setIndex(null), []);

  const allFallback = images.every((image) => image.fallback);

  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-[--space-16] px-[--gutter] py-[--space-16]"
    >
      <div className="mx-auto w-full max-w-[--maxw]">
        <div className="flex flex-wrap items-end justify-between gap-[--space-4]">
          <div>
            <p className="label flex items-center gap-[--space-3]">
              <span
                aria-hidden="true"
                className="inline-block h-px w-8"
                style={{ backgroundColor: accent }}
              />
              Gallery
            </p>
            <h2 id={headingId} className="mt-[--space-3] text-display-3 text-metal-100">
              {images.length > 1
                ? `${images.length} views of the ${carName.replace(/^911\s*/i, "")}`
                : "One frame so far"}
            </h2>
          </div>
          {images.length > 1 ? (
            <p className="label">Click a frame · Esc closes · ←/→ move</p>
          ) : null}
        </div>

        {allFallback ? (
          <p className="mt-[--space-4] max-w-[--maxw-prose] font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-500">
            Photography for this variant has not been cleared for licensing yet, so the
            placeholder silhouette is shown. It will never be a broken image.
          </p>
        ) : null}

        <ul className="mt-[--space-8] grid grid-cols-2 gap-[--space-3] md:grid-cols-3">
          {images.map((image, position) => (
            <li key={`${image.src}-${position}`}>
              <motion.button
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`Open image ${position + 1} of ${images.length}: ${image.alt}`}
                /* the layoutId is handed over to the lightbox when this frame is
                   the open one, so the two never claim the same id at once */
                layoutId={reduced || index !== null ? undefined : `gallery-${position}`}
                className={cx(
                  "group relative block w-full overflow-hidden border border-ink-4 bg-ink-2 transition-colors hover:border-metal-500",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
                )}
              >
                <span className="relative block aspect-[3/2] w-full">
                  <SafeImage
                    image={image}
                    fill
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className={cx(
                      "object-cover transition-transform duration-[--dur-slow]",
                      "group-hover:scale-[1.03]",
                      image.fallback && "opacity-60 grayscale",
                    )}
                  />
                </span>
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-[--space-2] bg-ink/70 px-[--space-2] py-[--space-1] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
                  <span className="truncate">
                    {String(position + 1).padStart(2, "0")} · {image.fallback ? "placeholder" : "archive"}
                  </span>
                  <span aria-hidden="true" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    ⤢
                  </span>
                </span>
              </motion.button>
            </li>
          ))}
        </ul>

        <Lightbox
          images={images}
          index={index}
          onClose={close}
          onIndexChange={setIndex}
          carName={carName}
          layoutId={index !== null && !reduced ? `gallery-${index}` : undefined}
        />
      </div>
    </section>
  );
}