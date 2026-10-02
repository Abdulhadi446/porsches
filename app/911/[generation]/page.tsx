import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GENERATIONS, getGeneration } from "#lib/generations";
import { getImage } from "#lib/assets";
import { GenerationHero } from "#components/variant/generation-hero";
import { StatCounters } from "#components/variant/spec-counters";
import { VariantGrid } from "#components/variant/variant-grid";
import { VideoSection } from "#components/variant/video-section";
import { GenerationPager } from "#components/variant/generation-pager";
import { DataNotes } from "#components/variant/data-notes";
import { generationVideos } from "#components/variant/lib/videos";
import { yearRange } from "#components/variant/lib/format";

/**
 * `/911/[generation]` — the generation landing page.
 *
 * Server component (deliverable 1): full-bleed hero with the generation hero
 * image, giant outlined year numerals, tagline + description, animated stat
 * counters, every variant in a linked grid, the curated generation videos, a
 * previous/next pager and a jump back to the timeline.
 *
 * Work per page is O(variants in this generation) — 13..23 entries — plus two
 * O(1) key lookups. Nothing scans the filesystem and no media is fetched here.
 */

export function generateStaticParams() {
  return GENERATIONS.map((generation) => ({ generation: generation.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ generation: string }>;
}): Promise<Metadata> {
  const { generation } = await params;
  const gen = getGeneration(generation);
  if (!gen) return { title: "Generation not found" };

  const years = yearRange(gen.yearsStart, gen.yearsEnd);
  const description =
    gen.tagline ||
    `${gen.name} (${years}) — ${gen.variants.length} catalogued variants, specifications and archive media.`;

  return {
    title: `${gen.code} — ${gen.name}`,
    description,
    alternates: { canonical: `/911/${gen.id}` },
    openGraph: {
      title: `${gen.code} ${gen.name} · ${years}`,
      description,
      type: "website",
    },
  };
}

export default async function GenerationPage({
  params,
}: {
  params: Promise<{ generation: string }>;
}) {
  const { generation } = await params;
  const gen = getGeneration(generation);
  if (!gen) notFound();

  const position = GENERATIONS.findIndex((entry) => entry.id === gen.id);
  const previous = position > 0 ? GENERATIONS[position - 1] : null;
  const next = position >= 0 && position < GENERATIONS.length - 1 ? GENERATIONS[position + 1] : null;

  const hero = getImage(gen.heroImage ?? gen.timelineImage, {
    alt: `${gen.code} ${gen.name} — ${yearRange(gen.yearsStart, gen.yearsEnd)}`,
  });
  const stats = (gen.stats ?? []).slice(0, 6);
  const videos = generationVideos(gen);

  return (
    <div data-owner="variant-pages">
      <GenerationHero
        code={gen.code}
        name={gen.name}
        tagline={gen.tagline}
        description={gen.description}
        yearsStart={gen.yearsStart}
        yearsEnd={gen.yearsEnd}
        ordinal={position + 1}
        total={GENERATIONS.length}
        variantCount={gen.variants.length}
        hero={hero}
        accent={gen.accent}
        generationId={gen.id}
      />

      {stats.length > 0 ? (
        <StatCounters stats={stats} accent={gen.accent} headingId={`gen-${gen.id}-stats`} />
      ) : null}

      <VariantGrid generation={gen} accent={gen.accent} headingId={`gen-${gen.id}-variants`} />

      {videos.length > 0 ? (
        <VideoSection
          videos={videos}
          carName={gen.code}
          accent={gen.accent}
          headingId={`gen-${gen.id}-videos`}
          lede={`Curated from the ${gen.variants.length} variants of the ${gen.code}. Nothing is downloaded from YouTube — each player is an embed that only loads when you press play.`}
        />
      ) : null}

      <DataNotes notes={gen.missing} heading="What the sources do not settle" accent={gen.accent} />

      <GenerationPager generation={gen} previous={previous} next={next} />
    </div>
  );
}