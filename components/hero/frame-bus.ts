/**
 * A very small bus between the *light* scroll layer (which must not import
 * three.js) and the *lazy* WebGL chunk.
 *
 * `useHeroScroll` runs in the page bundle and cannot import `invalidate` from
 * @react-three/fiber without dragging three.js into the first load. Instead the
 * scene registers a pump; scroll and pointer input call `pumpFrame()` and the
 * scene renders a frame only when something actually changed.
 *
 * Module-scope mutable state, but nothing here touches `window`/`document`, so
 * it is SSR safe.
 */

type FramePump = () => void;

let pump: FramePump | null = null;

export function setFramePump(next: FramePump | null): void {
  pump = next;
}

export function pumpFrame(): void {
  pump?.();
}
