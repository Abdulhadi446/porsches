"use client";

/**
 * Capability gate for the hero WebGL scene.
 *
 * Nothing here runs during render or on the server: the first paint is always the
 * static poster (`ready === false`), and the real answer arrives in an effect.
 * That keeps the hero hydration-safe *and* means the WebGL context is only ever
 * requested once we already know the machine can give us one.
 *
 * The probe creates a throwaway 1×1 context, reads the unmasked renderer string
 * to spot software rasterisers (SwiftShader / llvmpipe / Mesa), and immediately
 * calls `WEBGL_lose_context.loseContext()` so we never hold two contexts at once
 * — research.md notes this box can only keep one alive.
 */

import { useEffect, useState } from "react";
import { useReducedMotion } from "#components/fx/runtime";
import { QUALITY_FULL, QUALITY_LITE, type QualityProfile } from "./quality";

/**
 * `navigator.deviceMemory` is part of the Device Memory spec, not lib.dom.
 * One documented structural cast — no `any` anywhere in the hero.
 */
interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number;
}

const SOFTWARE_RE = /swiftshader|llvmpipe|software|softwarerasterizer|microsoft basic/i;

export interface HeroSupport {
  /** measured after mount? false ⇒ render the poster */
  ready: boolean;
  webgl: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  /** create a WebGL context at all? */
  canRender: boolean;
  tier: "full" | "lite";
  quality: QualityProfile;
}

const UNMEASURED: HeroSupport = {
  ready: false,
  webgl: false,
  reducedMotion: true,
  lowPower: true,
  canRender: false,
  tier: "lite",
  quality: QUALITY_LITE,
};

const MOBILE_RE =
  /android|iphone|ipod|iemobile|blackberry|windows phone|opera mini|mobile safari/i;

interface Probe {
  webgl: boolean;
  webgl2: boolean;
  software: boolean;
}

function probeWebgl(): Probe {
  const empty: Probe = { webgl: false, webgl2: false, software: false };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return empty;
  }
  let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    context =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  } catch {
    context = null;
  }
  if (!context) {
    return empty;
  }
  let software = false;
  try {
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : "";
    software = SOFTWARE_RE.test(renderer);
  } catch {
    software = false;
  }
  const webgl2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    context instanceof WebGL2RenderingContext;
  try {
    context.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* a context we cannot explicitly release is still dropped with the canvas */
  }
  context = null;
  canvas = null;
  return { webgl: true, webgl2, software };
}

export function useWebglSupport(): HeroSupport {
  const reducedMotion = useReducedMotion();
  const [support, setSupport] = useState<HeroSupport>(UNMEASURED);

  useEffect(() => {
    // Measured on the next frame, never during render or on the server: the
    // poster gets painted first, and the probe never competes with LCP.
    const frame = window.requestAnimationFrame(() => {      const probe = probeWebgl();
      const nav: NavigatorWithMemory = navigator;
      const cores =
        typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 0;
      const deviceMemory =
        typeof nav.deviceMemory === "number" ? nav.deviceMemory : 0;
      const mobile = MOBILE_RE.test(nav.userAgent || "");

      const fewCores = cores > 0 && cores < 4;
      const littleMemory = deviceMemory > 0 && deviceMemory <= 4;
      const lowPower =
        !probe.webgl ||
        mobile ||
        fewCores ||
        littleMemory ||
        probe.software ||
        !probe.webgl2;

      setSupport({
        ready: true,
        webgl: probe.webgl,
        reducedMotion,
        lowPower,
        // Reduced motion is an explicit "no canvas" — the poster is still composed.
        // Anything with a WebGL context gets a scene: weak hardware (mobile, few
        // cores, little memory, software rasterisers) takes the lite profile —
        // half-res DOF off, reflector off, smaller dpr — rather than degrading to
        // a flat photograph. Only "no WebGL at all" means poster.
        canRender: probe.webgl && !reducedMotion,
        tier: lowPower ? "lite" : "full",
        quality: lowPower ? QUALITY_LITE : QUALITY_FULL,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion]);

  return support;
}
