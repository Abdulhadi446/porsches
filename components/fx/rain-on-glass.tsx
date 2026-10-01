"use client";

/**
 * RainOnGlass — droplets and rivulets running down a glass surface.
 * Technique: one 2D canvas, stateless draw derived from `now` (two layers:
 * fast rivulets with fading trails + slow beads that occasionally slip).
 * DPR capped at 1.25, 30 fps, drops capped by FX_MAX_PARTICLES.
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

export interface RainOnGlassProps {
  className?: string;
  /** 0..1 — drop count, trail length and contrast */
  intensity?: number;
  /** droplet highlight colour (default metal-100) */
  color?: FxColor;
  /** cool refraction / shadow colour (default gulf-blue-deep) */
  tint?: FxColor;
  /** drops before the hard cap (default 180) */
  count?: number;
  /** frames per second (default 30) */
  fps?: number;
  /** fall speed multiplier (default 1) */
  speed?: number;
  position?: FxPosition;
  zIndex?: number | string;
}

interface Rivulet {
  x: number;
  y0: number;
  r: number;
  v: number;
  trail: number;
  wobble: number;
  alpha: number;
}

interface Bead {
  x: number;
  y: number;
  r: number;
  alpha: number;
  phase: number;
  slips: boolean;
  period: number;
  offset: number;
  v: number;
  wobble: number;
}

export function RainOnGlass({
  className,
  intensity = 1,
  color = "metal-100",
  tint = "gulf-blue-deep",
  count = 180,
  fps = 30,
  speed = 1,
  position = "absolute",
  zIndex,
}: RainOnGlassProps) {
  const reduced = useReducedMotion();
  const capability = useFxCapability();
  const animate = !reduced && !capability.lowPower;
  const [dropColor, tintColor] = useFxColors([color, tint]);
  const k = clamp01(intensity);

  const { rivulets, beads } = useMemo(() => {
    const random = seededRandom(964);
    const total = clamp(
      Math.round(count * (0.35 + 0.65 * k)),
      24,
      FX_MAX_PARTICLES,
    );
    const rivuletCount = Math.round(total * 0.42);
    const nextRivulets: Rivulet[] = Array.from(
      { length: rivuletCount },
      () => ({
        x: random(),
        y0: random(),
        r: 1.1 + random() * 2.4,
        v: 0.06 + random() * 0.16,
        trail: 6 + Math.floor(random() * 10),
        wobble: random() * Math.PI * 2,
        alpha: 0.2 + random() * 0.5,
      }),
    );
    const nextBeads: Bead[] = Array.from(
      { length: Math.max(0, total - rivuletCount) },
      () => {
        const slips = random() < 0.22;
        return {
          x: random(),
          y: random(),
          r: 0.9 + random() * 2.8,
          alpha: 0.16 + random() * 0.4,
          phase: random() * Math.PI * 2,
          slips,
          period: 5 + random() * 14,
          offset: random() * 14,
          v: 0.04 + random() * 0.1,
          wobble: random() * Math.PI * 2,
        };
      },
    );
    return { rivulets: nextRivulets, beads: nextBeads };
  }, [count, k]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, surface: FxSurface, now: number) => {
      const { w, h } = surface;
      if (w < 2 || h < 2) return;
      const t = now / 1000;
      const short = Math.min(w, h);

ctx.save();

      // rivulets: head + fading trail
      const trailSteps = Math.max(2, Math.round(6 * k));
      for (const drop of rivulets) {
        const span = h + short * 2;
        const travel = (drop.y0 * span + t * drop.v * span * speed) % span;
        const headY = travel - short;
        const x = drop.x * w + Math.sin(t * 0.6 + drop.wobble) * w * 0.004;
        const fade = drop.alpha * k;
        ctx.fillStyle = withAlpha(tintColor, fade * 0.5);
        ctx.beginPath();
        ctx.ellipse(
          x,
          headY,
          drop.r * 0.9,
          drop.r * 1.5,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        for (let step = 1; step <= trailSteps; step += 1) {
          const p = step / trailSteps;
          ctx.fillStyle = withAlpha(dropColor, fade * (1 - p) * 0.32);
          ctx.beginPath();
          ctx.arc(
            x,
            headY - step * drop.r * 2.4,
            Math.max(0.4, drop.r * (1 - p) * 0.85),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.fillStyle = withAlpha(dropColor, fade * 0.8);
        ctx.beginPath();
        ctx.arc(
          x - drop.r * 0.3,
          headY - drop.r * 0.5,
          drop.r * 0.32,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // beads: mostly static, some slip down and reset
      for (const bead of beads) {
        let y = bead.y;
        let slipBoost = 0;
        if (bead.slips) {
          const phase = (t + bead.offset) % bead.period;
          const runTime = bead.period * 0.32;
          if (phase < runTime) {
            const p = phase / runTime;
            y = bead.y + p * (1.05 - bead.y);
            slipBoost = 1 - p * 0.6;
          }
        }
        const breathe = 0.82 + 0.18 * Math.sin(t * 0.8 + bead.phase);
        const x = bead.x * w + Math.sin(t * 0.45 + bead.wobble) * w * 0.003;
        const py = y * h;
        const r = bead.r * breathe;
        const alpha = bead.alpha * k * (0.75 + slipBoost * 0.4);
        ctx.fillStyle = tintColor;
        ctx.globalAlpha = clamp01(alpha * 0.6);
        ctx.beginPath();
        ctx.arc(x, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dropColor;
        ctx.globalAlpha = clamp01(alpha);
        ctx.beginPath();
        ctx.arc(x - r * 0.34, py - r * 0.38, r * 0.44, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    },
    [rivulets, beads, speed, k, dropColor, tintColor],
  );

  const { ref, canvasRef, surface } = useCanvasFx(draw, {
    fps,
    maxDpr: 1.25,
    enabled: animate,
  });

  return (
    <div
      ref={ref}
      data-fx="rain-on-glass"
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
          colors={[dropColor, tintColor]}
          intensity={k * 0.55}
          pattern="dots"
        />
      )}
    </div>
  );
}

export default RainOnGlass;