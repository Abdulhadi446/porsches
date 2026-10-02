"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageResult } from "#lib/assets";
import { SafeImage } from "./safe-image";
import { cx } from "./lib/format";

/**
 * Turntable fallback — an image-sequence scrubber.
 *
 * Frame convention (this is the contract ASSET-3D must meet; `getModel()`
 * only hands us the directory):
 *
 *     <Model3D.turntable>/frame-000.webp
 *     <Model3D.turntable>/frame-001.webp …
 *
 * The frame count is *probed*, never assumed and never scanned from disk: a
 * small sequential probe (`new Image()`) walks the sequence and stops after
 * three consecutive misses, capped at 72 frames (one 360° at 5° steps).
 * If nothing resolves, the poster stays and the section says so.
 *
 * Interaction:
 *  - pointer drag (and a plain click position) scrubs horizontally;
 *  - the stage is a real `role="slider"`: ←/→ one frame, ↑/↓ five, Home/End to
 *    the ends, PageUp/PageDown ten;
 *  - auto-advance is opt-in and off by default under reduced motion.
 */

const MAX_FRAMES = 72;
const WINDOW_RADIUS = 3;

export interface TurntableProps {
  /** directory from `getModel().turntable` */
  base: string;
  poster: ImageResult;
  carName: string;
  accent: string;
  /** start auto-advancing (false under reduced motion) */
  autoPlay?: boolean;
  /** false until the section is near the viewport — probing waits for this */
  enabled?: boolean;
}

export function frameUrl(base: string, index: number): string {
  return `${base.replace(/\/$/, "")}/frame-${String(index).padStart(3, "0")}.webp`;
}

function probeFrame(url: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }
    const image = new window.Image();
    const done = (ok: boolean) => {
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    image.onload = () => done(true);
    image.onerror = () => done(false);
    window.setTimeout(() => done(false), timeoutMs);
    image.src = url;
  });
}

export function Turntable3D({
  base,
  poster,
  carName,
  accent,
  autoPlay = false,
  enabled = true,
}: TurntableProps) {
  const [frames, setFrames] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [probing, setProbing] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  /* ---- probe the sequence once, and only once the section is near ---- */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const found: number[] = [];
      let misses = 0;
      for (let i = 0; i < MAX_FRAMES && misses < 3; i += 1) {
        const ok = await probeFrame(frameUrl(base, i));
        if (cancelled) return;
        if (ok) {
          found.push(i);
          misses = 0;
        } else {
          misses += 1;
        }
      }
      if (cancelled) return;
      setFrames(found);
      setProbing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [base, enabled]);

  const count = frames.length;

  const clampIndex = useCallback(
    (value: number) => {
      if (count === 0) return 0;
      return Math.max(0, Math.min(count - 1, value));
    },
    [count],
  );

  /* ---- auto-advance ---- */
  useEffect(() => {
    if (!playing || count < 2) return;
    const id = window.setInterval(() => {
      setIndex((value) => (value + 1) % count);
    }, 90);
    return () => window.clearInterval(id);
  }, [count, playing]);

  const scrubFromEvent = useCallback(
    (clientX: number) => {
      const stage = stageRef.current;
      if (!stage || count < 2) return;
      const rect = stage.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      setIndex(clampIndex(Math.round(ratio * (count - 1))));
    },
    [clampIndex, count],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (count < 2) return;
      const map: Record<string, number> = {
        ArrowLeft: -1,
        ArrowDown: -5,
        ArrowRight: 1,
        ArrowUp: 5,
        PageDown: 10,
        PageUp: -10,
      };
      if (event.key in map) {
        event.preventDefault();
        setPlaying(false);
        setIndex((value) => clampIndex(value + map[event.key]));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setIndex(count - 1);
      }
    },
    [clampIndex, count],
  );

  const visible = frames.slice(
    Math.max(0, index - WINDOW_RADIUS),
    Math.min(count, index + WINDOW_RADIUS + 1),
  );
  const firstVisible = visible[0] ?? 0;

  return (
    <div className="absolute inset-0">
      <div
        ref={stageRef}
        role="slider"
        tabIndex={0}
        aria-label={`${carName} turntable — drag or use the arrow keys to rotate`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={index}
        aria-valuetext={count > 0 ? `Frame ${index + 1} of ${count}` : "No frames"}
        aria-disabled={count < 2}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (count < 2) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPlaying(false);
          scrubFromEvent(event.clientX);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          scrubFromEvent(event.clientX);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        className={cx(
          "absolute inset-0 touch-none select-none",
          count > 1 ? "cursor-ew-resize" : "cursor-default",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-guards",
        )}
      >
        {count > 0 ? (
          visible.map((frame) => (
            <div
              key={frame}
              className="absolute inset-0 transition-opacity duration-100"
              style={{ opacity: frame === frames[index] ? 1 : 0 }}
              aria-hidden="true"
            >
              <SafeImage
                image={{ src: frameUrl(base, frame), alt: "", width: 1600, height: 900 }}
                decorative
                fill
                sizes="(min-width: 1024px) 100vw, 100vw"
                className="object-cover"
              />
            </div>
          ))
        ) : (
          <div className="absolute inset-0">
            <SafeImage
              image={poster}
              decorative
              fill
              sizes="(min-width: 1024px) 100vw, 100vw"
              className="object-cover opacity-60"
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-[--space-2] bg-gradient-to-t from-ink to-transparent p-[--space-3]">
        <p className="label">
          {probing
            ? "Looking for the frame sequence"
            : count > 0
              ? `Frame ${index + 1} / ${count} · drag or arrow keys`
              : "Frame sequence not found — poster only"}
        </p>
        {count > 1 ? (
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            aria-pressed={playing}
            className="pointer-events-auto rounded-[--radius-sm] border border-ink-4 bg-ink-2/90 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
          >
            {playing ? "Pause" : "Play"}
          </button>
        ) : null}
      </div>

      {count > 1 ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-[--gutter] bottom-[--space-12] h-px bg-ink-4"
        >
          <div
            className="h-px"
            style={{
              width: `${((index + 1) / count) * 100}%`,
              backgroundColor: accent,
            }}
          />
        </div>
      ) : null}
      <span className="sr-only">
        {firstVisible >= 0 ? `Turntable sequence from frame ${firstVisible}` : ""}
      </span>
    </div>
  );
}