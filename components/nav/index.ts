/**
 * components/nav — owned by NAV-UX.
 *
 * Public surface. `app/layout.tsx` imports `SiteNav`, `PageTransition` and
 * `Footer` from their own modules; the rest are used by the routes in
 * `app/compare`, `app/search` and `app/variants`.
 */
export { SiteNav } from "./site-nav";
export { PageTransition } from "./page-transition";
export { Footer } from "./footer";
export { NavChrome, NAV_HEIGHT, type NavGeneration } from "./nav-chrome";
export {
  CommandPalette,
  NavUiProvider,
  PaletteLauncher,
  openCommandPalette,
  useNavUi,
  type NavUiApi,
} from "./command-palette";
export { CustomCursor } from "./cursor";
export { LoadingScreen, type LoadingScreenProps } from "./loading-screen";
export { VariantGrid, type VariantGridProps } from "./variant-grid";
export { CompareTable, type CompareTableProps } from "./compare-table";
export {
  BODY_FACETS,
  COMPARE_SLOT_KEYS,
  DRIVE_FACETS,
  ENGINE_FACETS,
  GENERATION_INDEX,
  PAGE_SIZE,
  SORT_OPTIONS,
  VARIANT_BY_KEY,
  VARIANT_COUNT,
  VARIANT_INDEX,
  YEAR_MAX,
  YEAR_MIN,
  applyFilters,
  defaultFilters,
  filtersFromParams,
  filtersHref,
  filtersToQuery,
  firstParam,
  resolveSlot,
  searchIndex,
  slotsToQuery,
  toggleFilterValue,
  type CompareSlot,
  type CompareSlotKey,
  type DriveLayout,
  type EngineFamily,
  type IndexedGeneration,
  type IndexedVariant,
  type PaletteEntry,
  type SortKey,
  type VariantFilters,
} from "./catalog";
