"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { FOCUS_RING } from "./reveal";
import { useReducedMotion } from "./lib/hooks";
import { cx, yearRange } from "./lib/format";

/**
 * Full-bleed hero — section (a) of the variant page.
 *
 * Layout is CSS-only: the outer block is 178svh tall (no scroll length at all
 * under reduced motion) and the stage inside is `sticky top-0 h-svh`, so the
 * parallax is structural and survives a failed GSAP chunk, a no-JS load and a
 * reduced-motion visit alike. GSAP then adds the scrubbed translate on top
 * (image drifts +6 %, title drifts −22 %) and the framer-motion pass handles
 * the entrance.
 *
 * Zero-JS fallback: the same markup, fully visible, one viewport tall.
 */

export interface VariantHeroProps {
  name: string;
  years: string;
  description: string;
  bodyStyles: string;
  headlineId: string;
  hero: ImageResult;
  /** generation crumb */
  generation: { id: string; code: string; name: string };
  yearsStart: number;
  yearsEnd: number | null;
  accent: string;
}

export function VariantHero({
  name,
  years,
  description,
  bodyStyles,
  headlineId,
  hero,
  generation,
  yearsStart,
  yearsEnd,
  accent,
}: VariantHeroProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  /* ---- scrubbed parallax: optional enhancement, always cleaned up ---- */
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let context: { revert: () => void } | null = null;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);

      const media = root.querySelector<HTMLElement>("[data-hero-media]");
      const title = root.querySelector<HTMLElement>("[data-hero-title]");
      const meta = root.querySelector<HTMLElement>("[data-hero-meta]");
      if (!media || !title) return;

      context = gsap.context(() => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.55,
              invalidateOnRefresh: true,
            },
          })
          .fromTo(
            media,
            { yPercent: 0, scale: 1.04 },
            { yPercent: 8, scale: 1.14, ease: "none" },
            0,
          )
          .fromTo(
            title,
            { yPercent: 0, opacity: 1 },
            { yPercent: -24, opacity: 0.2, ease: "none" },
            0,
          )
          .fromTo(
            meta,
            { yPercent: 0, opacity: 1 },
            { yPercent: -60, opacity: 0, ease: "none" },
            0,
          );
      }, root);
    })().catch(() => {
      // The sticky stage is already a complete hero without GSAP.
    });

    return () => {
      disposed = true;
      context?.revert();
    };
  }, [reduced]);

  const entrance = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 26 },
        animate: { opacity: 1, y: 0 },
      };
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <section
      ref={rootRef}
      aria-labelledby={headlineId}
      data-owner="variant-pages"
      className="relative h-svh [@media(prefers-reduced-motion:no-preference)]:h-[178svh]"
    >
      <div className="sticky top-0 isolate h-svh overflow-hidden bg-ink">
        {/* ---------------- media ---------------- */}
        <div
          data-hero-media
          aria-hidden={hero.fallback ? undefined : undefined}
          className="absolute inset-0 -z-30 will-change-transform"
        >
          <SafeImage
            image={hero}
            fill
            priority
            sizes="100vw"
            className={cx(
              "object-cover",
              hero.fallback ? "opacity-45 grayscale" : "opacity-90",
            )}
            style={{ objectPosition: "center 62%" }}
          />
        </div>

        {/* legibility: vertical scrim + generation-accent wash */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20"
          style={{
            backgroundImage:
              "linear-gradient(to top, var(--color-ink) 2%, color-mix(in srgb, var(--color-ink) 55%, transparent) 42%, color-mix(in srgb, var(--color-ink) 22%, transparent) 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20"
          style={{
            backgroundImage: `linear-gradient(115deg, color-mix(in srgb, ${accent} 26%, transparent) 0%, transparent 46%)`,
          }}
        />

        {/* giant outlined era numerals */}
        <p
          aria-hidden="true"
          data-hero-title
          className="pointer-events-none absolute inset-x-[--gutter] bottom-[18%] -z-10 select-none font-display text-[clamp(4.5rem,17vw,15rem)] leading-[0.78] tracking-[--tracking-display] text-transparent opacity-60"
          style={{ WebkitTextStroke: `1px ${accent}` }}
        >
          {yearRange(yearsStart, yearsEnd)}
        </p>

        {/* ---------------- content ---------------- */}
        <div className="relative z-content mx-auto flex h-full w-full max-w-[--maxw] flex-col justify-end px-[--gutter] pb-[--space-12] md:pb-[--space-16]">
          <motion.nav
            aria-label="Breadcrumb"
            {...entrance}
            transition={{ ...transition, delay: reduced ? 0 : 0.05 }}
            className="label mb-[--space-6] flex flex-wrap items-center gap-x-[--space-3] gap-y-1"
          >
            <Link
              href={`/911/${generation.id}`}
              className={cx(
                "rounded-[--radius-sm] py-1 transition-colors hover:text-metal-100",
                FOCUS_RING,
              )}
              style={{ color: accent }}
            >
              {generation.code}
            </Link>
            <span aria-hidden="true" className="text-ink-4">
              /
            </span>
            <span className="text-metal-300">{generation.name}</span>
          </motion.nav>

          <motion.h1
            id={headlineId}
            {...entrance}
            transition={{ ...transition, delay: reduced ? 0 : 0.12 }}
            className="text-display-2 max-w-[min(20ch,92%)] text-metal-100"
          >
            {name}
          </motion.h1>

          <motion.div
            data-hero-meta
            {...entrance}
            transition={{ ...transition, delay: reduced ? 0 : 0.2 }}
            className="mt-[--space-6] flex flex-col gap-[--space-4]"
          >
            <p className="spec-grid flex flex-wrap items-center gap-x-[--space-6] gap-y-[--space-2] text-mono-sm uppercase tracking-[--tracking-mono] text-metal-300">
              <span>{years}</span>
              {bodyStyles ? (
                <>
                  <span aria-hidden="true" className="text-ink-4">
                    ·
                  </span>
                  <span>{bodyStyles}</span>
                </>
              ) : null}
              {hero.fallback ? (
                <>
                  <span aria-hidden="true" className="text-ink-4">
                    ·
                  </span>
                  <span className="text-metal-500">Imagery pending</span>
                </>
              ) : null}
            </p>

            {description ? (
              <p className="max-w-[--maxw-prose] text-body-2 leading-relaxed text-metal-300">
                {description.split("\n\n")[0]}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-[--space-6] gap-y-[--space-3] pt-[--space-2]">
              <a
                href="#specs"
                className={cx(
                  "inline-flex items-center gap-[--space-3] rounded-[--radius-sm] border border-ink-4 bg-ink/60 px-[--space-4] py-[--space-3] font-mono text-mono-sm uppercase tracking-[--tracking-mono] transition-colors hover:border-metal-500 hover:bg-ink-2",
                  FOCUS_RING,
                )}
              >
                Specifications
                <span aria-hidden="true">↓</span>
              </a>
              <p className="label">Unofficial fan showcase · media licensed per asset</p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}