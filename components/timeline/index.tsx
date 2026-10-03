"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  CLIENT_GENERATIONS,
  type ClientGeneration,
} from "#lib/client-catalog";

const GENERATIONS = CLIENT_GENERATIONS;

/** 1963 → today, derived from the catalogue itself. */
function timelineRange(gens: ClientGeneration[] = GENERATIONS): [number, number] {
  const start = Math.min(...gens.map((g) => g.yearsStart));
  const end = Math.max(
    ...gens.map((g) => g.yearsEnd ?? new Date().getFullYear()),
  );
  return [start, end];
}
import type { ClientGeneration as Generation } from "#lib/client-catalog";
import { useSmoothScroll } from "./lenis-provider";
import { StageBackdrop } from "./backdrop";
import { TimelineChapter } from "./chapter";
import { TimelineHandoff, TimelineLeadIn } from "./handoff";
import { TimelineProgressRail } from "./progress-rail";
import { TimelineScrollHint } from "./scroll-hint";
import { TimelineGenerationIndex } from "./timeline-index";
import { TimelineYearScrub } from "./year-scrub";

/* ------------------------------------------------------------------ *
 * Tunables — all lengths are expressed in viewport heights so the
 * sequence scales with the device instead of a magic pixel count.
 * ------------------------------------------------------------------ */

/** scroll length of one chapter */
const CHAPTER_UNIT_WIDE = 1;
const CHAPTER_UNIT_TIGHT = 0.92;
/** scroll length of the horizontal year sweep */
const SWEEP_UNIT_WIDE = 2.4;
const SWEEP_UNIT_TIGHT = 1.6;
/** pinning is skipped entirely below this height — pinning a short
 *  viewport feels broken, and reduced motion gets static chapters */
const MOTION_QUERY =
  "(prefers-reduced-motion: no-preference) and (min-height: 560px)";

/** index reported while the year sweep owns the screen */
const SWEEPING = -1;

export function Timeline() {
  const rootRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hintHidden, setHintHidden] = useState(false);
  const [railVisible, setRailVisible] = useState(true);
  const { lenis } = useSmoothScroll();
  /** mirrors of the state above so the scroll handler never re-renders twice */
  const mirror = useRef({ index: 0, hint: false, rail: true });
  /** frozen px-per-chapter so rail jumps land on the same marks the pin uses */
  const pinUnit = useRef<number | null>(null);
  /** [firstYear, lastYear] — 1963 → today */
  const [range] = useState(timelineRange);

  /* ---------------------------------------------------------------- *
   * Rail / index jump. Falls through to the browser's native hash jump
   * whenever GSAP is not driving the page (no JS, reduced motion, short
   * viewport), so the links are always functional.
   * ---------------------------------------------------------------- */
  const handleJump = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, generation: Generation) => {
      const root = rootRef.current;
      if (!lenis || !root || root.dataset.motion !== "on") return;
      const stop = root.querySelector<HTMLElement>(
        `[data-ts-stop="${generation.id}"]`,
      );
      if (!stop) return;
      event.preventDefault();
      // park the middle of the chapter's window on the viewport centre
      const unit = pinUnit.current ?? window.innerHeight * chapterUnit();
      lenis.scrollTo(stop, {
        offset: unit * 0.5,
        duration: 1.2,
        easing: (t: number) => 1 - Math.pow(1 - t, 4),
        programmatic: true,
      });
    },
    [lenis],
  );

  /* ---------------------------------------------------------------- *
   * The pinned sequence.
   *
   * `gsap.context()` scopes every tween + ScrollTrigger so `revert()`
   * removes the pin spacers, the pin itself and the rAF work in one call.
   * A `gsap.matchMedia()` inside that context gates everything behind
   * MOTION_QUERY, so reduced motion and short viewports render the exact
   * same markup as static stacked chapters.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let context: { revert: () => void } | null = null;
    let mm: gsap.MatchMedia | null = null;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);

      const q = (selector: string) =>
        Array.from(root.querySelectorAll<HTMLElement>(selector));

      context = gsap.context(() => {
        mm = gsap.matchMedia();

        mm.add(MOTION_QUERY, () => {
          // flip the layout into "pinned" mode before anything measures
          root.dataset.motion = "on";

          const stage = root.querySelector<HTMLElement>("[data-ts-stage]");
          const scroller = root.querySelector<HTMLElement>("[data-ts-scroller]");
          const scrub = root.querySelector<HTMLElement>("[data-ts-scrub]");
          const track = root.querySelector<HTMLElement>(
            "[data-ts-scrub-track]",
          );
          const readout = root.querySelector<HTMLElement>(
            "[data-ts-readout]",
          );
          const chapters = q("[data-ts-chapter]");
          const stops = q("[data-ts-stop]");
          const numerals = q("[data-ts-numeral]");
          const drifts = q("[data-ts-drift-img]");
          const eras = q("[data-ts-era]");
          const washes = q("[data-ts-wash]");

          if (!stage || !scroller || !scrub || !track || !chapters.length) {
            return;
          }

          const isTight = () => window.innerWidth < 768;
          /** px of scroll per chapter, frozen at build time so the pin
           *  length and the timeline duration can never drift apart */
          const pinUnitPx = Math.round(
            window.innerHeight *
              (isTight() ? CHAPTER_UNIT_TIGHT : CHAPTER_UNIT_WIDE),
          );
          pinUnit.current = pinUnitPx;
          const sweepUnits = () =>
            isTight() ? SWEEP_UNIT_TIGHT : SWEEP_UNIT_WIDE;
          const sweepStart = chapters.length;
          const totalUnits = sweepStart + sweepUnits();
          const pinLength = Math.round(pinUnitPx * totalUnits);

          const applyHeights = () => {
            gsap.set(scroller, { height: `${pinLength}px` });
            if (stops.length) gsap.set(stops, { height: `${pinUnitPx}px` });
          };
          applyHeights();

          /* initial state, applied before the pinned layout is painted */
          gsap.set(washes, { autoAlpha: 0 });
          if (washes[0]) gsap.set(washes[0], { autoAlpha: 1 });
          gsap.set(chapters, { autoAlpha: 0, pointerEvents: "none" });
          gsap.set(chapters[0], { autoAlpha: 1, pointerEvents: "auto" });
          gsap.set(scrub, { autoAlpha: 0 });

          /* the odometer in the year sweep; kept outside React on purpose */
          let trigger: ScrollTrigger | null = null;
          const updateReadout = () => {
            if (!readout || !trigger) return;
            const p = gsap.utils.clamp(
              0,
              1,
              (trigger.progress * totalUnits - sweepStart) / sweepUnits(),
            );
            const year = String(
              Math.round(range[0] + p * (range[1] - range[0])),
            );
            if (readout.textContent !== year) readout.textContent = year;
          };

          const tl = gsap.timeline({ defaults: { ease: "none" } });

          /* ---- one window per generation ---- */
          chapters.forEach((chapter, index) => {
            const at = index;
            const numeral = numerals[index];
            const drift = drifts[index];
            const era = eras[index];

            if (index > 0) {
              // cross-fade the outgoing car visual + wash toward this accent
              tl.to(
                chapters[index - 1],
                { autoAlpha: 0, duration: 0.2, ease: "power2.in" },
                at,
              );
              tl.to(washes[index - 1], { autoAlpha: 0, duration: 0.4 }, at);
            }
            tl.to(washes[index], { autoAlpha: 1, duration: 0.4 }, at);
            tl.fromTo(
              chapter,
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.2, ease: "power2.out" },
              at,
            );
            tl.set(chapter, { pointerEvents: "auto" }, at + 0.2);

            if (numeral) {
              tl.fromTo(
                numeral,
                { xPercent: -16, yPercent: 10 },
                { xPercent: 16, yPercent: -10, ease: "none", duration: 1 },
                at,
              );
            }
            if (drift) {
              tl.fromTo(
                drift,
                { xPercent: -7, yPercent: 5, scale: 1.03, rotate: 1.6 },
                {
                  xPercent: 7,
                  yPercent: -5,
                  scale: 1.15,
                  rotate: -1.6,
                  ease: "none",
                  duration: 1,
                },
                at,
              );
            }
            if (era) {
              tl.fromTo(
                era,
                { autoAlpha: 0, scale: 1.16, yPercent: 10 },
                {
                  autoAlpha: 1,
                  scale: 1,
                  yPercent: 0,
                  duration: 0.18,
                  ease: "power3.out",
                },
                at + 0.3,
              ).to(
                era,
                {
                  autoAlpha: 0,
                  scale: 1.05,
                  yPercent: -6,
                  duration: 0.18,
                  ease: "power2.in",
                },
                at + 0.74,
              );
            }
            if (index < chapters.length - 1) {
              tl.to(
                chapter,
                { autoAlpha: 0, duration: 0.18, ease: "power2.in" },
                at + 0.82,
              );
              tl.set(chapter, { pointerEvents: "none" }, at + 1);
            }
          });

          /* ---- the signature horizontal sweep ---- */
          const last = chapters.length - 1;
          tl.to(chapters[last], { autoAlpha: 0, duration: 0.25 }, sweepStart);
          tl.set(chapters[last], { pointerEvents: "none" }, sweepStart);
          tl.to(washes[last], { autoAlpha: 0, duration: 0.35 }, sweepStart);
          tl.to(scrub, { autoAlpha: 1, duration: 0.3 }, sweepStart);
          tl.fromTo(
            track,
            { x: 0 },
            {
              x: () => Math.max(0, track.scrollWidth - window.innerWidth),
              ease: "none",
              duration: sweepUnits(),
              onUpdate: updateReadout,
            },
            sweepStart,
          );
          tl.to(scrub, { autoAlpha: 0, duration: 0.35 }, totalUnits - 0.35);

          /* ---- the single ScrollTrigger that drives everything ---- */
          trigger = ScrollTrigger.create({
            trigger: stage,
            start: "top top",
            end: () => `+=${pinLength}`,
            pin: stage,
            pinSpacing: false,
            anticipatePin: 1,
            scrub: 0.7,
            animation: tl,
            invalidateOnRefresh: true,
            onRefresh: applyHeights,
            onUpdate: (self) => {
              const time = self.progress * totalUnits;
              const next =
                time >= sweepStart
                  ? SWEEPING
                  : Math.min(chapters.length - 1, Math.max(0, Math.floor(time)));
              if (next !== mirror.current.index) {
                mirror.current.index = next;
                setActiveIndex(next);
              }
              if (!mirror.current.hint && self.progress > 0.004) {
                mirror.current.hint = true;
                setHintHidden(true);
              }
            },
            onToggle: (self) => {
              const on = self.isActive;
              if (mirror.current.rail !== on) {
                mirror.current.rail = on;
                setRailVisible(on);
              }
            },
          });

          ScrollTrigger.refresh();

          return () => {
            // back to the static stacked layout
            root.dataset.motion = "off";
          };
        });
      }, root);
    })().catch(() => {
      // Never let a failed chunk break the static timeline.
      root.dataset.motion = "off";
    });

    return () => {
      disposed = true;
      mm?.revert();
      context?.revert();
      root.dataset.motion = "off";
    };
  }, [range]);

  return (
    <section
      ref={rootRef}
      id="timeline"
      data-owner="scroll-timeline"
      data-motion="off"
      aria-label="1963 to today: every Porsche 911 generation"
      className="relative isolate"
    >
      <TimelineLeadIn />

      <div data-ts-wrap className="relative">
        {/* ---- pinned stage: identical markup for both modes ---- */}
        <div
          data-ts-stage
          className="relative data-[motion=on]:isolate data-[motion=on]:h-dvh data-[motion=on]:grid data-[motion=on]:grid-cols-1 data-[motion=on]:grid-rows-1 data-[motion=on]:overflow-hidden"
        >
          <StageBackdrop generations={GENERATIONS} />

          {GENERATIONS.map((generation, index) => (
            <TimelineChapter
              key={generation.id}
              generation={generation}
              index={index}
              total={GENERATIONS.length}
            />
          ))}

          <TimelineYearScrub
            start={range[0]}
            end={range[1]}
            chapters={GENERATIONS.length}
          />
        </div>

        {/* ---- scroll length driver, motion mode only ---- */}
        <div
          data-ts-scroller
          aria-hidden="true"
          className="pointer-events-none hidden data-[motion=on]:block"
        >
          {GENERATIONS.map((generation) => (
            <div
              key={generation.id}
              data-ts-stop
              data-generation={generation.id}
              className="w-full"
            />
          ))}
        </div>
      </div>

      <TimelineProgressRail
        generations={GENERATIONS}
        activeIndex={activeIndex}
        visible={railVisible}
        onJump={handleJump}
      />

      <TimelineScrollHint hidden={hintHidden} />

      <TimelineGenerationIndex generations={GENERATIONS} />

      <TimelineHandoff />
    </section>
  );
}

/** Viewport heights of scroll per chapter, responsive. */
function chapterUnit(): number {
  return typeof window !== "undefined" && window.innerWidth < 768
    ? CHAPTER_UNIT_TIGHT
    : CHAPTER_UNIT_WIDE;
}