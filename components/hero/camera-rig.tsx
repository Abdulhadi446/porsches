"use client";

/**
 * Camera rig — scroll-driven 360° orbit + damped pointer parallax.
 *
 * Scroll owns the azimuth (a full 2π over the hero's scroll length, written
 * into `progressRef` by the ScrollTrigger in `use-hero-scroll.ts`), the pointer
 * owns a small offset on top. Nothing here creates a ScrollTrigger, so there is
 * no second pin and no competition with the pinned timeline below.
 *
 * Because the canvas runs `frameloop="demand"`, every motion has to ask for a
 * frame: the pointer listeners call `invalidate()` directly, and the frame loop
 * keeps invalidating while the camera is still settling (or always, on the full
 * tier where a slow turntable is playing).
 */

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { clamp01 } from "#components/fx/runtime";

export interface CameraRigProps {
  /** 0 → 1 across the hero's scroll length */
  progressRef: MutableRefObject<number>;
  /** continuous idle animation — full tier AND hero on screen */
  continuous: boolean;
  /** horizontal parallax strength, in world units at full deflection */
  parallax?: number;
}

/** Start behind the rear three-quarter: the most 911-shaped angle there is. */
const START_AZIMUTH = Math.PI * 0.78;
const RADIUS_FAR = 9.9;
const RADIUS_NEAR = 7.5;
const HEIGHT_LOW = 1.02;
const HEIGHT_HIGH = 2.25;
const LOOK_AT_Y = 0.62;

export function CameraRig({
  progressRef,
  continuous,
  parallax = 0.55,
}: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  /** pointer target (−1..1) and its damped value */
  const wanted = useRef({ x: 0, y: 0 });
  const eased = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const element = gl.domElement;
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      wanted.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      wanted.current.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      invalidate();
    };
    const onLeave = () => {
      wanted.current.x = 0;
      wanted.current.y = 0;
      invalidate();
    };
    element.addEventListener("pointermove", onMove, { passive: true });
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("pointercancel", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("pointercancel", onLeave);
    };
  }, [gl, invalidate]);

  useFrame((_state, delta) => {
    const step = Math.min(delta, 0.05);
    const damping = 1 - Math.exp(-4.5 * step);

    eased.current.x += (wanted.current.x - eased.current.x) * damping;
    eased.current.y += (wanted.current.y - eased.current.y) * damping;

    const progress = clamp01(progressRef.current);
    // 0 → 1 → 0 across the orbit: pulls in and lifts for the mid-sweep,
    // then settles back to the wide profile framing.
    const arc = Math.sin(progress * Math.PI);
    const azimuth = START_AZIMUTH + progress * Math.PI * 2;
    const radius = RADIUS_FAR - (RADIUS_FAR - RADIUS_NEAR) * arc;
    const height = HEIGHT_LOW + (HEIGHT_HIGH - HEIGHT_LOW) * arc;

    const x = Math.cos(azimuth) * radius + eased.current.x * parallax;
    const z = Math.sin(azimuth) * radius + eased.current.x * parallax * 0.35;
    const y = height - eased.current.y * parallax * 0.45;

    const drift =
      Math.abs(x - camera.position.x) +
      Math.abs(y - camera.position.y) +
      Math.abs(z - camera.position.z) +
      Math.abs(eased.current.x - wanted.current.x) +
      Math.abs(eased.current.y - wanted.current.y);

    camera.position.set(x, y, z);
    camera.lookAt(0, LOOK_AT_Y + eased.current.y * 0.12, 0);

    // keep asking for frames while anything is still moving. Off-screen the
    // demand loop stays completely idle: no input, no invalidate, no draw.
    if (continuous || drift > 0.0004) invalidate();
  });

  return null;
}
