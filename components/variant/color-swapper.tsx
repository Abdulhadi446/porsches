"use client";

import type { Paint } from "./lib/palette";
import { cx } from "./lib/format";

/**
 * Paint chips for the 3D viewer.
 *
 * A real `<fieldset>` with native radios, so arrow-key operation, grouping and
 * the checked state come from the platform rather than from JS.
 *
 * When the active viewer cannot be tinted (an embedded Sketchfab scene owns
 * its own materials, a turntable is a photograph, there is no model at all)
 * the control renders *disabled* with the reason on screen and in `title`.
 * A tint that does nothing would be a lie, so it is never offered.
 */

export interface ColorSwapperProps {
  paints: readonly Paint[];
  value: string;
  onChange: (paint: Paint) => void;
  /** can the active viewer be tinted at all? */
  enabled: boolean;
  /** shown when disabled — must explain *why* */
  disabledReason?: string;
  /** how the tint was resolved: a named paint material or a size heuristic */
  basis?: "named" | "heuristic" | "none";
  accent: string;
}

export function ColorSwapper({
  paints,
  value,
  onChange,
  enabled,
  disabledReason,
  basis = "none",
  accent,
}: ColorSwapperProps) {
  return (
    <fieldset
      disabled={!enabled}
      className="border-0 p-0"
      aria-describedby={enabled ? undefined : "viewer-paint-note"}
    >
      <legend className="label mb-(--space-2)">Paint</legend>
      <div className="flex flex-wrap items-center gap-(--space-2)">
        {paints.map((paint) => {
          const id = `paint-${paint.id}`;
          return (
            <span key={paint.id} className="relative inline-flex">
              <input
                type="radio"
                id={id}
                name="viewer-paint"
                value={paint.id}
                checked={value === paint.id}
                onChange={() => onChange(paint)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                title={enabled ? paint.label : disabledReason}
                className={cx(
                  "flex cursor-pointer items-center gap-(--space-2) rounded-(--radius-pill) border border-ink-4 bg-ink-3 py-(--space-2) pr-(--space-3) pl-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-300 transition-colors",
                  "hover:border-metal-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-guards",
                  "peer-checked:border-guards peer-checked:text-metal-100",
                  !enabled && "cursor-not-allowed opacity-40 hover:border-ink-4",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full border border-ink-4"
                  style={{
                    backgroundColor: paint.css,
                    boxShadow: value === paint.id ? `0 0 0 2px ${accent}` : undefined,
                  }}
                />
                {paint.label}
              </label>
            </span>
          );
        })}
      </div>

      {!enabled ? (
        <p
          id="viewer-paint-note"
          className="mt-(--space-2) max-w-[46ch] font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-700"
        >
          {disabledReason ?? "Not available for this model."}
        </p>
      ) : basis === "heuristic" ? (
        <p className="mt-(--space-2) max-w-[46ch] font-mono text-mono-xs leading-relaxed tracking-(--tracking-mono) text-metal-500">
          Tinted the largest single material — the model exposes no material named
          &ldquo;paint&rdquo; or &ldquo;body&rdquo;.
        </p>
      ) : null}
    </fieldset>
  );
}