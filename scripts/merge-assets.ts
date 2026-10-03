/**
 * Lead-owned integration step: fold the asset agents' manifests into the
 * per-generation data files, and keep data/credits.json authoritative.
 *
 *   node scripts/merge-assets.ts [--check]
 *
 * Inputs  : data/images.json (ASSET-IMAGES), data/models.json (ASSET-3D),
 *           data/videos.json (ASSET-VIDEO), data/credits.json (ASSET-IMAGES)
 * Outputs : data/generations/*.json  (media fields only; spec fields untouched)
 *
 * Variant keys in the manifests may be "<genId>/<variantId>" (canonical) or a
 * bare "<variantId>" alias. The canonical key always wins; bare aliases are only
 * used when they resolve to exactly one variant.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Credit,
  Generation,
  ImageRef,
  Model3D,
  Variant,
  VideoRef,
} from "../data/schema";

const ROOT = new URL("..", import.meta.url).pathname;
const CHECK_ONLY = process.argv.includes("--check");

type Json = Record<string, unknown>;
const read = <T,>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const write = (p: string, v: unknown) =>
  writeFileSync(join(ROOT, p), JSON.stringify(v, null, 2) + "\n");

const images = read<Json>("data/images.json");
const models = read<Json>("data/models.json");
const videos = read<Json>("data/videos.json");
const creditsFile = read<{ generatedAt: string; credits: Credit[] }>(
  "data/credits.json",
);

const today = new Date().toISOString().slice(0, 10);
const credits = new Map<string, Credit>(
  (creditsFile.credits ?? []).map((c) => [c.assetId, c]),
);

/* ---------------------------------------------------------------- helpers */
const imgs = images as {
  generations?: Record<string, { heroImage?: ImageRef | null; timelineImage?: ImageRef | null }>;
  variants?: Record<string, { heroImage?: ImageRef | null; gallery?: ImageRef[] }>;
};
const mods = models as {
  generations?: Record<string, Model3D | null>;
  variants?: Record<string, Model3D | null>;
};
const vids = videos as { entries?: Record<string, VideoRef[]> };
const turntables = read<{
  entries?: Record<string, { dir?: string; synthetic?: boolean }>;
}>("data/turntables.json");

/** creditId → Credit, synthesising one if the images agent missed it. */
function ensureCredit(ref: ImageRef | null | undefined): Credit | null {
  if (!ref?.src) return null;
  if (ref.creditId && credits.has(ref.creditId)) return credits.get(ref.creditId)!;
  return null;
}

function modelCredit(m: Model3D | null | undefined, key: string): Credit | null {
  if (!m) return null;
  const assetId = `model-${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const existing = credits.get(assetId);
  if (existing) return existing;
  const credit: Credit = {
    assetId,
    kind: "model",
    source: m.sourceId ? "sketchfab" : "other",
    url: m.embedUrl ?? m.glb ?? "",
    license: m.license ?? null,
    author: m.author ?? null,
    retrieved: today,
    sourceId: m.sourceId ?? undefined,
    localPath: m.glb ?? null,
    note: m.embedUrl
      ? "Sketchfab embed — model streamed from Sketchfab CDN, never rehosted"
      : "local GLB",
  };
  credits.set(assetId, credit);
  return credit;
}

function videoCredit(v: VideoRef): Credit {
  const assetId = `video-${v.id}`;
  const existing = credits.get(assetId);
  if (existing) return existing;
  const credit: Credit = {
    assetId,
    kind: "video",
    source: "youtube",
    url: `https://www.youtube.com/watch?v=${v.id}`,
    license: "YouTube Terms of Service — embedded, not downloaded or rehosted",
    author: v.channel ?? null,
    retrieved: today,
    sourceId: v.id,
    localPath: null,
    note: v.note ?? null,
  };
  credits.set(assetId, credit);
  return credit;
}

/* ---------------------------------------------------------- bare-id index */
const variantIndex = new Map<string, string[]>(); // bare id -> ["gen/variant", ...]
for (const f of readdirSync(join(ROOT, "data/generations"))) {
  if (!f.endsWith(".json")) continue;
  const g = read<Generation>(`data/generations/${f}`);
  for (const v of g.variants) {
    const key = `${g.id}/${v.id}`;
    variantIndex.set(v.id, [...(variantIndex.get(v.id) ?? []), key]);
  }
}

/** canonical key first, then an unambiguous bare alias */
function resolve(
  map: Record<string, unknown> | undefined,
  genId: string,
  variantId: string,
): unknown {
  if (!map) return undefined;
  const canonical = `${genId}/${variantId}`;
  if (map[canonical] !== undefined) return map[canonical];
  const bare = map[variantId];
  if (bare === undefined) return undefined;
  const candidates = variantIndex.get(variantId) ?? [];
  if (candidates.length === 1) return bare;
  // ambiguous bare alias: only accept if the map has exactly one gen-scoped
  // entry for this id and they all carry identical content
  const scoped = Object.entries(map).filter(
    ([k]) => candidates.includes(k),
  ) as [string, unknown][];
  if (scoped.length === 0) return undefined;
  const [first] = scoped;
  return JSON.stringify(first[1]) === JSON.stringify(bare) ? bare : undefined;
}

/* ------------------------------------------------------------- merge pass */
const files = readdirSync(join(ROOT, "data/generations")).filter((f) =>
  f.endsWith(".json"),
);
let touched = 0;
const missing: string[] = [];

for (const f of files) {
  const rel = `data/generations/${f}`;
  const g = read<Generation>(rel);
  const genId = g.id;

  const gi = imgs.generations?.[genId];
  const gm = mods.generations?.[genId] ?? null;
  const gv = vids.entries?.[genId] ?? [];

  if (gi?.heroImage) g.heroImage = gi.heroImage;
  if (gi?.timelineImage) g.timelineImage = gi.timelineImage;
  if (gm) g.model3d = gm;
  if (gv.length) {
    g.videos = gv;
    gv.forEach((v) => void videoCredit(v));
  }
  const gCredits = [gi?.heroImage, gi?.timelineImage]
    .map((r) => ensureCredit(r))
    .filter((c): c is Credit => c !== null);
  if (gm) {
    const mc = modelCredit(gm, genId);
    if (mc) gCredits.push(mc);
  }
  if (gCredits.length) g.credits = gCredits;

  for (const v of g.variants as Variant[]) {
    const key = `${genId}/${v.id}`;
    const vi = resolve(imgs.variants, genId, v.id) as
      | { heroImage?: ImageRef | null; gallery?: ImageRef[] }
      | undefined;
    const vm = resolve(mods.variants, genId, v.id) as Model3D | null | undefined;
    const vv = vids.entries?.[key] ?? [];

    if (vi?.heroImage) v.heroImage = vi.heroImage;
    if (vi?.gallery?.length) v.gallery = vi.gallery;
    if (vm) v.model3d = vm;
    const tt = turntables.entries?.[key];
    if (tt?.dir) {
      v.model3d = { ...(v.model3d ?? {}), turntable: tt.dir };
      if (tt.synthetic) v.model3d.turntableSynthetic = true;
    }
    if (vv.length) {
      v.videos = vv;
      vv.forEach((x) => void videoCredit(x));
    }

    const vCredits: Credit[] = [];
    const hc = ensureCredit(vi?.heroImage);
    if (hc) vCredits.push(hc);
    for (const gref of (vi?.gallery ?? []).slice(0, 1)) {
      const gc = ensureCredit(gref);
      if (gc && gc.assetId !== hc?.assetId) vCredits.push(gc);
    }
    const mc = modelCredit(vm, key);
    if (mc) vCredits.push(mc);
    if (vCredits.length) v.credits = vCredits;

    if (!v.heroImage) missing.push(`${key}: no hero image`);
    if (!(v.gallery?.length ?? 0)) missing.push(`${key}: empty gallery`);
    if (!v.videos?.length && !vids.entries?.[genId]?.length) {
      missing.push(`${key}: no video (and none for its generation)`);
    }
    touched++;
  }

  if (!CHECK_ONLY) write(rel, g);
}

/* -------------------------------------------------------- credits + report */
if (!CHECK_ONLY) {
  creditsFile.generatedAt = new Date().toISOString();
  creditsFile.credits = [...credits.values()].sort((a, b) =>
    a.assetId.localeCompare(b.assetId),
  );
  write("data/credits.json", creditsFile);
}

const byKind = (k: Credit["kind"]) =>
  [...credits.values()].filter((c) => c.kind === k).length;
console.log(
  `${CHECK_ONLY ? "[check]" : "[merged]"} ${files.length} generations, ${touched} variants`,
);
console.log(
  `credits: ${credits.size} total (images ${byKind("image")}, models ${byKind(
    "model",
  )}, videos ${byKind("video")})`,
);
if (missing.length) {
  console.log(`missing media (${missing.length}):`);
  for (const m of missing) console.log("  -", m);
} else {
  console.log("missing media: none");
}
