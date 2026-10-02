import { GENERATIONS } from "#lib/generations";
import { NavChrome, type NavGeneration } from "./nav-chrome";

/**
 * SITE NAV — owned by NAV-UX.
 *
 * A server component on purpose: the nine generation summaries are extracted
 * here and handed to the client island (`NavChrome`) as plain props, so the
 * generation JSON never ships in the client bundle of any route. The palette's
 * index is code-split separately and only pulled in on first use.
 */
export function SiteNav() {
  const generations: NavGeneration[] = GENERATIONS.map((generation) => ({
    id: generation.id,
    code: generation.code,
    name: generation.name,
    years: `${generation.yearsStart}\u2013${generation.yearsEnd ?? "today"}`,
    accent: generation.accent,
    tagline: generation.tagline ?? "",
    variantCount: generation.variants.length,
    yearStart: generation.yearsStart,
  }));

  return <NavChrome generations={generations} />;
}
