/**
 * Hero design tokens.
 *
 * Every colour handed to three.js is resolved from `styles/tokens.css` through
 * the fx library's resolver (which mirrors the same hexes for the pre-CSS case).
 * There is not a single hardcoded colour in the WebGL scene — the scene simply
 * cannot be server rendered, so resolving at runtime is always safe.
 *
 * Resolver internals are reused rather than reimplemented; `fxVar` builds the
 * `var(--color-…)` reference, `resolveFxColor` reads it back off
 * `:root` (falling back to the mirrored hex).
 */

import { useMemo } from "react";
import { resolveFxColor, type FxToken } from "#components/fx/runtime";

export interface HeroColors {
  ink: string;
  ink2: string;
  ink3: string;
  metal100: string;
  metal300: string;
  metal500: string;
  metal700: string;
  metal900: string;
  guards: string;
  guardsDeep: string;
  guardsGlow: string;
  gulfBlue: string;
  signal: string;
}

const TOKENS = {
  ink: "ink",
  ink2: "ink-2",
  ink3: "ink-3",
  metal100: "metal-100",
  metal300: "metal-300",
  metal500: "metal-500",
  metal700: "metal-700",
  metal900: "metal-900",
  guards: "guards",
  guardsDeep: "guards-deep",
  guardsGlow: "guards-glow",
  gulfBlue: "gulf-blue",
  signal: "signal",
} as const satisfies Record<keyof HeroColors, FxToken>;

/** Client-only: reads the live cascade. Called from inside the lazy scene chunk. */
export function useHeroColors(): HeroColors {
  return useMemo(() => {
    const out = {} as Record<keyof HeroColors, string>;
    for (const [name, token] of Object.entries(TOKENS)) {
      out[name as keyof HeroColors] = resolveFxColor(token);
    }
    return out;
  }, []);
}
