"use client";

import { useEffect, useRef, useState } from "react";
import type { EngineSound } from "#lib/sounds";
import { FOCUS_RING } from "./reveal";
import { cx } from "./lib/format";

/**
 * Ignition control — plays the generation's licence-clean engine recording
 * (resolved server-side by `getEngineSound`, handed down as plain props).
 *
 * Behaviour:
 *  - the audio element never preloads; the file is fetched on first play;
 *  - opening a page never *surprises* the visitor with sound: the control
 *    attempts an automatic start only if this browser session already played
 *    audio once (sessionStorage flag set by an explicit tap/click) and the
 *    connection is not in save-data mode. A rejected promise is swallowed and
 *    the button simply stays visible;
 *  - one recording at a time: pause + rewind on unmount and when the tab is
 *    hidden;
 *  - attribution is always on screen — it ships with the sound, not a page.
 */

export interface EngineStartProps {
  sound: EngineSound;
  accent: string;
  className?: string;
}

type Status = "idle" | "playing" | "error";

const ARMED_KEY = "p911:engine-start-armed";

export function EngineStart({ sound, accent, className }: EngineStartProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const play = () => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio
      .play()
      .then(() => {
        try {
          sessionStorage.setItem(ARMED_KEY, "1");
        } catch {
          /* private mode — auto-start just stays off */
        }
      })
      .catch(() => setStatus("idle")); // autoplay refused: the button remains
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      audio.currentTime = 0;
      setStatus("idle");
    } else {
      play();
    }
  };

  /* auto-start only for a returning, already-engaged session */
  useEffect(() => {
    let armed = false;
    try {
      armed = sessionStorage.getItem(ARMED_KEY) === "1";
    } catch {
      armed = false;
    }
    if (!armed) return;

    const connection =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection ?? null;
    if (connection?.saveData) return;

    const audio = audioRef.current;
    if (!audio) return;
    // Small defer so the page paints first; a rejection is fine.
    const timer = window.setTimeout(() => {
      void audio.play().catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sound.src]);

  /* pause on unmount and whenever the tab is hidden */
  useEffect(() => {
    const audio = audioRef.current;
    const stop = () => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      setStatus("idle");
    };
    const onHidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      stop();
    };
  }, [sound.src]);

  const playing = status === "playing";

  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-(--space-4) gap-y-1", className)}>
      <audio
        ref={audioRef}
        src={sound.src}
        preload="none"
        onPlay={() => setStatus("playing")}
        onPause={() => setStatus("idle")}
        onEnded={() => setStatus("idle")}
        onError={() => setStatus("error")}
      />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        className={cx(
          "inline-flex min-h-11 items-center gap-(--space-3) rounded-(--radius-sm) border px-4 py-3 font-mono text-mono-sm uppercase tracking-(--tracking-mono) transition-colors",
          status === "error"
            ? "cursor-not-allowed border-ink-4 text-metal-700"
            : playing
              ? "border-transparent bg-ink/70 text-metal-100"
              : "border-ink-4 bg-ink/60 text-metal-100 hover:border-metal-500",
          FOCUS_RING,
        )}
        style={status === "error" ? undefined : { borderColor: playing ? accent : undefined }}
        disabled={status === "error"}
      >
        <span aria-hidden="true" className="inline-flex" style={{ color: accent }}>
          {status === "error" ? "×" : playing ? "■" : "◉"}
        </span>
        {status === "error" ? "Recording unavailable" : playing ? "Stop the engine" : "Start the engine"}
      </button>
      <span className="max-w-[46ch] font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-700">
        {status === "error" ? (
          "This browser could not play the .ogg recording."
        ) : (
          <span className="inline-flex flex-wrap gap-x-(--space-2)">
            <span>
              Sound: {sound.subject}
              {/* the full moment detail on wider screens; on phones the
                  subject + credit keep the caption clear of the hero numerals */}
              <span className="hidden sm:inline"> {sound.moment}</span>
            </span>
            <span aria-hidden="true" className="text-ink-4">
              ·
            </span>
            {sound.sourceUrl ? (
              <a
                href={sound.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-ink-4 underline-offset-4 transition-colors hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
              >
                {sound.author ?? "Author unrecorded"} · {sound.license ?? "licence unrecorded"} ·
                Commons
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span>
                {sound.author ?? "Author unrecorded"} · {sound.license ?? "licence unrecorded"}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}
