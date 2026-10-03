"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavUiProvider, useNavUi } from "./command-palette";
import { CustomCursor } from "./cursor";
import {
  useFocusTrap,
  useMediaQuery,
  usePrefersReducedMotion,
  useScrollLock,
} from "./use-nav";

/**
 * MEGA-NAV — owned by NAV-UX. The client half of `SiteNav`.
 *
 * Fixed glass bar at `--z-nav + 10` (one step above the pinned timeline rail,
 * which also sits at `--z-nav`), auto-hiding on scroll-down and returning on
 * scroll-up, with a mega-panel of the nine generations and a full-screen
 * sheet on small screens. It is `position: fixed`, so it can never contribute
 * to CLS, and it publishes `--nav-h` for the pages that need to clear it.
 */

export interface NavGeneration {
  id: string;
  code: string;
  name: string;
  years: string;
  accent: string;
  tagline: string;
  variantCount: number;
  yearStart: number;
}

export const NAV_HEIGHT = 64;

const QUICK_LINKS = [
  { href: "/variants", label: "All variants", note: "Filterable grid of every 911" },
  { href: "/compare", label: "Compare", note: "Spec-by-spec diff, two or four" },
  { href: "/search", label: "Search", note: "Faceted search with shareable URLs" },
  { href: "/credits", label: "Credits", note: "Every image, model and licence" },
] as const;

/** Pixels of downward travel before the bar hides. */
const HIDE_AFTER = 96;
const HIDE_DELTA = 6;

export function NavChrome({ generations }: { generations: NavGeneration[] }) {
  const pathname = usePathname() ?? "/";
  const reduced = usePrefersReducedMotion();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { paletteOpen, openPalette } = useNavUi();
  const [panel, setPanel] = useState<"none" | "mega" | "sheet">("none");
  const [hidden, setHidden] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const megaRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const megaTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const megaId = useId();

  const livePanel = isDesktop && panel === "sheet" ? "none" : panel;
  const sheetOpen = livePanel === "sheet";

  useFocusTrap(sheetOpen, sheetRef, { initialFocus: closeButtonRef });
  useScrollLock(sheetOpen);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nav-h", `${NAV_HEIGHT}px`);
  }, []);

  useEffect(() => {
    if (livePanel === "none") return;
    const wasSheet = livePanel === "sheet";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPanel("none");
      (wasSheet ? sheetTriggerRef.current : megaTriggerRef.current)?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (wasSheet) return;
      const target = event.target as Node | null;
      if (target && headerRef.current?.contains(target)) return;
      setPanel("none");
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [livePanel]);

  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const delta = y - last;
        if (y < HIDE_AFTER) {
          setHidden(false);
          last = y;
          return;
        }
        if (Math.abs(delta) < HIDE_DELTA) return;
        if (delta > 0 && livePanel === "none" && !paletteOpen) {
          setHidden(true);
        } else if (delta < 0) {
          setHidden(false);
        }
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [livePanel, paletteOpen]);

  const closePanel = useCallback(() => setPanel("none"), []);
  const isActive = useCallback(
    (href: string) => {
      if (href === "/") return pathname === "/";
      return pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname],
  );

  const barOffset = hidden && livePanel === "none" ? "-100%" : "0%";

  return (
    <NavUiProvider>
      <a
        href="#main"
        className="sr-only rounded-[--radius-sm] border border-guards bg-ink-2 px-[--space-4] py-[--space-2] font-mono text-mono-sm text-metal-100 focus:not-sr-only focus:fixed focus:left-[--space-4] focus:top-[--space-4] focus:z-[calc(var(--z-nav)+20)]"
      >
        Skip to content
      </a>

      <header
        ref={headerRef}
        data-owner="nav-ux"
        data-hidden={hidden && livePanel === "none" ? "" : undefined}
        style={{ transform: `translateY(${barOffset})` }}
        className="fixed inset-x-0 top-0 z-[calc(var(--z-nav)+10)] border-b border-ink-4/70 bg-ink/72 backdrop-blur-xl transition-transform duration-[--dur-base] ease-[--ease-out-expo] data-[hidden]:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]"
      >
        <div className="mx-auto flex h-16 max-w-[--maxw] items-center gap-[--space-3] px-[--gutter]">
          <Link
            href="/"
            aria-label="911 Showcase"
            aria-current={isActive("/") ? "page" : undefined}
            className="mr-auto shrink-0 font-display text-lg uppercase tracking-[--tracking-label] transition-colors hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-guards"
          >
            911<span className="text-guards-text">.</span>SHOWCASE
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-[--space-1]">
            <button
              ref={megaTriggerRef}
              type="button"
              onClick={() =>
                setPanel((value) => (value === "mega" ? "none" : "mega"))
              }
              aria-expanded={livePanel === "mega"}
              aria-controls={`${megaId}-panel`}
              className="hidden items-center gap-[--space-2] rounded-[--radius-sm] px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-300 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards lg:inline-flex"
            >
              Generations
              <span
                aria-hidden="true"
                className={`text-[0.6rem] transition-transform duration-[--dur-fast] ${
                  livePanel === "mega" ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>

            {QUICK_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`hidden rounded-[--radius-sm] px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards lg:inline-flex ${
                  isActive(link.href) ? "text-guards-text" : "text-metal-500 hover:text-metal-100"
                }`}
              >
                {link.label}
              </Link>
            ))}

            <button
              type="button"
              onClick={() => openPalette()}
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              aria-label="Search all generations and variants (command palette)"
              className="inline-flex items-center gap-[--space-2] rounded-[--radius-pill] border border-ink-4 min-h-11 px-[--space-4] py-[--space-3] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-500 transition-colors hover:border-guards hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
            >
              <span aria-hidden="true">⌕</span>
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded-[--radius-sm] border border-ink-4 px-1 text-[0.625rem] text-metal-700 md:inline">
                ⌘K
              </kbd>
            </button>

            <button
              ref={sheetTriggerRef}
              type="button"
              onClick={() => setPanel((value) => (value === "sheet" ? "none" : "sheet"))}
              aria-label={sheetOpen ? "Close menu" : "Open menu"}
              aria-expanded={sheetOpen}
              aria-controls={`${megaId}-sheet`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-[--radius-sm] border border-ink-4 font-mono text-mono-sm text-metal-300 transition-colors hover:border-guards hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards lg:hidden"
            >
              <span className="sr-only">{sheetOpen ? "Close menu" : "Open menu"}</span>
              <span aria-hidden="true">{sheetOpen ? "✕" : "☰"}</span>
            </button>
          </nav>
        </div>

        <AnimatePresence initial={false}>
          {livePanel === "mega" && (
            <motion.div
              key="mega"
              id={`${megaId}-panel`}
              ref={megaRef}
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="hidden overflow-hidden border-t border-ink-4/70 bg-ink/95 backdrop-blur-xl lg:block"
            >
              <div className="mx-auto max-w-[--maxw] px-[--gutter] py-[--space-8]">
                <div className="grid gap-[--space-8] lg:grid-cols-[1fr_20rem]">
                  <div>
                    <p className="label mb-[--space-4]">
                      Nine generations · 1963 → today
                    </p>
                    <ul className="grid gap-[--space-2] sm:grid-cols-2 xl:grid-cols-3">
                      {generations.map((generation) => {
                        const active = pathname === `/911/${generation.id}`;
                        return (
                          <li key={generation.id}>
                            <Link
                              href={`/911/${generation.id}`}
                              aria-current={active ? "page" : undefined}
                              onClick={closePanel}
                              className={`group flex h-full flex-col gap-1 border bg-ink-2/70 p-[--space-4] transition-colors hover:border-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${
                                active ? "border-guards" : "border-ink-4"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className="mb-[--space-2] block h-0.5 w-10"
                                style={{ backgroundColor: generation.accent }}
                              />
                              <span className="flex items-baseline gap-[--space-3]">
                                <span className="font-display text-2xl leading-none">
                                  {generation.code}
                                </span>
                                <span className="font-mono text-mono-xs text-metal-500">
                                  {generation.years}
                                </span>
                              </span>
                              <span className="text-mono-sm text-metal-300">
                                {generation.name}
                              </span>
                              <span className="mt-auto pt-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700">
                                {generation.variantCount} variants
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-[--space-2]">
                    <p className="label">Jump to</p>
                    {QUICK_LINKS.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closePanel}
                        aria-current={isActive(link.href) ? "page" : undefined}
                        className="flex flex-col border-l-2 border-ink-4 py-[--space-1] pl-[--space-3] transition-colors hover:border-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
                      >
                        <span className="font-mono text-mono-sm text-metal-100">
                          {link.label}
                        </span>
                        <span className="text-mono-xs text-metal-500">{link.note}</span>
                      </Link>
                    ))}
                    <p className="mt-[--space-2] font-mono text-mono-xs leading-relaxed text-metal-700">
                      Unofficial fan project. Not affiliated with, nor endorsed by,
                      Dr. Ing. h.c. F. Porsche AG.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            key="sheet"
            id={`${megaId}-sheet`}
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            initial={reduced ? false : { opacity: 0, y: "-2%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: "-2%" }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-overlay overflow-y-auto overscroll-contain bg-ink/97 pt-[calc(var(--nav-h,64px)+var(--space-6))] backdrop-blur-xl lg:hidden"
          >
            <div className="px-[--gutter] pb-[--space-16]">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  setPanel("none");
                  sheetTriggerRef.current?.focus();
                }}
                className="mb-[--space-6] inline-flex items-center gap-[--space-2] rounded-[--radius-sm] border border-ink-4 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-label] text-metal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                <span aria-hidden="true">✕</span> Close
              </button>

              <button
                type="button"
                onClick={() => {
                  setPanel("none");
                  openPalette();
                }}
                className="mb-[--space-8] flex w-full items-center gap-[--space-3] border border-ink-4 bg-ink-2 px-[--space-4] py-[--space-4] text-left font-mono text-mono-sm text-metal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                <span aria-hidden="true">⌕</span>
                Search every variant
                <span className="ml-auto text-mono-xs text-metal-700">⌘K</span>
              </button>

              <p className="label mb-[--space-3]">Generations</p>
              <ul className="mb-[--space-8] flex flex-col">
                {generations.map((generation) => {
                  const active = pathname === `/911/${generation.id}`;
                  return (
                    <li key={generation.id} className="border-b border-ink-4">
                      <Link
                        href={`/911/${generation.id}`}
                        onClick={closePanel}
                        aria-current={active ? "page" : undefined}
                        className="flex items-center gap-[--space-3] py-[--space-4] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-guards"
                      >
                        <span
                          aria-hidden="true"
                          className="h-8 w-0.5"
                          style={{ backgroundColor: generation.accent }}
                        />
                        <span className="font-display text-xl leading-none">
                          {generation.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-mono-sm text-metal-300">
                            {generation.name}
                          </span>
                          <span className="block font-mono text-mono-xs text-metal-700">
                            {generation.years} · {generation.variantCount} variants
                          </span>
                        </span>
                        {active && <span className="label text-guards-text">Current</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <p className="label mb-[--space-3]">Go to</p>
              <ul className="flex flex-col">
                {QUICK_LINKS.map((link) => (
                  <li key={link.href} className="border-b border-ink-4">
                    <Link
                      href={link.href}
                      onClick={closePanel}
                      aria-current={isActive(link.href) ? "page" : undefined}
                      className="flex items-center justify-between py-[--space-4] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-guards"
                    >
                      <span className="font-display text-lg uppercase">{link.label}</span>
                      <span aria-hidden="true" className="text-metal-700">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <p className="mt-[--space-8] font-mono text-mono-xs leading-relaxed text-metal-700">
                Unofficial fan project — not affiliated with or endorsed by
                Dr. Ing. h.c. F. Porsche AG.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CustomCursor />
    </NavUiProvider>
  );
}
