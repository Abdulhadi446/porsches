"use client";

/**
 * GrainOverlay — film grain / sensor noise over the whole page or a section.
 * Technique: inline SVG feTurbulence data-URI (no network, no canvas, no
 * runtime asset fetch). Static by default; `animated` jitters the tile in
 * `steps()` so the paint cost is a background-position swap, not a redraw.
 */

import { useMemo } from "react";
import {
  FxStatic,
  clamp,
  clamp01,
  fxRootStyle,
  svgDataUri,
  useFxCapability,
  useFxColors,
  useFxStylesheet,
  useReducedMotion,
  useVisibility,
  withAlpha,
  type FxColor,
  type FxPosition,
} from "./runtime";

export interface GrainOverlayProps {
  className?: string;
  /** 0..1 — multiplies both the noise and the colour wash */
  intensity?: number;
  /** noise + wash colour (default metal-100) */
  color?: FxColor;
  /** secondary colour for the wash (default metal-500) */
  tint?: FxColor;
  /** noise opacity multiplier (default 0.5 → ~3% on screen) */
  opacity?: number;
  /** noise tile size in px (default 160) */
  size?: number;
  /** jitter the tile every ~80ms (default false; always off for reduced motion) */
  animated?: boolean;
  /** add the faint radial colour wash (default true) */
  wash?: boolean;
  position?: FxPosition;
  zIndex?: number | string;
}

const SHEET_ID = "fx-grain-overlay";
const SHEET = `
@keyframes fx-grain-jitter {
  0%   { background-position: 0 0; }
  20%  { background-position: -37px 23px; }
  40%  { background-position: 19px -41px; }
  60%  { background-position: -53px -17px; }
  80%  { background-position: 41px 37px; }
  100% { background-position: 0 0; }
}
[data-fx="grain-overlay"][data-fx-active="false"] .fx-grain-layer {
  animation-play-state: paused;
}
`;

const NOISE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">
<filter id="n" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="11" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/>
</filter>
<rect width="180" height="180" filter="url(#n)"/>
</svg>`;

export function GrainOverlay({
  className,
  intensity = 1,
  color = "metal-100",
  tint = "metal-500",
  opacity = 0.5,
  size = 160,
  animated = false,
  wash = true,
  position = "fixed",
  zIndex = "var(--z-overlay)",
}: GrainOverlayProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const { ref, active } = useVisibility<HTMLDivElement>("200px");
  const [noiseColor, washColor] = useFxColors([color, tint]);

  useFxStylesheet(SHEET_ID, SHEET);

  const k = clamp01(intensity);
  const tile = clamp(size, 60, 600);
  const noiseAlpha = clamp01(opacity) * (0.02 + 0.05 * k);
  const jitter = animated && !reduced && !capability.lowPower;

  const tiles = useMemo(() => svgDataUri(NOISE_SVG), []);

  return (
    <div
      ref={ref}
      data-fx="grain-overlay"
      data-fx-mode="css"
      data-fx-active={active}
      aria-hidden="true"
      className={className}
      style={fxRootStyle({ position, zIndex })}
    >
      {wash && !capability.lowPower ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `radial-gradient(120% 90% at 50% 0%, ${withAlpha(washColor, 0.05 * k)} 0%, transparent 60%), radial-gradient(100% 80% at 50% 100%, ${withAlpha(noiseColor, 0.035 * k)} 0%, transparent 62%)`,
          }}
        />
      ) : null}
      {capability.lowPower ? (
        <FxStatic
          colors={[noiseColor, washColor]}
          intensity={k * 0.35}
          pattern="none"
        />
      ) : (
        <div
          className="fx-grain-layer"
          style={{
            position: "absolute",
            inset: jitter ? "-60px" : 0,
            backgroundImage: tiles,
            backgroundSize: `${tile}px ${tile}px`,
            mixBlendMode: "overlay",
            opacity: noiseAlpha,
            animation: jitter
              ? "fx-grain-jitter 0.8s steps(1, end) infinite"
              : undefined,
            willChange: jitter ? "background-position" : undefined,
          }}
        />
      )}
    </div>
  );
}

export default GrainOverlay;