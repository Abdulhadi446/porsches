"use client";

import { useEffect, useRef } from "react";

/**
 * 8. `<CarCursor />` — car-cursor.tsx
 *
 * A pointer-following 911 silhouette for anything that *is* a car on screen
 * (grid cards, gallery frames, the hero stage, the 3D viewer). It is the one
 * fx component that tracks the pointer instead of a background, so a few
 * parts of the shared contract differ deliberately:
 *
 *  - **opt-in targets**: the layer is inert until the pointer enters an
 *    element marked `data-car-cursor`. Controls nested inside such a zone
 *    (links that are not the zone itself, buttons, form widgets) keep the
 *    native cursor, so a hero CTA never loses its affordance;
 *  - **armed by JS**: `cursor: none` is applied only after this component
 *    has armed `<html data-cursor-armed>` on a fine pointer with
 *    `prefers-reduced-motion: no-preference`. No JS, a coarse pointer or
 *    reduced motion → the native cursor never disappears;
 *  - **no rAF loop at rest**: frames run only while the pointer moves or the
 *    bank angle is still settling, then the loop parks itself. `visibility`,
 *    `blur` and `scroll` all force-hide; nothing animates off-screen.
 *
 * First paint is empty (opacity 0, position parked at 0 0) — the SSR markup
 * and the first client render are identical, and all positioning happens
 * through direct DOM writes, so the component never re-renders.
 */

export interface CarCursorProps {
  className?: string;
}

/** Hand-drawn 911 profile (facing right), mirrored from the placeholder's stance. */
const CAR_PATH =
  "M6 20.6c0-3.7 2.7-5.8 7-6.9C15.2 9.8 21 6.5 27.6 6.3c6.9-.2 12.4 2.1 16.8 5.5 4.2 3.2 9.9 4.3 14.2 6.1 2.7 1.1 4.3 2.4 4.7 4.3v1.4H6z";

export function CarCursor({ className }: CarCursorProps) {
  const glyphRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const doc = document;
    const root = doc.documentElement;
    const glyph = glyphRef.current;
    if (!glyph) return;

    const media = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );

    let raf = 0;
    let x = 0;
    let y = 0;
    let prevX = 0;
    let tilt = 0;
    let vel = 0;
    let visible = false;
    let disposed = false;

    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(frame);
    };

    const frame = () => {
      raf = 0;
      const target = Math.max(-13, Math.min(13, vel * 0.5));
      tilt += (target - tilt) * 0.2;
      vel *= 0.82;
      glyph.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-88%, -50%) rotate(${tilt.toFixed(2)}deg)`;
      if (visible && (Math.abs(tilt) > 0.05 || Math.abs(vel) > 0.08)) schedule();
    };

    const show = (on: boolean) => {
      if (on === visible) return;
      visible = on;
      glyph.style.opacity = on ? "1" : "0";
      if (!on) {
        tilt = 0;
        vel = 0;
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
      }
    };

    const INTERACTIVE = "a, button, [role='button'], input, select, textarea, label";

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const zone = target.closest<HTMLElement>("[data-car-cursor]");
      if (!zone) {
        show(false);
        return;
      }
      // nested controls keep the native cursor (the zone itself may BE a link)
      const control = target.closest<HTMLElement>(INTERACTIVE);
      if (control && control !== zone) {
        show(false);
        return;
      }

      const dx = event.clientX - prevX;
      prevX = event.clientX;
      vel = vel * 0.55 + dx * 0.45;
      x = event.clientX;
      y = event.clientY;
      show(true);
      schedule();
    };

    const onLeave = (event: PointerEvent) => {
      if (!event.relatedTarget) show(false);
    };
    const onHide = () => show(false);
    const onScroll = () => show(false);
    const onVisibility = () => {
      if (doc.hidden) show(false);
    };

    const arm = () => {
      root.setAttribute("data-cursor-armed", "");
      doc.addEventListener("pointermove", onMove, { passive: true });
      doc.addEventListener("pointerout", onLeave, { passive: true });
      window.addEventListener("blur", onHide);
      window.addEventListener("scroll", onScroll, { passive: true });
      doc.addEventListener("visibilitychange", onVisibility);
    };

    const disarm = () => {
      show(false);
      root.removeAttribute("data-cursor-armed");
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerout", onLeave);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("scroll", onScroll);
      doc.removeEventListener("visibilitychange", onVisibility);
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const sync = () => {
      if (disposed) return;
      if (media.matches) arm();
      else disarm();
    };

    sync();
    media.addEventListener("change", sync);

    return () => {
      disposed = true;
      media.removeEventListener("change", sync);
      disarm();
    };
  }, []);

  return (
    <>
      {/*
        Armed-only cursor rule: `<html data-cursor-armed>` is set by the effect
        above, so this CSS is inert without JS / on touch / under reduced
        motion. Nested controls restore the native pointer.
      */}
      <style>
        {`[data-cursor-armed] [data-car-cursor]{cursor:none}
[data-cursor-armed] [data-car-cursor] :is(a,button,[role="button"],input,select,textarea,label){cursor:pointer}
.fx-car-cursor-glyph{transition:opacity 140ms ease}
@media (prefers-reduced-motion:reduce){.fx-car-cursor-glyph{transition:none}}`}
      </style>
      <div
        ref={glyphRef}
        aria-hidden="true"
        data-fx="car-cursor"
        data-fx-mode="css"
        className={className}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: "var(--z-overlay)",
          opacity: 0,
          pointerEvents: "none",
          color: "var(--color-metal-100)",
          filter:
            "drop-shadow(0 0 6px color-mix(in srgb, var(--color-guards) 55%, transparent)) drop-shadow(0 2px 3px rgb(0 0 0 / 0.55))",
          willChange: "transform",
        }}
      >
        <svg
          width="62"
          height="30"
          viewBox="0 0 68 30"
          fill="none"
          aria-hidden="true"
          style={{ display: "block", overflow: "visible" }}
        >
          <path d={CAR_PATH} fill="currentColor" />
          <circle cx="17.5" cy="23.2" r="5" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="48" cy="23.2" r="5" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="17.5" cy="23.2" r="1.4" fill="currentColor" />
          <circle cx="48" cy="23.2" r="1.4" fill="currentColor" />
        </svg>
      </div>
    </>
  );
}
