import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GENERATIONS, getVariant } from "#lib/generations";
import { getGallery, getImage, getModel } from "#lib/assets";
import { VariantHero } from "#components/variant/variant-hero";
import { SpecCounters } from "#components/variant/spec-counters";
import { Viewer3D } from "#components/variant/viewer-3d";
import { Gallery } from "#components/variant/gallery";
import { VideoSection } from "#components/variant/video-section";
import { CompareWidget } from "#components/variant/compare-widget";
import { CreditsStrip } from "#components/variant/credits-strip";
import { DataNotes } from "#components/variant/data-notes";
import { buildSpecRows } from "#components/variant/lib/specs";
import { pickSiblings } from "#components/variant/lib/siblings";
import { variantVideos } from "#components/variant/lib/videos";
import { creditsForVariant, modelAttribution } from "#components/variant/lib/credits";
import { bodyStyleList, yearRange } from "#components/variant/lib/format";

/**
 * `/911/[generation]/[variant]` — the flagship page (deliverable 2).
 *
 * Still a **server** component: every byte of catalogue data is resolved here
 * and handed to `"use client"` leaves as plain props. Per-page work is O(variants
 * in this generation) for the sibling picker and O(1) for everything else —
 * no filesystem walking, no network, no media loading.
 */

export function generateStaticParams() {
  return GENERATIONS.flatMap((generation) =>
    generation.variants.map((variant) => ({
      generation: generation.id,
      variant: variant.id,
    })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ generation: string; variant: string }>;
}): Promise<Metadata> {
  const { generation, variant } = await params;
  const hit = getVariant(generation, variant);
  if (!hit) return { title: "Variant not found" };

  const { generation: gen, variant: v } = hit;
  const hero = getImage(v.heroImage, { alt: `${v.name} — ${v.years}` });
  const description =
    v.description.split("\n\n")[0] ||
    `${v.name} (${v.years}) — ${v.power}. Part of the ${gen.code} generation.`;

  return {
    title: `${v.name} (${v.years})`,
    description,
    alternates: { canonical: `/911/${gen.id}/${v.id}` },
    openGraph: {
      title: `${v.name} · ${gen.code}`,
      description,
      type: "article",
      images: hero.fallback ? undefined : [{ url: hero.src, alt: hero.alt }],
    },
  };
}

export default async function VariantPage({
  params,
}: {
  params: Promise<{ generation: string; variant: string }>;
}) {
  const { generation, variant } = await params;
  const hit = getVariant(generation, variant);
  if (!hit) notFound();

  const { generation: gen, variant: v } = hit;
  const headlineId = "variant-heading";
  const years = yearRange(v.yearsStart ?? gen.yearsStart, v.yearsEnd ?? gen.yearsEnd);

  const hero = getImage(v.heroImage, { alt: `${v.name} — ${v.years}` });
  const gallery = getGallery(v);
  const model = getModel(v.model3d);
  const videos = variantVideos(gen, v);
  const rows = buildSpecRows(v);
  const siblings = pickSiblings(gen, v, GENERATIONS, 3);
  const variantKey = `${gen.id}/${v.id}`;

  // credits for exactly the media this page renders
  const renderedImages = [v.heroImage, ...(v.gallery ?? [])];
  const creditRows = creditsForVariant(v, renderedImages);
  const attribution = modelAttribution(v.model3d);

  return (
    <article data-owner="variant-pages" aria-labelledby={headlineId}>
      {/* ---- (a) full-bleed hero ---- */}
      <VariantHero
        name={v.name}
        years={v.years}
        description={v.description}
        bodyStyles={bodyStyleList(v.bodyStyles)}
        headlineId={headlineId}
        hero={hero}
        generation={{ id: gen.id, code: gen.code, name: gen.name }}
        yearsStart={v.yearsStart ?? gen.yearsStart}
        yearsEnd={v.yearsEnd ?? gen.yearsEnd}
        accent={gen.accent}
      />

      {/* ---- (b) animated spec counters ---- */}
      <SpecCounters
        rows={rows}
        accent={gen.accent}
        headingId="variant-specs"
        lede={`Every figure below is quoted from the sources listed at the foot of the page. A dash means the number was never published — it is never estimated.`}
      />

      {/* ---- (c) 3D viewer ---- */}
      <Viewer3D
        model={model}
        carName={v.name}
        poster={hero}
        accent={gen.accent}
        headingId="variant-viewer"
      />

      {/* ---- (d) gallery + lightbox ---- */}
      <Gallery
        images={gallery}
        carName={v.name}
        accent={gen.accent}
        headingId="variant-gallery"
      />

      {/* ---- (e) videos ---- */}
      {videos.length > 0 ? (
        <VideoSection
          videos={videos}
          carName={v.name}
          accent={gen.accent}
          headingId="variant-videos"
          lede="Variant-specific films first, then the curated set for the generation. Every player is an embed that loads on click."
        />
      ) : null}

      {/* ---- (f) compare with ---- */}
      <CompareWidget
        generation={{ id: gen.id, code: gen.code }}
        variant={v}
        variantKey={variantKey}
        siblings={siblings}
        accent={gen.accent}
        headingId="variant-compare"
      />

      {/* ---- sources + data gaps ---- */}
      {v.sources && v.sources.length > 0 ? (
        <section aria-labelledby="variant-sources" className="px-[--gutter] py-[--space-12]">
          <div className="mx-auto w-full max-w-[--maxw]">
            <h2 id="variant-sources" className="label">
              Sources ({v.sources.length})
            </h2>
            <ol className="mt-[--space-4] flex flex-col gap-[--space-2]">
              {v.sources.map((source) => (
                <li
                  key={source.url}
                  className="font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-500"
                >
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline decoration-ink-4 underline-offset-4 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                  >
                    {source.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      <DataNotes notes={v.missing} heading="What the sources do not settle" accent={gen.accent} />

      {/* ---- (g) credits ---- */}
      <CreditsStrip
        rows={creditRows}
        attribution={attribution}
        headingId="variant-credits"
        accent={gen.accent}
      />

      {/* ---- close: keep the catalogue walkable ---- */}
      <nav
        aria-label={`More from the ${gen.code}`}
        className="border-t border-ink-4 px-[--gutter] py-[--space-12]"
      >
        <div className="mx-auto flex w-full max-w-[--maxw] flex-col gap-[--space-6]">
          <p className="label flex flex-wrap items-center gap-x-[--space-3]">
            <span
              aria-hidden="true"
              className="inline-block h-px w-8"
              style={{ backgroundColor: gen.accent }}
            />
            More from the {gen.code} ·{" "}
            <Link
              href={`/911/${gen.id}`}
              className="rounded-[--radius-sm] text-metal-100 underline decoration-ink-4 underline-offset-4 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
            >
              all {gen.variants.length} variants
            </Link>
          </p>
          <ul className="flex flex-wrap gap-[--space-3]">
            {siblings.map((sibling) => (
              <li key={sibling.key}>
                <Link
                  href={sibling.href}
                  className="inline-flex items-center gap-[--space-2] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                >
                  {sibling.variant.name}
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/#timeline"
                className="inline-flex items-center gap-[--space-2] rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                Back to the timeline
              </Link>
            </li>
          </ul>
          <p className="label">
            {years} · {v.bodyStyles.length > 0 ? bodyStyleList(v.bodyStyles) : "body style not recorded"}
          </p>
        </div>
      </nav>
    </article>
  );
}