"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useMounted } from "./use-nav";

/**
 * COMMAND PALETTE — owned by NAV-UX.
 *
 * ⌘K / Ctrl-K / "/" opens a modal combobox over a static index of the nine
 * generations and every variant. The catalogue is code-split and pulled in on
 * mount (`import("./catalog")`) so the generation JSON never lands in the
 * initial route bundle. No request is ever made.
 *
 * Semantics: `role="dialog" aria-modal` on the panel, a real combobox
 * (`aria-expanded` / `aria-controls` / `aria-activedescendant`) on the input,
 * a `role="listbox"` with `role="group"` sections, focus trapped while open
 * and restored to the trigger on close. The panel is mounted per open, so the
 * seeded query and the recent searches always start from a clean slate.
 *
 * This module owns only the context, the global shortcut and the launcher, so it
 * stays in the initial JS of every route. The dialog (and framer-motion with it)
 * lives in `command-palette-panel.tsx` and is fetched on demand, warmed during
 * idle time so the first ⌘K press still opens instantly.
 */

const OPEN_EVENT = "911-nav:open-palette";

/* ------------------------------------------------------------------ *
 * Provider + global shortcut
 * ------------------------------------------------------------------ */

export interface NavUiApi {
  paletteOpen: boolean;
  /** pre-fills the input when the palette is opened programmatically */
  paletteSeed: string;
  openPalette: (seed?: string) => void;
  closePalette: () => void;
  togglePalette: () => void;
}

const FALLBACK_API: NavUiApi = {
  paletteOpen: false,
  paletteSeed: "",
  openPalette: () => {},
  closePalette: () => {},
  togglePalette: () => {},
};

const NavUiContext = createContext<NavUiApi>(FALLBACK_API);

export function useNavUi(): NavUiApi {
  return useContext(NavUiContext);
}

/**
 * Imperative handle for server components that render a launcher button —
 * dispatches a DOM event the provider listens for, so no module-level mutable
 * state and no client boundary is required in the caller.
 */
export function openCommandPalette(seed = ""): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent<string>(OPEN_EVENT, { detail: seed }),
  );
}

export function NavUiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");

  const openPalette = useCallback((next = "") => {
    setSeed(next);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => {
    setSeed("");
    setOpen((value) => !value);
  }, []);

  const api = useMemo<NavUiApi>(
    () => ({
      paletteOpen: open,
      paletteSeed: seed,
      openPalette,
      closePalette,
      togglePalette,
    }),
    [open, seed, openPalette, closePalette, togglePalette],
  );

  useEffect(() => {
    const onExternal = (event: Event) => {
      openPalette((event as CustomEvent<string>).detail ?? "");
    };
    document.addEventListener(OPEN_EVENT, onExternal);
    return () => document.removeEventListener(OPEN_EVENT, onExternal);
  }, [openPalette]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePalette();
        return;
      }
      if (open || event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      openPalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette, togglePalette]);

  return (
    <NavUiContext.Provider value={api}>
      {children}
      <CommandPalette />
    </NavUiContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Lazy dialog shell
 * ------------------------------------------------------------------ */

const CommandPalettePanel = dynamic(
  () => import("./command-palette-panel").then((m) => m.CommandPalettePanel),
  { ssr: false },
);

/** Warm the panel during idle time so the first ⌘K press never waits on the network. */
function prefetchPalettePanel() {
  const load = () => void import("./command-palette-panel");
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(load, { timeout: 3000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(load, 2000);
  return () => window.clearTimeout(handle);
}

export function CommandPalette() {
  const { paletteOpen, paletteSeed, closePalette } = useNavUi();
  const mounted = useMounted();

  useEffect(() => prefetchPalettePanel(), []);

  if (!mounted || !paletteOpen) return null;
  return (
    <CommandPalettePanel seed={paletteSeed} onClose={closePalette} />
  );
}

/**
 * Server-renderable button that opens the palette pre-filled with a query.
 * Used by `/search` so the faceted page can hand off to ⌘K without becoming a
 * client component itself.
 */
export function PaletteLauncher({
  seed = "",
  label = "Open the command palette",
  className = "",
}: {
  seed?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette(seed)}
      className={`inline-flex min-h-11 items-center rounded-(--radius-pill) border border-ink-4 px-4 py-2 font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-500 transition-colors hover:border-guards hover:text-guards-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards ${className}`}
    >
      {label}
      <span aria-hidden="true" className="ml-2 text-metal-700">
        ⌘K
      </span>
    </button>
  );
}

export type { PaletteEntry } from "./catalog";
