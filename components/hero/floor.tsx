"use client";

/**
 * The studio floor.
 *
 * `MeshReflectorMaterial` (drei) gives the product-shot look: the car is mirrored
 * into a blurred, strength-mixed reflection that dissolves with distance. It is
 * the single most expensive thing in the scene, so on the lite tier it is swapped
 * for a plain metal `meshStandardMaterial` that still picks up the environment —
 * the composition is identical, the reflection is not.
 *
 * A 24 m disc rather than an infinite plane: the fog swallows the rim, and a
 * bounded disc keeps the reflection frustum small.
 */

import { MeshReflectorMaterial } from "@react-three/drei";
import type { QualityProfile } from "./quality";
import type { HeroColors } from "./hero-tokens";

export interface HeroFloorProps {
  quality: QualityProfile;
  colors: HeroColors;
}

export function HeroFloor({ quality, colors }: HeroFloorProps) {
  const { reflector } = quality;
  return (
    <group name="hero-floor">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[24, 96]} />
        {reflector.enabled ? (
          <MeshReflectorMaterial
            resolution={reflector.resolution}
            blur={reflector.blur}
            mixBlur={reflector.mixBlur}
            mixStrength={reflector.mixStrength}
            mirror={0.62}
            depthScale={1.1}
            depthToBlurRatioBias={0.26}
            minDepthThreshold={0.32}
            maxDepthThreshold={1.35}
            distortion={0.32}
            roughness={0.84}
            metalness={0.6}
            color={colors.ink3}
            envMapIntensity={0.55}
          />
        ) : (
          <meshStandardMaterial
            color={colors.metal900}
            roughness={0.3}
            metalness={0.86}
            envMapIntensity={1.1}
          />
        )}
      </mesh>
    </group>
  );
}
