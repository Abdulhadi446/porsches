"use client";

/**
 * SpeedLines — radial motion-blur streaks rushing out of a vanishing point.
 * Technique: one 2D canvas, stateless draw derived from `now`, seeded layout,
 * DPR capped at 1.25, loop throttled to 32 fps, paused off-screen / hidden tab.
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
  withAlpha,
  type FxColor,
  type FxPosition,
  type FxSurface,
} from "./runtime";

export type SpeedLinesOrigin = "center" | "bottom" | "left" | "right";

export interface SpeedLinesProps {
  className?: string;
  /** 0..1 — line count, brightness and rush speed */
  intensity?: number;
  /** streak body colour (default metal-300) */
  color?: FxColor;
  /** streak core / leading-edge colour (default guards-glow) */
  coreColor?: FxColor;
  /** streak count before the hard cap (default 64) */
  count?: number;
  /** frames per second (default 32) */
  fps?: number;
  /** vanishing point, default "center" */
  origin?: SpeedLinesOrigin;
  /** rush multiplier (default 1) */
  speed?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

interface Line {
  angle: number;
  phase: number;
  length: number;
  width: number;
  alpha: number;
  rate: number;
}

const ORIGINS: Record<SpeedLinesOrigin, { x: number; y: number }> = {
  center: { x: 0.5, y: 0.5 },
  bottom: { x: 0.5, y: 0.62 },
  left: { x: 0.18, y: 0.5 },
  right: { x: 0.82, y: 0.5 },
};

export function SpeedLines({
  className,
  intensity = 1,
  color = "metal-300",
  coreColor = "guards-glow",
  count = 64,
  fps = 32,
  origin = "center",
  speed = 1,
  position = "absolute",
  zIndex,
}: SpeedLinesProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const animate = !reduced && !capability.lowPower;
  const [bodyColor, headColor] = useFxColors([color, coreColor]);
  const k = clamp01(intensity);
  const point = ORIGINS[origin] ?? ORIGINS.center;

  const lines = useMemo<Line[]>(() => {
    const random = seededRandom(356);
    const total = clamp(
      Math.round(count * (0.4 + 0.6 * k)),
      8,
      FX_MAX_PARTICLES,
    );
    return Array.from({ length: total }, () => {
      const jitter = 0.25 + random() * 0.75;
      return {
        angle: random() * Math.PI * 2,
        phase: random(),
        length: 0.06 + random() * 0.16,
        width: 0.7 + random() * 2.4,
        alpha: 0.25 + random() * 0.75,
        rate: jitter,
      };
    });
  }, [count, k]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, surface: FxSurface, now: number) => {
      const { w, h } = surface;
      if (w < 2 || h < 2) return;
      const t = now / 1000;
      const ox = point.x * w;
      const oy = point.y * h;
      const reach = Math.hypot(w, h);

      ctx.save();
      ctx.lineCap = "round";
      for (const line of lines) {
        const p = (t * line.rate * speed * k + line.phase) % 1;
        const head = p * reach;
        const tail = Math.max(0, head - line.length * reach * (0.35 + p * 0.9));
        if (head - tail < 0.5) continue;
        const cos = Math.cos(line.angle);
        const sin = Math.sin(line.angle);
        const fade = line.alpha * (0.18 + p * 0.85) * (1 - p * 0.4) * k;
        ctx.globalAlpha = clamp01(fade * 0.5);
        ctx.lineWidth = line.width * (0.45 + p * 1.7);
        ctx.strokeStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(ox + cos * tail, oy + sin * tail);
        ctx.lineTo(ox + cos * head, oy + sin * head);
        ctx.stroke();

        const coreLength = tail + (head - tail) * 0.45;
        ctx.globalAlpha = clamp01(fade * 0.85);
        ctx.lineWidth = Math.max(0.5, ctx.lineWidth * 0.45);
        ctx.strokeStyle = headColor;
        ctx.beginPath();
        ctx.moveTo(ox + cos * coreLength, oy + sin * coreLength);
        ctx.lineTo(ox + cos * head, oy + sin * head);
        ctx.stroke();
      }

      const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, reach * 0.42);
      glow.addColorStop(0, withAlpha(headColor, 0.16 * k));
      glow.addColorStop(1, withAlpha(headColor, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
    [lines, point.x, point.y, speed, k, bodyColor, headColor],
  );

  const { ref, canvasRef, surface } = useCanvasFx(draw, {
    fps,
    maxDpr: 1.25,
    enabled: animate,
  });

  return (
    <div
      ref={ref}
      data-fx="speed-lines"
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
        <FxStatic colors={[bodyColor, headColor]} intensity={k * 0.8} pattern="rays" />
      )}
    </div>
  );
}

export default SpeedLines;