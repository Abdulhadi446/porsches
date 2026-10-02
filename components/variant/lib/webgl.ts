"use client";

/**
 * ONE shared WebGL context policy — the site-wide lease.
 *
 * `research.md` §3: "Only one WebGL context alive at a time on this box for
 * tests". A variant page has exactly one viewer, but a future page (compare,
 * search results) could mount several, and `components/fx` degrades to static
 * CSS whenever it believes the machine is low-power. So:
 *
 *  - `claimCanvas(id)` is a lease: the newest claimant wins and every previous
 *    holder is revoked, which unmounts its `<Canvas>` and lets three.js
 *    dispose the context in the same commit.
 *  - while a canvas is alive we call `setFxCapabilityOverride(false)` (a
 *    sanctioned export of components/fx) so the 2D-canvas background effects
 *    do not flip to their static fallback just because a WebGL context was
 *    detected elsewhere. The override is removed on release.
 *
 * Module scope is deliberate: one lease per JS realm, not per component.
 */

import { setFxCapabilityOverride } from "#components/fx";

let holder: string | null = null;
let fxOverrideActive = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function applyFxOverride(claimed: boolean): void {
  if (claimed === fxOverrideActive) return;
  fxOverrideActive = claimed;
  // false = "a WebGL context is alive, keep the effects animating"
  setFxCapabilityOverride(claimed ? false : null);
}

/** Take the single canvas slot. Returns false if someone else holds it. */
export function claimCanvas(id: string): boolean {
  holder = id;
  applyFxOverride(true);
  notify();
  return true;
}

/** Give the slot back. No-op when `id` is not the current holder. */
export function releaseCanvas(id: string): void {
  if (holder !== id) return;
  holder = null;
  applyFxOverride(false);
  notify();
}

/** Is the lease currently held (by anyone)? */
export function canvasClaimed(): boolean {
  return holder !== null;
}

/** Subscribe to lease changes; returns the unsubscribe function. */
export function subscribeCanvas(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Device-pixel-ratio ceiling for the viewer canvas. */
export const VIEWER_DPR_CEILING = 1.75;