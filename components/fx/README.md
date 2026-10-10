# components/fx — background effects library

Eight drop-in, decorative layers for the 911 showcase. Seven are background layers; the
eighth (`CarCursor`) is a pointer-following overlay. Every component is a client
component, never intercepts pointer events, and degrades to a static CSS gradient (or to
the native cursor) instead of failing.

```tsx
import { GradientMesh, Starfield, GrainOverlay, CarCursor } from "#components/fx";
```

No runtime asset fetches: colours come from `styles/tokens.css` (resolved with
`getComputedStyle`, mirrored as constants for SSR), noise is an inline SVG `feTurbulence`
data-URI, and every effect is CSS or a single 2D canvas. **No WebGL context is created** —
not by these components, not for these effects.

---

## Shared contract

Every component accepts:

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `className` | `string` | – | merged onto the root element |
| `intensity` | `number` | `1` | `0..1`, clamped; drives opacity, count and speed |
| `position` | `"absolute" \| "fixed" \| "relative" \| "sticky"` | `"absolute"` (`"fixed"` for grain) | applied inline, fills the parent |
| `zIndex` | `number \| string` | `"var(--z-bg)"` (`"var(--z-overlay)"` for grain) | applied inline |

Root element behaviour: `aria-hidden`, `pointer-events: none`, `overflow: hidden`,
`contain: layout style paint` (isolates blend modes and clips, so nothing escapes the layer),
and `data-fx="<name>"` + `data-fx-mode="css" \| "canvas" \| "static"` for debugging.

### Colour props

Colours accept a **token name** (`"guards-glow"`), a **CSS variable**
(`"var(--color-gulf-blue)"`) or any canvas-parseable CSS colour (`"#d5001c"`, `rgb()`,
`hsl()`). Tokens are looked up in `styles/tokens.css` at runtime; the token hex values are
mirrored in `FX_TOKEN_COLORS` as the SSR / pre-hydration value, so the first client render
always matches the server markup. Canvas components cannot use `color-mix()` /
`oklch()` values — use a token, a `var(--color-…)` string, or hex.

Token names available: `ink`, `ink-2`, `ink-3`, `ink-4`, `guards`, `guards-deep`,
`guards-glow`, `gulf-blue`, `gulf-blue-deep`, `gulf-orange`, `gulf-orange-deep`,
`metal-100`, `metal-300`, `metal-500`, `metal-700`, `metal-900`, `signal`, `ok`.

### Perf guards (all components)

1. **Reduced motion** — `prefers-reduced-motion: reduce` is read with `matchMedia`. The
   animated layer is replaced by a static CSS fallback (`data-fx-mode="static"`), or by the
   component's own static rendering for the two effects that *are* static (grain, and the
   non-animated heat haze). Nothing animates. `app/globals.css` also globally neuters
   animations, so this is belt-and-braces.
2. **Low power / no WebGL** — measured once after mount: `navigator.hardwareConcurrency < 4`
   **or** a mobile UA **or** no obtainable WebGL context → static CSS gradient fallback.
   Override with `setFxCapabilityOverride(true | false | null)` before first render (useful
   when a 3D scene already owns the only available context). `<GrainOverlay />` swaps its
   colour wash for that static gradient and drops the noise tile; the other six switch the
   whole layer.
3. **First paint is always static.** Capability and motion state start in the "safe" value
   and upgrade after mount, so SSR output is the cheap CSS gradient — no canvas in the HTML,
   no hydration mismatch, no flash of animation.
4. **DPR is capped** — 1.25 for the soft/blurry effects (rain, speed lines, road tunnel),
   1.5 for the starfield, and never above `FX_DPR_CEILING` (2).
5. **Particle budgets are capped** by `FX_MAX_PARTICLES` (420) and scaled down by
   `intensity`; frame rate is throttled per component (`fps`, default 30).
6. **Pauses when idle** — an `IntersectionObserver` (120–200 px root margin) and a
   `document.visibilitychange` listener stop the rAF loop (canvas) or set
   `animation-play-state: paused` (CSS) whenever the layer is off-screen or the tab hidden.
7. **No leaks** — rAF cancelled, observers disconnected, canvas context reference dropped on
   unmount. One canvas per component instance, never a global/shared context.
8. **Deterministic layout** — particle/blob positions come from a seeded PRNG (mulberry32),
   so server and client markup are identical.

`runtime.tsx` is an internal module (not re-exported except for the tokens/utilities listed
below) holding the shared hooks: `useCanvasFx`, `useFxCapability`, `useReducedMotion`,
`useVisibility`, `useFxColors`, `FxStatic`, `svgDataUri`, `seededRandom`.

---

## Components

### 1. `<GradientMesh />` — `gradient-mesh.tsx`

Animated multi-blob gradient mesh. **Pure CSS** (radial-gradient divs + `blur()` +
keyframes), no canvas.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `colors` | `FxColor[]` | – | explicit colours; wins over `palette` |
| `palette` | `FxToken[]` | `["guards-deep", "gulf-blue-deep", "ink-3"]` | token names |
| `blobs` | `number` | `3` | clamped to 1–5 |
| `duration` | `number` | `26` | seconds per blob cycle (±30 % jitter) |
| `blurPx` | `number` | `110` | blur radius |

**Cost:** ~3–5 composited layers, `transform`-only animation, one blur on the container.
Cheapest effect in the set. No JS runs after mount.

```tsx
<section className="relative">
  <GradientMesh intensity={0.8} palette={["guards-deep", "gulf-blue-deep"]} />
  <div className="relative z-content">{children}</div>
</section>
```

### 2. `<SpeedLines />` — `speed-lines.tsx`

Radial motion-blur streaks rushing out of a vanishing point. **2D canvas**, stateless draw.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"metal-300"` | streak body |
| `coreColor` | `FxColor` | `"guards-glow"` | leading edge + centre glow |
| `count` | `number` | `64` | clamped to 8–420, scaled by `intensity` |
| `fps` | `number` | `32` | |
| `origin` | `"center" \| "bottom" \| "left" \| "right"` | `"center"` | vanishing point |
| `speed` | `number` | `1` | rush multiplier |

**Cost:** 2 strokes per line (≤ ~130 draw calls/frame at default), 1 radial gradient, DPR ≤ 1.25,
32 fps. Cheap; the count prop is the dial.

```tsx
<SpeedLines className="opacity-70" intensity={0.9} origin="bottom" color="metal-300" />
```

### 3. `<RainOnGlass />` — `rain-on-glass.tsx`

Rain droplets and rivulets running down glass. **2D canvas**, two layers: fast rivulets with
fading trails + slow beads (22 % of them slip down and reset).

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"metal-100"` | droplet highlight |
| `tint` | `FxColor` | `"gulf-blue-deep"` | refraction / shadow |
| `count` | `number` | `180` | clamped to 24–420 total, scaled by `intensity` |
| `fps` | `number` | `30` | |
| `speed` | `number` | `1` | fall speed |

**Cost:** the most expensive of the set — ~1 arc per bead plus up to 6 trail arcs per
rivulet (~1200 paths/frame at defaults). Keep `count` ≤ 180 over large areas, `intensity`
≤ 0.7, and prefer a small sub-section rather than the whole page. DPR ≤ 1.25.

```tsx
<RainOnGlass className="mix-blend-screen" intensity={0.5} count={120} />
```

### 4. `<HeatHaze />` — `heat-haze.tsx`

Shimmer / heat distortion. **CSS only**: one inline SVG `feTurbulence` data-URI that crawls in
`steps()`, plus blurred gradient sheets that rise. No postprocessing pass, no rAF loop.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"gulf-orange"` | warm shimmer |
| `colorSecondary` | `FxColor` | `"guards-glow"` | cool counter-shimmer |
| `grainSize` | `number` | `220` | turbulence tile px |
| `frequency` | `number` | `1` | turbulence frequency multiplier (0.25–4) |
| `bands` | `number` | `2` | clamped 1–4 |
| `duration` | `number` | `7` | seconds per shimmer cycle |

**Cost:** 1 blurred, `mix-blend-mode: screen` layer + ≤ 4 transform/opacity layers. Paint is
a background-position swap (7 steps) rather than a redraw, so it stays cheap at any size.

```tsx
<HeatHaze intensity={0.6} color="gulf-orange" colorSecondary="guards-glow" />
```

### 5. `<GrainOverlay />` — `grain-overlay.tsx`

Film grain over the page or a section. **Inline SVG `feTurbulence` data-URI**, static by
default; `animated` jitters the tile in `steps()`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"metal-100"` | noise tint reference + wash |
| `tint` | `FxColor` | `"metal-500"` | wash |
| `opacity` | `number` | `0.5` | noise opacity multiplier (≈ 2–7 % on screen) |
| `size` | `number` | `160` | tile px (60–600) |
| `animated` | `boolean` | `false` | forced off under reduced motion / low power |
| `wash` | `boolean` | `true` | faint radial colour wash |

**Cost:** one tiled background image, no JS after mount. Intended as a single page-level
instance at `position="fixed"` (z-index `var(--z-overlay)`).

```tsx
<GrainOverlay intensity={0.7} animated position="fixed" />
```

### 6. `<RoadTunnel />` — `road-tunnel.tsx`

Road markings and tunnel ribs vanishing to a horizon. **2D canvas** with a hand-rolled
perspective projection (`s = focal / z`).

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"guards-glow"` | tunnel ribs + horizon glow |
| `roadColor` | `FxColor` | `"metal-300"` | road surface, lanes, rails, centre beam |
| `depth` | `number` | `30` | depth steps, clamped 6–64 |
| `fps` | `number` | `30` | |
| `speed` | `number` | `1` | rush speed |
| `horizon` | `number` | `0.46` | horizon as a fraction of height (0.12–0.9) |
| `progress` | `number` | – | drive the offset from scroll instead of time |

**Cost:** ~4 paths per depth step (≤ 256 paths/frame at max depth), 2 gradients, DPR ≤ 1.25.
Pass `progress` (e.g. from a GSAP/Lenis timeline) to make it scroll-driven instead of
self-animating.

```tsx
<RoadTunnel intensity={0.8} horizon={0.42} progress={scrollProgress} />
```

### 7. `<Starfield />` — `starfield.tsx`

Scroll-reactive parallax starfield. **2D canvas**, three depth layers; `window.scrollY` is
read inside the render loop (no scroll listener, no Lenis dependency).

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `FxColor` | `"metal-100"` | stars |
| `tint` | `FxColor` | `"guards-glow"` | 1-in-5 tinted stars |
| `count` | `number` | `220` | clamped 16–420, scaled by `intensity` |
| `fps` | `number` | `30` | |
| `parallax` | `number` | `0.18` | travel per 1000 px of scroll |
| `twinkle` | `number` | `1` | twinkle speed |
| `offset` | `number` | `0` | extra px offset (e.g. timeline-driven) |

**Cost:** one arc per star (≤ ~420 at 30 fps), DPR ≤ 1.5. The only component that reads
scroll state, and it does so without a listener.

```tsx
<Starfield count={160} intensity={0.9} parallax={0.25} />
```

### 8. `<CarCursor />` — `car-cursor.tsx`

A 911 silhouette that replaces the native cursor while the pointer is over a car — the
variant/generation cards, gallery frames, the hero stage and the 3D viewer. Mounted once in
`app/layout.tsx`; the effect is **opt-in per element** via the `data-car-cursor` attribute.

Deviations from the shared contract (deliberate, all of them):

| Aspect | Behaviour |
| --- | --- |
| Parent | none — `position: fixed`, follows the pointer |
| Pointer events | the layer itself is `pointer-events: none`; it only *reads* the pointer |
| `intensity`/`position`/`zIndex` props | not accepted (fixed by nature, `var(--z-overlay)`) |
| Reduced motion / touch / no-JS | the component stays inert **and** never hides the native cursor — `cursor: none` is applied only after JS arms `<html data-cursor-armed>` on a fine pointer with `prefers-reduced-motion: no-preference` |

Perf: no rAF loop at rest — frames run only while the pointer moves or the bank angle is
still settling, then park. `scroll`, `blur`, `visibilitychange` and `pointerout` all
force-hide; all writes are `transform`/`opacity` on the DOM node (the component never
re-renders). Nested controls inside a car zone (`a`/`button`/form widgets that are not the
zone element itself) restore the native pointer, so hero CTAs keep their affordance.

```tsx
<CarCursor />
// anywhere that is a car:
<Link href={href} data-car-cursor=""> … </Link>
```

---

## Copy-paste: layering a section

```tsx
"use client";
import { GradientMesh, RoadTunnel, GrainOverlay } from "#components/fx";

export function HeroBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden">
      <GradientMesh intensity={0.7} blurPx={140} />
      <RoadTunnel intensity={0.8} horizon={0.42} />
      <div className="relative z-content">{children}</div>
      <GrainOverlay position="absolute" zIndex="var(--z-overlay)" />
    </section>
  );
}
```

Notes for integrators:

* The fx root is `position: absolute; inset: 0` by default, so the parent **must** be
  positioned (`relative`/`absolute`/`fixed`) and sized.
* Keep content above the layers (`z-content`) — the fx default to `var(--z-bg)`.
* Stacking several canvas effects at once multiplies their cost; one or two per viewport is
  the budget. Layers with `mix-blend-mode` blend only inside their own `contain: paint` layer
  by design.
* All effects are decorative: `aria-hidden`, no text, no interaction.

## Exported API

```ts
export {
  GradientMesh, SpeedLines, RainOnGlass, HeatHaze,
  GrainOverlay, RoadTunnel, Starfield, CarCursor,
  GRADIENT_MESH_PALETTE,
  type GradientMeshProps, type SpeedLinesProps, type SpeedLinesOrigin,
  type RainOnGlassProps, type HeatHazeProps, type GrainOverlayProps,
  type RoadTunnelProps, type StarfieldProps, type CarCursorProps,
  FX_TOKEN_COLORS, FX_DPR_CEILING, FX_MAX_PARTICLES, fxVar,
  setFxCapabilityOverride,
  type FxColor, type FxPosition, type FxToken,
} from "@/components/fx";
```

Internal helpers (not in the barrel, but stable): `useCanvasFx`, `useFxCapability`,
`useReducedMotion`, `useVisibility`, `useFxColors`, `FxStatic`, `svgDataUri`,
`seededRandom`, `withAlpha`.