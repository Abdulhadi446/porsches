"use client";

/**
 * HeatHaze — shimmer / heat distortion over the page background.
 * Technique: CSS only. One inline SVG feTurbulence data-URI (no asset fetch)
 * crawling in `steps()` + two blurred gradient sheets that rise. No rAF loop,
 * no postprocessing pass, no backdrop-filter.
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
  type FxColor,
  type FxPosition,
} from "./runtime";

export interface HeatHazeProps {
  className?: string;
  /** 0..1 — shimmer opacity, crawl rate and band count */
  intensity?: number;
  /** warm shimmer colour (default gulf-orange) */
  color?: FxColor;
  /** cool counter-shimmer colour (default guards-glow) */
  colorSecondary?: FxColor;
  /** turbulence tile size in px (default 220) */
  grainSize?: number;
  /** turbulence frequency multiplier (default 1) */
  frequency?: number;
  /** 1..4 shimmer bands (default 2) */
  bands?: number;
  /** seconds per shimmer cycle (default 7) */
  duration?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

const SHEET_ID = "fx-heat-haze";
const SHEET = `
@keyframes fx-hz-crawl {
  0%   { background-position: 0 0; }
  100% { background-position: -140px 90px; }
}
@keyframes fx-hz-rise {
  0%   { transform: translate3d(0, 8%, 0) scaleY(1.05); opacity: 0.25; }
  50%  { transform: translate3d(1.5%, -4%, 0) scaleY(1.18); opacity: 0.7; }
  100% { transform: translate3d(0, 8%, 0) scaleY(1.05); opacity: 0.25; }
}
[data-fx="heat-haze"][data-fx-active="false"] .fx-hz-crawl,
[data-fx="heat-haze"][data-fx-active="false"] .fx-hz-band {
  animation-play-state: paused;
}
`;

const TURBULENCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">
<filter id="h" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="turbulence" baseFrequency="0.009 0.03" numOctaves="2" seed="5" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/>
</filter>
<rect width="220" height="220" filter="url(#h)"/>
</svg>`;

export function HeatHaze({
  className,
  intensity = 1,
  color = "gulf-orange",
  colorSecondary = "guards-glow",
  grainSize = 220,
  frequency = 1,
  bands = 2,
  duration = 7,
  position = "absolute",
  zIndex,
}: HeatHazeProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const { ref, active } = useVisibility<HTMLDivElement>("200px");
  const animate = !reduced && !capability.lowPower;
  const [warm, cool] = useFxColors([color, colorSecondary]);
  const k = clamp01(intensity);

  useFxStylesheet(SHEET_ID, SHEET);

  const bandCount = clamp(Math.round(bands), 1, 4);
  const tiles = useMemo(() => {
    const freq = clamp(frequency, 0.25, 4);
    const svg = TURBULENCE_SVG.replace(
      "baseFrequency=\"0.009 0.03\"",
      `baseFrequency="${(0.009 * freq).toFixed(4)} ${(0.03 * freq).toFixed(4)}"`,
    );
    return svgDataUri(svg);
  }, [frequency]);

  const crawlDuration = clamp(duration * 0.6, 1.5, 60);
  const bandList = useMemo(
    () =>
      Array.from({ length: bandCount }, (_, index) => ({
        left:
          bandCount === 1 ? 50 : 8 + index * (84 / (bandCount - 1)),
        delay: -duration * (index / bandCount),
        duration: duration * (0.8 + index * 0.15),
      })),
    [bandCount, duration],
  );

  return (
    <div
      ref={ref}
      data-fx="heat-haze"
      data-fx-mode={animate ? "css" : "static"}
      data-fx-active={active}
      aria-hidden="true"
      className={className}
      style={fxRootStyle({ position, zIndex })}
    >
      {animate ? (
        <>
          <div
            className="fx-hz-crawl"
            style={{
              position: "absolute",
              inset: "-12%",
              backgroundImage: tiles,
              backgroundSize: `${grainSize}px ${grainSize}px`,
              filter: "blur(2px) contrast(150%) brightness(70%)",
              opacity: 0.16 + 0.2 * k,
              mixBlendMode: "screen",
              animation: `fx-hz-crawl ${crawlDuration}s steps(7, end) infinite`,
              willChange: "background-position",
            }}
          />
          {bandList.map((band, index) => (
            <div
              key={index}
              className="fx-hz-band"
              style={{
                position: "absolute",
                bottom: "-25%",
                left: `${band.left}%`,
                width: "34%",
                height: "120%",
                backgroundImage: `linear-gradient(180deg, transparent 0%, ${warm} 46%, ${cool} 100%)`,
                filter: "blur(34px)",
                mixBlendMode: "screen",
                opacity: (0.1 + 0.16 * k) * (1 - index * 0.18),
                borderRadius: "50%",
                animation: `fx-hz-rise ${band.duration}s cubic-bezier(0.45, 0, 0.55, 1) ${band.delay}s infinite alternate`,
                willChange: "transform, opacity",
              }}
            />
          ))}
        </>
      ) : capability.lowPower ? (
        <FxStatic colors={[warm, cool]} intensity={k * 0.7} pattern="haze" />
      ) : (
        <div
          data-fx-static="haze"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: tiles,
            backgroundSize: `${grainSize}px ${grainSize}px`,
            filter: "blur(2px) contrast(150%) brightness(70%)",
            opacity: 0.14 + 0.14 * k,
            mixBlendMode: "screen",
          }}
        />
      )}
    </div>
  );
}

export default HeatHaze;