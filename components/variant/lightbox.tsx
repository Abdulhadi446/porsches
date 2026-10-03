"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { useSmoothScroll } from "#components/timeline/lenis-provider";
import { useMounted, useReducedMotion } from "./lib/hooks";
import { cx } from "./lib/format";

/**
 * Gallery lightbox — section (d)'s second half.
 *
 * A real dialog, not a styled div:
 *  - `role="dialog"` + `aria-modal` + a label that announces position;
 *  - the counter is an `aria-live="polite"` region, so arrow-key navigation is
 *    announced;
 *  - Esc / ← / → are bound on `document` (the dialog may not hold focus);
 *  - Tab is trapped inside the dialog and focus is restored to the thumbnail
 *    that opened it;
 *  - scroll is locked on `<body>` *and* on Lenis, which owns the scroll on
 *    this site — locking only the body would let the page keep drifting;
 *  - the image shares a `layoutId` with the thumbnail, which is what gives the
 *    framer-motion shared-element hop. Under reduced motion there is no
 *    transition at all, just an instant swap.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface LightboxProps {
  images: ImageResult[];
  /** null closes the dialog */
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  carName: string;
  /** shared-element id shared with the gallery thumbnail */
  layoutId?: string;
}

export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
  carName,
  layoutId,
}: LightboxProps) {
  const reduced = useReducedMotion();
  const { lenis } = useSmoothScroll();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mounted = useMounted();

  const open = index !== null && images.length > 0;
  const current = open ? images[index] : null;
  const total = images.length;

  const step = useCallback(
    (delta: number) => {
      if (index === null || total === 0) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, onIndexChange, total],
  );

  /* keyboard: Esc closes, arrows page, Tab is trapped */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        case "ArrowRight":
          event.preventDefault();
          step(1);
          return;
        case "ArrowLeft":
          event.preventDefault();
          step(-1);
          return;
        case "Home":
          event.preventDefault();
          onIndexChange(0);
          return;
        case "End":
          event.preventDefault();
          onIndexChange(total - 1);
          return;
        case "Tab": {
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusables = Array.from(
            dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
          ).filter((element) => element.offsetParent !== null);
          if (focusables.length === 0) {
            event.preventDefault();
            dialog.focus();
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement as HTMLElement | null;
          if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
        default:
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onIndexChange, open, step, total]);

  /* scroll lock + focus handoff (restore to the trigger, per a11y) */
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const main = document.getElementById("main");
    const previouslyInert = main?.inert ?? false;
    document.body.style.overflow = "hidden";
    main?.setAttribute("inert", "");
    lenis?.stop();
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyInert) main?.setAttribute("inert", "");
      else main?.removeAttribute("inert");
      lenis?.start();
      trigger?.focus();
    };
  }, [lenis, open]);

  if (!mounted) return null;

  const dialog = (
    <AnimatePresence>
      {open && current ? (
        <motion.div
          key="lightbox"
          className="fixed inset-0 z-overlay"
          initial={reduced ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.25 }}
        >
          {/* backdrop */}
          <button
            type="button"
            aria-label="Close image viewer"
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-zoom-out bg-ink/95 backdrop-blur-sm"
          />

          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${carName} — image ${index + 1} of ${total}`}
            tabIndex={-1}
            className="absolute inset-0 z-10 flex flex-col outline-none"
          >
            <div className="flex items-center justify-between gap-[--space-4] px-[--gutter] py-[--space-4]">
              <p className="label truncate">{current.alt}</p>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-[--radius-sm] border border-ink-4 px-[--space-4] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                Close (Esc)
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-[--gutter] pb-[--space-4]">
              {total > 1 ? (
                <NavButton side="left" onClick={() => step(-1)} />
              ) : null}

              <motion.figure
                layoutId={layoutId}
                className="relative mx-[--space-8] max-h-full w-full max-w-[min(72rem,90vw)]"
              >
                <div className="relative aspect-[3/2] w-full border border-ink-4 bg-ink-2">
                  <SafeImage
                    image={current}
                    fill
                    sizes="(min-width: 1024px) 72rem, 92vw"
                    className="object-contain"
                  />
                </div>
                <figcaption className="sr-only">{current.alt}</figcaption>
              </motion.figure>

              {total > 1 ? (
                <NavButton side="right" onClick={() => step(1)} />
              ) : null}
            </div>

            <div className="px-[--gutter] pb-[--space-6]">
              <p
                aria-live="polite"
                className="font-mono text-mono-sm tracking-[--tracking-mono] text-metal-500"
              >
                {index + 1} / {total}
                <span className="sr-only">
                  {` of ${total} images. Use the left and right arrow keys to navigate.`}
                </span>
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(dialog, document.body);
}

function NavButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={cx(
        "absolute top-1/2 -translate-y-1/2 grid h-12 w-12 shrink-0 place-items-center rounded-[--radius-pill] border border-ink-4 bg-ink-2/90 font-mono text-metal-100 transition-colors hover:border-metal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      <span aria-hidden="true">{side === "left" ? "←" : "→"}</span>
    </button>
  );
}