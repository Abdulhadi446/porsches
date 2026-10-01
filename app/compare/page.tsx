import type { Metadata } from "next";
import { allVariants } from "#lib/generations";

export const metadata: Metadata = {
  title: "Compare two 911s",
  description: "Side-by-side spec comparison of any two Porsche 911 variants.",
};

/** STUB — owned by NAV-UX subagent. */
export default function ComparePage() {
  const variants = allVariants();
  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto max-w-[--maxw]">
        <p className="label mb-4">Compare</p>
        <h1 className="text-display-2 mb-8">Pick two 911s</h1>
        <p className="label">
          {variants.length} variants indexed — UI pending (nav-ux).
        </p>
      </div>
    </div>
  );
}
