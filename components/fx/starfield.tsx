"use client";

/**
 * Starfield — scroll-reactive parallax star field.
 * Technique: one 2D canvas, three depth layers, positions derived from
 * `now` + window.scrollY (read inside the loop, no scroll listener, no
 * Lenis dependency). DPR capped at 1.5, 30 fps, stars capped by
 * FX_MAX_PARTICLES and scaled to the surface area.
 */

import { useCallback, useMemo } from "react";
import {
  FxStatic,
  FX_MAX_PARTICLES,
  clamp,
  clamp01,
  fxRootStyle,
  seededRandom,
  useCanvasFx,
  useFxCapability,
  useFxColors,
  useReducedMotion,
  type FxColor,
  type FxPosition,
  type FxSurface,
} from "./runtime";

export interface StarfieldProps {
  className?: string;
  /** 0..1 — star count, brightness and parallax travel */
  intensity?: number;
  /** star colour (default metal-100) */
  color?: FxColor;
  /** tinted stars, weighted 1-in-5 (default guards-glow) */
  tint?: FxColor;
  /** stars before the hard cap (default 220) */
  count?: number;
  /** frames per second (default 30) */
  fps?: number;
  /** vertical travel per 1000px of scroll (default 0.18) */
  parallax?: number;
  /** twinkle speed multiplier (default 1) */
  twinkle?: number;
  /** extra y offset in px (e.g. tie to a GSAP/Lenis timeline) */
  offset?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  layer: number;
  phase: number;
  tinted: boolean;
}

const LAYERS = [
  { travel: 0.35, radius: 0.55, weight: 0.42 },
  { travel: 0.7, radius: 0.9, weight: 0.34 },
  { travel: 1.25, radius: 1.35, weight: 0.24 },
] as const;

export function Starfield({
  className,
  intensity = 1,
  color = "metal-100",
  tint = "guards-glow",
  count = 220,
  fps = 30,
  parallax = 0.18,
  twinkle = 1,
  offset = 0,
  position = "absolute",
  zIndex,
}: StarfieldProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const animate = !reduced && !capability.lowPower;
  const [starColor, tintColor] = useFxColors([color, tint]);
  const k = clamp01(intensity);

  const stars = useMemo<Star[]>(() => {
    const random = seededRandom(9111963);
    const total = clamp(
      Math.round(count * (0.3 + 0.7 * k)),
      16,
      FX_MAX_PARTICLES,
    );
    const list: Star[] = [];
    let layer = 0;
    for (let index = 0; index < total; index += 1) {
      const layerIndex = layer % LAYERS.length;
      layer += random() < LAYERS[layerIndex].weight ? 1 : 0;
      list.push({
        x: random(),
        y: random(),
        r: LAYERS[layerIndex].radius * (0.5 + random() * 0.9),
        layer: layerIndex,
        phase: random() * Math.PI * 2,
        tinted: random() < 0.2,
      });
    }
    return list;
  }, [count, k]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, surface: FxSurface, now: number) => {
      const { w, h } = surface;
      if (w < 2 || h < 2) return;
      const t = now / 1000;
      const scroll =
        typeof window === "undefined" ? 0 : window.scrollY || 0;
      const unit = Math.min(w, h);

      ctx.save();
      for (const star of stars) {
        const layer = LAYERS[star.layer];
        const travel =
          (scroll * layer.travel * parallax * 1000 + offset) / (h || 1);
        const y = ((star.y + travel) % 1.25) * h - h * 0.12;
        if (y < -unit * 0.05 || y > h + unit * 0.05) continue;
        const pulse = 0.55 + 0.45 * Math.sin(t * 1.4 * twinkle + star.phase);
        const radius = Math.max(0.35, star.r * (unit / 900) * 1.6);
        ctx.globalAlpha = clamp01((0.16 + 0.7 * pulse) * k);
        ctx.fillStyle = star.tinted ? tintColor : starColor;
        ctx.beginPath();
        ctx.arc(star.x * w, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    [stars, parallax, offset, twinkle, k, starColor, tintColor],
  );

  const { ref, canvasRef, surface } = useCanvasFx(draw, {
    fps,
    maxDpr: 1.5,
    enabled: animate,
  });

  return (
    <div
      ref={ref}
      data-fx="starfield"
      data-fx-mode={animate ? "canvas" : "static"}
      aria-hidden="true"
      className={className}
      style={fxRootStyle({ position, zIndex })}
    >
      {animate ? (
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            opacity: surface.w > 0 ? 1 : 0,
            transition: "opacity 320ms linear",
          }}
        />
      ) : (
        <FxStatic colors={[starColor, tintColor]} intensity={k} pattern="dots" />
      )}
    </div>
  );
}

export default Starfield;