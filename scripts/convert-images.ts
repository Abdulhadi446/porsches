/**
 * ASSET-IMAGES — local image pipeline (sharp).
 *
 * Reads data/images.json + data/credits.json, converts every referenced source
 * into AVIF (640 / 1280 / 1920, never upscaling beyond the Commons source) and
 * WebP (1280), writes them to
 *   public/images/<variantId|genId>/<assetId>-<width>.<ext>
 * and back-fills `width`, `height` and a 16px-wide base64 `blurDataURL` into
 * data/images.json. Already-rendered files are skipped, so the script is
 * resumable; a missing original is re-downloaded from Wikimedia (never hotlinked).
 *
 * Run:  npx tsx scripts/convert-images.ts
 *       node --experimental-strip-types scripts/convert-images.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USER_AGENT =
  "porsche-911-showcase-image-pipeline/1.0 (unofficial fan showcase; contact: repository owner)";
const WORK_DIR = process.env.P911_WORK_DIR ?? "/tmp/opencode/p911";
const RAW_DIR = path.join(WORK_DIR, "raw");
const CACHE_DIR = path.join(WORK_DIR, "cache");
const API = "https://api.wikimedia.org/core/v1/commons";
const TARGET_W = 1920;
const IMAGES_JSON = path.join(ROOT, "data/images.json");
const CREDITS_JSON = path.join(ROOT, "data/credits.json");
const PUBLIC_DIR = path.join(ROOT, "public");

const AVIF_WIDTHS = [640, 1280, 1920];
const AVIF_QUALITY = 62;
const AVIF_EFFORT = 2; // effort 4 costs 8x the CPU for ~1% smaller files
const CONVERT_CONCURRENCY = Number(process.env.P911_CONVERT_CONCURRENCY ?? 3);
const WEBP_WIDTH = 1280;
const WEBP_QUALITY = 72;
const BLUR_WIDTH = 16;

interface Credit {
  assetId: string;
  sourceId: string;
  localPath: string;
  note: string;
  license: string | null;
  author: string | null;
}

interface ImagesFile {
  generatedAt: string;
  generations: Record<string, unknown>;
  variants: Record<string, unknown>;
}

interface ImageRefLike {
  src?: unknown;
  blurDataURL?: unknown;
  width?: unknown;
  height?: unknown;
  creditId?: unknown;
}

/* ------------------------------------------------------------- discovery */

function loadJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`! ${file} is not valid JSON: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function findRaw(assetId: string): string | null {
  if (!fs.existsSync(RAW_DIR)) return null;
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (f.startsWith(`${assetId}.`)) return path.join(RAW_DIR, f);
  }
  return null;
}

/** Width-specific Commons thumbnail derived from the original upload URL. */
function thumbUrlFor(origUrl: string, width: number): string | null {
  const clean = origUrl.split("?")[0];
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(
    clean,
  );
  if (!m) return null;
  const [, base, h1, h2, name] = m;
  return `${base.replace("upload", "thumb")}/thumb/${h1}/${h2}/${name}/${width}px-${name}`;
}

function cachePath(kind: string, key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0");
  return path.join(CACHE_DIR, kind, hex.slice(0, 2), `${hex}.json`);
}

interface Meta {
  origUrl: string;
  width: number;
  height: number;
}

/** Serialise REST calls: the shared API answers bursts with 429. */
let apiNextAt = 0;
async function apiGate(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, apiNextAt - now);
  apiNextAt = Math.max(now, apiNextAt) + 400;
  if (wait > 0) await sleep(wait);
}

/** `api.wikimedia.org` is the only Commons host reachable from this machine, so
 *  the exact upload URL is read from the REST file endpoint (cached on disk and
 *  shared with scripts/fetch-images.ts) instead of being rebuilt from the md5. */
async function metaFor(fileTitle: string): Promise<Meta | null> {
  const url = `${API}/file/${encodeURIComponent(fileTitle)}`;
  const cache = cachePath("meta", url);
  if (fs.existsSync(cache)) {
    try {
      return JSON.parse(fs.readFileSync(cache, "utf8")) as Meta | null;
    } catch {
      /* refetch */
    }
  }
  // api.wikimedia.org answers 429 to bursts, so every gap grows while it refuses
  let gap = 400;
  for (let attempt = 0; attempt <= 8; attempt++) {
    await apiGate();
    await sleep(gap);
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) {
        gap = Math.min(15000, Math.round(gap * 2));
        continue;
      }
      if (!res.ok) return null;
      const d = (await res.json()) as {
        original?: { url?: string; width?: number; height?: number };
      };
      const meta: Meta | null = d.original?.url
        ? {
            origUrl: d.original.url.split("?")[0],
            width: d.original.width ?? 0,
            height: d.original.height ?? 0,
          }
        : null;
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, JSON.stringify(meta));
      gap = Math.max(300, Math.round(gap * 0.8));
      return meta;
    } catch {
      gap = Math.min(15000, Math.round(gap * 2));
    }
  }
  return null;
}

async function reDownload(credit: Credit): Promise<string | null> {
  const existing = findRaw(credit.assetId);
  if (existing) return existing;
  if (!credit.sourceId?.startsWith("File:")) return null;
  const meta = await metaFor(credit.sourceId);
  if (!meta) return null;
  const ext = (path.extname(new URL(meta.origUrl).pathname) || ".jpg").toLowerCase();
  const dest = path.join(RAW_DIR, `${credit.assetId}${ext}`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const thumb = thumbUrlFor(meta.origUrl, TARGET_W);
  // never upscale: a 1920px thumb only exists when the original is at least that wide
  const urls = thumb && meta.width >= TARGET_W ? [thumb, meta.origUrl] : [meta.origUrl];
  for (const url of urls) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url.split("?")[0], { headers: { "User-Agent": USER_AGENT } });
        if (res.status === 429 || res.status >= 500) {
          await sleep(700 * 2 ** attempt);
          continue;
        }
        if (!res.ok) break;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 4096) break;
        fs.writeFileSync(dest, buf);
        console.log(`  ↓ re-downloaded ${credit.sourceId}`);
        return dest;
      } catch {
        await sleep(600 * 2 ** attempt);
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Source dimensions as recorded by the fetcher (never upscale past them). */
function sourceWidth(credit: Credit, fallback: number): number {
  const m = /source (\d+)[×x](\d+)px/.exec(credit.note ?? "");
  return m ? Number(m[1]) : fallback;
}

/* ------------------------------------------------------------ conversion */

interface Job {
  credit: Credit;
  refs: ImageRefLike[];
  src: string;
}

async function convertJob(job: Job): Promise<{ ok: boolean; blur: string | null; width: number; height: number }> {
  const raw = await reDownload(job.credit);
  if (!raw) {
    console.log(`  ! no source for ${job.credit.assetId} (${job.credit.sourceId})`);
    return { ok: false, blur: null, width: 0, height: 0 };
  }
  const image = sharp(raw, { failOn: "none" });
  const meta = await image.metadata();
  const rawW = meta.width ?? 0;
  const rawH = meta.height ?? 0;
  if (!rawW || !rawH) {
    console.log(`  ! unreadable source ${job.credit.assetId}`);
    return { ok: false, blur: null, width: 0, height: 0 };
  }
  const limit = Math.min(rawW, sourceWidth(job.credit, rawW));
  const widths = AVIF_WIDTHS.filter((w) => w <= limit);
  if (widths.length === 0) widths.push(rawW <= limit ? rawW : limit);

  // the credit's localPath is the single canonical location for this image
  const rel = (job.credit.localPath || job.src).replace(/^\//, "");
  const outDir = path.join(PUBLIC_DIR, path.dirname(rel));
  fs.mkdirSync(outDir, { recursive: true });

  for (const w of widths) {
    const file = path.join(outDir, `${job.credit.assetId}-${w}.avif`);
    if (!fs.existsSync(file) || fs.statSync(file).size < 512) {
      await sharp(raw, { failOn: "none" })
        .resize({ width: w, withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
        .toFile(file);
    }
  }
  const webpFile = path.join(outDir, `${job.credit.assetId}-${WEBP_WIDTH}.webp`);
  if (!fs.existsSync(webpFile) || fs.statSync(webpFile).size < 512) {
    await sharp(raw, { failOn: "none" })
      .resize({ width: Math.min(WEBP_WIDTH, limit), withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(webpFile);
  }

  const blurBuf = await sharp(raw, { failOn: "none" })
    .resize({ width: BLUR_WIDTH })
    .webp({ quality: 30 })
    .toBuffer();
  const blur = `data:image/webp;base64,${blurBuf.toString("base64")}`;

  const primary = widths[widths.length - 1];
  const primaryMeta = await sharp(path.join(outDir, `${job.credit.assetId}-${primary}.avif`)).metadata();
  return {
    ok: true,
    blur,
    width: primaryMeta.width ?? primary,
    height: primaryMeta.height ?? Math.round((primary * rawH) / rawW),
  };
}

/* ------------------------------------------------------------------ main */

interface VerifyRef {
  src: string;
  creditId?: string;
  blurDataURL?: unknown;
  width?: unknown;
}

/** Walk data/images.json and prove every referenced file exists on disk. */
function verify(images: ImagesFile, creditsFile: { credits: Credit[] }): void {
  const creditIds = new Set((creditsFile.credits ?? []).map((c) => c.assetId));
  const seen = new Set<string>();
  const missing: string[] = [];
  const unknownCredit: string[] = [];
  const noBlur: string[] = [];
  const seenCredit = new Set<string>();
  let refs = 0;
  let variantsWithHero = 0;
  let variantsWith5 = 0;
  let variantsTotal = 0;

  const check = (ref: VerifyRef, where: string): void => {
    refs++;
    const file = path.join(PUBLIC_DIR, ref.src.replace(/^\//, ""));
    if (!fs.existsSync(file) || fs.statSync(file).size < 512) missing.push(ref.src);
    if (!ref.creditId || !creditIds.has(ref.creditId)) unknownCredit.push(`${where} → ${ref.src}`);
    else seenCredit.add(ref.creditId);
    if (!ref.blurDataURL) noBlur.push(ref.src);
    seen.add(ref.src);
  };

  const genLines: string[] = [];
  for (const [genId, entry] of Object.entries(images.generations ?? {})) {
    const e = entry as { heroImage?: VerifyRef | null; timelineImage?: VerifyRef | null };
    for (const [role, ref] of [
      ["hero", e.heroImage],
      ["timeline", e.timelineImage],
    ] as const) {
      if (!ref) {
        genLines.push(`  ${genId}.${role}: MISSING (no ref)`);
        missing.push(`${genId}.${role}`);
        continue;
      }
      check(ref, `${genId}.${role}`);
      genLines.push(`  ${genId}.${role}: ${ref.src}`);
    }
  }
  const varLines: string[] = [];
  // per-generation keys are canonical; the plain-id aliases are the same entries
  const allKeys = Object.keys(images.variants ?? {});
  const slashed = allKeys.filter((k) => k.includes("/"));
  const canonical = new Set<string>(slashed);
  for (const k of allKeys) if (!k.includes("/") && !slashed.some((s) => s.endsWith(`/${k}`))) canonical.add(k);
  for (const key of [...canonical].sort()) {
    const e = (images.variants[key] ?? {}) as { heroImage?: VerifyRef | null; gallery?: VerifyRef[] };
    const gallery = e.gallery ?? [];
    variantsTotal++;
    if (e.heroImage) {
      variantsWithHero++;
      check(e.heroImage, `${key}.heroImage`);
    }
    for (const g of gallery) check(g, `${key}.gallery`);
    if (e.heroImage && gallery.length >= 5) variantsWith5++;
    varLines.push(
      `  ${key.padEnd(30)} hero ${e.heroImage ? "y" : "N"} · gallery ${gallery.length}${gallery.length < 5 ? "  <5" : ""}`,
    );
  }

  const orphanCredits = (creditsFile.credits ?? []).filter((c) => !seenCredit.has(c.assetId));

  console.log(`\nrefs ${refs} · distinct files ${seen.size} · exists ${seen.size - missing.length} · missing ${missing.length}`);
  console.log(`credits ${creditsFile.credits?.length ?? 0} · referenced ${seenCredit.size} · orphaned ${orphanCredits.length}`);
  console.log(`variants ${variantsTotal} · with hero ${variantsWithHero} · with >=5 gallery ${variantsWith5}`);
  console.log(`refs without blurDataURL: ${noBlur.length}`);
  console.log(`refs with unknown creditId: ${unknownCredit.length}`);
  if (process.env.P911_VERIFY_QUIET !== "1") {
    console.log("\ngenerations:\n" + genLines.join("\n"));
    console.log("\nvariants:\n" + varLines.join("\n"));
  }
  if (missing.length) console.log(`\nMISSING FILES:\n  ${[...new Set(missing)].join("\n  ")}`);
  if (orphanCredits.length) {
    console.log(`\nORPHAN CREDITS (no ref):\n  ${orphanCredits.map((c) => `${c.assetId} ${c.sourceId}`).join("\n  ")}`);
  }
  if (unknownCredit.length) console.log(`\nUNKNOWN creditId:\n  ${unknownCredit.slice(0, 20).join("\n  ")}`);
  console.log(`\npublic/images size ${(du(path.join(PUBLIC_DIR, "images")) / 1e6).toFixed(1)} MB`);
  if (missing.length || unknownCredit.length) process.exitCode = 1;
}

/** Delete rendered files that no ImageRef in data/images.json points at (a
 *  photo's canonical directory can move between runs; nothing is orphaned). */
function prune(images: ImagesFile, dry: boolean): void {
  const keep = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.src === "string" && typeof obj.creditId === "string") {
      const src = obj.src.replace(/^\//, "");
      keep.add(src);
      // one credit renders to AVIF 640/1280/1920 + WebP 1280 next to the src
      const base = src.replace(/-\d+\.\w+$/, "");
      for (const f of ["-640.avif", "-1280.avif", "-1920.avif", "-1280.webp"]) keep.add(`${base}${f}`);
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(images.generations);
  walk(images.variants);
  const root = path.join(PUBLIC_DIR, "images");
  let bytes = 0;
  const stale: string[] = [];
  const scan = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "_placeholder" || entry.name === "README.md") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(p);
        if (fs.readdirSync(p).length === 0) {
          fs.rmdirSync(p);
          stale.push(`${path.relative(PUBLIC_DIR, p)}/ (dir)`);
        }
        continue;
      }
      const rel = path.relative(PUBLIC_DIR, p);
      if (keep.has(rel)) continue;
      stale.push(rel);
      if (!dry) {
        bytes += fs.statSync(p).size;
        fs.unlinkSync(p);
      }
    }
  };
  if (!fs.existsSync(root)) return;
  scan(root);
  console.log(
    `${dry ? "would remove" : "removed"} ${stale.length} unreferenced files (${(bytes / 1e6).toFixed(1)} MB)`,
  );
  if (stale.length && dry) console.log(`  ${stale.slice(0, 20).join("\n  ")}`);
}

async function main(): Promise<void> {
  const images = loadJson<ImagesFile>(IMAGES_JSON, {
    generatedAt: new Date().toISOString(),
    generations: {},
    variants: {},
  });
  const creditsFile = loadJson<{ credits: Credit[] }>(CREDITS_JSON, { credits: [] });
  if (process.argv.includes("--prune")) {
    prune(images, process.argv.includes("--dry-run"));
    return;
  }
  if (process.argv.includes("--verify")) {
    verify(images, creditsFile);
    return;
  }
  const credits = new Map<string, Credit>();
  for (const c of creditsFile.credits ?? []) credits.set(c.assetId, c);

  /* collect every ImageRef that points at a credit ------------------------ */
  const jobs = new Map<string, Job>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const ref = obj as ImageRefLike;
    if (typeof ref.src === "string" && typeof ref.creditId === "string") {
      const credit = credits.get(ref.creditId);
      if (credit) {
        const existing = jobs.get(ref.creditId);
        if (existing) {
          existing.refs.push(ref);
          if (ref.src.endsWith(".avif")) existing.src = ref.src;
        } else {
          jobs.set(ref.creditId, { credit, refs: [ref], src: ref.src });
        }
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(images.generations);
  walk(images.variants);
  console.log(`${jobs.size} distinct images referenced by ${[...jobs.values()].reduce((n, j) => n + j.refs.length, 0)} refs`);

  let done = 0;
  let failed = 0;
  let written = 0;
  const queue = [...jobs.values()];
  const workers = Array.from({ length: Math.min(CONVERT_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const result = await convertJob(job);
      if (!result.ok) failed++;
      else {
        written++;
        for (const ref of job.refs) {
          ref.blurDataURL = result.blur;
          ref.width = result.width;
          ref.height = result.height;
        }
      }
      done++;
      if (done % 25 === 0) console.log(`  converted ${done}/${jobs.size}`);
    }
  });
  await Promise.all(workers);

  images.generatedAt = new Date().toISOString();
  fs.writeFileSync(IMAGES_JSON, `${JSON.stringify(images, null, 2)}\n`);

  const bytes = du(path.join(PUBLIC_DIR, "images"));
  console.log(
    `converted ${written}/${jobs.size} images (${failed} failed) · public/images now ${(bytes / 1e6).toFixed(1)} MB · blur placeholders written to data/images.json`,
  );
}

function du(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? du(p) : fs.statSync(p).size;
  }
  return total;
}

await main();

export {};