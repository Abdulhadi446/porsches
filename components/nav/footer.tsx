import Link from "next/link";

/** STUB — owned by NAV-UX subagent. */
export function Footer() {
  return (
    <footer
      className="border-t border-ink-4 px-[--gutter] py-12 text-metal-500"
      data-owner="nav-ux"
    >
      <div className="mx-auto flex max-w-[--maxw] flex-col gap-6">
        <p className="label">Fan project — not affiliated with Porsche AG</p>
        <p className="max-w-[--maxw-prose] text-sm leading-relaxed">
          This is an unofficial, non-commercial fan showcase created for
          educational and tribute purposes. Porsche, 911, Carrera, Targa,
          Turbo, GT3 and all related model names, badges and trademarks are the
          property of Dr. Ing. h.c. F. Porsche AG. No endorsement is implied.
        </p>
        <div className="flex gap-6">
          <Link href="/credits" className="label hover:text-guards">
            Credits &amp; licenses
          </Link>
          <Link href="/compare" className="label hover:text-guards">
            Compare
          </Link>
        </div>
      </div>
    </footer>
  );
}
