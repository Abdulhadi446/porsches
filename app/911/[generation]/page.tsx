import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GENERATIONS, getGeneration } from "#lib/generations";

export function generateStaticParams() {
  return GENERATIONS.map((g) => ({ generation: g.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ generation: string }>;
}): Promise<Metadata> {
  const { generation } = await params;
  const gen = getGeneration(generation);
  return { title: gen ? `${gen.code} — ${gen.name}` : "Generation" };
}

/** STUB — owned by VARIANT-PAGES subagent. */
export default async function GenerationPage({
  params,
}: {
  params: Promise<{ generation: string }>;
}) {
  const { generation } = await params;
  const gen = getGeneration(generation);
  if (!gen) notFound();

  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto max-w-[--maxw]">
        <p className="label mb-4">
          {gen.yearsStart}–{gen.yearsEnd ?? "today"}
        </p>
        <h1 className="text-display-2 mb-8">{gen.code}</h1>
        <p className="mb-12 max-w-[--maxw-prose] text-metal-500">
          {gen.description || "Generation overview — content pending."}
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {gen.variants.map((v) => (
            <li key={v.id}>
              <Link
                href={`/911/${gen.id}/${v.id}`}
                className="block border border-ink-4 bg-ink-2 p-6 transition-colors hover:border-guards"
              >
                <span className="font-display text-xl">{v.name}</span>
                <span className="mt-1 block font-mono text-mono-xs text-metal-500">
                  {v.years}
                </span>
              </Link>
            </li>
          ))}
          {gen.variants.length === 0 && (
            <li className="label">Variants pending data agents.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
