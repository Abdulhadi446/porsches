import type { Metadata } from "next";
import creditsData from "#data/credits.json";
import type { CreditsFile } from "#data/schema";

export const metadata: Metadata = {
  title: "Credits & licenses",
  description:
    "Every image, model and video used in this unofficial 911 showcase, with author and license.",
};

const data = creditsData as CreditsFile;

export default function CreditsPage() {
  const credits = data.credits ?? [];
  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto w-full min-w-0 max-w-[--maxw]">
        <p className="label mb-4">Auto-generated from /data/credits.json</p>
        <h1 className="text-display-2 mb-8">
          Credits <span className="text-guards-text">&amp;</span> licenses
        </h1>
        <p className="mb-12 max-w-[--maxw-prose] text-metal-500">
          This is an unofficial fan project. All media below is used under the
          license listed. Nothing is hotlinked from third-party sites except
          YouTube embeds, which remain hosted by YouTube.
        </p>

        {credits.length === 0 ? (
          <p className="label">No credits recorded yet (asset agents pending).</p>
        ) : (
          <ul className="min-w-0 divide-y divide-ink-4 border-y border-ink-4">
            {credits.map((c) => (
              <li key={c.assetId} className="grid min-w-0 gap-2 py-5 md:grid-cols-12">
                <span className="font-mono text-mono-xs text-metal-500 md:col-span-2">
                  {c.kind}
                </span>
                <span className="md:col-span-3">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-guards-text"
                  >
                    {c.sourceId ?? c.assetId}
                  </a>
                </span>
                <span className="md:col-span-3">{c.author ?? "unknown"}</span>
                <span className="font-mono text-mono-xs md:col-span-3">
                  {c.license ?? "unknown license"}
                </span>
                <span className="font-mono text-mono-xs text-metal-700 md:col-span-1">
                  {c.retrieved}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
