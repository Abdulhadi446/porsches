"use client";

/**
 * RoadTunnel — road markings and tunnel ribs rushing to a horizon point.
 * Technique: one 2D canvas with a hand-rolled perspective projection
 * (s = focal / z). Stateless draw derived from `now`, or from the `progress`
 * prop when the caller wants to drive it from Lenis/GSAP scroll.
 * DPR capped at 1.25, 30 fps, depth step count capped.
 */

import { useCallback, useMemo } from "react";
import {
  FxStatic,
  clamp,
  clamp01,
  fxRootStyle,
  useCanvasFx,
  useFxCapability,
  useFxColors,
  useReducedMotion,
  withAlpha,
  type FxColor,
  type FxPosition,
  type FxSurface,
} from "./runtime";

export interface RoadTunnelProps {
  className?: string;
  /** 0..1 — brightness, line count and rush speed */
  intensity?: number;
  /** tunnel rib / horizon colour (default guards-glow) */
  color?: FxColor;
  /** road + lane line colour (default metal-300) */
  roadColor?: FxColor;
  /** depth steps drawn (default 30, hard cap 64) */
  depth?: number;
  /** frames per second (default 30) */
  fps?: number;
  /** rush speed multiplier (default 1) */
  speed?: number;
  /** horizon position, 0..1 of height (default 0.46) */
  horizon?: number;
  /** drive the offset from scroll instead of time (0..1+) */
  progress?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

const FOCAL = 0.85;
const RIB_HALF_WIDTH = 1.05;
const RIB_HEIGHT = 0.72;
const LANES = [-0.52, 0, 0.52];

export function RoadTunnel({
  className,
  intensity = 1,
  color = "guards-glow",
  roadColor = "metal-300",
  depth = 30,
  fps = 30,
  speed = 1,
  horizon = 0.46,
  progress,
  position = "absolute",
  zIndex,
}: RoadTunnelProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const animate = !reduced && !capability.lowPower;
  const [ribColor, lineColor] = useFxColors([color, roadColor]);
  const k = clamp01(intensity);
  const steps = clamp(Math.round(depth), 6, 64);
  const horizonY = clamp(horizon, 0.12, 0.9);

  const spacing = useMemo(() => 0.055 + steps * 0.0035, [steps]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, surface: FxSurface, now: number) => {
      const { w, h } = surface;
      if (w < 2 || h < 2) return;
      const cx = w * 0.5;
      const hy = h * horizonY;
      const unit = Math.max(w, h);
      const offset =
        progress === undefined
          ? (now / 1000) * speed * k * 0.42
          : progress * 120 * speed;
      const shift = ((offset % spacing) + spacing) % spacing;

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "butt";

      // horizon glow
      const glow = ctx.createRadialGradient(cx, hy, 0, cx, hy, unit * 0.55);
      glow.addColorStop(0, withAlpha(ribColor, 0.3 * k));
      glow.addColorStop(0.4, withAlpha(ribColor, 0.08 * k));
      glow.addColorStop(1, withAlpha(ribColor, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      for (let index = 0; index < steps; index += 1) {
        const z = (index - 1) * spacing + shift + 0.02;
        if (z <= 0.012) continue;
        const near = FOCAL / z;
        const far = FOCAL / (z + spacing);
        const alpha = clamp01(near * 0.55) * k;

        // road surface
        ctx.fillStyle = withAlpha(lineColor, alpha * 0.05);
        ctx.beginPath();
        ctx.moveTo(cx - RIB_HALF_WIDTH * near * unit, hy + RIB_HEIGHT * near * unit);
        ctx.lineTo(cx - RIB_HALF_WIDTH * far * unit, hy + RIB_HEIGHT * far * unit);
        ctx.lineTo(cx + RIB_HALF_WIDTH * far * unit, hy + RIB_HEIGHT * far * unit);
        ctx.lineTo(cx + RIB_HALF_WIDTH * near * unit, hy + RIB_HEIGHT * near * unit);
        ctx.closePath();
        ctx.fill();

        // lane dashes + edge rails
        ctx.strokeStyle = withAlpha(lineColor, alpha * 0.75);
        ctx.lineWidth = Math.max(0.6, near * unit * 0.006);
        ctx.beginPath();
        for (const lane of LANES) {
          const xNear = cx + lane * near * unit;
          const yNear = hy + RIB_HEIGHT * near * unit;
          const xFar = cx + lane * far * unit;
          const yFar = hy + RIB_HEIGHT * far * unit;
          ctx.moveTo(xNear, yNear);
          ctx.lineTo(xFar, yFar);
        }
        ctx.stroke();

        // tunnel rib
        const nearLeft = cx - RIB_HALF_WIDTH * near * unit;
        const nearRight = cx + RIB_HALF_WIDTH * near * unit;
        const nearTop = hy - RIB_HEIGHT * near * unit * 0.78;
        const nearBottom = hy + RIB_HEIGHT * near * unit;
        const farLeft = cx - RIB_HALF_WIDTH * far * unit;
        const farRight = cx + RIB_HALF_WIDTH * far * unit;
        const farTop = hy - RIB_HEIGHT * far * unit * 0.78;
        const farBottom = hy + RIB_HEIGHT * far * unit;
        ctx.strokeStyle = withAlpha(ribColor, alpha * 0.9);
        ctx.lineWidth = Math.max(0.6, near * unit * 0.005);
        ctx.beginPath();
        ctx.moveTo(nearLeft, nearTop);
        ctx.lineTo(farLeft, farTop);
        ctx.lineTo(farRight, farBottom);
        ctx.lineTo(nearRight, nearBottom);
        ctx.closePath();
        ctx.stroke();
      }

      // centre beam
      const beam = ctx.createLinearGradient(cx, hy, cx, h);
      beam.addColorStop(0, withAlpha(lineColor, 0.12 * k));
      beam.addColorStop(1, withAlpha(lineColor, 0));
      ctx.fillStyle = beam;
      ctx.fillRect(cx - unit * 0.06, hy, unit * 0.12, h - hy);

      ctx.restore();
    },
    [steps, spacing, speed, k, horizonY, progress, ribColor, lineColor],
  );

  const { ref, canvasRef, surface } = useCanvasFx(draw, {
    fps,
    maxDpr: 1.25,
    enabled: animate,
  });

  return (
    <div
      ref={ref}
      data-fx="road-tunnel"
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
        <FxStatic
          colors={[ribColor, lineColor]}
          intensity={k * 0.85}
          pattern="rays"
        />
      )}
    </div>
  );
}

export default RoadTunnel;