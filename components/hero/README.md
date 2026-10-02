# components/hero — the 3D hero

`Hero3D()` is the first thing on `/`. It is a full-viewport cinematic hero: a
real-time R3F scene when the machine can afford one, and an identically composed
static poster when it cannot.

```
components/hero/
  index.tsx              Hero3D: mount gate, sticky stage, scroll runway  (client)
  hero-scene.tsx         <Canvas> + scene graph — the only three.js chunk (ssr:false)
  hero-content.tsx       HTML type layer: kicker, headline, spec strip, hint
  hero-poster.tsx        static composition for no-WebGL / reduced motion
  hero-data.ts           copy + data-derived specs/model/image (pure, SSR safe)
  car.tsx                <Car>: getModel() → GLB, else the procedural 911
  procedural-911.ts      the 911 side profile + every geometry it builds
  floor.tsx              MeshReflectorMaterial stage (lite: plain metal)
  lighting.tsx           3 lights + <Environment> Lightformer rings + gradient dome
  post.tsx               Bloom → (DOF) → ToneMapping → Vignette
  camera-rig.tsx         360° scroll orbit + damped pointer parallax
  use-hero-scroll.ts     the single ScrollTrigger (DOM scrub + camera progress)
  use-webgl-support.ts   capability probe → full | lite | poster
  quality.ts             the two quality profiles
  frame-bus.ts           scroll → "please render one frame" (keeps three out of the light bundle)
  error-boundary.tsx     canvas and GLB both degrade instead of blanking
  hero-tokens.ts         resolves every colour from styles/tokens.css
```

## Scene graph

```
<Canvas frameloop="demand" flat dpr>          gl: antialias, high-performance
  <color background>        ink                opaque safety net
  <fogExp2 fog>             ink-2 @ 0.05       swallows the 24 m disc rim
  <FrameBus />                                scroll → invalidate()
  <ContextGuard />                            gl.dispose + forceContextLoss on unmount
  <CameraRig />                               scroll azimuth + pointer offset
  <HeroLighting />                            ambient + directional + spot + red kicker
    <Environment frames={1}>                  local cube RT built from 5 <Lightformer>s
  <HeroBackdrop />                            gradient dome (drei GradientTexture)
  <HeroFloor />                               24 m disc, MeshReflectorMaterial
  <Turntable>                                 slow idle yaw (full tier only)
    <Car />                                   useGLTF | procedural 911
  <HeroPost />                                one composer, one pass
</Canvas>
```

Nothing fetches a remote asset: the environment map is rendered locally from
`<Lightformer>` rings (no `preset=`, no HDR, no CDN), the backdrop is a 2D-canvas
gradient painted from tokens, and the car is either a local `.glb` or geometry we
build ourselves.

## The procedural 911

ASSET-3D is delivering **Sketchfab embeds**, which are iframes and cannot be drawn
inside this canvas, and no licensed local `.glb` exists yet. Rather than ship an
empty stage, `procedural-911.ts` builds the car from the shape of a 901/911:
`CAR_PROFILE` is a 21-point side elevation in real metres (4.19 × 1.85 × 1.30,
2.45 wheelbase, 0.34 wheels), extruded across the car's width with a 3 cm bevel,
with the daylight opening and both wheel arches cut as holes. The arches are arcs
centred on the *axle* (0.44 m about a hub 0.34 m up, trimmed where they cross the
sill) rather than semicircles on the rocker, which is what lets the 0.68 m tyre
sit inside a 0.78 m opening and gives the body its wide, low arches. On top of
that: side glass, two glass panels for the windscreen and backlight (offset along
their own normal so they never z-fight), four wheels with rims, headlight and tail
light bars, and door mirrors — 16 meshes, ~810 triangles, all painted with token
colours.

Real dimensions matter here: the camera framing, the reflection and the DOF focus
distance are all tuned against them.

## Dropping in a real GLB later

Nothing to wire up — the contract is already in place:

1. ASSET-3D records a licensed local file, e.g.
   `data/generations/992-2.json → model3d.glb = "/models/911-992-2.glb"` (that
   field must be the *local* path; `getModel()` already prefers `glb` over
   `embedUrl`).
2. `heroModel()` returns `{ kind: "glb", glb }`, `<Car />` switches to
   `<LoadedCar />`, and the model is centred, scaled to a 4.19 m length and
   dropped onto `y = 0` by `fitScene()`.
3. The procedural body stays as the Suspense fallback *and* as the error
   fallback, so a 404 or a corrupt file degrades to the silhouette instead of an
   empty stage. No changes needed in any other file.

If the GLB arrives with its own scale/axis conventions, `fitScene()` is the one
place to adjust.

## Scroll: 360° orbit and the Lenis hand-off

One ScrollTrigger, in `use-hero-scroll.ts`:

| | |
| --- | --- |
| trigger | the hero `<section>` (not pinned — its stage is `position: sticky`) |
| range | `top top` → `bottom bottom`, i.e. `HERO_SCROLL_VH` (260vh) minus the stage |
| scrub | `0.6`, driven by the timeline GSAP already created |
| outputs | `progressRef.current` for `<CameraRig />`; `pumpFrame()` so the demand-loop renders a frame; the DOM timeline fades the type layer and steps the spec strip |
| teardown | `gsap.context().revert()` — tweens, trigger and inline styles all go |

Lenis does the rest: `lenis-provider.tsx` drives Lenis from the GSAP ticker and
calls `ScrollTrigger.update()` on every Lenis scroll, so the DOM timeline and the
camera read the same smoothed position in the same frame. We register no second
scroll listener and create no second pin.

**No competition with the pinned timeline.** The hero never pins: a sticky
section adds no ScrollTrigger spacer, and the trigger's range ends exactly where
the timeline's lead-in begins. At progress 1 the orbit has closed the full
circle, the type layer has faded out and the floor is left empty, so the pinned
stage below fades in over a clean ink band. The hero calls
`ScrollTrigger.refresh()` after it changes the page height and again on
`document.fonts.ready`, because it makes the document taller after the timeline
has already measured.

## Performance budget

Target: **60 fps on a 2019-class laptop GPU, ≤ 30 draw calls, one WebGL context
for the whole page.**

| Knob | `full` | `lite` | Why |
| --- | --- | --- | --- |
| dpr | `[1, 1.75]` | `[1, 1.25]` | fill rate is the first thing to go |
| composer MSAA | 4 | 0 | canvas MSAA is unused once a composer owns the target |
| reflector | 512², blur `[320,110]` | off → metal `meshStandardMaterial` | the single most expensive object |
| DOF | on, half-res blur | off | needs a depth buffer + a blur pass |
| bloom levels | 7 | 4 | mip chain length |
| env cube RT | 256 | 128 | rendered **once** (`frames={1}`) |
| wheel segments | 32 | 18 | |
| idle animation | turntable + breathing | none | see below |

`lite` is chosen when `navigator.hardwareConcurrency < 4`, `deviceMemory ≤ 4`,
a mobile UA, no WebGL2, or the unmasked renderer string looks like a software
rasteriser (SwiftShader / llvmpipe / Mesa). The probe creates a 1×1 throwaway
context and calls `loseContext()` immediately, so it never holds two contexts
(research.md §3 — this box keeps only one).

**Demand rendering.** The canvas is `frameloop="demand"`. Frames are requested
by: pointer movement, ScrollTrigger updates (through the frame bus), and the
idle turntable while the hero is on screen. When the hero scrolls out of view
(`IntersectionObserver`, 300px margin) nothing invalidates, so the scene is
completely idle; when it comes back, one `invalidate()` draws the first frame.
On the `lite` tier there is no idle animation at all — the scene only draws when
the visitor scrolls or moves the pointer.

**No shadows.** Grounding comes from the reflector plus fog. A shadow map would
add a depth pass for something the blurred reflection already sells.

## Fallbacks

| Situation | Result |
| --- | --- |
| No WebGL (or the probe throws) | `HeroPoster`: token gradient + the newest generation's image via `getImage()`, headline intact |
| `prefers-reduced-motion: reduce` | same poster, no canvas at all, no entrance animation, no hint loop, hero is `100dvh` with no scrub |
| WebGL present but hero off-screen | `<GradientMesh />` from `components/fx` stands in until the mount gate opens |
| `lowPower` | `lite` profile, canvas still shown |
| Canvas fails to create | `<Canvas fallback>` → poster; any render error → `ErrorBoundary` → poster |
| GLB 404 / corrupt / throws | Suspense + `ErrorBoundary` → procedural 911 |
| GSAP chunk fails | static composition, `progressRef` pinned at 0 |

Reduced motion is also honoured live: flipping the OS setting re-runs the probe,
tears the canvas down and restores the poster.

## Cleanup

- pointer `pointermove` / `pointerleave` / `pointercancel` listeners removed
- ScrollTrigger + tweens + inline styles removed by `gsap.context().revert()`;
  the rAF scheduled by the WebGL probe is cancelled
- every geometry/material created here is disposed by its owner; the drei
  `Environment` and the composer dispose their own render targets
- `ContextGuard` runs `gl.renderLists.dispose()`, `gl.dispose()` and
  `gl.forceContextLoss()` on unmount (deferred one task, so R3F's own scene
  disposal happens first) — **exactly one live WebGL context**
- while the canvas is alive the hero holds
  `setFxCapabilityOverride(false)` so `components/fx` keeps its animated layers;
  it is reset to `null` on unmount

## Notes / open items

- `prefers-reduced-motion` means *no canvas* for the hero, which is a stricter
  reading than "static 3D". If a reviewer prefers a still render of the same
  scene, flip `canRender` in `use-webgl-support.ts` and gate the idle animation
  on `reducedMotion` instead — the profile is already there.
- The probe's `deviceMemory` read needs one structural cast
  (`NavigatorWithMemory`); `lib.dom` does not ship the Device Memory spec.
- Colour resolution reuses `components/fx/runtime`'s `resolveFxColor`, which
  mirrors the token hexes for the pre-CSS case. There are no hardcoded colours in
  the WebGL scene.
- Spec-strip selection rule: the earliest non-special coupé with a numeric
  `powerPs` per generation (1964 · 130 PS → 2024 · 394 PS). It lives in
  `hero-data.ts` and needs no ids hardcoded.
