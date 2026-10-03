"use client";

/**
 * INTERNAL — shared plumbing for every component in components/fx.
 * Not part of the public barrel (see ./index.ts).
 *
 * Owns: design-token colour resolution, capability detection
 * (reduced motion / low power / no WebGL), viewport visibility,
 * and a single capped 2D-canvas render loop per component instance.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";

/* ------------------------------------------------------------------ */
/* Design tokens — mirror of styles/tokens.css @theme block.           */
/* Used as deterministic fallbacks (SSR / pre-hydration) and as the    */
/* answer when a CSS custom property is not yet resolvable.            */
/* ------------------------------------------------------------------ */

export const FX_TOKEN_COLORS = {
  ink: "#050506",
  "ink-2": "#0b0b0d",
  "ink-3": "#131317",
  "ink-4": "#1c1c22",
  guards: "#d5001c",
  "guards-deep": "#8f0014",
  "guards-glow": "#ff2036",
  "gulf-blue": "#3fa9d6",
  "gulf-blue-deep": "#1c6f96",
  "gulf-orange": "#f47b20",
  "gulf-orange-deep": "#c85a08",
  "metal-100": "#f4f4f5",
  "metal-300": "#c9c9cf",
  "metal-500": "#8b8b95",
  "metal-700": "#55555e",
  "metal-900": "#26262d",
  signal: "#ffd400",
  ok: "#37d67a",
} as const;

export type FxToken = keyof typeof FX_TOKEN_COLORS;

/** A token name ("guards-glow"), a `var(--color-…)` string, or any CSS colour. */
export type FxColor = FxToken | (string & {});

const FX_VAR_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries(FX_TOKEN_COLORS).map(([name, value]) => [
    `--color-${name}`,
    value,
  ]),
);

/** Hard ceiling on device-pixel-ratio for every fx canvas. */
export const FX_DPR_CEILING = 2;
/** Hard ceiling on generated particles/lines/drops per component. */
export const FX_MAX_PARTICLES = 420;

export function fxVar(token: FxToken): string {
  return `var(--color-${token})`;
}

const VAR_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/;

/**
 * Resolve a colour prop to something canvas / data-URI code can use.
 * Accepts token names, `var(--color-x)` and raw CSS colours.
 */
export function resolveFxColor(input: FxColor, fallback = "#ffffff"): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (Object.prototype.hasOwnProperty.call(FX_TOKEN_COLORS, raw)) {
    return FX_TOKEN_COLORS[raw as FxToken];
  }
  const match = VAR_RE.exec(raw);
  if (!match) return raw || fallback;
  const [, name, inlineFallback] = match;
  const known = FX_VAR_DEFAULTS[name];
  if (typeof window === "undefined") {
    return known || inlineFallback?.trim() || fallback;
  }
  let resolved = "";
  try {
    resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  } catch {
    resolved = "";
  }
  return resolved || known || inlineFallback?.trim() || fallback;
}

/**
 * Resolve a list of colour props after mount (reads styles/tokens.css
 * through getComputedStyle). Deterministic on the first render, so the
 * server markup and the first client render always match.
 */
export function useFxColors(inputs: readonly FxColor[]): string[] {
  const key = inputs.join("|");
  return useMemo(
    () => key.split("|").map((value) => resolveFxColor(value as FxColor)),
    [key],
  );
}

/* ------------------------------------------------------------------ */
/* Small maths / deterministic RNG                                     */
/* ------------------------------------------------------------------ */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Seeded PRNG (mulberry32) — identical on server and client. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert `#rgb` / `#rrggbb` to `rgba(...)`; anything else uses color-mix(). */
export function withAlpha(color: string, amount: number): string {
  const a = clamp01(amount);
  const value = color.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    if (full.length === 6) {
      const num = Number.parseInt(full, 16);
      if (Number.isFinite(num)) {
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
      }
    }
  }
  return `color-mix(in srgb, ${value} ${Math.round(a * 100)}%, transparent)`;
}

/* ------------------------------------------------------------------ */
/* Capability detection                                                */
/* ------------------------------------------------------------------ */

export interface FxCapability {
  /** navigator.hardwareConcurrency, 0 when unknown */
  cores: number;
  mobile: boolean;
  webgl: boolean;
  /** < 4 cores, mobile UA, or no WebGL context available */
  lowPower: boolean;
  /** measured yet? */
  ready: boolean;
}

const UNKNOWN_CAPABILITY: FxCapability = {
  cores: 0,
  mobile: false,
  webgl: false,
  lowPower: true,
  ready: false,
};

function detectWebgl(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = (
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    ) as WebGLRenderingContext | null;
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const MOBILE_RE =
  /android|iphone|ipod|iemobile|blackberry|windows phone|opera mini|mobile safari/i;

let capabilityOverride: boolean | null = null;
/** Bumped whenever the override changes so mounted effects re-measure. */
const capabilityListeners = new Set<() => void>();

/**
 * Escape hatch for the low-power / no-WebGL static fallback. Call it once
 * before the effects render (e.g. in a client provider or a layout module) to
 * force or forbid animation. Pass `null` to restore auto-detection.
 */
export function setFxCapabilityOverride(allow: boolean | null): void {
  if (capabilityOverride === allow) return;
  capabilityOverride = allow;
  cachedCapability = null;
  for (const listener of capabilityListeners) listener();
}

/**
 * Measure the device once, AFTER mount. The first render (server and client)
 * always returns the safe static capability so hydration can never mismatch —
 * probing WebGL during render was the source of React #418 on desktop.
 */
let cachedCapability: FxCapability | null = null;

/** Server + first client render: the safe static capability (no mismatch). */
const UNKNOWN_SNAPSHOT = UNKNOWN_CAPABILITY;

function getCapabilitySnapshot(): FxCapability {
  if (cachedCapability) return cachedCapability;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return UNKNOWN_SNAPSHOT;
  }
  const cores =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 0;
  const mobile = MOBILE_RE.test(navigator.userAgent || "");
  const webgl = detectWebgl();
  const detected = (cores > 0 && cores < 4) || mobile || !webgl;
  cachedCapability = {
    cores,
    mobile,
    webgl,
    lowPower: capabilityOverride ?? detected,
    ready: true,
  };
  return cachedCapability;
}

const subscribeToCapability = (onChange: () => void) => {
  capabilityListeners.add(onChange);
  return () => {
    capabilityListeners.delete(onChange);
  };
};

export function useFxCapability(): FxCapability {
  return useSyncExternalStore(
    subscribeToCapability,
    getCapabilitySnapshot,
    () => UNKNOWN_SNAPSHOT,
  );
}

/**
 * `true` until the media query has been measured, so the first paint (server
 * and client) is always the cheap, static fallback.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** IntersectionObserver + document.hidden, combined into one flag. */
export function useVisibility<T extends HTMLElement>(
  rootMargin = "120px",
): { ref: RefObject<T | null>; active: boolean } {
  const ref = useRef<T | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const onScreenRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) onScreenRef.current = entry.isIntersecting;
          setOnScreen(onScreenRef.current);
        },
        { rootMargin, threshold: 0 },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }

    onScreenRef.current = true;
    const fallback = window.requestAnimationFrame(() => setOnScreen(true));
    return () => window.cancelAnimationFrame(fallback);
  }, [rootMargin]);

  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return { ref, active: onScreen && !hidden };
}

/* ------------------------------------------------------------------ */
/* Scoped keyframes (injected once, no global stylesheet edits)         */
/* ------------------------------------------------------------------ */

export function useFxStylesheet(id: string, css: string): void {
  useEffect(() => {
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }, [id, css]);
}

/** Data-URI SVG noise helper (feTurbulence, no runtime asset fetch). */
export function svgDataUri(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}")`;
}

/* ------------------------------------------------------------------ */
/* Positioning / static fallback                                       */
/* ------------------------------------------------------------------ */

export type FxPosition = "absolute" | "fixed" | "relative" | "sticky";

export interface FxRootStyleOptions {
  position?: FxPosition;
  zIndex?: number | string;
}

/** Deterministic root style: fills its positioned parent, never interactive. */
export function fxRootStyle({
  position = "absolute",
  zIndex = "var(--z-bg)",
}: FxRootStyleOptions = {}): CSSProperties {
  const style: CSSProperties = {
    position,
    pointerEvents: "none",
    zIndex,
    overflow: "hidden",
    contain: "layout style paint",
  };
  if (position === "absolute" || position === "fixed" || position === "sticky") {
    style.top = 0;
    style.right = 0;
    style.bottom = 0;
    style.left = 0;
  }
  return style;
}

export type FxStaticPattern = "none" | "rays" | "dots" | "haze";

export interface FxStaticProps {
  colors: readonly string[];
  intensity?: number;
  pattern?: FxStaticPattern;
  style?: CSSProperties;
}

/**
 * Static CSS-only fallback: layered gradients (+ an optional CSS pattern).
 * Zero JS, zero canvas, no layout animation.
 */
export function FxStatic({
  colors,
  intensity = 1,
  pattern = "none",
  style,
}: FxStaticProps) {
  const k = clamp01(intensity);
  const [a, b, c] = [
    colors[0] ?? "#101014",
    colors[1] ?? colors[0] ?? "#101014",
    colors[2] ?? colors[1] ?? colors[0] ?? "#101014",
  ];

  const blobs = [
    `radial-gradient(120% 95% at 16% 8%, ${withAlpha(a, 0.5 * k)} 0%, transparent 62%)`,
    `radial-gradient(95% 85% at 84% 26%, ${withAlpha(b, 0.34 * k)} 0%, transparent 64%)`,
    `radial-gradient(150% 130% at 50% 112%, ${withAlpha(c, 0.3 * k)} 0%, transparent 72%)`,
  ];

  const extras: Record<FxStaticPattern, string | null> = {
    none: null,
    rays: `conic-gradient(from 0deg at 50% 52%, ${withAlpha(a, 0.22 * k)} 0deg, transparent 18deg, transparent 40deg, ${withAlpha(b, 0.16 * k)} 62deg, transparent 96deg)`,
    dots: `radial-gradient(${withAlpha(a, 0.55 * k)} 1.1px, transparent 1.5px)`,
    haze: `repeating-linear-gradient(102deg, ${withAlpha(b, 0.14 * k)} 0px, transparent 14px, ${withAlpha(a, 0.1 * k)} 30px, transparent 46px)`,
  };

  // the tiled layer must be first so background-size maps to it
  const tiled = pattern === "dots" ? extras.dots : null;
  const images = tiled ? [tiled, ...blobs] : [...blobs];
  const overlay = extras[pattern] === tiled ? null : extras[pattern];
  if (overlay) images.push(overlay);

  return (
    <div
      data-fx-static={pattern}
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: images.filter(Boolean).join(", "),
        backgroundSize: tiled ? "26px 26px, auto" : undefined,
        opacity: 0.35 + 0.65 * k,
        ...style,
      }}
    />
  );
}

export interface FxStaticRootProps extends FxStaticProps {
  className?: string;
  position?: FxPosition;
  zIndex?: number | string;
  style?: CSSProperties;
  /** element name written to data-fx, e.g. "gradient-mesh" */
  name: string;
}

/** Positioned wrapper around <FxStatic />, for CSS-only effects. */
export function FxStaticRoot({
  className,
  position,
  zIndex,
  style,
  ...staticProps
}: FxStaticRootProps) {
  return (
    <div
      data-fx={staticProps.name}
      data-fx-mode="static"
      aria-hidden="true"
      className={className}
      style={{ ...fxRootStyle({ position, zIndex }), ...style }}
    >
      <FxStatic {...staticProps} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2D canvas runtime — exactly one canvas per component instance       */
/* ------------------------------------------------------------------ */

export interface FxSurface {
  /** CSS pixels */
  w: number;
  h: number;
  /** applied device-pixel-ratio (already capped) */
  dpr: number;
}

export interface CanvasFx {
  /** attach to the positioned wrapper */
  ref: RefObject<HTMLDivElement | null>;
  /** attach to the <canvas /> */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** on screen and tab visible */
  active: boolean;
  surface: FxSurface;
}

export interface CanvasFxOptions {
  /** frames per second, default 30 */
  fps?: number;
  /** device-pixel-ratio cap for this canvas, default 1.5 */
  maxDpr?: number;
  /** when false the canvas is not mounted / not painted (static fallback) */
  enabled?: boolean;
  rootMargin?: string;
}

/**
 * Sizing + capped rAF loop for one 2D canvas. The draw callback must be
 * stateless and derive everything from `now` so a paused frame is valid.
 */
export function useCanvasFx(
  draw: (ctx: CanvasRenderingContext2D, surface: FxSurface, now: number) => void,
  options: CanvasFxOptions = {},
): CanvasFx {
  const { fps = 30, maxDpr = 1.5, enabled = true, rootMargin = "120px" } =
    options;

  const ref = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [surface, setSurface] = useState<FxSurface>({ w: 0, h: 0, dpr: 1 });

  const paintRef = useRef<(() => void) | null>(null);
  const elapsedRef = useRef(0);
  const onScreenRef = useRef(false);
  const drawParams = useRef(draw);
  const fpsRef = useRef(fps);
  const maxDprRef = useRef(maxDpr);
  const surfaceRef = useRef<FxSurface>(surface);

  useEffect(() => {
    drawParams.current = draw;
    fpsRef.current = fps;
    maxDprRef.current = maxDpr;
    surfaceRef.current = surface;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onVisibilityChange = () =>
      setActive(onScreenRef.current && !document.hidden);

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            onScreenRef.current = entry.isIntersecting;
          }
          setActive(onScreenRef.current && !document.hidden);
        },
        { rootMargin, threshold: 0 },
      );
      observer.observe(el);
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }

    onScreenRef.current = true;
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [rootMargin]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.max(
        1,
        Math.min(
          window.devicePixelRatio || 1,
          maxDprRef.current,
          FX_DPR_CEILING,
        ),
      );
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setSurface((prev) =>
        prev.w === w && prev.h === h && prev.dpr === dpr
          ? prev
          : { w, h, dpr },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    paintRef.current = null;
    if (!enabled || !canvas || surface.w < 1 || surface.h < 1) return;

    const pixelW = Math.max(1, Math.round(surface.w * surface.dpr));
    const pixelH = Math.max(1, Math.round(surface.h * surface.dpr));
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    canvas.style.width = `${surface.w}px`;
    canvas.style.height = `${surface.h}px`;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d", { alpha: true });
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    paintRef.current = () => {
      const current = surfaceRef.current;
      ctx!.setTransform(current.dpr, 0, 0, current.dpr, 0, 0);
      ctx!.clearRect(0, 0, current.w, current.h);
      drawParams.current(ctx!, current, elapsedRef.current);
    };
    paintRef.current();
  }, [enabled, surface]);

  useEffect(() => {
    const interval = 1000 / Math.max(1, fpsRef.current);
    if (!enabled) return;
    if (!active) {
      paintRef.current?.();
      return;
    }
    let raf = 0;
    let previous = -Infinity;
    const startedAt = performance.now() - elapsedRef.current;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - previous < interval) return;
      previous = now;
      elapsedRef.current = now - startedAt;
      paintRef.current?.();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, enabled]);

  return { ref, canvasRef, active, surface };
}