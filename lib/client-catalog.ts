/**
 * Client-safe catalogue loader.
 *
 * Client components import THIS, never `#lib/generations` — the raw generation
 * files carry every gallery blur placeholder, credit object and source URL,
 * which cost ~2 MB of initial JS. This module reads the slim build artefact
 * produced by `scripts/build-client-catalog.ts` (wired to prebuild/predev).
 *
 * Server components keep using `#lib/generations` for full-fidelity data.
 */
import catalog from "#data/client-catalog.json";
import type { BodyStyle, GenerationId } from "#data/schema";

export interface ClientImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  blurDataURL?: string | null;
  creditId?: string;
}

export interface ClientVideo {
  id: string;
  title: string;
  channel?: string;
  poster?: string | null;
  note?: string;
}

export interface ClientVariant {
  id: string;
  name: string;
  years: string;
  yearsStart: number | null;
  yearsEnd: number | null;
  engine: string;
  power: string;
  powerPs: number | null;
  torque: string | null;
  acceleration: string | null;
  topSpeed: string | null;
  weight: string | null;
  drivetrain: string | null;
  transmission: string | null;
  bodyStyles: BodyStyle[];
  special: boolean;
  production: string | null;
  /** Full prose lives in the server-only data files; never shipped to the client. */
  heroImage: ClientImage | null;
  videos: ClientVideo[];
}

export interface ClientGeneration {
  id: GenerationId;
  index: number;
  code: string;
  name: string;
  yearsStart: number;
  yearsEnd: number | null;
  tagline: string;
  accent: string;
  eraType: "display" | "mono";
  /** First paragraph only — enough for the timeline chapter, 100 kB cheaper. */
  description: string;
  stats: { label: string; value: string }[];
  heroImage: ClientImage | null;
  timelineImage: ClientImage | null;
  model3d: { embedUrl: string | null; glb: string | null } | null;
  videos: ClientVideo[];
  variants: ClientVariant[];
}

/** 1963 → today, in timeline order. */
export const CLIENT_GENERATIONS = catalog.generations as ClientGeneration[];

export function clientGeneration(id: string): ClientGeneration | undefined {
  return CLIENT_GENERATIONS.find((g) => g.id === id);
}

export function clientVariants(
  generationId?: string,
): Array<ClientVariant & { generationId: GenerationId; generationCode: string }> {
  const list = generationId
    ? CLIENT_GENERATIONS.filter((g) => g.id === generationId)
    : CLIENT_GENERATIONS;
  return list.flatMap((g) =>
    g.variants.map((v) => ({
      ...v,
      generationId: g.id,
      generationCode: g.code,
    })),
  );
}