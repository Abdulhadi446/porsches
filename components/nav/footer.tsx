import Link from "next/link";
import { GENERATIONS } from "#lib/generations";

/**
 * FOOTER — owned by NAV-UX.
 *
 * Server component. Carries the non-commercial fan-project disclaimer that the
 * site must show on every page, the per-generation links, and the credits /
 * compare entry points.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      data-owner="nav-ux"
      className="relative z-content mt-(--space-24) border-t border-ink-4 bg-ink-2/60 px-(--gutter) pt-(--space-16) pb-(--space-12)"
    >
      <div className="mx-auto max-w-(--maxw)">
        <div className="grid gap-(--space-12) lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-display text-2xl uppercase tracking-(--tracking-label)">
              911<span className="text-guards-text">.</span>SHOWCASE
            </p>
            <p className="mt-(--space-3) max-w-(--maxw-prose) text-body-2 leading-relaxed text-metal-500">
              Six decades of the Porsche 911, from the 1963 901 to the 992.2
              T-Hybrid era — every generation, every variant, with real
              specifications and cited sources. Built as a tribute and an
              educational project.
            </p>
            <p className="label mt-(--space-6)">
              Nine generations · 1963 → today
            </p>
          </div>

          <nav aria-label="Generations">
            <p className="label mb-(--space-4)">Generations</p>
            <ul className="grid grid-cols-2 gap-x-(--space-4) gap-y-(--space-2)">
              {GENERATIONS.map((generation) => (
                <li key={generation.id}>
                  <Link
                    href={`/911/${generation.id}`}
                    className="group inline-flex min-h-6 items-center gap-(--space-2) font-mono text-mono-sm text-metal-500 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 translate-y-[-1px]"
                      style={{ backgroundColor: generation.accent }}
                    />
                    {generation.code}
                    <span className="text-mono-xs text-metal-700">
                      {generation.yearsStart}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Explore">
            <p className="label mb-(--space-4)">Explore</p>
            <ul className="flex flex-col gap-(--space-2)">
              {[
                { href: "/variants", label: "All variants" },
                { href: "/compare", label: "Compare two 911s" },
                { href: "/search", label: "Search" },
                { href: "/credits", label: "Credits & licences" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center font-mono text-mono-sm text-metal-500 transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-(--space-16) border-t border-ink-4 pt-(--space-8)">
          <p className="label mb-(--space-3)">Disclaimer</p>
          <div className="max-w-(--maxw-prose) space-y-(--space-3) text-mono-sm leading-relaxed text-metal-500">
            <p>
              This is an unofficial, non-commercial fan project. It is{" "}
              <strong className="font-medium text-metal-300">
                not affiliated with, sponsored by, or endorsed by
              </strong>{" "}
              Dr. Ing. h.c. F. Porsche AG. It was built as a tribute to the
              Porsche 911 and as an educational and technical writing exercise.
            </p>
            <p>
              Porsche, 911, Carrera, Targa, Turbo, GT3, Spyder and all related
              model names, badges, logos and trademarks are the property of
              Dr. Ing. h.c. F. Porsche AG. No rights are asserted, implied or
              granted by this site, and nothing here is for sale.
            </p>
            <p>
              All images, 3D models and videos are used under the licences
              recorded for each asset in{" "}
              <Link
                href="/credits"
                className="text-guards-text underline decoration-1 underline-offset-2 hover:decoration-2"
              >
                Credits &amp; licences
              </Link>
              . Specifications are compiled from the sources cited on each
              variant page; where a figure could not be verified it is shown as
              unavailable rather than estimated.
            </p>
          </div>
        </div>

        <div className="mt-(--space-8) flex flex-col gap-(--space-2) border-t border-ink-4 pt-(--space-6) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} · Unofficial fan showcase — no affiliation with Porsche AG
          </p>
          <p>Built as a tribute · 9 generations · 1963 → today</p>
        </div>
      </div>
    </footer>
  );
}
