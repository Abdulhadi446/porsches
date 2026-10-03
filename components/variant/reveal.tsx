"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReducedMotion } from "./lib/hooks";
import { cx } from "./lib/format";

/**
 * Scroll-triggered entrance used by every non-critical block on the variant
 * and generation pages.
 *
 * - `whileInView` + `viewport={{ once: true }}` means the animation runs once
 *   and never re-triggers (no jank on scroll-back).
 * - Under `prefers-reduced-motion: reduce` this renders a plain element, so
 *   the content is fully visible on first paint with no transform at all.
 * - Nothing here is required for the page to make sense: it is decoration
 *   around content that is already in the DOM.
 */
export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** stagger delay in seconds */
  delay?: number;
  /** travel distance in px */
  y?: number;
  /** opacity floor of the animation (1 = fade in from invisible) */
  from?: number;
  /** render as a semantic element */
  as?: "div" | "section" | "li" | "article" | "header" | "footer";
}

export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  from = 0,
  as = "div",
  ...rest
}: RevealProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    const Tag = as;
    return (
      <Tag className={className} {...(rest as Record<string, never>)}>
        {children}
      </Tag>
    );
  }

  const Component = motion[as];
  return (
    <Component
      className={className}
      initial={{ opacity: from, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: 0.7,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </Component>
  );
}

/** The mono eyebrow used above every section heading. */
export function Eyebrow({
  children,
  className,
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <p className={cx("label flex items-center gap-(--space-3)", className)}>
      <span
        aria-hidden="true"
        className="inline-block h-px w-8"
        style={{ backgroundColor: accent ?? "var(--color-guards)" }}
      />
      {children}
    </p>
  );
}

/** Focus ring used by every interactive element in components/variant. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards";