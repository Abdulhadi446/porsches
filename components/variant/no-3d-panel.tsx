"use client";

import { GradientMesh } from "#components/fx";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";

/**
 * The "no model on file" state — and today that is *every* variant, because
 * `data/models.json` does not exist yet (ASSET-3D still to run).
 *
 * The requirement is not to render an empty box, it is to say what will be
 * there and where it comes from. So this panel:
 *  - reuses the background library instead of inventing a new effect
 *    (`GradientMesh` is pure CSS — no canvas, no extra context);
 *  - shows the real hero frame as a plate instead of a spinner;
 *  - states the pipeline (licensed local `.glb` → Sketchfab embed →
 *    turntable → nothing) and links to /credits.
 */

export interface NoModelPanelProps {
  accent: string;
  carName: string;
  poster: ImageResult;
}

export function NoModelPanel({ accent, carName, poster }: NoModelPanelProps) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-ink-2">
      <GradientMesh
        palette={["guards-deep", "ink-3", "gulf-blue-deep"]}
        intensity={0.45}
        blobs={2}
        duration={34}
      />

      <div className="relative z-content grid w-full max-w-[52rem] gap-[--space-6] p-[--space-6] md:grid-cols-[1.1fr_1fr] md:p-[--space-8]">
        <div
          className="relative aspect-[4/3] w-full overflow-hidden border border-ink-4"
          aria-hidden="true"
        >
          <SafeImage
            image={poster}
            decorative
            fill
            sizes="(min-width: 768px) 40vw, 90vw"
            className="object-cover opacity-70 grayscale"
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to top right, var(--color-ink) 6%, transparent 60%)",
            }}
          />
        </div>

        <div className="flex flex-col gap-[--space-3] self-center">
          <p className="label flex items-center gap-[--space-3]">
            <span
              aria-hidden="true"
              className="inline-block h-px w-8"
              style={{ backgroundColor: accent }}
            />
            3D model — not on file yet
          </p>
          <h3 className="text-display-3 text-metal-100">
            {carName} in three dimensions
          </h3>
          <p className="text-body-2 leading-relaxed text-metal-500">
            Every model on this site has to be licence-checked before it can ship, so
            the 3D pipeline is deliberately conservative. When one lands for this
            variant you get, in priority order:
          </p>
          <ol className="flex flex-col gap-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500">
            <li>
              <span className="mr-[--space-2]" style={{ color: accent }}>
                01
              </span>
              a licensed local model, rendered here with orbit + zoom
            </li>
            <li>
              <span className="mr-[--space-2]" style={{ color: accent }}>
                02
              </span>
              a Sketchfab embed, loaded only when you ask for it
            </li>
            <li>
              <span className="mr-[--space-2]" style={{ color: accent }}>
                03
              </span>
              an image-sequence turntable you can scrub
            </li>
          </ol>
          <p className="font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-700">
            Sources and licences are listed on the credits page.
          </p>
        </div>
      </div>
    </div>
  );
}