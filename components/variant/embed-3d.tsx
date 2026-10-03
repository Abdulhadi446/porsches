"use client";

import { useState } from "react";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";

/**
 * Sketchfab embed — facade first, iframe only on request.
 *
 * An iframe is the most expensive thing on the page (a whole second JS
 * runtime plus textures), so it is never in the initial HTML: the section
 * renders the poster frame and one button. That also guarantees we never have
 * several Sketchfab iframes alive at once — the loader in viewer-3d mounts the
 * *component*, and this component mounts exactly one iframe, behind a click.
 *
 * The `allow` list is deliberately minimal (fullscreen + XR tracking) and the
 * frame gets a descriptive `title`, because an untitled iframe is an a11y hole.
 */

export interface Embed3DProps {
  embedUrl: string;
  poster: ImageResult;
  carName: string;
  accent: string;
}

export function Embed3D({ embedUrl, poster, carName, accent }: Embed3DProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="absolute inset-0">
      {!loaded ? (
        <div className="absolute inset-0">
          <SafeImage
            image={poster}
            decorative
            fill
            sizes="(min-width: 1024px) 100vw, 100vw"
            className="object-cover opacity-60"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to top, var(--color-ink) 5%, color-mix(in srgb, var(--color-ink) 40%, transparent) 60%, transparent 100%)",
            }}
          />
          <div className="absolute inset-0 grid place-items-center p-(--space-6)">
            <div className="flex max-w-[46ch] flex-col items-center gap-(--space-4) text-center">
              <p className="label">Interactive model · Sketchfab</p>
              <button
                type="button"
                onClick={() => setLoaded(true)}
                className="inline-flex min-h-11 items-center gap-(--space-3) rounded-(--radius-pill) border border-ink-4 bg-ink-2/90 px-6 py-3 font-mono text-mono-sm uppercase tracking-(--tracking-mono) text-metal-100 transition-colors hover:border-metal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                <span aria-hidden="true" style={{ color: accent }}>
                  ▶
                </span>
                Load the 3D viewer
              </button>
              <p className="font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
                Loads Sketchfab&apos;s viewer on demand — nothing is requested from a
                third party until you press the button.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <iframe
          src={embedUrl}
          title={`${carName} — interactive 3D model (Sketchfab)`}
          loading="lazy"
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full border-0"
        />
      )}
    </div>
  );
}