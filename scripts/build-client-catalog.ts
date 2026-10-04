/**
 * Build a slim, client-safe catalogue.
 *
 * WHY: client components (command palette, /search, /variants, /compare, the
 * timeline and the hero) import generation data. Shipping the raw files meant
 * ~2 MB of initial JS: every gallery `blurDataURL` base64 blob, every credit
 * object and every variant `sources` array rode along even though the client
 * only needs identity, search fields and one thumbnail.
 *
 * This script writes `data/client-catalog.json` with exactly what the client
 * reads. Server components keep using the full `data/generations/*.json`.
 *
 *   node scripts/build-client-catalog.ts
 *   (wired to `npm run prebuild` + `npm run predev`)
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = <T,>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const write = (p: string, v: unknown) =>
  writeFileSync(join(ROOT, p), JSON.stringify(v) + "\n");

/* Local structural types: the raw files carry more than the client needs. */
interface RawImage {
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  blurDataURL?: string | null;
}
interface RawVideo {
  id: string;
  title: string;
  channel?: string;
  poster?: string | null;
}
interface RawModel {
  embedUrl?: string | null;
  glb?: string | null;
}
interface RawStat {
  label: string;
  value: string;
}
interface RawVariant {
  id: string;
  name: string;
  years: string;
  yearsStart?: number | null;
  yearsEnd?: number | null;
  engine: string;
  power: string;
  powerPs?: number | null;
  torque?: string | null;
  acceleration?: string | null;
  topSpeed?: string | null;
  weight?: string | null;
  drivetrain?: string | null;
  transmission?: string | null;
  bodyStyles?: string[];
  special?: boolean;
  production?: string | null;
  description: string;
  heroImage?: RawImage | null;
  videos?: RawVideo[];
}
interface RawGeneration {
  id: string;
  index: number;
  code: string;
  name: string;
  yearsStart: number;
  yearsEnd?: number | null;
  tagline: string;
  accent: string;
  eraType?: "display" | "mono";
  description: string;
  stats?: RawStat[];
  heroImage?: RawImage | null;
  timelineImage?: RawImage | null;
  model3d?: RawModel | null;
  videos?: RawVideo[];
  variants?: RawVariant[];
}

/**
 * Store the LARGEST available rendition, not a thumbnail.
 *
 * next/image chooses the delivered width from the `sizes` attribute and runs
 * the request through the optimizer, so a full-bleed hero asking for w=1600
 * gets a sharp 1920 source. Handing it the 640px file instead (as this script
 * used to) makes the optimizer upscale a small file — measurably soft heroes on
 * large displays, and `w=2560` requests against 640px files in the timeline.
 */
function thumb(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  return src;
}

function slimImage(
  image: RawImage | null | undefined,
  opts: { withBlur?: boolean } = {},
): RawImage | null {
  if (!image?.src) return null;
  const out: RawImage = {
    src: thumb(image.src),
    alt: image.alt ?? "",
    width: image.width,
    height: image.height,
  };
  if (opts.withBlur && image.blurDataURL) out.blurDataURL = image.blurDataURL;
  return out;
}

const generations = readdirSync(join(ROOT, "data/generations"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read<RawGeneration>(`data/generations/${f}`))
  .sort((a, b) => a.index - b.index);

const slim = generations.map((g) => ({
  id: g.id,
  index: g.index,
  code: g.code,
  name: g.name,
  yearsStart: g.yearsStart,
  yearsEnd: g.yearsEnd ?? null,
  tagline: g.tagline,
  accent: g.accent,
  eraType: g.eraType ?? "display",
  // the timeline renders only the first paragraph — ship only that
  description: String(g.description ?? "").split("\n\n")[0],
  stats: (g.stats ?? []).slice(0, 6),
  heroImage: slimImage(g.heroImage),
  timelineImage: slimImage(g.timelineImage),
  model3d: g.model3d
    ? { embedUrl: g.model3d.embedUrl ?? null, glb: g.model3d.glb ?? null }
    : null,
  videos: (g.videos ?? []).map((v: RawVideo) => ({
    id: v.id,
    title: v.title,
    channel: v.channel ?? null,
    poster: v.poster ?? null,
  })),
  variants: (g.variants ?? []).map((v: RawVariant) => ({
    id: v.id,
    name: v.name,
    years: v.years,
    yearsStart: v.yearsStart ?? null,
    yearsEnd: v.yearsEnd ?? null,
    engine: v.engine,
    power: v.power,
    powerPs: typeof v.powerPs === "number" ? v.powerPs : null,
    torque: v.torque ?? null,
    acceleration: v.acceleration ?? null,
    topSpeed: v.topSpeed ?? null,
    weight: v.weight ?? null,
    drivetrain: v.drivetrain ?? null,
    transmission: v.transmission ?? null,
    bodyStyles: v.bodyStyles ?? [],
    special: v.special === true,
    production: v.production ?? null,
    heroImage: slimImage(v.heroImage),
    videos: (v.videos ?? []).map((x: RawVideo) => ({
      id: x.id,
      title: x.title,
      ...(x.channel ? { channel: x.channel } : {}),
      poster: x.poster ?? null,
    })),
  })),
}));

const out = { generatedAt: new Date().toISOString(), generations: slim };
const json = JSON.stringify(out);
write("data/client-catalog.json", out);

const variants = slim.reduce((n, g) => n + g.variants.length, 0);
console.log(
  `client-catalog.json: ${slim.length} generations, ${variants} variants, ${(
    json.length / 1024
  ).toFixed(0)} kB (raw data/generations is ~1400 kB)`,
);