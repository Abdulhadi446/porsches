"use client";

import { useState } from "react";
import type { ScopedVideo } from "./lib/videos";

/**
 * Section (e) — videos.
 *
 * Facade first: a poster frame (YouTube's own CDN, which is the sanctioned
 * hotlink) plus one button. The `<iframe>` only exists after a click, so a
 * page can never open several YouTube players at once — and YouTube's player
 * bundle is by far the heaviest script we would otherwise ship.
 *
 * `getVideo()` has already validated every id and built the
 * `youtube-nocookie.com` embed URL, so an unverified or malformed id can
 * never reach this component.
 */

export interface VideoSectionProps {
  videos: ScopedVideo[];
  carName: string;
  accent: string;
  headingId: string;
  /** intro copy differs per scope */
  lede?: string;
}

export function VideoSection({ videos, carName, accent, headingId, lede }: VideoSectionProps) {
  if (videos.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-(--space-16) px-(--gutter) py-(--space-16)"
    >
      <div className="mx-auto w-full max-w-(--maxw)">
        <p className="label flex items-center gap-(--space-3)">
          <span
            aria-hidden="true"
            className="inline-block h-px w-8"
            style={{ backgroundColor: accent }}
          />
          Watch
        </p>
        <h2 id={headingId} className="mt-(--space-3) text-display-3 text-metal-100">
          {videos.length} film{videos.length === 1 ? "" : "s"} on the {carName.replace(/^911\s*/i, "")}
        </h2>
        {lede ? (
          <p className="mt-(--space-4) max-w-(--maxw-prose) text-body-2 text-metal-500">
            {lede}
          </p>
        ) : null}

        <ul className="mt-(--space-8) grid grid-cols-1 gap-(--space-6) md:grid-cols-2">
          {videos.map((video) => (
            <li key={video.id} className="flex flex-col gap-(--space-3)">
              <VideoFacade video={video} accent={accent} />
              <div className="flex flex-col gap-(--space-1)">
                <p className="font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-700">
                  {video.scope === "variant" ? "This variant" : "Generation"}
                  {video.channel ? ` · ${video.channel}` : ""}
                </p>
                <p className="text-body-2 leading-snug text-metal-300">{video.title}</p>
                {video.note ? (
                  <p className="max-w-[52ch] font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
                    {video.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function VideoFacade({ video, accent }: { video: ScopedVideo; accent: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden border border-ink-4 bg-ink-2">
      {playing ? (
        <iframe
          src={video.embedUrl}
          title={video.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${video.title}`}
          className="group absolute inset-0 h-full w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-guards"
        >
          {video.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote YouTube CDN poster; next/image would need remotePatterns in next.config.ts (lead-owned)
            <img
              src={video.poster}
              alt=""
              width={480}
              height={360}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-75 transition-opacity group-hover:opacity-90"
            />
          ) : (
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, var(--color-ink-3), var(--color-ink-2))",
              }}
            />
          )}
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center"
          >
            <span
              className="grid h-16 w-16 place-items-center rounded-(--radius-pill) border border-ink-4 bg-ink/70 text-xl text-metal-100 transition-transform duration-(--dur-base) group-hover:scale-105"
              style={{ boxShadow: `0 0 0 1px ${accent}` }}
            >
              ▶
            </span>
          </span>
          <span className="sr-only">Play: {video.title}</span>
        </button>
      )}
    </div>
  );
}