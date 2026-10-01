"use client";

/**
 * GradientMesh — animated multi-blob gradient background.
 * Technique: pure CSS (radial-gradient divs + blur + keyframes). No canvas,
 * no WebGL, no runtime asset fetch. Deterministic blob layout (seeded PRNG)
 * so the server markup matches the first client render.
 */

import { useMemo } from "react";
import {
  FxStatic,
  clamp01,
  clamp,
  fxRootStyle,
  fxVar,
  resolveFxColor,
  seededRandom,
  useFxCapability,
  useFxColors,
  useFxStylesheet,
  useReducedMotion,
  useVisibility,
  type FxColor,
  type FxPosition,
  type FxToken,
} from "./runtime";

export const GRADIENT_MESH_PALETTE = [
  "guards-deep",
  "gulf-blue-deep",
  "ink-3",
] as const satisfies readonly FxToken[];

export interface GradientMeshProps {
  /** merged onto the root element; positioning stays deterministic */
  className?: string;
  /** 0..1 — blob layer opacity + contrast */
  intensity?: number;
  /** explicit colours; wins over `palette` (accepts tokens, var(--color-…), css) */
  colors?: readonly FxColor[];
  /** token names, resolved through styles/tokens.css */
  palette?: readonly FxToken[];
  /** 1..5 drifting blobs (default 3) */
  blobs?: number;
  /** seconds per blob cycle (default 26) */
  duration?: number;
  /** blur radius in px (default 110) */
  blurPx?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

const SHEET_ID = "fx-gradient-mesh";
const SHEET = `
@keyframes fx-gm-blob {
  0%   { transform: translate3d(0,0,0) scale(1); }
  50%  { transform: translate3d(4%, -6%, 0) scale(1.18); }
  100% { transform: translate3d(-5%, 5%, 0) scale(0.92); }
}
[data-fx="gradient-mesh"][data-fx-active="false"] .fx-gm-blob {
  animation-play-state: paused;
}
`;

interface Blob {
  x: number;
  y: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
}

export function GradientMesh({
  className,
  intensity = 1,
  colors,
  palette = GRADIENT_MESH_PALETTE,
  blobs = 3,
  duration = 26,
  blurPx = 110,
  position = "absolute",
  zIndex,
}: GradientMeshProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const { ref, active } = useVisibility<HTMLDivElement>("200px");
  const animate = !reduced && !capability.lowPower;

  const resolvedPalette = colors?.length
    ? colors
    : (palette as readonly FxColor[]);
  const fxColors = useFxColors(resolvedPalette);

  const shape = useMemo(() => clamp(Math.round(blobs), 1, 5), [blobs]);

  const blobList = useMemo<Blob[]>(() => {
    const random = seededRandom(911);
    const paletteCss = fxColors.length
      ? fxColors
      : GRADIENT_MESH_PALETTE.map((token) => resolveFxColor(fxVar(token)));
    const round = (value: number) => Math.round(value * 10) / 10;
    return Array.from({ length: shape }, (_, index) => ({
      x: round(6 + random() * 78),
      y: round(4 + random() * 76),
      size: round(38 + random() * 42),
      color: paletteCss[index % paletteCss.length],
      duration: round(duration * (0.72 + random() * 0.6)),
      delay: -round(random() * duration),
    }));
    // fxColors identity changes only when the palette key changes (see useFxColors)
  }, [fxColors, shape, duration]);

  useFxStylesheet(SHEET_ID, SHEET);

  const k = clamp01(intensity);

  return (
    <div
      ref={ref}
      data-fx="gradient-mesh"
      data-fx-mode={animate ? "css" : "static"}
      data-fx-active={active}
      aria-hidden="true"
      className={className}
      style={fxRootStyle({ position, zIndex })}
    >
      {animate ? (
        <div
          style={{
            position: "absolute",
            inset: "-18%",
            filter: `blur(${Math.round(blurPx)}px)`,
            opacity: 0.32 + 0.68 * k,
            transform: "translateZ(0)",
          }}
        >
          {blobList.map((blob, index) => (
            <span
              key={index}
              className="fx-gm-blob"
              style={{
                position: "absolute",
                left: `${blob.x}%`,
                top: `${blob.y}%`,
                width: `${blob.size}%`,
                aspectRatio: "1 / 1",
                borderRadius: "50%",
                background: `radial-gradient(circle at 50% 50%, ${blob.color} 0%, color-mix(in srgb, ${blob.color} 40%, transparent) 42%, transparent 70%)`,
                opacity: 0.55 + 0.45 * k,
                animation: `fx-gm-blob ${blob.duration}s cubic-bezier(0.45, 0, 0.55, 1) ${blob.delay}s infinite alternate`,
                willChange: "transform",
              }}
            />
          ))}
        </div>
      ) : (
        <FxStatic colors={fxColors} intensity={k * 0.9} pattern="rays" />
      )}
    </div>
  );
}

export default GradientMesh;