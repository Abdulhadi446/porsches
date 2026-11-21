import type { Metadata } from "next";
import Link from "next/link";
import creditsData from "#data/credits.json";
import turntableCreditsData from "#data/turntable-credits.json";
import turntableRoutesJson from "#data/generations/turntable-routes.json";
import type {
  Credit,
  CreditsFile,
  TurntableCredit,
  TurntableCreditsFile,
} from "#data/schema";

export const metadata: Metadata = {
  title: "Credits & licences",
  description:
    "Every image, model, video and turntable frame used in this unofficial 911 showcase, with author and license.",
};

const data = creditsData as CreditsFile;
const turntableData = turntableCreditsData as TurntableCreditsFile;

const credits = (data.credits ?? []).slice().sort((a, b) =>
  a.assetId.localeCompare(b.assetId),
);

const turntableCredits = (turntableData.credits ?? [])
  .slice()
  .sort((a, b) => a.localPath.localeCompare(b.localPath));

/**
 * Licence label → the licence text. Only the strings actually present in the
 * data get a link (see the resolver); anything else renders as plain text and
 * is reported by `unknownLicenses()` rather than guessed at.
 */
const LICENCE_URLS: Record<string, string> = {
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC0 1.0 (public domain dedication)": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
  "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
  "CC BY-SA 2.0 DE": "https://creativecommons.org/licenses/by-sa/2.0/de/",
  "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

/** `null` when a licence string has no entry in LICENCE_URLS — reported, never guessed. */
function licenceHref(license: string | null | undefined): string | null {
  if (!license) return null;
  return LICENCE_URLS[license] ?? null;
}

function LicenceText({ license }: { license: string | null | undefined }) {
  if (!license) return <>unknown license</>;
  const href = licenceHref(license);
  if (!href) return <>{license}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-guards-text"
    >
      {license}
    </a>
  );
}

/**
 * The generation data is read from disk at module scope — this page is a
 * server component and the route is prerendered, so the read happens once at
 * build time and ships nothing to the client. It maps a sequence directory to
 * the variant (or generation) page that shows it, and carries the authoritative
 * `turntableSynthetic` flag.
 *
 * For vinext/Cloudflare Workers compatibility, we precompute turntable routes
 * at build time and import them statically.
 */
interface TurntableRoute {
  href: string;
  label: string;
  synthetic: boolean;
}

const turntableRoutesMap = new Map(
  turntableRoutesJson.map((entry) => [entry.key, {
    href: entry.href,
    label: entry.label,
    synthetic: entry.synthetic,
  }])
);

function getTurntableRoutes(): Map<string, TurntableRoute> {
  return turntableRoutesMap;
}

const turntableRoutes = getTurntableRoutes();

/** Licence strings present in the turntable data with no resolver entry. */
function unknownLicenses(): string[] {
  const seen = new Set<string>();
  for (const record of turntableCredits) {
    if (!licenceHref(record.license)) seen.add(record.license);
  }
  return [...seen].sort();
}

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

function TurntableRow({ record }: { record: TurntableCredit }) {
  const route = turntableRoutes.get(record.localPath);
  const synthetic = route?.synthetic ?? /synthetic/i.test(record.note);
  return (
    <li className="grid min-w-0 gap-2 py-5 md:grid-cols-12">
      <span className="font-mono text-mono-xs text-metal-500 md:col-span-2">
        turntable
      </span>
      <span className="min-w-0 break-words md:col-span-3">
        <a
          href={record.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-guards-text"
        >
          {record.sourceId}
        </a>
      </span>
      <span className="min-w-0 break-words md:col-span-2">
        {record.author}
      </span>
      <span className="min-w-0 break-words font-mono text-mono-xs md:col-span-2">
        <LicenceText license={record.license} />
      </span>
      <span className="min-w-0 break-words font-mono text-mono-xs md:col-span-2">
        {route ? (
          <Link href={route.href} className="hover:text-guards-text">
            {route.label}
          </Link>
        ) : (
          <span className="text-metal-700">no page on file</span>
        )}
      </span>
      <span className="font-mono text-mono-xs text-metal-700 md:col-span-1">
        {record.retrieved}
      </span>
      {synthetic ? (
        <p className="min-w-0 break-words font-mono text-mono-xs leading-relaxed text-metal-700 md:col-span-12">
          Parallax pan of a single photograph — no multi-angle 360° sequence
          exists under a free licence.
        </p>
      ) : null}
    </li>
  );
}

/**
 * Auto-generated from /data/credits.json and /data/turntable-credits.json.
 *
 * Paginated on purpose: rendering all 1 000+ rows produced a 2.2 MB HTML
 * document and 4.2 s of total blocking time — by far the worst route on the
 * site. 60 rows per page keeps the document around 130 kB, and the whole
 * licence set is still reachable and linkable.
 *
 * The turntable section below is NOT paginated: it is 210 rows of Commons
 * attribution required by CC BY / CC BY-SA, so it ships in full on every page.
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

  const totalRecords = credits.length + turntableCredits.length;
  const unlicensed = unknownLicenses();
  const syntheticCount = turntableCredits.filter(
    (record) => turntableRoutes.get(record.localPath)?.synthetic ?? /synthetic/i.test(record.note),
  ).length;

  return (
    <div className="px-[--gutter] pb-[--space-32] pt-[--space-32]">
      <div className="mx-auto w-full min-w-0 max-w-[--maxw]">
        <p className="label mb-4">
          Auto-generated from /data/credits.json and /data/turntable-credits.json
        </p>
        <h1 className="text-display-2 mb-8">
          Credits <span className="text-guards-text">&amp;</span> licenses
        </h1>
        <p className="mb-6 max-w-[--maxw-prose] break-words text-metal-500">
          This is an unofficial fan project. All media below is used under the
          license listed. Nothing is hotlinked from third-party sites except
          YouTube embeds, which remain hosted by YouTube.
        </p>
        <p className="label mb-10 break-words">
          {totalRecords} records · {credits.length} assets +{" "}
          {turntableCredits.length} turntable frames · page {page} of {pages}
        </p>

        <section aria-labelledby="assets-heading" className="mb-[--space-24]">
          <h2 id="assets-heading" className="text-display-3 mb-6">
            Images, models &amp; videos
          </h2>
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
                    <LicenceText license={c.license} />
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
        </section>

        <section aria-labelledby="turntable-heading">
          <h2 id="turntable-heading" className="text-display-3 mb-6">
            Turntable frames
          </h2>
          <p className="mb-6 max-w-[--maxw-prose] break-words text-metal-500">
            Each record is the Commons photograph a turntable sequence was
            rendered from. Where a car has no free-licensed multi-angle
            photography the sequence is a parallax pan of that single
            photograph, not a real 360° orbit — {syntheticCount} of{" "}
            {turntableCredits.length} records are flagged that way in the data
            and labelled in the viewer.
          </p>
          <p className="label mb-4 break-words">
            Licenses re-verified {turntableData.verifiedAt.slice(0, 10)} ·{" "}
            {turntableData.alreadyCorrect} confirmed · {turntableData.corrected}{" "}
            corrected · {turntableData.unusable} sources dropped for an
            unverifiable license
          </p>
          {unlicensed.length > 0 ? (
            <p className="mb-4 break-words font-mono text-mono-xs text-guards-text">
              Licence strings with no resolver entry (reported, not guessed):{" "}
              {unlicensed.join(", ")}
            </p>
          ) : null}
          <ul className="min-w-0 divide-y divide-ink-4 border-y border-ink-4">
            {turntableCredits.map((record) => (
              <TurntableRow key={record.assetId} record={record} />
            ))}
          </ul>
          <p className="mt-[--space-6] max-w-[--maxw-prose] break-words font-mono text-mono-xs leading-relaxed text-metal-700">
            {turntableData.note}
          </p>
        </section>
      </div>
    </div>
  );
}
