import type { CSSProperties } from "react";

/**
 * The giant OUTLINED year numeral that parallaxes behind each chapter.
 *
 * Structure note: the outer element owns all layout/positioning (including the
 * static `translate`), the inner `[data-ts-numeral]` element is the GSAP
 * parallax target. Two elements so the scrub transform never fights a
 * Tailwind transform.
 *
 * Decorative: `aria-hidden`, never announced.
 */
export function YearNumeral({
  year,
  className = "",
}: {
  year: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-[-3vw] bottom-(--space-4) select-none overflow-hidden md:inset-x-auto md:bottom-auto md:left-(--gutter) md:right-0 md:top-1/2 md:-translate-y-1/2 ${className}`}
    >
      <span
        data-ts-numeral
        className="block text-right font-display leading-[0.78] tracking-(--tracking-display) text-transparent opacity-70 text-[clamp(6.5rem,27vw,25rem)]"
        style={
          {
            WebkitTextStroke: "1px var(--chapter-accent, currentColor)",
          } as CSSProperties
        }
      >
        {year}
      </span>
    </span>
  );
}