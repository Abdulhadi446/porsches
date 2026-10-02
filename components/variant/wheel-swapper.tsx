"use client";

import type { WheelOption } from "./lib/palette";
import { cx } from "./lib/format";

/**
 * Wheel swapper.
 *
 * **Only rendered enabled when the model actually exposes named wheel nodes.**
 * `wheelGroups()` groups mesh names like `wheel_sport_fl` / `wheel_sport_fr` into
 * a "sport" set, `wheel_...` into another, etc. Fewer than two groups → the
 * control is disabled with the reason spelled out. We never invent a wheel
 * style: there is no catalogue of rims in the data, and faking one would be
 * inventing a fact about the car.
 *
 * Native radios again → arrow keys, grouping and checked state are free.
 */

export interface WheelSwapperProps {
  /** discovered groups, or null when the model exposes < 2 named sets */
  groups: WheelOption[] | null;
  value: string | null;
  onChange: (group: WheelOption) => void;
  /** set when the model could not be inspected at all */
  unavailableReason?: string;
}

export function WheelSwapper({ groups, value, onChange, unavailableReason }: WheelSwapperProps) {
  const enabled = Boolean(groups && groups.length > 1);

  return (
    <fieldset
      disabled={!enabled}
      className="border-0 p-0"
      aria-describedby={enabled ? undefined : "viewer-wheel-note"}
    >
      <legend className="label mb-[--space-2]">Wheels</legend>

      {enabled ? (
        <div className="flex flex-wrap items-center gap-[--space-2]">
          {groups!.map((group) => {
            const id = `wheel-${group.id}`;
            return (
              <span key={group.id} className="relative inline-flex">
                <input
                  type="radio"
                  id={id}
                  name="viewer-wheels"
                  value={group.id}
                  checked={value === group.id}
                  onChange={() => onChange(group)}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  title={`${group.label} — ${group.nodes.length} named node${group.nodes.length === 1 ? "" : "s"} in the model`}
                  className={cx(
                    "cursor-pointer rounded-[--radius-sm] border border-ink-4 bg-ink-3 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-300 transition-colors",
                    "hover:border-metal-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-guards",
                    "peer-checked:border-guards peer-checked:text-metal-100",
                  )}
                >
                  {group.label}
                </label>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-[--space-2]">
          {["Stock", "Sport", "Turbo"].map((label) => (
            <span
              key={label}
              title="Unavailable — this model exposes no named wheel nodes"
              aria-disabled="true"
              className="cursor-not-allowed rounded-[--radius-sm] border border-ink-4 bg-ink-3 px-[--space-3] py-[--space-2] font-mono text-mono-xs uppercase tracking-[--tracking-mono] text-metal-700 opacity-60"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {!enabled ? (
        <p
          id="viewer-wheel-note"
          className="mt-[--space-2] max-w-[46ch] font-mono text-mono-xs leading-relaxed tracking-[--tracking-mono] text-metal-700"
        >
          {unavailableReason ??
            "This model exposes no named wheel nodes, so there is nothing to swap — the control stays disabled rather than pretending."}
        </p>
      ) : null}
    </fieldset>
  );
}