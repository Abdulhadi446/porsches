"use client";

/**
 * The hero's scroll wiring — one ScrollTrigger, two consumers.
 *
 *  - the DOM (this file): a scrubbed GSAP timeline fades the kicker, headline,
 *    scroll hint and spec strip, and drives the progress hairline;
 *  - the 3D scene: the same trigger's `progress` is written into `progressRef`,
 *    which `<CameraRig />` reads to orbit a full 360°, and `pumpFrame()` asks
 *    the (lazy) canvas for a frame — the light bundle never imports three.js.
 *
 * IMPORTANT — no interference with the pinned timeline below:
 *  - the hero is NOT pinned. It is a tall section (`HERO_SCROLL_VH`) with a
 *    `position: sticky` stage, so ScrollTrigger never inserts a pin spacer here
 *    and the two pinned/scrubbed sequences cannot fight over the scroll.
 *  - the trigger range is exactly the section's own scroll runway
 *    (`top top` → `bottom bottom`), which ends where the timeline's lead-in
 *    begins. At progress 1 the orbit has closed the circle and the type layer has
 *    faded out, leaving a clean hand-off to `components/timeline`.
 *  - Lenis drives everything: the provider already calls `ScrollTrigger.update()`
 *    on each Lenis scroll and GSAP animates this timeline with `scrub`, so both
 *    scenes read the same smoothed position in the same frame.
 *
 * Teardown: `gsap.context().revert()` removes every tween, the ScrollTrigger and
 * the inline styles it wrote; the effect also refuses to install anything after
 * unmount.
 */

import { useEffect } from "react";
import type { MutableRefObject, RefObject } from "react";
import { pumpFrame } from "./frame-bus";

export interface HeroScrollOptions {
  /** the tall hero section */
  rootRef: RefObject<HTMLElement | null>;
  /** false under reduced motion or before the chunk is ready */
  active: boolean;
  /** 0 → 1 written every update; read by the camera rig */
  progressRef: MutableRefObject<number>;
  /** one spec per generation */
  segments: number;
}

/** Windows the type layer occupies, as a fraction of the orbit. */
const TITLE_OUT_START = 0.12;
const SPECS_START = 0.16;
const SPECS_SPAN = 0.84;

export function useHeroScroll({
  rootRef,
  active,
  progressRef,
  segments,
}: HeroScrollOptions): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !active || segments < 1) return;

    let disposed = false;
    let context: { revert: () => void } | null = null;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed || !root.isConnected) return;
      gsap.registerPlugin(ScrollTrigger);

      context = gsap.context(() => {
        const query = (selector: string) =>
          Array.from(root.querySelectorAll<HTMLElement>(selector));

        const kicker = query("[data-hero-kicker]");
        const title = query("[data-hero-title]");
        const hint = query("[data-hero-hint]");
        const bar = query("[data-hero-progress]");
        const specs = query("[data-hero-spec]");

        // initial state, applied before the first painted frame
        gsap.set(specs, { autoAlpha: 0, yPercent: 12 });
        if (specs[0]) gsap.set(specs[0], { autoAlpha: 1, yPercent: 0 });
        gsap.set(bar, { scaleX: 0 });

        const timeline = gsap.timeline({ defaults: { ease: "none" } });

        timeline.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);

        // NOTE: on the three elements framer-motion also animates, GSAP only
        // touches `autoAlpha`. Both libraries own `element.style.transform`, and
        // a re-render (the canvas mount flips `live`) would otherwise clobber a
        // running scrub tween.
        timeline.to(hint, { autoAlpha: 0, duration: 0.12 }, 0);
        timeline.to(
          kicker,
          { autoAlpha: 0, duration: 0.14 },
          TITLE_OUT_START * 0.2,
        );
        timeline.to(
          title,
          { autoAlpha: 0, duration: 0.34 },
          TITLE_OUT_START,
        );

        // one window per generation; the last one (the current car) stays put.
        // index 0 is already the visible one (see the `gsap.set` above), so it
        // only ever gets a fade-out — never a fromTo, which would hide it on
        // the very first painted frame.
        const slot = SPECS_SPAN / segments;
        const fade = Math.min(0.3, slot * 0.34);
        specs.forEach((element, index) => {
          const start = SPECS_START + index * slot;
          if (index > 0) {
            timeline.to(
              specs[index - 1],
              { autoAlpha: 0, yPercent: -12, duration: fade },
              start,
            );
            timeline.fromTo(
              element,
              { autoAlpha: 0, yPercent: 12 },
              {
                autoAlpha: 1,
                yPercent: 0,
                duration: fade,
                ease: "power2.out",
              },
              start + slot * 0.18,
            );
          }
          if (index < segments - 1) {
            timeline.to(
              element,
              { autoAlpha: 0, yPercent: -12, duration: fade },
              start + slot * 0.7,
            );
          }
        });

        ScrollTrigger.create({
          trigger: root,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
          animation: timeline,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            progressRef.current = self.progress;
            pumpFrame();
          },
        });
      }, root);

      // the hero changed the page height (sticky runway) — everyone re-measures
      ScrollTrigger.refresh();
      const onFonts = () => ScrollTrigger.refresh();
      document.fonts?.ready.then(onFonts).catch(() => undefined);
    })().catch(() => {
      // GSAP never blocks the hero: the static composition stays put.
      progressRef.current = 0;
    });

    return () => {
      disposed = true;
      context?.revert();
    };
  }, [active, progressRef, rootRef, segments]);
}
