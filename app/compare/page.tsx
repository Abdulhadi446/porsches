import type { Metadata } from "next";
import Link from "next/link";
import {
  COMPARE_SLOT_KEYS,
  firstParam,
  resolveSlot,
  VARIANT_BY_KEY,
} from "#components/nav/catalog";
import { CompareTable } from "#components/nav/compare-table";
import { LoadingScreen } from "#components/nav/loading-screen";

/**
 * /compare — owned by NAV-UX.
 *
 * Server-rendered shell: the `?a=<genId>/<variantId>&b=…` params are resolved
 * on the server (so a shared link arrives fully populated), and the client
 * island takes over from there. Missing or unresolvable params simply leave
 * the slot empty — the page never 404s and never throws.
 */

export const metadata: Metadata = {
  title: "Compare two 911s",
  description:
    "Side-by-side specification comparison of any two (or four) Porsche 911 variants, from the 1963 901 to the 992.2 T-Hybrid.",
};

type CompareSearch = Record<string, string | string[] | undefined>;

const SUGGESTED: Array<{ a: string; b: string; note: string }> = [
  {
    a: "901/911-2.0",
    b: "992-2/turbo-s",
    note: "Sixty years of flat-six, 130 PS → 700 PS turbo hybrid",
  },
  {
    a: "964/turbo-3.6",
    b: "993/turbo",
    note: "Last of the big air-cooled turbos vs the last air-cooled 911",
  },
  {
    a: "996/gt3",
    b: "997/gt3-rs-4.0",
    note: "Where the modern GT3 lineage starts",
  },
  {
    a: "gseries/carrera-rs-3.0",
    b: "991/gt2-rs",
    note: "The two ends of the rear-engined competition car",
  },
];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<CompareSearch>;
}) {
  const params = await searchParams;
  const slots = COMPARE_SLOT_KEYS.map((key) =>
    resolveSlot(key, firstParam(params[key])),
  );
  const prefilled = slots.some((slot) => slot.variant);

  return (
    <div className="px-[--gutter] pt-[calc(var(--nav-h,64px)+var(--space-12))] pb-[--space-24]">
      <LoadingScreen caption="Side by side" />
      <div className="mx-auto max-w-[--maxw]">
        <header className="mb-[--space-8] max-w-[--maxw-prose]">
          <p className="label mb-[--space-2]">Compare</p>
          <h1 className="text-display-2 mb-[--space-4]">
            Two 911s, <span className="text-guards">spec for spec</span>
          </h1>
          <p className="text-metal-500">
            Every figure below comes from the dataset — the same numbers the
            variant pages cite. Pick two cars (or four), and the shareable link
            in your address bar always reproduces exactly what you see.
          </p>
        </header>

        <CompareTable initialSlots={slots} />

        {!prefilled && (
          <section aria-labelledby="suggested-heading" className="mt-[--space-16]">
            <h2 id="suggested-heading" className="text-display-3 mb-[--space-6]">
              Start with a classic pair
            </h2>
            <ul className="grid gap-[--space-3] md:grid-cols-2">
              {SUGGESTED.map((pair) => (
                <li key={`${pair.a}-${pair.b}`}>
                  <Link
                    href={`/compare?a=${pair.a}&b=${pair.b}`}
                    className="block border border-ink-4 bg-ink-2 p-[--space-5] transition-colors hover:border-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                  >
                    <span className="block font-display text-lg uppercase">
                      {labelOf(pair.a)} vs {labelOf(pair.b)}
                    </span>
                    <span className="mt-[--space-2] block text-mono-sm text-metal-500">
                      {pair.note}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function labelOf(key: string): string {
  return VARIANT_BY_KEY.get(key)?.name ?? key;
}
