import type { Metadata } from "next";
import { filtersFromParams, VARIANT_COUNT } from "#components/nav/catalog";
import { LoadingScreen } from "#components/nav/loading-screen";
import { VariantGrid } from "#components/nav/variant-grid";

/**
 * /variants — owned by NAV-UX.
 *
 * The filterable grid. The server only parses `searchParams` into the shared
 * `VariantFilters` shape and hands it to the client grid, which then owns the
 * URL from that point on (`history.replaceState`), so every filter change is
 * instant *and* shareable.
 */

export const metadata: Metadata = {
  title: "Every 911 variant",
  description:
    `Filter all ${VARIANT_COUNT} Porsche 911 variants by generation, body style, engine family, drivetrain and year — sortable by power, year or name.`,
};

type GridSearch = Record<string, string | string[] | undefined>;

export default async function VariantsPage({
  searchParams,
}: {
  searchParams: Promise<GridSearch>;
}) {
  const filters = filtersFromParams(await searchParams);

  return (
    <>
      <LoadingScreen caption="Every 911, indexed" />
      <VariantGrid initialFilters={filters} />
    </>
  );
}
