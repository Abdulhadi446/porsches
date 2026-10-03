import type { Metadata } from "next";
import Link from "next/link";
import creditsData from "#data/credits.json";
import type { Credit, CreditsFile } from "#data/schema";

export const metadata: Metadata = {
  title: "Credits & licences",
  description:
    "Every image, model and video used in this unofficial 911 showcase, with author and license.",
};

const data = creditsData as CreditsFile;
const credits = (data.credits ?? []).slice().sort((a, b) =>
  a.assetId.localeCompare(b.assetId),
);

const PAGE_SIZE = 60;
const pages = Math.max(1, Math.ceil(credits.length / PAGE_SIZE));

function rowsFor(page: number): Credit[] {
  const start = (page - 1) * PAGE_SIZE;
  return credits.slice(start, start + PAGE_SIZE);
}

function PageLink({
  href,
  children,
  current,
}: {
  href: string;
  children: React.ReactNode;
  current?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-11 items-center border border-ink-4 px-[--space-4] font-mono text-mono-xs uppercase tracking-[--tracking-mono] transition-colors hover:border-guards hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
        current ? "border-guards text-metal-100" : "text-metal-500"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Auto-generated from /data/credits.json.
 *
 * Paginated on purpose: rendering all 1 000+ rows produced a 2.2 MB HTML
 * document and 4.2 s of total blocking time — by far the worst route on the
 * site. 60 rows per page keeps the document around 130 kB, and the whole
 * licence set is still reachable and linkable.
 */
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const raw = (await searchParams)?.page;
  const requested = Number.parseInt(Array.isArray(raw) ? raw[0] ?? "1" : raw ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const rows = rowsFor(page);
  const href = (p: number) => (p === 1 ? "/credits" : `/credits?page=${p}`);

  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto w-full min-w-0 max-w-[--maxw]">
        <p className="label mb-4">Auto-generated from /data/credits.json</p>
        <h1 className="text-display-2 mb-8">
          Credits <span className="text-guards-text">&amp;</span> licenses
        </h1>
        <p className="mb-6 max-w-[--maxw-prose] break-words text-metal-500">
          This is an unofficial fan project. All media below is used under the
          license listed. Nothing is hotlinked from third-party sites except
          YouTube embeds, which remain hosted by YouTube.
        </p>
        <p className="label mb-10 break-words">
          {credits.length} assets · page {page} of {pages}
        </p>

        {credits.length === 0 ? (
          <p className="label">No credits recorded yet (asset agents pending).</p>
        ) : (
          <ul className="min-w-0 divide-y divide-ink-4 border-y border-ink-4">
            {rows.map((c) => (
              <li
                key={c.assetId}
                className="grid min-w-0 gap-2 py-5 md:grid-cols-12"
              >
                <span className="font-mono text-mono-xs text-metal-500 md:col-span-2">
                  {c.kind}
                </span>
                <span className="min-w-0 break-words md:col-span-3">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-guards-text"
                  >
                    {c.sourceId ?? c.assetId}
                  </a>
                </span>
                <span className="min-w-0 break-words md:col-span-3">
                  {c.author ?? "unknown"}
                </span>
                <span className="min-w-0 break-words font-mono text-mono-xs md:col-span-3">
                  {c.license ?? "unknown license"}
                </span>
                <span className="font-mono text-mono-xs text-metal-700 md:col-span-1">
                  {c.retrieved}
                </span>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav
            aria-label="Credits pages"
            className="mt-[--space-12] flex flex-wrap gap-[--space-2]"
          >
            {page > 1 && (
              <PageLink href={href(page - 1)}>
                ← Previous
              </PageLink>
            )}
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === pages ||
                  Math.abs(p - page) <= 2,
              )
              .map((p, index, list) => (
                <span key={p} className="contents">
                  {index > 0 && list[index - 1] !== p - 1 && (
                    <span className="inline-flex min-h-11 items-center px-[--space-2] text-metal-700">
                      …
                    </span>
                  )}
                  <PageLink href={href(p)} current={p === page}>
                    {p}
                  </PageLink>
                </span>
              ))}
            {page < pages && (
              <PageLink href={href(page + 1)}>
                Next →
              </PageLink>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}