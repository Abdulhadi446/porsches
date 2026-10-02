/**
 * Quality tiers for the hero WebGL scene.
 *
 * Two knobs, chosen once after mount by `useWebglSupport`:
 *  - `full` — desktop GPU, the cinematic look (reflective floor, DOF, soft bloom)
 *  - `lite` — mobile / low core count / software renderer: same composition,
 *    cheaper effects. The scene never degrades into a different *look*, only
 *    into fewer pixels and fewer passes.
 *
 * `none` is not a tier: it means "do not create a WebGL context at all" and is
 * handled by the poster fallback in `hero-poster.tsx`.
 */

export type QualityTier = "full" | "lite";

export interface QualityProfile {
  tier: QualityTier;
  /** [min, max] device pixel ratio handed to the renderer */
  dpr: [number, number];
  /** MSAA samples on the composer's render target (canvas MSAA is unused once a composer is mounted) */
  multisampling: number;
  /** cube-render-target size for the <Environment> Lightformers */
  envResolution: number;
  /** depth of field needs a depth buffer + a blur pass: full tier only */
  dof: boolean;
  bloom: {
    intensity: number;
    /** mip levels — fewer levels on lite */
    levels: number;
    luminanceThreshold: number;
  };
  reflector: {
    enabled: boolean;
    resolution: number;
    blur: [number, number];
    mixBlur: number;
    mixStrength: number;
  };
  /** radial segments on the extruded body / wheels */
  wheelSegments: number;
  bevelSegments: number;
  /** continuous idle animation (turntable + breathing). Off on lite: the scene
   *  then only renders when scroll or pointer input asks it to. */
  idleAnimation: boolean;
}

export const QUALITY_FULL: QualityProfile = {
  tier: "full",
  dpr: [1, 1.75],
  multisampling: 4,
  envResolution: 256,
  dof: true,
  bloom: { intensity: 0.62, levels: 7, luminanceThreshold: 0.78 },
  reflector: {
    enabled: true,
    resolution: 512,
    blur: [320, 110],
    mixBlur: 1.1,
    mixStrength: 1.35,
  },
  wheelSegments: 32,
  bevelSegments: 2,
  idleAnimation: true,
};

export const QUALITY_LITE: QualityProfile = {
  tier: "lite",
  dpr: [1, 1.25],
  multisampling: 0,
  envResolution: 128,
  dof: false,
  bloom: { intensity: 0.42, levels: 4, luminanceThreshold: 0.86 },
  reflector: {
    enabled: false,
    resolution: 256,
    blur: [0, 0],
    mixBlur: 0,
    mixStrength: 0,
  },
  wheelSegments: 18,
  bevelSegments: 1,
  idleAnimation: false,
};
