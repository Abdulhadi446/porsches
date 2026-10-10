"use client";

/**
 * `<Hero3D />` — the landing hero.
 *
 * Structure (nothing above `HeroScene` imports three.js):
 *
 *   <section>                       tall: 100dvh, or 260vh once GSAP owns scroll
 *     <div sticky h-dvh>            the stage — exactly one viewport, always
 *       <GradientMesh/>             fx backdrop, only while no canvas is above it
 *       <HeroPoster/>               still composition (no WebGL / reduced motion)
 *       <HeroScene/>                lazy WebGL chunk, latched on first approach
 *       <HeroContent/>              kicker, headline, spec strip, hint
 *       <GrainOverlay/>             fx film grain over the top
 *     </div>
 *   </section>
 *
 * Mount gate: the canvas is only created once (a) support has been measured and
 * says WebGL is available and motion is welcome, and (b) an IntersectionObserver
 * says the hero is within 300px of the viewport. Until then the server-rendered
 * poster is what the user sees, so the first paint is never blocked by a canvas.
 *
 * Boundary with `components/timeline`: the hero owns exactly its own scroll
 * runway and never pins anything — see the header of `use-hero-scroll.ts`.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { GradientMesh, GrainOverlay, setFxCapabilityOverride } from "#components/fx";
import { useVisibility } from "#components/fx/runtime";
import { HeroContent } from "./hero-content";
import { HeroPoster } from "./hero-poster";
import {
  HERO_SCROLL_VH,
  heroEraSpecs,
  heroModel,
} from "./hero-data";
import { useHeroScroll } from "./use-hero-scroll";
import { useWebglSupport } from "./use-webgl-support";

/**
 * `ssr: false` so three.js is fetched only after hydration, and only when the
 * mount gate below agrees there is a machine worth rendering for.
 */
const HeroScene = dynamic(() => import("./hero-scene"), {
  ssr: false,
  loading: () => null,
});

/** How far ahead of the viewport the hero may build its context. */
const MOUNT_MARGIN = "300px";

export function Hero3D() {
  const support = useWebglSupport();
  const { ref: rootRef, active } = useVisibility<HTMLElement>(MOUNT_MARGIN);
  const progressRef = useRef(0);
  const [everNear, setEverNear] = useState(false);

  // both are pure reads of the generation JSON — cheap enough to re-run
  const model = heroModel();
  const specs = heroEraSpecs();

  /**
   * The canvas is latched on the *first* approach and then kept: unmounting it
   * would throw the context away and force a full shader/env rebuild every time
   * the visitor scrolls back up. Off-screen the scene simply stops asking for
   * frames (`active === false` → no `invalidate()` anywhere), which is free.
   */
  useEffect(() => {
    if (!active) return;
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = window.requestAnimationFrame(() => {
      // The hero's <h1> is the LCP element and three.js is the main-thread
      // budget's biggest item: never compete with first paint. Wait for load +
      // an idle slot (or ~1.2 s, whichever is first) before grabbing a context.
      const start = () => setEverNear(true);
      const ric = window.requestIdleCallback?.bind(window);
      if (ric) {
        idle = ric(start, { timeout: 1200 });
      } else {
        timer = setTimeout(start, 1200);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle) window.cancelIdleCallback?.(idle);
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  /** scroll scrubbing needs a measured machine *and* a motion preference */
  const scrub = support.ready && !support.reducedMotion;
  useHeroScroll({ rootRef, active: scrub, progressRef, segments: specs.length });

  const mounted = support.canRender && everNear;
  const stageHeight = scrub ? `${HERO_SCROLL_VH}vh` : "100dvh";

  /**
   * While our canvas holds the page's single WebGL context, tell the fx library
   * not to bail to its static fallback (sanctioned export, see components/fx
   * README §"Perf guards"). `null` restores auto-detection on unmount.
   */
  useEffect(() => {
    if (!mounted) return;
    setFxCapabilityOverride(false);
    return () => setFxCapabilityOverride(null);
  }, [mounted]);

  return (
    <section
      ref={rootRef}
      id="hero"
      data-owner="3d-hero"
      data-hero-root=""
      data-motion={scrub ? "on" : "off"}
      aria-label="Porsche 911, 1963 to today"
      className="relative"
      style={{ height: stageHeight }}
    >
      <div
        data-hero-stage=""
        data-car-cursor="" data-cursor="hide"
        className="sticky top-0 h-dvh w-full overflow-hidden bg-ink"
      >
        {/* bottom layer: fx gradient, only while there is no canvas above it */}
        {mounted ? null : support.canRender ? (
          <GradientMesh
            intensity={0.7}
            palette={["guards-deep", "gulf-blue-deep", "ink-3"]}
          />
        ) : null}

        {/* the still composition: server-rendered, LCP, hidden once the canvas
            is painting over it */}
        <HeroPoster hidden={mounted} />

        {mounted ? (
          <HeroScene
            quality={support.quality}
            model={model}
            progressRef={progressRef}
            active={active}
          />
        ) : null}

        <HeroContent
          specs={specs}
          reducedMotion={support.reducedMotion}
          live={mounted}
          initialIndex={scrub ? 0 : specs.length - 1}
        />

        <GrainOverlay
          intensity={0.55}
          position="absolute"
          zIndex="var(--z-overlay)"
        />
      </div>
    </section>
  );
}

export default Hero3D;
