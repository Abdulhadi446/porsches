"use client";

import { usePathname } from "next/navigation";

/**
 * Route transition veil.
 *
 * CSS-only on purpose: this island used framer-motion, which put a 146 kB
 * animation library into the initial bundle of EVERY route for a 0.4 s fade.
 * The exit half cannot run in the App Router anyway (the outgoing tree is gone
 * by the time it would play), so we keep the enter half and add a short
 * scroll-progress bar that costs nothing.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-[page-in_var(--dur-base)_var(--ease-out-expo)]">
      {children}
    </div>
  );
}
