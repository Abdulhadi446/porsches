import { memo } from "react";

/**
 * First-scroll cue. Fades out once the reader has scrolled. Decorative, so it
 * is `aria-hidden` and never steals a tab stop.
 */
export function ScrollHint({ hidden }: { hidden: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-hidden={hidden ? "" : undefined}
      className="pointer-events-none fixed bottom-(--space-6) left-1/2 z-[var(--z-nav)] -translate-x-1/2 transition-opacity duration-(--dur-slow) data-[hidden]:opacity-0"
    >
      <span className="label block text-center">Scroll</span>
      <span className="mx-auto mt-(--space-2) block h-(--space-8) w-px bg-gradient-to-b from-guards to-transparent motion-safe:animate-pulse" />
    </div>
  );
}

export const TimelineScrollHint = memo(ScrollHint);