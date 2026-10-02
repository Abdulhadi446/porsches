"use client";

/**
 * Optional glTF decoders — wired, but never required.
 *
 * `data/models.json` does not exist yet, so no `.glb` resolves today. When
 * ASSET-3D lands one, this module has to be ready:
 *
 *  - **Meshopt** — decoder ships inside `three` (`three/addons/libs/…`), so it
 *    is always wired up, no extra files in `/public`.
 *  - **Draco** — needs `draco_decoder.js|wasm` on our own origin. We point at
 *    `/decoders/draco/`, which does not exist yet; the wiring is attempted in
 *    a try/catch and a *missing* decoder only breaks Draco-compressed assets,
 *    never an uncompressed `.glb`.
 *  - **KTX2/Basis** — same story: `/decoders/basis/`, and `detectSupport()`
 *    needs a live renderer, so it is created inside the R3F tree.
 *
 * Everything is dynamic-imported so none of it lands in the initial bundle,
 * and every failure is swallowed into `null` (see `decoderReport`).
 */

import type { WebGLRenderer } from "three";

export const DECODER_PATHS = {
  draco: "/decoders/draco/",
  basis: "/decoders/basis/",
} as const;

interface DecoderRegistry {
  meshopt: unknown | null;
  draco: unknown | null;
  ktx2: unknown | null;
}

const registry: DecoderRegistry = { meshopt: null, draco: null, ktx2: null };
const pending = new Map<string, Promise<unknown | null>>();

export interface DecoderReport {
  meshopt: "ready" | "absent";
  draco: "ready" | "absent";
  ktx2: "ready" | "absent" | "pending";
}

export function decoderReport(): DecoderReport {
  return {
    meshopt: registry.meshopt ? "ready" : "absent",
    draco: registry.draco ? "ready" : "absent",
    ktx2: registry.ktx2 ? "ready" : registry.ktx2 === null ? "pending" : "absent",
  };
}

function once<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T | null>;
  const promise = load()
    .then((value) => {
      registry[key as keyof DecoderRegistry] = value;
      return value;
    })
    .catch(() => {
      registry[key as keyof DecoderRegistry] = null;
      return null;
    });
  pending.set(key, promise);
  return promise;
}

/** Meshopt: JS-only, bundled with three. Safe to always load. */
export function ensureMeshopt(): Promise<unknown | null> {
  return once("meshopt", async () => {
    const imported = (await import("three/addons/libs/meshopt_decoder.module.js")) as {
      default?: unknown;
    };
    return imported.default ?? imported;
  });
}

/** Draco: needs `/decoders/draco/`. Tolerates the files being absent. */
export function ensureDraco(): Promise<unknown | null> {
  return once("draco", async () => {
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    const loader = new DRACOLoader();
    loader.setDecoderPath(DECODER_PATHS.draco);
    return loader;
  });
}

/** KTX2: needs `/decoders/basis/` *and* a live WebGL context. */
export async function ensureKTX2(renderer: WebGLRenderer): Promise<unknown | null> {
  if (registry.ktx2) return registry.ktx2;
  try {
    const { KTX2Loader } = await import("three/addons/loaders/KTX2Loader.js");
    const loader = new KTX2Loader();
    loader.setTranscoderPath(DECODER_PATHS.basis);
    loader.detectSupport(renderer);
    registry.ktx2 = loader;
    return loader;
  } catch {
    registry.ktx2 = null;
    return null;
  }
}

/**
 * Called from `useGLTF(url, …, extendLoader)`. Runs synchronously with
 * whatever decoders are already resolved — which is every loader for an
 * uncompressed asset, so the common path has no await at all.
 */
export function attachDecoders(loader: {
  setDRACOLoader?: (value: unknown) => void;
  setKTX2Loader?: (value: unknown) => void;
  setMeshoptDecoder?: (value: unknown) => void;
}): void {
  try {
    if (registry.meshopt && loader.setMeshoptDecoder) {
      loader.setMeshoptDecoder(registry.meshopt);
    }
    if (registry.draco && loader.setDRACOLoader) {
      loader.setDRACOLoader(registry.draco);
    }
    if (registry.ktx2 && loader.setKTX2Loader) {
      loader.setKTX2Loader(registry.ktx2);
    }
  } catch {
    // a loader that refuses a decoder must not take the page down
  }
}

/** Warm every decoder that needs no GL context. Safe to call repeatedly. */
export function warmDecoders(): Promise<unknown> {
  return Promise.all([ensureMeshopt(), ensureDraco()]);
}