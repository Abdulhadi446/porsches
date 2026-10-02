"use client";

/**
 * Post chain.
 *
 * Cost control is the whole point of this file: one `EffectComposer`, one pass,
 * and the number of effects inside it is decided by the quality tier.
 *
 *  - Bloom: soft, mip-map blurred, high luminance threshold — only the specular
 *    hits and the light rings bloom. Deliberately *not* `SelectiveBloom`: that
 *    needs a normal/depth pre-pass and a second composer, which is not worth it
 *    for an effect whose visible result is identical at this threshold.
 *  - DOF: full tier only (mobile / low-power / reduced motion all drop it).
 *    Half-resolution blur, focus pinned to the car's beltline.
 *  - ToneMapping: required. three skips renderer tone mapping whenever it draws
 *    into a render target, which is exactly what a composer does — so the Canvas
 *    runs `flat` (NoToneMapping) and the curve is applied here instead, once.
 *  - Vignette: the cinema framing, last so it darkens after tone mapping.
 */

import {
  Bloom,
  DepthOfField,
  EffectComposer,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import type { QualityProfile } from "./quality";

export interface HeroPostProps {
  quality: QualityProfile;
}

export function HeroPost({ quality }: HeroPostProps) {
  const { bloom, dof, multisampling } = quality;
  return (
    <EffectComposer
      multisampling={multisampling}
      enableNormalPass={false}
      stencilBuffer={false}
      resolutionScale={1}
    >
      <Bloom
        mipmapBlur
        intensity={bloom.intensity}
        luminanceThreshold={bloom.luminanceThreshold}
        luminanceSmoothing={0.3}
        radius={0.74}
        levels={bloom.levels}
      />
      {dof ? (
        <DepthOfField
          target={[0, 0.62, 0]}
          worldFocusRange={2.6}
          bokehScale={2.4}
          resolutionScale={0.5}
          height={480}
        />
      ) : null}
      <ToneMapping />
      <Vignette offset={0.26} darkness={0.78} eskil={false} />
    </EffectComposer>
  );
}
