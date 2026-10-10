"use client";

/**
 * Studio lighting — rings and slabs of light, nothing else.
 *
 * HARD RULE from docs/research.md and the brief: no HDR, no remote fetch, no
 * `<Environment preset=...>`, no CDN. The environment map is rendered locally
 * from `<Lightformer>` rings inside a `<Environment>` portal (drei builds one
 * small cube render target from the children, once), so every reflection in the
 * paint, the glass and the floor comes from shapes we place ourselves.
 *
 * Three real lights sit on top of it for the specular key, and a gradient dome
 * plus `fogExp2` (mounted in hero-scene) close the backdrop.
 */

import { BackSide } from "three";
import { Environment, GradientTexture, Lightformer } from "@react-three/drei";
import type { QualityProfile } from "./quality";
import type { HeroColors } from "./hero-tokens";

export interface HeroLightingProps {
  quality: QualityProfile;
  colors: HeroColors;
}

/**
 * Gradient dome — the only "background", painted from tokens.
 *
 * drei's `GradientTexture` paints a 2D canvas with `document`, which is why it
 * only ever renders inside the (client-only) canvas.
 */
export function HeroBackdrop({ colors }: { colors: HeroColors }) {
  return (
    <mesh name="hero-backdrop" frustumCulled={false}>
      <sphereGeometry args={[46, 32, 20]} />
      <meshBasicMaterial side={BackSide} fog={false}>
        {/* v = 0 at the nadir: ink → ink-3 horizon glow → ink-2 → ink zenith */}
        <GradientTexture
          size={128}
          width={8}
          stops={[0, 0.34, 0.52, 0.78, 1]}
          colors={[
            colors.ink,
            colors.ink2,
            colors.ink3,
            colors.ink2,
            colors.ink,
          ]}
        />
      </meshBasicMaterial>
    </mesh>
  );
}

export function HeroLighting({ quality, colors }: HeroLightingProps) {
  return (
    <group name="hero-lighting">
      <ambientLight intensity={0.55} color={colors.metal700} />
      <directionalLight
        position={[4.4, 6.4, 3.6]}
        intensity={2.2}
        color={colors.metal100}
      />
      <spotLight
        position={[-3.4, 5.4, 2.8]}
        angle={0.6}
        penumbra={0.95}
        intensity={44}
        distance={24}
        decay={2}
        color={colors.metal100}
      />
      {/* No floor-level Guards Red point light: at any intensity it smears
          across the glossy floor at grazing angles. The red lives only in the
          high environment ring below, whose mirrored image lands near the
          fogged horizon instead. */}

      <Environment resolution={quality.envResolution} frames={1}>
        {/* key ring, high and behind — draws the roof highlight */}
        <Lightformer
          form="ring"
          intensity={3.6}
          color={colors.metal100}
          scale={9}
          position={[0, 4.6, -8]}
          target={[0, 0, 0]}
        />
        {/* cool fill from the left */}
        <Lightformer
          form="ring"
          intensity={2.4}
          color={colors.gulfBlue}
          scale={6}
          position={[-7, 2.4, 3.2]}
          target={[0, 0.4, 0]}
        />
        {/* warm rim from the right rear — the classic 911 three-quarter sweep */}
        {/* warm rim from the right rear — the classic 911 three-quarter sweep.
            Kept high: on the glossy floor its mirrored image lands near the
            fogged horizon instead of smearing a red carpet across the frame. */}
        <Lightformer
          form="ring"
          intensity={0.45}
          color={colors.guardsGlow}
          scale={3}
          position={[7.4, 4.4, -2.4]}
          target={[0, 0.5, 0]}
        />
        {/* overhead softbox, keeps the bonnet from going flat */}
        <Lightformer
          form="rect"
          intensity={2.2}
          color={colors.metal300}
          scale={[11, 2.6, 1]}
          position={[0, 6.4, 1.6]}
          target={[0, 0, 0]}
        />
        {/* low bounce off the floor */}
        <Lightformer
          form="circle"
          intensity={1.1}
          color={colors.metal500}
          scale={4}
          position={[2.6, 0.6, 5.4]}
          target={[0, 0.6, 0]}
        />
      </Environment>
    </group>
  );
}
