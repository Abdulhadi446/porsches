import Link from "next/link";
import { GENERATIONS } from "#lib/generations";

/** STUB — owned by NAV-UX subagent; replace with the sticky mega-nav. */
export function SiteNav() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-nav flex items-center justify-between border-b border-ink-4/60 bg-ink/70 px-[--gutter] py-4 backdrop-blur"
      data-owner="nav-ux"
    >
      <Link href="/" className="font-display text-lg tracking-label uppercase">
        911<span className="text-guards">.</span>SHOWCASE
      </Link>
      <nav aria-label="Generations" className="hidden gap-4 md:flex">
        {GENERATIONS.map((g) => (
          <Link
            key={g.id}
            href={`/911/${g.id}`}
            className="label transition-colors hover:text-metal-100"
          >
            {g.code}
          </Link>
        ))}
      </nav>
      <Link href="/compare" className="label hover:text-guards">
        Compare
      </Link>
    </header>
  );
}
