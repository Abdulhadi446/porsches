import type { Metadata } from "next";
import Link from "next/link";
import { GENERATIONS } from "#lib/generations";

/** 404 inside `/911` — offers the nine known generations instead of a dead end. */
export const metadata: Metadata = { title: "Nothing here" };

export default function GenerationIndexNotFound() {
  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto w-full max-w-[--maxw]">
        <p className="label">404</p>
        <h1 className="text-display-2 mt-[--space-4] max-w-[18ch] text-metal-100">
          That page isn&apos;t in the catalogue
        </h1>
        <p className="mt-[--space-6] max-w-[--maxw-prose] text-body-2 text-metal-500">
          The nine generations we do have are all listed below. Every one of them
          pre-rendered at build time, so this is a real 404 rather than a slow lookup.
        </p>
        <ul className="mt-[--space-8] grid grid-cols-2 gap-px border border-ink-4 bg-ink-4 sm:grid-cols-3 lg:grid-cols-5">
          {GENERATIONS.map((generation) => (
            <li key={generation.id}>
              <Link
                href={`/911/${generation.id}`}
                className="flex h-full flex-col gap-1 bg-ink-2 p-[--space-4] transition-colors hover:bg-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                <span className="font-display text-display-3 leading-none tracking-[--tracking-display] text-metal-100">
                  {generation.code}
                </span>
                <span className="label">
                  {generation.yearsStart}–{generation.yearsEnd ?? "today"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}