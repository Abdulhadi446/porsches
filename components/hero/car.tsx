"use client";

/**
 * `<Car />` — the hero vehicle.
 *
 * Resolution order (documented in README.md):
 *   1. `model.kind === "glb"` → drei `useGLTF`, wrapped in Suspense + an error
 *      boundary so a missing / corrupt file can never take the hero down.
 *   2. anything else (Sketchfab embed, turntable images, nothing at all) →
 *      the procedural side-profile 911 from `procedural-911.ts`. This is the
 *      expected path today: ASSET-3D is delivering Sketchfab embeds, which are
 *      iframes and cannot be composited into this canvas.
 *
 * Every geometry and material this component creates is owned by it and disposed
 * on unmount. The GLB branch shares drei's loader cache, so it opts out of
 * R3F's disposal and relies on the context teardown instead.
 */

import { Suspense, useEffect, useMemo } from "react";
import {
  Box3,
  Color,
  DoubleSide,
  Group,
  MeshPhysicalMaterial,
  Vector3,
} from "three";
import { useGLTF } from "@react-three/drei";
import type { ModelResult } from "#lib/assets";
import { ErrorBoundary } from "./error-boundary";
import type { QualityProfile } from "./quality";
import {
  CAR,
  createBodyGeometry,
  createPanelGeometries,
  createSideGlassGeometry,
  createWheelGeometries,
  wheelPlacements,
} from "./procedural-911";
import type { HeroColors } from "./hero-tokens";

export interface CarProps {
  /** resolved through `getModel()` in `#lib/assets` */
  model: ModelResult;
  quality: QualityProfile;
  colors: HeroColors;
}

/* ------------------------------------------------------------------ *
 * Procedural 911
 * ------------------------------------------------------------------ */

export function Procedural911({
  quality,
  colors,
}: {
  quality: QualityProfile;
  colors: HeroColors;
}) {
  const resources = useMemo(() => {
    const body = createBodyGeometry(quality.bevelSegments);
    const sideGlass = createSideGlassGeometry();
    const panels = createPanelGeometries();
    const wheels = createWheelGeometries(quality.wheelSegments);

    const paint = new MeshPhysicalMaterial({
      color: new Color(colors.guardsDeep),
      metalness: 0.62,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
      envMapIntensity: 1.35,
    });
    const glass = new MeshPhysicalMaterial({
      color: new Color(colors.ink2),
      metalness: 0.4,
      roughness: 0.06,
      envMapIntensity: 1.9,
      transparent: true,
      opacity: 0.78,
      side: DoubleSide,
      depthWrite: false,
    });
    const rubber = new MeshPhysicalMaterial({
      color: new Color(colors.ink),
      metalness: 0.08,
      roughness: 0.92,
      envMapIntensity: 0.35,
    });
    const rim = new MeshPhysicalMaterial({
      color: new Color(colors.metal300),
      metalness: 1,
      roughness: 0.18,
      envMapIntensity: 1.6,
    });
    const lamp = new MeshPhysicalMaterial({
      color: new Color(colors.metal100),
      emissive: new Color(colors.metal100),
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.25,
    });
    const tail = new MeshPhysicalMaterial({
      color: new Color(colors.guards),
      emissive: new Color(colors.guardsGlow),
      emissiveIntensity: 1.5,
      metalness: 0.1,
      roughness: 0.4,
    });

    return {
      body,
      sideGlass,
      panels,
      wheels,
      paint,
      glass,
      rubber,
      rim,
      lamp,
      tail,
      disposables: [
        body,
        sideGlass,
        panels.windscreen,
        panels.backlight,
        wheels.tyre,
        wheels.rim,
        paint,
        glass,
        rubber,
        rim,
        lamp,
        tail,
      ],
    };
  }, [colors, quality.bevelSegments, quality.wheelSegments]);

  useEffect(() => {
    return () => {
      for (const item of resources.disposables) item.dispose();
    };
  }, [resources]);

  const wheels = wheelPlacements();

  return (
    <group name="procedural-911">
      <mesh geometry={resources.body} material={resources.paint} />
      <mesh geometry={resources.sideGlass} material={resources.glass} renderOrder={1} />
      <mesh geometry={resources.panels.windscreen} material={resources.glass} renderOrder={1} />
      <mesh geometry={resources.panels.backlight} material={resources.glass} renderOrder={1} />

      {wheels.map((position, index) => (
        <group key={index} position={position}>
          <mesh geometry={resources.wheels.tyre} material={resources.rubber} />
          <mesh geometry={resources.wheels.rim} material={resources.rim} />
        </group>
      ))}

      {/* headlight bar + tail light bar: the two horizontal graphic signatures */}
      <mesh position={[CAR.length / 2 - 0.15, 0.79, 0]} material={resources.lamp}>
        <boxGeometry args={[0.06, 0.055, CAR.width * 0.82]} />
      </mesh>
      <mesh position={[-CAR.length / 2 + 0.03, 0.72, 0]} material={resources.tail}>
        <boxGeometry args={[0.05, 0.05, CAR.width * 0.86]} />
      </mesh>

      {/* door mirrors */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0.36, 0.99, side * (CAR.width / 2 - 0.02)]}>
          <boxGeometry args={[0.09, 0.05, 0.13]} />
          <meshPhysicalMaterial
            color={new Color(colors.metal700)}
            metalness={0.9}
            roughness={0.22}
            envMapIntensity={1.4}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Local GLB branch
 * ------------------------------------------------------------------ */

/** Centre + scale a loaded scene so it sits on the floor at a 4.19 m length. */
function fitScene(scene: Group): Group {
  const clone = scene.clone(true);
  const box = new Box3().setFromObject(clone);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = CAR.length / (Math.max(size.x, size.z) || 1);
  clone.scale.setScalar(scale);
  clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return clone;
}

function LoadedCar({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const object = useMemo(() => fitScene(gltf.scene), [gltf.scene]);
  useEffect(() => {
    return () => {
      // shared with drei's loader cache — drop the references and let the
      // WebGL context teardown free the buffers
      object.clear();
    };
  }, [object]);
  return <primitive object={object} dispose={null} />;
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export function Car({ model, quality, colors }: CarProps) {
  const procedural = <Procedural911 quality={quality} colors={colors} />;
  if (model.kind !== "glb" || !model.glb) return procedural;
  return (
    <ErrorBoundary fallback={procedural}>
      <Suspense fallback={procedural}>
        <LoadedCar url={model.glb} />
      </Suspense>
    </ErrorBoundary>
  );
}
