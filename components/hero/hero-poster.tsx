"use client";

/**
 * Poster fallback — the hero without WebGL.
 *
 * Shown when the browser cannot give us a context, and deliberately also when
 * `prefers-reduced-motion: reduce` is set: the composition is identical, only
 * the motion is missing. It is what the server renders, so it is also the LCP
 * element and the only thing in the initial HTML.
 *
 * Composition: a token gradient backdrop (reused from the fx library's
 * `<GradientMesh />`), the newest generation's image through `getImage()`, and a
 * vignette scrim that keeps the headline legible. No runtime asset fetch beyond
 * the image itself.
 */

import Image from "next/image";
import { heroPosterImage } from "./hero-data";

export interface HeroPosterProps {
  /**
   * `true` once the opaque canvas is painting over this layer. The poster stays
   * mounted the whole time (it is the server-rendered LCP element, so the image
   * is already in cache) and is only hidden, which removes the black flash while
   * the canvas warms up without ever unmounting the image.
   */
  hidden?: boolean;
}

export function HeroPoster({ hidden = false }: HeroPosterProps) {
  const image = heroPosterImage();
  return (
    <div
      data-hero-poster=""
      aria-hidden={hidden || undefined}
      className="absolute inset-0 overflow-hidden bg-ink"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      {/* token gradient: ink floor, metal-900 horizon, ink-3 wash */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(120% 82% at 50% 104%, var(--color-ink-3) 0%, transparent 64%)",
            "radial-gradient(70% 55% at 18% 22%, var(--color-guards-deep) 0%, transparent 68%)",
            "radial-gradient(64% 48% at 86% 30%, var(--color-gulf-blue-deep) 0%, transparent 70%)",
            "linear-gradient(180deg, var(--color-ink) 0%, var(--color-ink-2) 58%, var(--color-ink) 100%)",
          ].join(", "),
        }}
      />

      <div className="absolute inset-0">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          sizes="100vw"
          quality={82}
          placeholder={image.blurDataURL ? "blur" : "empty"}
          className="object-cover object-center opacity-55"
        />
      </div>

      {/* legibility scrim: floor haze + top fade into the headline */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "linear-gradient(0deg, var(--color-ink) 2%, transparent 46%)",
            "linear-gradient(180deg, var(--color-ink) 0%, transparent 26%)",
            "radial-gradient(78% 62% at 50% 46%, transparent 40%, var(--color-ink) 100%)",
          ].join(", "),
        }}
      />
    </div>
  );
}
