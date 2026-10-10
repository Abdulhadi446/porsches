"use client";

import { GradientMesh } from "#components/fx";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";

/**
 * The "no model on file" state — shown only when a variant has neither a local
 * GLB, nor a Sketchfab embed, nor a turntable (today: 36 of 164 variants, the
 * ones no free-licensed capture of exists).
 *
 * It is not an apology panel: it is a full-bleed archive photograph with one
 * honest sentence on top. The pipeline note stays, shrunk to a single mono
 * line, and /credits stays the one link.
 */

export interface NoModelPanelProps {
  accent: string;
  carName: string;
  poster: ImageResult;
}

export function NoModelPanel({ accent, carName, poster }: NoModelPanelProps) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-2">
      <SafeImage
        image={poster}
        decorative
        fill
        sizes="(min-width: 1024px) 100vw, 100vw"
        className="object-cover object-center opacity-90"
      />
      <GradientMesh
        palette={["guards-deep", "ink-3", "gulf-blue-deep"]}
        intensity={0.3}
        blobs={1}
        duration={40}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to top, var(--color-ink) 8%, color-mix(in srgb, var(--color-ink) 70%, transparent) 48%, transparent 85%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-(--space-2) p-(--space-6) md:p-(--space-8)">
        <p className="label flex items-center gap-(--space-3)">
          <span
            aria-hidden="true"
            className="inline-block h-px w-8"
            style={{ backgroundColor: accent }}
          />
          No free-licensed 3D of this car yet
        </p>
        <h3 className="text-display-3 text-metal-100">{carName}</h3>
        <p className="max-w-[54ch] text-body-2 leading-relaxed text-metal-300">
          Every model on this site is licence-checked by hand before it can
          ship, and no capture of this car clears that bar yet. The archive
          photograph is what we can show honestly today.
        </p>
        <p className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700">
          Pipeline: licensed local model → Sketchfab embed → turntable ·
          sources on the credits page
        </p>
      </div>
    </div>
  );
}
