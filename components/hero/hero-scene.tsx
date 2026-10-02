"use client";

/**
 * The hero scene — the only file that imports three.js.
 *
 * Reached exclusively through `next/dynamic({ ssr: false })` in ./index.tsx, so
 * the first paint is HTML (see `hero-poster.tsx`) and this chunk arrives after
 * hydration. It owns exactly one WebGL context for the whole page.
 *
 * Scene graph
 *
 *   <Canvas frameloop="demand" flat>
 *     <color attach="background" />            opaque ink, safety net
 *     <fogExp2 attach="fog" />                 swallows the floor rim
 *     <FrameBus />          registers the scroll → frame pump
 *     <ContextGuard />      gl.dispose() + forceContextLoss() on unmount
 *     <CameraRig />         scroll orbit + pointer parallax
 *     <HeroLighting />      3 lights + <Environment> Lightformer rings
 *     <HeroBackdrop />      gradient dome
 *     <HeroFloor />         MeshReflectorMaterial disc (lite: plain metal)
 *     <Turntable>           group: slow idle yaw (full tier only)
 *       <Car />             getModel() → useGLTF, else procedural 911
 *     <HeroPost />          Bloom → (DOF) → ToneMapping → Vignette
 *
 * Teardown: every geometry/material is disposed by its owner, the pointer
 * listeners are removed, the composer disposes its own render targets, and
 * `ContextGuard` releases the GL context last so nothing survives the hero.
 */

import { useEffect, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Group as ThreeGroup } from "three";
import type { ModelResult } from "#lib/assets";
import { Car } from "./car";
import { CameraRig } from "./camera-rig";
import { ErrorBoundary } from "./error-boundary";
import { HeroFloor } from "./floor";
import { HeroBackdrop, HeroLighting } from "./lighting";
import { HeroPost } from "./post";
import { HeroPoster } from "./hero-poster";
import { setFramePump } from "./frame-bus";
import { useHeroColors } from "./hero-tokens";
import type { QualityProfile } from "./quality";

export interface HeroSceneProps {
  quality: QualityProfile;
  model: ModelResult;
  /** written by the ScrollTrigger; read by the camera rig */
  progressRef: MutableRefObject<number>;
  /** false when the hero scrolls out of view: no frames are requested at all */
  active: boolean;
}

/** Scroll (or anything in the light bundle) asks for a frame through this. */
function FrameBus() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    setFramePump(() => invalidate());
    return () => setFramePump(null);
  }, [invalidate]);
  return null;
}

/**
 * Releases the only WebGL context this page is allowed to have.
 *
 * Deferred by a task so R3F's own unmount (which disposes the scene graph) runs
 * first; `forceContextLoss` then drops the browser's context so navigating away
 * and back cannot end up with two live.
 */
function ContextGuard() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    return () => {
      window.setTimeout(() => {
        gl.renderLists.dispose();
        gl.dispose();
        gl.forceContextLoss();
      }, 0);
    };
  }, [gl]);
  return null;
}

/** Idle turntable. On the lite tier the scene only renders on input. */
function Turntable({
  children,
  continuous,
}: {
  children: ReactNode;
  continuous: boolean;
}) {
  const group = useRef<ThreeGroup>(null);
  const invalidate = useThree((state) => state.invalidate);
  useFrame((state) => {
    if (!continuous || !group.current) return;
    const elapsed = state.clock.getElapsedTime();
    group.current.rotation.y = elapsed * 0.055;
    group.current.position.y = Math.sin(elapsed * 0.45) * 0.012;
    invalidate();
  });
  return <group ref={group}>{children}</group>;
}

export default function HeroScene({
  quality,
  model,
  progressRef,
  active,
}: HeroSceneProps) {
  const colors = useHeroColors();
  const { dpr } = quality;

  return (
    <ErrorBoundary fallback={<HeroPoster />}>
      <Canvas
        /* tone mapping happens in <HeroPost /> — see post.tsx */
        flat
        frameloop="demand"
        dpr={dpr}
        camera={{ position: [7.4, 1.1, 5.6], fov: 30, near: 0.4, far: 120 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
        }}
        fallback={<HeroPoster />}
      >
        <color attach="background" args={[colors.ink]} />
        <fogExp2 attach="fog" args={[colors.ink2, 0.05]} />

        <FrameBus />
        <ContextGuard />
        <CameraRig
          progressRef={progressRef}
          continuous={quality.idleAnimation && active}
        />

        <HeroLighting quality={quality} colors={colors} />
        <HeroBackdrop colors={colors} />
        <HeroFloor quality={quality} colors={colors} />

        <Turntable continuous={quality.idleAnimation && active}>
          <Car model={model} quality={quality} colors={colors} />
        </Turntable>

        <HeroPost quality={quality} />
      </Canvas>
    </ErrorBoundary>
  );
}
