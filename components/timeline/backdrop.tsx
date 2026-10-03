import type { ClientGeneration as Generation } from "#lib/client-catalog";
import { withAlpha } from "./format";

/**
 * Shared backdrop for the pinned stage.
 *
 * One accent wash per generation, cross-faded by the master ScrollTrigger
 * timeline so the background colour shifts toward each generation's `accent`.
 * Fully decorative — `aria-hidden`, and hidden entirely in static mode where
 * each chapter carries its own wash instead.
 */
export function StageBackdrop({ generations }: { generations: Generation[] }) {
  return (
    <div
      data-ts-backdrop
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-20 overflow-hidden bg-ink data-[motion=off]:hidden"
    >
      {generations.map((generation, index) => (
        <div
          key={generation.id}
          data-ts-wash
          className={`absolute inset-0 ${index === 0 ? "opacity-100" : "opacity-0"}`}
          style={{
            backgroundImage: [
              `radial-gradient(120% 70% at 72% 12%, ${withAlpha(generation.accent, 0.3)} 0%, transparent 62%)`,
              `radial-gradient(90% 60% at 10% 96%, ${withAlpha(generation.accent, 0.14)} 0%, transparent 58%)`,
              `linear-gradient(200deg, ${withAlpha(generation.accent, 0.1)} 0%, transparent 48%)`,
            ].join(", "),
          }}
        />
      ))}

      {/* hairline grid — motion mode only */}
      <div className="absolute inset-0 opacity-[0.07] data-[motion=off]:hidden">
        <div className="absolute inset-y-0 left-1/4 w-px bg-metal-300" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-metal-300" />
        <div className="absolute inset-y-0 left-3/4 w-px bg-metal-300" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-metal-300" />
      </div>

      {/* diagonal hairline accent, echoes the image drift direction */}
      <div className="absolute inset-0 overflow-hidden data-[motion=off]:hidden">
        <div
          className="absolute inset-x-[-30%] inset-y-[-30%] origin-center rotate-[14deg]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, transparent 49.9%, var(--color-guards) 50%, transparent 50.1%, transparent 100%)",
            opacity: 0.18,
          }}
        />
      </div>

      {/* vignette keeps the display numerals from bleeding into the nav */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_35%,var(--color-ink)_100%)] opacity-60" />
    </div>
  );
}