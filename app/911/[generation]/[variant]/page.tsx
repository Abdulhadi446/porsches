import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GENERATIONS, getVariant } from "#lib/generations";
import { getImage, getModel, getVideos } from "#lib/assets";

export function generateStaticParams() {
  return GENERATIONS.flatMap((g) =>
    g.variants.map((v) => ({ generation: g.id, variant: v.id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ generation: string; variant: string }>;
}): Promise<Metadata> {
  const { generation, variant } = await params;
  const hit = getVariant(generation, variant);
  return {
    title: hit ? hit.variant.name : "Variant",
    description: hit?.variant.description,
  };
}

/** STUB — owned by VARIANT-PAGES subagent. */
export default async function VariantPage({
  params,
}: {
  params: Promise<{ generation: string; variant: string }>;
}) {
  const { generation, variant } = await params;
  const hit = getVariant(generation, variant);
  if (!hit) notFound();
  const { generation: gen, variant: v } = hit;
  const hero = getImage(v.heroImage, { alt: v.name });
  const model = getModel(v.model3d);
  const videos = getVideos(v.videos);

  const specs = [
    ["Years", v.years],
    ["Engine", v.engine],
    ["Power", v.power],
    ["0–100 km/h", v.acceleration ?? "—"],
    ["Top speed", v.topSpeed ?? "—"],
    ["Drivetrain", v.drivetrain ?? "—"],
    ["Transmission", v.transmission ?? "—"],
    ["Weight", v.weight ?? "—"],
  ] as const;

  return (
    <article data-owner="variant-pages">
      <section className="relative flex h-[80svh] items-end overflow-hidden px-[--gutter] pb-[--gutter]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hero.src}
          alt={hero.alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
        <div className="relative z-content">
          <p className="label mb-3">
            <Link href={`/911/${gen.id}`} className="hover:text-guards">
              {gen.code}
            </Link>{" "}
            / {v.years}
          </p>
          <h1 className="text-display-2">{v.name}</h1>
        </div>
      </section>

      <section className="px-[--gutter] py-[--space-24]">
        <div className="mx-auto grid max-w-[--maxw] gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="mb-6 max-w-[--maxw-prose] leading-relaxed text-metal-300">
              {v.description}
            </p>
            {model.kind === "embed" && model.embedUrl && (
              <div className="aspect-video w-full border border-ink-4">
                <iframe
                  title={`${v.name} 3D model`}
                  src={model.embedUrl}
                  className="h-full w-full"
                  allow="autoplay; fullscreen; xr-spatial-tracking"
                  loading="lazy"
                />
              </div>
            )}
          </div>
          <dl className="spec-grid lg:col-span-5">
            {specs.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between border-b border-ink-4 py-3"
              >
                <dt className="text-metal-500">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {videos.length > 0 && (
        <section className="px-[--gutter] pb-[--space-24]">
          <div className="mx-auto grid max-w-[--maxw] gap-6 md:grid-cols-2">
            {videos.map((video) => (
              <div key={video.id} className="aspect-video border border-ink-4">
                <iframe
                  title={video.title}
                  src={video.embedUrl}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
