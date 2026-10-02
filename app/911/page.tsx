import type { Metadata } from "next";
import { GENERATIONS } from "#lib/generations";
import { GenerationGrid } from "#components/variant/generation-grid";
import { generationVideoCount } from "#components/variant/lib/videos";

/**
 * `/911` — the generation index. Lives inside VARIANT-PAGES' ownership
 * (`app/911/**`). Server component: nine cards, no client JavaScript.
 */

export const metadata: Metadata = {
  title: "Every 911 generation",
  description:
    "All nine Porsche 911 generations — 1963's 901 to the 992.2 T-Hybrid era — with every catalogued variant linked to its own page.",
  alternates: { canonical: "/911" },
};

export default function GenerationsIndexPage() {
  const totals: Record<string, number> = {};
  const videoCounts: Record<string, number> = {};

  for (const generation of GENERATIONS) {
    totals[generation.id] = generation.variants.length;
    videoCounts[generation.id] = generationVideoCount(generation.id);
  }

  return (
    <div data-owner="variant-pages">
      <GenerationGrid
        generations={GENERATIONS}
        totals={totals}
        videoCounts={videoCounts}
      />
    </div>
  );
}