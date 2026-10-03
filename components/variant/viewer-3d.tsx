"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageResult, ModelResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { ColorSwapper } from "./color-swapper";
import { WheelSwapper } from "./wheel-swapper";
import { Turntable3D } from "./turntable-3d";
import { NoModelPanel } from "./no-3d-panel";
import { Embed3D } from "./embed-3d";
import { claimCanvas, releaseCanvas } from "./lib/webgl";
import { DEFAULT_PAINT, PAINTS, type Paint, type WheelOption } from "./lib/palette";
import { useInView, useReducedMotion } from "./lib/hooks";
import type { GlbInspection } from "./viewer-glb";

/**
 * Section (c) — the 3D viewer.
 *
 * One decision, four outcomes (priority order comes from `getModel()`):
 *
 *   glb       → R3F canvas, lazily imported, mounted only while the section is
 *               in view, holding a site-wide WebGL lease and disposing the
 *               context when it unmounts.
 *   embed     → Sketchfab iframe behind a poster + click-to-load facade, so a
 *               page never has more than one live iframe in this section.
 *   turntable → image-sequence scrubber driven by pointer *and* keyboard.
 *   none      → a composed "3D coming soon" panel (today: every variant, since
 *               data/models.json does not exist yet).
 *
 * Colour/wheel swapping is only offered where the data can honour it:
 * glb → driven by real material + node inspection; embed/turntable/none →
 * rendered disabled with the reason on screen.
 */

const GlbStage = dynamic(() => import("./viewer-glb").then((mod) => mod.GlbStage), {
  ssr: false,
  loading: () => <StageSkeleton />,
});

function StageSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-2">
      <p className="label">Preparing the model</p>
    </div>
  );
}

export interface Viewer3DProps {
  model: ModelResult;
  carName: string;
  poster: ImageResult;
  accent: string;
  headingId: string;
}

export function Viewer3D({ model, carName, poster, accent, headingId }: Viewer3DProps) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "240px" });
  const [dismissed, setDismissed] = useState(false);
  const [paint, setPaint] = useState<Paint>(DEFAULT_PAINT);
  const [wheel, setWheel] = useState<WheelOption | null>(null);
  const [inspection, setInspection] = useState<GlbInspection | null>(null);

  const isGlb = model.kind === "glb" && Boolean(model.glb);
  const live = isGlb && inView && !dismissed;

  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-(--space-16) px-(--gutter) py-(--space-16)"
    >
      <div className="mx-auto w-full max-w-(--maxw)">
        <div className="flex flex-wrap items-end justify-between gap-(--space-4)">
          <div>
            <p className="label flex items-center gap-(--space-3)">
              <span
                aria-hidden="true"
                className="inline-block h-px w-8"
                style={{ backgroundColor: accent }}
              />
              3D viewer
            </p>
            <h2 id={headingId} className="mt-(--space-3) text-display-3 text-metal-100">
              {isGlb ? "Spin it yourself" : "Look closer"}
            </h2>
          </div>
          <p className="label">
            {isGlb
              ? live
                ? "WebGL context live · one per page"
                : dismissed
                  ? "Viewer released"
                  : "Viewer mounts when in view"
              : model.kind === "embed"
                ? "Sketchfab embed · click to load"
                : model.kind === "turntable"
                  ? "Image sequence scrubber"
                  : "No model on file yet"}
          </p>
        </div>

        <div
          ref={ref}
          className="relative mt-(--space-8) overflow-hidden border border-ink-4 bg-ink-2"
        >
          {/* fixed aspect box → the canvas/iframe can never shift the page */}
          <div className="relative aspect-[16/10] w-full sm:aspect-[16/9]">
            {isGlb && model.glb ? (
              live ? (
                <GlbHost
                  url={model.glb}
                  paint={paint}
                  wheel={wheel}
                  accent={accent}
                  onInspect={setInspection}
                />
              ) : (
                <ViewerPoster poster={poster} carName={carName} accent={accent} />
              )
            ) : model.kind === "embed" && model.embedUrl ? (
              <Embed3D
                embedUrl={model.embedUrl}
                poster={poster}
                carName={carName}
                accent={accent}
              />
            ) : model.kind === "turntable" && model.turntable ? (
              <>
                {model.turntableSynthetic && (
                  <p className="label mt-(--space-2)">
                    Parallax pan of one photograph — no multi-angle 360° of this
                    car exists under a free licence
                  </p>
                )}
                <Turntable3D
                  base={model.turntable}
                  poster={poster}
                  carName={carName}
                  accent={accent}
                  autoPlay={!reduced}
                  enabled={inView}
                />
              </>
            ) : (
              <NoModelPanel accent={accent} carName={carName} poster={poster} />
            )}
          </div>

          {isGlb || model.author || model.license ? (
            <div className="flex flex-wrap items-center justify-between gap-(--space-4) border-t border-ink-4 p-(--space-4)">
              <p className="max-w-[52ch] font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-700">
                {model.author || model.license
                  ? [
                      model.author ?? "Author unrecorded",
                      model.license ?? "licence unrecorded",
                      model.sourceId,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : isGlb
                    ? "Model licence recorded in /credits"
                    : ""}
              </p>
              {live ? (
                <button
                  type="button"
                  onClick={() => {
                    setDismissed(true);
                    releaseCanvas("variant-viewer");
                  }}
                  className="rounded-(--radius-sm) border border-ink-4 px-(--space-3) py-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  Release the 3D viewer
                </button>
              ) : dismissed ? (
                <button
                  type="button"
                  onClick={() => setDismissed(false)}
                  className="rounded-(--radius-sm) border border-ink-4 px-(--space-3) py-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  Mount the viewer again
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-(--space-6) flex flex-col gap-(--space-6) md:flex-row md:items-start md:justify-between">
          <ColorSwapper
            paints={PAINTS}
            value={paint.id}
            onChange={setPaint}
            enabled={
              isGlb && live && inspection !== null && inspection.paintBasis !== "none"
            }
            basis={inspection?.paintBasis ?? "none"}
            accent={accent}
            disabledReason={
              model.kind === "embed"
                ? "The Sketchfab viewer owns its own materials — an embedded scene cannot be re-tinted from this page."
                : model.kind === "turntable"
                  ? "A turntable is a photograph sequence, so there is no material to tint."
                  : !isGlb
                    ? "No 3D model on file for this variant yet."
                    : live
                      ? "This model exposes no paint material that can be tinted safely."
                      : "The viewer is not mounted, so there is nothing to tint."
            }
          />
          <WheelSwapper
            groups={isGlb && live ? (inspection?.wheelGroups ?? null) : null}
            value={wheel?.id ?? null}
            onChange={setWheel}
            unavailableReason={
              model.kind === "embed"
                ? "The Sketchfab viewer controls its own wheels."
                : !isGlb
                  ? "No 3D model on file for this variant yet."
                  : !live
                    ? "The viewer is not mounted."
                    : undefined
            }
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Owns the WebGL lease for the lifetime of the canvas. Separated from
 * `GlbStage` so `claimCanvas`/`releaseCanvas` always bracket the actual
 * context, and so a thrown render can never leave the lease held.
 */
function GlbHost({
  url,
  paint,
  wheel,
  accent,
  onInspect,
}: {
  url: string;
  paint: Paint;
  wheel: WheelOption | null;
  accent: string;
  onInspect: (report: GlbInspection) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const { inView } = useInView<HTMLDivElement>({ rootMargin: "120px", ignoreVisibility: true });

  const inspect = useCallback((report: GlbInspection) => onInspect(report), [onInspect]);

  useEffect(() => {
    claimCanvas("variant-viewer");
    return () => releaseCanvas("variant-viewer");
  }, []);

  // pause the loop when the tab is hidden as well as when scrolled away
  useEffect(() => {
    const sync = () => setActive(inView && !document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [inView]);

  return (
    <div ref={hostRef} className="absolute inset-0">
      <GlbStage
        url={url}
        paint={paint}
        wheel={wheel}
        active={active}
        onInspect={inspect}
        accent={accent}
      />
    </div>
  );
}

/** Facade shown before the canvas is mounted: hero frame + honest status. */
function ViewerPoster({
  poster,
  carName,
  accent,
}: {
  poster: ImageResult;
  carName: string;
  accent: string;
}) {
  return (
    <div className="absolute inset-0">
      <SafeImage
        image={poster}
        alt=""
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
            "linear-gradient(to top, var(--color-ink) 4%, color-mix(in srgb, var(--color-ink) 45%, transparent) 60%, transparent 100%)",
        }}
      />
      <p className="absolute inset-x-0 bottom-0 p-(--space-6) text-center font-mono text-mono-sm tracking-(--tracking-mono) text-metal-300">
        <span aria-hidden="true" className="mr-(--space-2)" style={{ color: accent }}>
          ◆
        </span>
        3D viewer mounts as {carName} scrolls into view
      </p>
    </div>
  );
}