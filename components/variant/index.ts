export { SafeImage, type SafeImageProps } from "./safe-image";
export { Reveal, Eyebrow, FOCUS_RING } from "./reveal";

export { VariantHero, type VariantHeroProps } from "./variant-hero";
export { SpecCounters, StatCounters, type SpecCountersProps } from "./spec-counters";
export { Viewer3D, type Viewer3DProps } from "./viewer-3d";
export { ColorSwapper, type ColorSwapperProps } from "./color-swapper";
export { WheelSwapper, type WheelSwapperProps } from "./wheel-swapper";
export { Embed3D } from "./embed-3d";
export { Turntable3D, frameUrl } from "./turntable-3d";
export { NoModelPanel } from "./no-3d-panel";
export { Gallery, type GalleryProps } from "./gallery";
export { Lightbox, type LightboxProps } from "./lightbox";
export { VideoSection, type VideoSectionProps } from "./video-section";
export { CompareWidget, type CompareWidgetProps } from "./compare-widget";
export { CreditsStrip, type CreditsStripProps } from "./credits-strip";
export { DataNotes } from "./data-notes";

export { GenerationHero, type GenerationHeroProps } from "./generation-hero";
export { GenerationGrid, type GenerationGridProps } from "./generation-grid";
export { GenerationPager, type GenerationPagerProps } from "./generation-pager";
export { VariantGrid, type VariantGridProps } from "./variant-grid";

export {
  buildSpecRows,
  diffCells,
  diffRowKeys,
  DIFF_LABELS,
  noteFor,
  type SpecRow,
} from "./lib/specs";
export { pickSiblings, compareHref, type Sibling } from "./lib/siblings";
export {
  generationVideos,
  variantVideos,
  generationVideoCount,
  orderedVideoKeys,
  type ScopedVideo,
} from "./lib/videos";
export { creditsForVariant, modelAttribution, lookupCredit } from "./lib/credits";
export { PAINTS, DEFAULT_PAINT, wheelGroups, type Paint, type WheelOption } from "./lib/palette";
export { useReducedMotion, useInView, useCountUp, useMounted } from "./lib/hooks";