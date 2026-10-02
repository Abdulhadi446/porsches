"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useCursorEligible } from "./use-nav";

/**
 * CUSTOM CURSOR — owned by NAV-UX.
 *
 * A spring-damped ring plus a hard dot that trails the pointer. It is purely
 * additive: `cursor: none` is never set anywhere, so the native cursor, text
 * carets and focus rings all stay visible and keyboard users are unaffected.
 *
 * Hover states are derived from the element under the pointer:
 *  - `a`, `button`, `[role="button"]`, `select`, `summary`, `label` → the ring
 *    expands and tints Guards red
 *  - `canvas` (the 3D hero) → the ring becomes a labelled disc reading
 *    `VIEW 3D`, or `data-cursor="drag"` for anything draggable
 *  - `input`, `textarea`, `[contenteditable]` → the ring hides so the caret is
 *    never obscured
 *  - `data-cursor="hide"` on a wrapper suppresses the ring for that subtree
 *
 * Rendered only for a fine pointer with a hover-capable device and with no
 * `prefers-reduced-motion`: coarse pointers and motion-sensitive users get no
 * DOM, no listeners and no compositing layer at all.
 */

type CursorMode = "idle" | "link" | "canvas" | "text" | "hidden";

const RING = 30;
const DOT = 5;
const INTERACTIVE =
  'a[href], button, [role="button"], select, summary, label, summary, [data-cursor]';
const TYPING = 'input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable="true"]';

function labelFor(element: Element | null): string {
  if (!element) return "";
  const node = element.closest<HTMLElement>("[data-cursor]");
  const value = node?.dataset.cursor;
  if (value === "hide") return "";
  if (value === "drag") return "DRAG";
  if (value === "view") return "VIEW 3D";
  if (value) return value.replace(/-/g, " ").toUpperCase().slice(0, 12);
  const canvas = element.closest("canvas");
  if (canvas) return "VIEW 3D";
  return "";
}

export function CustomCursor() {
  const eligible = useCursorEligible();
  const [mode, setMode] = useState<CursorMode>("idle");
  const [label, setLabel] = useState("");
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const ringX = useSpring(x, { stiffness: 210, damping: 24, mass: 0.55 });
  const ringY = useSpring(y, { stiffness: 210, damping: 24, mass: 0.55 });
  const dotX = useSpring(x, { stiffness: 900, damping: 46, mass: 0.18 });
  const dotY = useSpring(y, { stiffness: 900, damping: 46, mass: 0.18 });

  useEffect(() => {
    if (!eligible) return;

    const show = () => {
      if (visibleRef.current) return;
      visibleRef.current = true;
      setVisible(true);
    };
    const hide = () => {
      if (!visibleRef.current) return;
      visibleRef.current = false;
      setVisible(false);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      x.set(event.clientX);
      y.set(event.clientY);
      show();
    };

    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-cursor="hide"]')) {
        setMode("hidden");
        setLabel("");
        return;
      }
      if (target.closest(TYPING)) {
        setMode("text");
        setLabel("");
        return;
      }
      const canvas = target.closest("canvas");
      if (canvas) {
        setMode("canvas");
        setLabel(labelFor(target) || "DRAG");
        return;
      }
      const interactive = target.closest(INTERACTIVE);
      if (interactive) {
        setMode("link");
        setLabel(labelFor(target));
        return;
      }
      setMode("idle");
      setLabel("");
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      setPressed(true);
    };
    const up = () => setPressed(false);
    const onBlur = () => {
      hide();
      setPressed(false);
      setMode("idle");
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointerleave", hide);
    document.addEventListener("pointerenter", show);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerleave", hide);
      document.removeEventListener("pointerenter", show);
      window.removeEventListener("blur", onBlur);
    };
  }, [eligible, x, y]);

  if (!eligible) return null;

  const isCanvas = mode === "canvas";
  const scale = isCanvas ? 2.35 : mode === "link" ? 1.35 : 1;
  const opacity = mode === "text" || mode === "hidden" ? 0 : visible ? 1 : 0;
  const pressScale = pressed ? 0.82 : 1;

  return (
    <div
      aria-hidden="true"
      data-nav-cursor={mode}
      className="pointer-events-none fixed inset-0 z-cursor hidden [@media(hover:hover)]:block"
    >
      <motion.div
        style={{ x: ringX, y: ringY, width: RING, height: RING, marginLeft: -RING / 2, marginTop: -RING / 2 }}
        animate={{ scale: scale * pressScale, opacity }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className={`absolute left-0 top-0 flex items-center justify-center rounded-full border ${
          isCanvas
            ? "border-guards bg-guards/10"
            : mode === "link"
              ? "border-guards bg-guards/5"
              : "border-metal-100/40 bg-transparent"
        }`}
      >
        <span
          className={`scale-[0.34] whitespace-nowrap font-mono text-mono-xs uppercase leading-none tracking-[--tracking-label] text-metal-100 transition-opacity duration-[--dur-fast] ${
            label && (isCanvas || mode === "link") ? "opacity-100" : "opacity-0"
          }`}
        >
          {label}
        </span>
      </motion.div>

      <motion.div
        style={{ x: dotX, y: dotY, width: DOT, height: DOT, marginLeft: -DOT / 2, marginTop: -DOT / 2 }}
        animate={{ scale: pressed ? 1.8 : mode === "idle" ? 1 : 0.5, opacity: visible ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        className="absolute left-0 top-0 rounded-full bg-metal-100"
      />
    </div>
  );
}
