"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { useReducedMotion } from "./lib/hooks";
import { cx, yearRange } from "./lib/format";

/**
 * Generation landing hero.
 *
 * One viewport, no pinning: the page below it is a long scroll anyway, so a
 * pinned hero would only add scroll length. GSAP scrubs the image and the
 * outlined numerals against the hero's own travel; if GSAP is unavailable (or
 * motion is reduced) the identical markup stands still and reads fine.
 *
 * The giant outlined numerals are decorative (`aria-hidden`) — the years are
 * also in the visible label row, which is what a screen reader gets.
 */

export interface GenerationHeroProps {
  code: string;
  name: string;
  tagline: string;
  description: string;
  yearsStart: number;
  yearsEnd: number | null;
  ordinal: number;
  total: number;
  variantCount: number;
  hero: ImageResult;
  accent: string;
  generationId: string;
}

export function GenerationHero({
  code,
  name,
  tagline,
  description,
  yearsStart,
  yearsEnd,
  ordinal,
  total,
  variantCount,
  hero,
  accent,
  generationId,
}: GenerationHeroProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

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

      const media = root.querySelector<HTMLElement>("[data-gen-media]");
      const numerals = root.querySelector<HTMLElement>("[data-gen-numerals]");
      if (!media) return;

      context = gsap.context(() => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "bottom top",
              scrub: 0.5,
              invalidateOnRefresh: true,
            },
          })
          .fromTo(
            media,
            { yPercent: -4, scale: 1.05 },
            { yPercent: 12, scale: 1.16, ease: "none" },
            0,
          )
          .fromTo(
            numerals,
            { yPercent: 0, opacity: 1 },
            { yPercent: -14, opacity: 0.35, ease: "none" },
            0,
          );
      }, root);
    })().catch(() => {
      // static hero is a complete hero
    });

    return () => {
      disposed = true;
      context?.revert();
    };
  }, [reduced]);

  const entrance = reduced ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 } };
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.85, ease: [0.16, 1, 0.3, 1] as const };

  const firstParagraph = description.split("\n\n")[0] ?? "";
  const secondParagraph = description.split("\n\n")[1] ?? "";

  return (
    <section
      ref={rootRef}
      aria-labelledby={`gen-${generationId}-heading`}
      className="relative isolate flex min-h-[92svh] flex-col justify-end overflow-hidden bg-ink px-(--gutter) pb-(--space-12) pt-(--space-24)"
    >
      <div data-gen-media className="absolute inset-0 -z-30 will-change-transform">
        <SafeImage
          image={hero}
          fill
          priority
          sizes="100vw"
          className={cx(
            "object-cover",
            hero.fallback ? "opacity-40 grayscale" : "opacity-80",
          )}
          style={{ objectPosition: "center 55%" }}
        />
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "linear-gradient(to top, var(--color-ink) 1%, color-mix(in srgb, var(--color-ink) 68%, transparent) 46%, color-mix(in srgb, var(--color-ink) 30%, transparent) 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20"
        style={{
          backgroundImage: `linear-gradient(100deg, color-mix(in srgb, ${accent} 30%, transparent) 0%, transparent 52%)`,
        }}
      />

      <p
        aria-hidden="true"
        data-gen-numerals
        className="pointer-events-none absolute inset-x-(--gutter) top-[12%] select-none font-display text-[clamp(5rem,20vw,17rem)] leading-[0.8] tracking-(--tracking-display) text-transparent opacity-55"
        style={{ WebkitTextStroke: `1px ${accent}` }}
      >
        {yearRange(yearsStart, yearsEnd)}
      </p>

      <div className="relative z-content mx-auto w-full max-w-(--maxw)">
        <motion.nav
          aria-label="Breadcrumb"
          {...entrance}
          transition={{ ...transition, delay: reduced ? 0 : 0.05 }}
          className="label flex flex-wrap items-center gap-x-(--space-3) gap-y-1"
        >
          <Link
            href="/911"
            className="rounded-(--radius-sm) py-1 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            All generations
          </Link>
          <span aria-hidden="true" className="text-ink-4">
            /
          </span>
          <span className="text-metal-300">
            {ordinal} of {total}
          </span>
        </motion.nav>

        <motion.p
          {...entrance}
          transition={{ ...transition, delay: reduced ? 0 : 0.1 }}
          className="label mt-(--space-6)"
        >
          <span style={{ color: accent }}>{code}</span>
          <span aria-hidden="true" className="mx-(--space-3) text-ink-4">
            —
          </span>
          {yearRange(yearsStart, yearsEnd)}
        </motion.p>

        <motion.h1
          id={`gen-${generationId}-heading`}
          {...entrance}
          transition={{ ...transition, delay: reduced ? 0 : 0.16 }}
          className="text-display-2 mt-(--space-2) max-w-[min(18ch,92%)] text-metal-100"
        >
          {name}
        </motion.h1>

        {tagline ? (
          <motion.p
            {...entrance}
            transition={{ ...transition, delay: reduced ? 0 : 0.22 }}
            className="mt-(--space-4) max-w-[52ch] font-display text-display-3 leading-[1.05] text-metal-300"
          >
            {tagline}
          </motion.p>
        ) : null}

        <motion.div
          {...entrance}
          transition={{ ...transition, delay: reduced ? 0 : 0.28 }}
          className="mt-(--space-8) grid max-w-[70rem] gap-(--space-6) lg:grid-cols-2"
        >
          {firstParagraph ? (
            <p className="max-w-(--maxw-prose) text-body-2 leading-relaxed text-metal-300">
              {firstParagraph}
            </p>
          ) : null}
          {secondParagraph ? (
            <p className="max-w-(--maxw-prose) text-body-2 leading-relaxed text-metal-500">
              {secondParagraph}
            </p>
          ) : null}
        </motion.div>

        <motion.div
          {...entrance}
          transition={{ ...transition, delay: reduced ? 0 : 0.34 }}
          className="mt-(--space-8) flex flex-wrap items-center gap-x-(--space-6) gap-y-(--space-3)"
        >
          <a
            href="#variants"
            className={cx(
              "inline-flex items-center gap-(--space-3) rounded-(--radius-sm) border border-ink-4 bg-ink/60 px-(--space-4) py-(--space-3) font-mono text-mono-sm uppercase tracking-(--tracking-mono) transition-colors hover:border-metal-500 hover:bg-ink-2",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
            )}
          >
            All {variantCount} variants
            <span aria-hidden="true">↓</span>
          </a>
          {hero.fallback ? (
            <p className="label">Hero imagery pending — placeholder shown</p>
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}