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

import crypto from "node:crypto";
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

/** Rebuild the Wikimedia upload/thumb URL from the "File:…" title (md5 path). */
function commonsUrls(fileTitle: string): { origUrl: string; thumbUrl: string } {
  const name = fileTitle.slice(5).replace(/ /g, "_");
  const h = crypto.createHash("md5").update(name).digest("hex");
  const enc = encodeURIComponent(name);
  const dir = `${h[0]}/${h.slice(0, 2)}/${enc}`;
  return {
    origUrl: `https://upload.wikimedia.org/wikipedia/commons/${dir}`,
    thumbUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/${dir}/1920px-${enc}`,
  };
}

async function reDownload(credit: Credit): Promise<string | null> {
  const existing = findRaw(credit.assetId);
  if (existing) return existing;
  if (!credit.sourceId?.startsWith("File:")) return null;
  const { origUrl, thumbUrl } = commonsUrls(credit.sourceId);
  const ext = (path.extname(new URL(origUrl).pathname) || ".jpg").toLowerCase();
  const dest = path.join(RAW_DIR, `${credit.assetId}${ext}`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const url of [thumbUrl, origUrl]) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

  const rel = job.src.replace(/^\//, "");
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

async function main(): Promise<void> {
  const images = loadJson<ImagesFile>(IMAGES_JSON, {
    generatedAt: new Date().toISOString(),
    generations: {},
    variants: {},
  });
  const creditsFile = loadJson<{ credits: Credit[] }>(CREDITS_JSON, { credits: [] });
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