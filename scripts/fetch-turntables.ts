/**
 * ASSET-TURNTABLES — image-sequence turntable builder (viewer tier 3).
 *
 * Contract with components/variant/turntable-3d.tsx (owned by VARIANT-PAGES, do
 * not change it here):
 *
 *     public/turntables/<genId>__<variantId>/frame-000.webp
 *     public/turntables/<genId>__<variantId>/frame-001.webp …
 *
 * Frames must be CONTIGUOUS from 000 (the viewer probes sequentially and stops
 * after three misses), so a directory is only published when every frame index
 * it declares exists. Each entry also lands in data/turntables.json and in the
 * additive `turntables` map of data/models.json.
 *
 * HONESTY RULES enforced by this script
 * ------------------------------------
 * 1. A frame is a real photograph of a real car. Nothing is generated, redrawn
 *    or colourised.
 * 2. A sequence may only contain photographs of THE SAME PHYSICAL CAR. The
 *    evidence used (all of it recorded per frame in
 *    data/turntable-credits.json) is:
 *      a. an identical series stem — the Commons file name minus its trailing
 *         disambiguator (`_(12)`, `_(front)`, `_(flickr id)`, `_03`, …);
 *      b. an identical rendered-file-page Description (the "English :" sentence
 *         with the file-name echo removed);
 *      c. an identical Author on every member;
 *      d. text that positively names THIS variant and THIS generation — never
 *         inferred from the family alone (chassis code / air-cooled engine size
 *         / model year must appear);
 *      e. every member's licence parsed from its own Commons file page and
 *         restricted to CC0 / PD / CC BY / CC BY-SA 2.0/3.0/4.0;
 *      f. pairwise perceptual distance, so a "sequence" cannot be the same
 *         angle photographed twice.
 *    If any of those fail the sequence is NOT assembled — the variant is
 *    reported as missing instead. Photographs of different cars are never
 *    mixed into one directory.
 * 3. Frame ORDER is not invented: it is either the camera azimuth stated in the
 *    file names, or the shoot's own numbering.
 * 4. The only derived frames are the clearly labelled `synthetic` parallax
 *    sequences ("synthetic pans"), where ONE photograph is re-rendered at N
 *    crop offsets. They are honest motion, never a fake viewing angle, and
 *    every manifest entry says `"synthetic": true`.
 *
 * Pipeline (re-runnable, resumable, polite):
 *   search → group into same-car series → licence + identity check → download →
 *   sharp → 640px WebP frames → data/turntables.json +
 *   data/turntable-credits.json + the additive `turntables` map of
 *   data/models.json
 *
 * Usage:
 *   npx tsx scripts/fetch-turntables.ts --priority
 *   npx tsx scripts/fetch-turntables.ts --all
 *   npx tsx scripts/fetch-turntables.ts --gen 993 --gen 992-1
 *   npx tsx scripts/fetch-turntables.ts --variants 993/carrera,997/gt2-rs
 *   npx tsx scripts/fetch-turntables.ts --all --analyse     # plan only
 *   npx tsx scripts/fetch-turntables.ts --all --only-real   # no synthetic pans
 *   npx tsx scripts/fetch-turntables.ts --all --boards      # QA contact sheets
 *   node --experimental-strip-types scripts/fetch-turntables.ts --all
 *
 * API responses are cached under $P911_WORK_DIR (default /tmp/opencode/p911)
 * with the same cache layout, User-Agent and adaptive throttling as
 * scripts/fetch-images.ts, so the two pipelines share cached answers and never
 * burst the API. data/turntables.json and data/turntable-credits.json are
 * rewritten after every target car, so an interrupted run leaves valid data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USER_AGENT =
  "porsche-911-showcase-turntable-pipeline/1.0 (unofficial fan showcase; contact: repository owner)";
const API = "https://api.wikimedia.org/core/v1/commons";

const WORK_DIR = process.env.P911_WORK_DIR ?? "/tmp/opencode/p911";
const CACHE_DIR = path.join(WORK_DIR, "cache");
const RAW_DIR = path.join(WORK_DIR, "raw");
const BOARD_DIR = path.join(WORK_DIR, "boards");

const TURNTABLE_DIR = path.join(ROOT, "public/turntables");
const TURNTABLES_JSON = path.join(ROOT, "data/turntables.json");
const TT_CREDITS_JSON = path.join(ROOT, "data/turntable-credits.json");
const MODELS_JSON = path.join(ROOT, "data/models.json");
const GEN_DIR = path.join(ROOT, "data/generations");

const CONCURRENCY = Number(process.env.P911_CONCURRENCY ?? 4);
const MIN_GAP_MS = Number(process.env.P911_GAP_MS ?? 350);
const MAX_GAP_MS = 4000;
const SEARCH_LIMIT = 50;
const MAX_RETRIES = 8;
const DOWNLOAD_W = 1200; // frames are 640px wide; never pull a 6000px original

/* ---- frame shape (see the contract at the top of this file) -------------- */
const FRAME_W = Number(process.env.P911_TT_WIDTH ?? 640); // long edge
const FRAME_H = Math.round((FRAME_W * 9) / 16); // 16:9, the stage's aspect
const WEBP_QUALITY = Number(process.env.P911_TT_QUALITY ?? 72);
const MAX_FRAMES = 72; // hard cap from the viewer
const TARGET_FRAMES = Number(process.env.P911_TT_FRAMES ?? 24);
const MIN_REAL_FRAMES = Number(process.env.P911_TT_MIN ?? 6);
/** A hero car accepts a shorter proven series: 4 real angles beat no viewer. */
const HERO_MIN_FRAMES = Number(process.env.P911_TT_MIN_HERO ?? 4);

function frameBar(target: { priority: number }): number {
  return target.priority >= 0 ? Math.min(MIN_REAL_FRAMES, HERO_MIN_FRAMES) : MIN_REAL_FRAMES;
}
const SYNTHETIC_FRAMES = Number(process.env.P911_TT_SYNTH ?? 24);
const MIN_SOURCE_W = Number(process.env.P911_TT_MIN_SOURCE_W ?? 900);
const MIN_DIST = Number(process.env.P911_TT_MIN_DIST ?? 10); // dHash bits of 64
const MAX_GROUPS = Number(process.env.P911_TT_MAX_GROUPS ?? 6);
const HASH_CHUNK = Number(process.env.P911_TT_CHUNK ?? 8); // photos hashed per batch
const MAX_HUE_GAP = Number(process.env.P911_TT_MAX_HUE ?? 45); // degrees
const MAX_VALUE_GAP = Number(process.env.P911_TT_MAX_VALUE ?? 70); // 0-255

/* ------------------------------------------------------------------ types */

type GenerationId =
  | "901"
  | "gseries"
  | "964"
  | "993"
  | "996"
  | "997"
  | "991"
  | "992-1"
  | "992-2";

interface VariantLite {
  id: string;
  name: string;
  bodyStyles?: string[];
  special?: boolean;
}

interface GenerationLite {
  id: GenerationId;
  index?: number;
  code: string;
  name: string;
  variants: VariantLite[];
}

interface Target {
  key: string;
  gen: GenerationId;
  variantId: string;
  name: string;
  required: string[];
  forbidden: string[];
  queries: string[];
  priority: number;
  /** narrower than the generation window where a variant spans fewer years */
  years: [number, number] | null;
  /** already served by a glb or a Sketchfab embed → the viewer never reaches
   *  tier 3, so a turntable for it would only cost disk */
  skip: boolean;
}

interface FileMeta {
  origUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
  uploader: string | null;
}

interface PageInfo {
  ok: boolean;
  reason: string;
  license: string | null;
  author: string | null;
  assessment: string | null;
  /** normalised "English :" description with the file-name echo removed */
  desc: string;
  date: string;
  source: string;
}

interface Frame {
  fileTitle: string;
  angle: string | null;
  seriesNo: number;
  creditId: string;
}

interface Entry {
  dir: string;
  frames: number;
  synthetic: boolean;
  sources: string[];
}

interface CreditOut {
  assetId: string;
  kind: "image";
  source: "wikimedia";
  url: string;
  license: string | null;
  author: string | null;
  retrieved: string;
  sourceId: string;
  localPath: string;
  note: string;
}

interface ModelsFile {
  variants?: Record<string, { glb?: string | null; embedUrl?: string | null } | null>;
  generations?: Record<string, unknown>;
  turntables?: Record<string, string>;
  [key: string]: unknown;
}

const REJECT: PageInfo = {
  ok: false,
  reason: "not fetched",
  license: null,
  author: null,
  assessment: null,
  desc: "",
  date: "",
  source: "",
};

/* ---------------------------------------------------------------- targets */

/** The hero / timeline cars, in the order the lead asked for. */
const PRIORITY: string[] = [
  "901/911-2.0",
  "901/porsche-901",
  "gseries/turbo-3.3-930",
  "964/carrera-4",
  "993/carrera",
  "993/turbo",
  "996/gt3",
  "997/gt2-rs",
  "997/sport-classic",
  "991/gt2-rs",
  "991/r",
  "992-1/gt3-rs",
  "992-1/dakar",
  "992-1/s-t",
  "992-2/turbo-s",
  "992-2/carrera-gts",
];

const DISPLACEMENTS = ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.6", "3.8", "4.0"];

/** Longest-first: the longest phrase in a variant name is its model key. */
const MODEL_PHRASES = [
  "carrera rsr",
  "carrera rs",
  "carrera 4 gts",
  "carrera t",
  "sport classic",
  "mt package",
  "lm-gt",
  "sc rs",
  "sc",
  "gt3 s/c",
  "gt2 rs",
  "gt3 rs",
  "gt3",
  "gt2",
  "turbo s",
  "turbo",
  "carrera",
  "rsr",
  "rs",
  "gts",
  "s/t",
  "t/r",
  "dakar",
  "leichtbau",
  "flachbau",
  "cup",
  "classic",
  "anniversary",
  "heritage",
  "commemorative",
  "weissach",
  "s/c",
  "america",
  "million",
  "r",
  "s",
  "e",
  "l",
  "t",
];

/** Names of other special editions — never acceptable for this variant. */
const SPECIAL_PHRASES = [
  "turbo",
  "carrera rsr",
  "sc rs",
  "carrera rs",
  "rsr",
  "rs",
  "st",
  "s/t",
  "t/r",
  "leichtbau",
  "flachbau",
  "lm-gt",
  "cup",
  "dakar",
  "sport classic",
  "classic",
  "anniversary",
  "heritage",
  "commemorative",
  "weissach",
  "s/c",
  "america",
  "million",
  "4s",
  "2s",
  "gts",
];

const BODY_TOKEN: Record<string, string> = {
  targa: "targa",
  cabriolet: "cabriolet",
  speedster: "speedster",
  roadster: "roadster",
};

/** Model keys that are only meaningful next to the model number. */
const ANCHORED_KEYS = new Set(["st", "s/t", "t/r", "r"]);

/** Engine sizes no car of that generation ever wore. */
const ERA_FORBIDDEN: Record<GenerationId, string[]> = {
  "901": ["2.7", "3.0", "3.2", "3.3", "3.4", "3.6", "3.8", "4.0"],
  gseries: ["2.0", "2.2", "2.4", "3.4", "3.6", "3.8", "4.0"],
  "964": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3"],
  "993": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3"],
  "996": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3"],
  "997": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.4"],
  "991": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.4", "3.6"],
  "992-1": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.4", "3.6", "3.8"],
  "992-2": ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.4", "3.6", "3.8"],
};

/** Model years a generation could plausibly be photographed in. */
const GEN_YEARS: Record<GenerationId, [number, number]> = {
  "901": [1962, 1974],
  gseries: [1973, 1990],
  "964": [1988, 1995],
  "993": [1994, 1999],
  "996": [1997, 2006],
  "997": [2004, 2013],
  "991": [2011, 2020],
  "992-1": [2018, 2024],
  "992-2": [2024, 2030],
};

/** Which chassis code belongs to which generation. */
const CODE_GEN: Record<string, GenerationId> = {
  "901": "901",
  "912": "901",
  "914": "901",
  "930": "gseries",
  "964": "964",
  "993": "993",
  "996": "996",
  "997": "997",
  "991": "991",
  "992": "992-1",
};

interface Override {
  extraQueries?: string[];
  extraRequired?: string[];
  extraForbidden?: string[];
  dropRequired?: string[];
  /** the variant's own model-year window, when it is narrower than its generation */
  years?: [number, number];
}

const OVERRIDES: Record<string, Override> = {
  // the 1963-65 prototype only: a 1966+ "Porsche 901 911" file is a production
  // 911 that carries the old type number, not the prototype
  "901/porsche-901": {
    extraQueries: ["Porsche 901 prototype 1964"],
    years: [1963, 1965],
  },
  "901/911-r": { extraQueries: ["Porsche 911 R 1971"] },
  "901/s-t": { extraQueries: ["Porsche 911 S/T 1971"] },
  "901/911-t-r": { extraQueries: ["Porsche 911 T/R"] },
  "901/912": { extraQueries: ["Porsche 912"] },
  "964/carrera-4s": { extraRequired: ["4s"] },
  "964/carrera-2s": { extraRequired: ["2s"] },
  "964/rs-america": { extraQueries: ["Porsche 964 RS America"] },
  "964/30th-anniversary": { extraQueries: ["Porsche 964 30 Jahre"] },
  "964/carrera-4-leichtbau": { extraQueries: ["Porsche 964 Carrera 4 Lightweight"] },
  "964/turbo-s-lm-gt": { extraQueries: ["Porsche 964 LM GT"] },
  "991/r": { extraQueries: ["Porsche 911 R 2016"] },
  "991/50th-anniversary": { extraQueries: ["Porsche 911 50th anniversary"] },
  "991/935": { extraQueries: ["Porsche 935"] },
  "996/40th-anniversary": { extraQueries: ["Porsche 996 40 Jahre"] },
  "996/millennium-edition": { extraQueries: ["Porsche 996 Millennium Edition"] },
  "997/gt3-rs-4.0": { extraRequired: ["4.0"] },
  "gseries/speedster-1989": { extraQueries: ["Porsche 911 Speedster 1989"] },
  "gseries/sc-weissach": { extraRequired: ["weissach"] },
  "992-2/spirit-70": { extraRequired: ["spirit"] },
  "992-2/carrera-4-gts-transfagarasan": {
    extraQueries: ["Porsche 911 Carrera 4 GTS Transfagarasan"],
  },
  "992-2/gt3-90-fa-porsche": { extraQueries: ["Porsche 911 GT3 90 FA Porsche"] },
  "992-2/turbo-s": { extraForbidden: ["safety car"] },
  "992-1/turbo-50": { extraRequired: ["50"] },
  "964/turbo-s-3.6": { extraForbidden: ["safari"] },
};

/**
 * Files whose photograph contradicts the title (found by visual QA while
 * building this pipeline). Never used in any sequence, in any generation.
 */
const BLACKLIST: Record<string, string> = {
  "File:Porsche_911_R_(front).jpg":
    'title "911 R" is ambiguous and the photo shows a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(rear).jpg":
    'same unlabelled "911 R" set — a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(side)_(1).jpg":
    'same unlabelled "911 R" set — a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(side)_(2).jpg":
    'same unlabelled "911 R" set — a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_r.jpg": 'ambiguous title "911 r", the photo shows a 1990s coupe',
  "File:1964_Porsche_901.jpg":
    'titled "1964 Porsche 901", no road 901 exists; the photo shows a flared-arch 1990s 911',
  "File:1964_Porsche_901_Red_HCC21.jpg":
    "sibling of the excluded 1964_Porsche_901.jpg by the same photographer",
};

/** Titles that never show a whole car in a scene — never a turntable frame. */
const NOT_A_FRAME = [
  "interior",
  "cockpit",
  "dashboard",
  "engine",
  "gearbox",
  "transmission",
  "seat",
  "steering",
  "pedal",
  "odometer",
  "instrument",
  "cluster",
  "gauge",
  "switch",
  "button",
  "key",
  "detail",
  "badge",
  "emblem",
  "taillight",
  "tail_light",
  "tailgate",
  "headlight",
  "head_light",
  "wheel",
  "tyre",
  "tire",
  "rim",
  "mirror",
  "exhaust",
  "brake",
  "spoiler",
  "wing",
  "door",
  "handle",
  "sill",
  "roof",
  "bonnet",
  "hood",
  "grille",
  "bumper",
  "latch",
  "number",
  "plate",
  "sign",
  "sticker",
  "decal",
  "fender",
  "book",
  "brochure",
  "poster",
  "advert",
  "catalog",
  "cover art",
];

const NOISE = [
  "diecast",
  "toy",
  "toys",
  "toyota",
  "model car",
  "scale model",
  "scalemodel",
  "hot wheels",
  "matchbox",
  "lego",
  "papercraft",
  "drawing",
  "painting",
  "blueprint",
  "logo",
  "illustration",
  "artwork",
  "airbrush",
  "livery",
  "joustra",
  "render",
  "sketch",
  "comic",
  "t-shirt",
  "t shirt",
  "mug",
  "diorama",
  "video game",
  "forza",
  "gran turismo",
  "need for speed",
  "assetto",
  "kit car",
  "replica",
  "rat rod",
  "hot rod",
  "liberty walk",
  "police",
  "polizei",
  "military",
  "taxi",
  "crash",
  "wreck",
  "accident",
  "burnt",
  "burned",
  "derailed",
];

/** The car is a speck, or the subject is something else entirely. */
const SCENE_NOISE = [
  "corner",
  "crossroad",
  "intersection",
  "street",
  "traffic",
  "parking",
  "panorama",
  "cityscape",
  "building",
  "storefront",
  "auction",
  "museum",
  "exhibition",
  "auto show",
  "car show",
  "motor show",
  "podium",
  "crowd",
  "parade",
  "rallye",
  "rally",
  "track day",
  "on track",
  "circuit",
  "drift",
  "burnout",
  "pit lane",
  "garage",
  "workshop",
  "engine bay",
];

const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;

/* ------------------------------------------------------------- utilities */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adaptive politeness: Wikimedia answers 429 to bursts, so every refusal widens
 * the gap and every success narrows it again — quickly, because a gap that only
 * relaxes by 3% turns one burst into an hour of crawling.
 */
let throttleGap = MIN_GAP_MS;
function throttled(): void {
  const next = Math.min(MAX_GAP_MS, Math.round(throttleGap * 1.8));
  if (next !== throttleGap) {
    throttleGap = next;
    console.log(`    [throttle] gap -> ${throttleGap}ms (429 from Wikimedia)`);
  }
}
function relaxed(): void {
  if (throttleGap > MIN_GAP_MS) {
    throttleGap = Math.max(MIN_GAP_MS, Math.round(throttleGap * 0.7));
  }
}

/** Bounded-concurrency map with a minimum gap between request starts. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;
  let lastStart = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const wait = Math.max(0, lastStart + throttleGap - Date.now());
      lastStart = Date.now() + wait;
      if (wait > 0) await sleep(wait);
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function slug(s: string, max: number): string {
  const out = s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return out.length > 0 ? out : "frame";
}

/** Normalised text used for every title / description comparison. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[“”"'’]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\.(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasToken(text: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(token)}([^a-z0-9]|$)`).test(text);
}

/** Single-letter model keys only count next to the model number or an engine size. */
function hasModelToken(text: string, token: string): boolean {
  if (token.length > 1) return hasToken(text, token);
  return new RegExp(
    `911\\s*${escapeRe(token)}([^a-z0-9]|$)|\\b${escapeRe(token)}\\s*[234]\\.`,
  ).test(text);
}

function stripQuery(u: string): string {
  return u.split("?")[0];
}

/** `<genId>__<variantId>` — filesystem-safe and unique across generations. */
function dirFor(key: string): string {
  return key.replace("/", "__");
}

function pageUrlFor(fileTitle: string): string {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, "_"))}`;
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

/* ------------------------------------------------------------ http layer */

async function request(url: string, accept: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Api-User-Agent": USER_AGENT,
          Accept: accept,
        },
      });
      if (res.status === 404) return "";
      if (res.status === 429) {
        throttled();
        await sleep(700 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      if (res.status >= 500) {
        await sleep(600 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      if (!res.ok) return "";
      relaxed();
      return await res.text();
    } catch {
      await sleep(500 * 2 ** attempt + Math.random() * 300);
    }
  }
  process.stderr.write(`  ! request failed: ${url}\n`);
  return "";
}

function cacheFile(kind: string, key: string): string {
  const h = hash(key);
  return path.join(CACHE_DIR, kind, h.slice(0, 2), `${h}.json`);
}

function readCache<T>(kind: string, key: string): T | null {
  const p = cacheFile(kind, key);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeCache(kind: string, key: string, value: unknown): void {
  const p = cacheFile(kind, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value));
}

/* ---------------------------------------------------------- commons calls */

async function searchCommons(query: string): Promise<string[]> {
  const url = `${API}/search/page?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`;
  const cached = readCache<{ pages: { key: string }[] }>("search", url);
  if (cached) return cached.pages.map((p) => p.key);
  const body = await request(url, "application/json");
  let pages: string[] = [];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { pages?: { key: string }[] };
      pages = (parsed.pages ?? [])
        .map((p) => p.key)
        .filter((k) => typeof k === "string" && k.startsWith("File:"));
    } catch {
      pages = [];
    }
  }
  // an empty result set from a throttled request must never poison the cache
  if (body) writeCache("search", url, { pages: pages.map((key) => ({ key })) });
  return pages;
}

/** Width-specific Commons thumbnail derived from the original upload URL. */
function thumbUrlFor(origUrl: string, width: number): string {
  const clean = stripQuery(origUrl);
  const m =
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(
      clean,
    );
  if (!m) return clean;
  const [, base, h1, h2, name] = m;
  return `${base.replace("upload", "thumb")}/thumb/${h1}/${h2}/${name}/${width}px-${name}`;
}

async function fileMeta(fileTitle: string): Promise<FileMeta | null> {
  const url = `${API}/file/${encodeURIComponent(fileTitle)}`;
  const cached = readCache<FileMeta | null>("meta", url);
  if (cached !== null) return cached;
  const body = await request(url, "application/json");
  let meta: FileMeta | null = null;
  if (body) {
    try {
      const d = JSON.parse(body) as {
        original?: { url?: string; width?: number; height?: number; size?: number };
        latest?: { user?: { name?: string } };
      };
      const w = d.original?.width ?? 0;
      if (d.original?.url && w > 0) {
        meta = {
          origUrl: stripQuery(d.original.url),
          thumbUrl: thumbUrlFor(d.original.url, DOWNLOAD_W),
          width: w,
          height: d.original.height ?? 0,
          bytes: d.original.size ?? 0,
          uploader: d.latest?.user?.name ?? null,
        };
      }
    } catch {
      meta = null;
    }
  }
  if (body) writeCache("meta", url, meta);
  return meta;
}

async function pageInfo(fileTitle: string, uploader: string | null): Promise<PageInfo> {
  const url = `${API}/page/${encodeURIComponent(fileTitle)}/html`;
  const cached = readCache<PageInfo | null>("licence", url);
  if (cached !== null) return cached;
  const body = await request(url, "text/html");
  const info = parsePage(body, uploader, fileTitle);
  // only cache a real answer, never a transient network failure
  if (body.length > 800) writeCache("licence", url, info);
  return info;
}

async function download(url: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) return true;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(stripQuery(url), {
        headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
      });
      if (res.status === 429) {
        throttled();
        await sleep(800 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      if (res.status >= 500) {
        await sleep(700 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      if (!res.ok) return false;
      relaxed();
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4096) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch {
      await sleep(600 * 2 ** attempt);
    }
  }
  return false;
}

/* ------------------------------------------------------------ page parse */

const CC_LICENSE_URL = /https?:\/\/creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/g;
const CC0_URL = /https?:\/\/creativecommons\.org\/publicdomain\/zero\/([0-9.]+)/g;
const PDMARK_URL = /https?:\/\/creativecommons\.org\/publicdomain\/mark\/([0-9.]+)/g;

const INFO_BOX_LABELS = [
  "Camera location",
  "Camera model",
  "Exposure time",
  "F number",
  "Focal length",
  "ISO speed",
  "Date",
  "Source",
  "Assessment",
  "Summary",
  "Description",
  "Categories",
  "Licensing",
  "Permission",
  "File history",
  "Structured data",
  "Other versions",
];

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/\s+/g, " ");
}

function licenseShort(code: string, version: string): string {
  const map: Record<string, string> = {
    by: "CC BY",
    "by-sa": "CC BY-SA",
    "by-nc": "CC BY-NC",
    "by-nd": "CC BY-ND",
    "by-nc-sa": "CC BY-NC-SA",
    "by-nc-nd": "CC BY-NC-ND",
  };
  return `${map[code] ?? code.toUpperCase()} ${version}`;
}

/**
 * Positive identification only: CC0 / public domain / CC BY / CC BY-SA
 * 2.0/3.0/4.0. Nothing is inferred — a licence that cannot be read off the
 * rendered Commons file page is a rejection, never a guess.
 */
function parseLicence(text: string): PageInfo {
  const reject = (reason: string): PageInfo => ({
    ...REJECT,
    reason,
  });
  const own = ownLicenceSentence(text);
  const assessment = /this is a featured picture/i.test(text)
    ? "Featured picture"
    : /this is a quality image/i.test(text)
      ? "Quality image"
      : /this is a valued image/i.test(text)
        ? "Valued image"
        : null;
  const author = parseAuthor(text);
  if (own && /non-?free|fair use|copyright violation/i.test(own)) {
    return reject("non-free / fair use");
  }
  let short: string | null = null;
  CC_LICENSE_URL.lastIndex = 0;
  const cc = CC_LICENSE_URL.exec(text);
  if (cc && !/nc|nd/.test(cc[1])) short = licenseShort(cc[1], cc[2]);
  if (!short) {
    CC0_URL.lastIndex = 0;
    const zero = CC0_URL.exec(text);
    if (zero) short = `CC0 ${zero[1]}`;
  }
  if (!short) {
    PDMARK_URL.lastIndex = 0;
    const mark = PDMARK_URL.exec(text);
    if (mark) short = `Public Domain Mark ${mark[1]}`;
  }
  if (!short && /public domain|no known copyright restrictions/i.test(text)) {
    short = "Public domain";
  }
  if (!short) return reject("licence not identified in file page");
  if (!/^(CC0|CC BY|CC BY-SA|Public domain|Public Domain Mark)/.test(short)) {
    return reject(`licence not accepted: ${short}`);
  }
  const version = Number(short.split(" ").pop() ?? "0");
  if (/^CC (BY|BY-SA)/.test(short) && !(version === 2 || version === 3 || version === 4)) {
    return reject(`licence version not accepted: ${short}`);
  }
  return {
    ok: true,
    reason: "ok",
    license: own ? `${short} — ${tidySentence(own)}` : short,
    author,
    assessment,
    desc: "",
    date: "",
    source: "",
  };
}

function ownLicenceSentence(text: string): string | null {
  const patterns = [
    /This (?:file|image|work|photo|photograph|media) is licensed under the ([^.]*?licen[sc]e)\./i,
    /This (?:file|image|work|photo|photograph) is in the public domain[^.]*\./i,
    /This (?:file|image|work|photo|photograph) has been released (?:in)?to the public domain[^.]*\./i,
    /This work is released under the (?:Creative Commons )?CC0[^.]*\./i,
    /This image is released to the public domain[^.]*\./i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

function tidySentence(s: string): string {
  return s
    .replace(/^\s*this (?:file|image|work|photo|photograph|media)\s+/i, "")
    .replace(/^\s*(?:is|has been)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

function parseAuthor(text: string): string | null {
  const head = text.slice(0, 8000);
  const stop = INFO_BOX_LABELS.map(escapeRe).join("|");
  const strict = new RegExp(`\\bAuthor\\b\\s+([^|]{1,180}?)(?=\\s*(?:${stop})\\b)`, "i").exec(head);
  if (strict) {
    const a = strict[1].replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
    if (
      a.length > 0 &&
      a.length < 160 &&
      !/^(the|a|an|unknown|self|own work|user)$/i.test(a)
    ) {
      return a;
    }
  }
  const loose = new RegExp(
    `\\bAuthor\\b\\s+(.{1,140}?)(?=\\s(?:Camera|Assessment|Licensing|File history)\\b)`,
    "i",
  ).exec(head);
  if (loose) {
    const a = loose[1].replace(/\s+/g, " ").trim();
    if (a.length > 1) return a;
  }
  return null;
}

/** Info-box value that follows a label, up to the next label. */
function infoValue(text: string, label: string): string {
  const i = text.indexOf(label);
  if (i < 0) return "";
  const rest = text.slice(i + label.length);
  const next = INFO_BOX_LABELS.filter((l) => l !== label)
    .map(escapeRe)
    .join("|");
  const m = new RegExp(`^(.{0,220}?)(?=\\s(?:${next})\\b)`).exec(rest);
  const v = (m ? m[1] : rest.slice(0, 160)).replace(/\s+/g, " ").trim();
  return v.replace(/[.,;]+$/, "");
}

function parsePage(html: string, uploader: string | null, fileTitle: string): PageInfo {
  if (!html || html.length < 800) return { ...REJECT, reason: "file page html unavailable" };
  const text = htmlToText(html);
  const lic = parseLicence(text);
  return {
    ...lic,
    author: lic.author ?? (uploader ? `uploader ${uploader}` : null),
    desc: cleanDesc(infoValue(text, "Description"), fileTitle),
    date: infoValue(text, "Date"),
    source: infoValue(text, "Source"),
  };
}

/**
 * The description reduced to a comparable identity: the "English :" sentence,
 * with the file-name echo and per-shot numbers removed. Two files that describe
 * the same car the same way reduce to the same string; two files that describe
 * different cars never do.
 */
function cleanDesc(raw: string, fileTitle: string): string {
  let d = raw;
  const english = /English\s*:\s*/i.exec(d);
  if (english) d = d.slice(english.index + english[0].length);
  d = d.split(/\bOther languages\b|\bCategories\b|\bLicensing\b|\bPermission\b/i)[0];
  const stemNorm = norm(fileTitle.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""));
  // drop the leading echo of the file name, however many words it spans
  for (let n = Math.min(8, d.split(/\s+/).length - 1); n >= 2; n--) {
    const head = d.split(/\s+/).slice(0, n).join(" ");
    const h = norm(head);
    if (h.length >= 8 && stemNorm.startsWith(h)) {
      d = d.slice(head.length);
      break;
    }
  }
  d = d.replace(/\(\s*[\d\s]+\s*\)/g, " ");
  d = d.replace(/\b\d{4,}\b/g, " ");
  d = d.replace(/\.(jpe?g|png|tiff?|webp)\b/gi, " ");
  return norm(d);
}

/* ------------------------------------------------------------- title bits */

interface SeriesInfo {
  stem: string;
  tail: string;
  seriesNo: number;
  angle: string | null;
}

const ANGLE_WORDS =
  "front|rear|back|side|left|right|threequarter|three-quarter|3/4|profile|front-left|front-right|rear-left|rear-right|top|bottom|above|aerial|quarter";

/**
 * The Commons file name split into the part that identifies the shoot and the
 * per-shot disambiguator: `Foo_(front).jpg`, `Foo_(12345).jpg`, `Foo_07.jpg`
 * and `Foo_Rear.jpg` all share the stem `Foo`.
 */
function seriesOf(fileTitle: string): SeriesInfo {
  const base = fileTitle.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
  const tails: string[] = [];
  let rest = base;
  for (;;) {
    const m = /\s*[-(]\s*([^()]*?)\s*[)-]$/.exec(rest);
    if (!m) break;
    tails.unshift(m[1].trim());
    rest = rest.slice(0, rest.length - (m[1].length + 2)).trim();
  }
  // a final "_07" / "-2" is a shot number too
  const numbered = /^(.*?)[_-](\d{1,3})$/.exec(rest);
  if (numbered) {
    rest = numbered[1];
    tails.unshift(numbered[2]);
  } else {
    // a final "_Front" / "_Rear" is an angle label
    const angled = new RegExp(`^(.*?)[_-](${ANGLE_WORDS})$`, "i").exec(rest);
    if (angled) {
      rest = angled[1];
      tails.unshift(angled[2]);
    }
  }
  const tail = tails.join(" ").toLowerCase();
  const nums = tails
    .map((t) => Number(t))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 120);
  return {
    stem: norm(rest),
    tail,
    seriesNo: nums.length > 0 ? Math.max(...nums) : 0,
    angle: angleOf(tail),
  };
}

/** Camera azimuth stated by a file name; null when the name does not say. */
function angleOf(text: string): string | null {
  const t = ` ${norm(text)} `;
  const rules: [RegExp, string][] = [
    [/ front left | front three quarter | three quarter front | front 3 4 /, "front"],
    [/ front right | front three quarter right /, "front"],
    [/^ front | front$| front view /, "front"],
    [/ rear left | rear three quarter | three quarter rear | rear 3 4 /, "rear"],
    [/^ rear | rear$| rear view |^ back | back view /, "rear"],
    [/ left side | side left |^ left /, "left"],
    [/ right side | side right |^ right /, "right"],
    [/^ side | side view |^ profile | profile view /, "side"],
    [/ three quarter | 3 4 /, "threequarter"],
    [/^ top | above | aerial /, "high"],
  ];
  for (const [re, name] of rules) if (re.test(t)) return name;
  return null;
}

const ANGLE_ORDER = ["front", "threequarter", "right", "rear", "left", "high", "side"];

function mentionsPorsche(title: string): boolean {
  return /porsche|911|912|930|964|993|996|997|991|992|901/.test(norm(title));
}

/**
 * Word-boundary noise matching. A plain `includes` test is wrong here: "toy"
 * matches "TOYOTIRES" and "sign" matches "design", which silently threw away
 * whole photo series. Multi-word entries still match as a phrase.
 */
function mentionsAny(text: string, words: string[]): boolean {
  const t = norm(text);
  const tokens = new Set(t.split(" "));
  return words.some((w) => {
    const n = norm(w);
    if (!n) return false;
    if (n.includes(" ")) return t.includes(n);
    return tokens.has(n);
  });
}

/** 1:18 / 1-24 / 1:43 scale models, before punctuation is normalised away. */
function isScaleModel(title: string): boolean {
  return /1\s*[:.\-]\s*(18|24|32|43|64|87)\b/.test(title);
}

function isNoiseTitle(title: string): boolean {
  return isScaleModel(title) || mentionsAny(title, NOISE);
}

function isSceneOnly(title: string): boolean {
  return mentionsAny(title, SCENE_NOISE);
}

function isNotAFrame(title: string): boolean {
  return mentionsAny(title, NOT_A_FRAME);
}

/* ------------------------------------------------- identity of the subject */

interface Verdict {
  ok: boolean;
  why: string;
}

/**
 * Which generation does this text describe? Only from an explicit chassis code,
 * an air-cooled engine size, or a stated model year — never from the family.
 */
function genSignal(text: string): GenerationId | null {
  const t = norm(text);
  const found = new Set<GenerationId>();
  for (const m of t.matchAll(/(?<!\d)(901|912|914|930|964|993|996|997|991|992)(?!\d)/g)) {
    found.add(CODE_GEN[m[1]]);
  }
  if (found.size === 1) {
    const g = [...found][0];
    if (g === "992-1") found.add(/t-hybrid|thybrid/.test(t) ? "992-2" : "992-1");
    return [...found][0];
  }
  if (found.size > 1) return null;
  if (hasToken(t, "2.0") || hasToken(t, "2.2") || hasToken(t, "2.4")) return "901";
  if (hasToken(t, "2.7") || hasToken(t, "3.0") || hasToken(t, "3.2")) return "gseries";
  return null;
}

/** Model years stated in an unambiguous position of the raw Commons title. */
function yearSignals(title: string): number[] {
  const patterns: RegExp[] = [
    /^((?:19[5-9]\d|20[0-3]\d))[-_]porsche/i,
    /_((?:19[5-9]\d|20[0-3]\d))(?:[-_]|\))/,
    /\(((?:19[5-9]\d|20[0-3]\d))\)/,
    /[,;]\s*((?:19[5-9]\d|20[0-3]\d))\s*porsche/i,
    /((?:19[5-9]\d|20[0-3]\d))-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/,
    // the description of an old car often states its build year in words
    /\b(?:made|built|build|model year|year|construction)\s*(?:in|:)?\s*(19[5-9]\d|20[0-3]\d)\b/i,
  ];
  const out = new Set<number>();
  const t = title.replace(/^File:/, "");
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const y = Number(m[1]);
      if (Number.isFinite(y)) out.add(y);
    }
  }
  return [...out];
}

/** 992.1 and 992.2 share the "992" code, so they accept each other's titles. */
function genCompatible(signal: GenerationId | null, gen: GenerationId): boolean {
  if (!signal) return false;
  return signal === gen || (signal === "992-1" && gen === "992-2");
}

/**
 * Does this text describe THIS variant of THIS generation? A generation signal
 * is mandatory from the 964 onwards; 992.2 additionally needs either an explicit
 * T-Hybrid mention or a model year from 2025, because a 992.1 Carrera GTS is a
 * different car from the 992.2 T-Hybrid the roster lists.
 */
function identityOk(
  title: string,
  desc: string,
  target: Target,
  lenient = false,
): Verdict {
  const t = norm(title);
  const both = `${t} ${norm(desc)}`;
  if (!mentionsPorsche(both)) return { ok: false, why: "not a Porsche subject" };
  if (isNoiseTitle(t)) return { ok: false, why: "not a photograph of a car" };
  const signal = genSignal(both);
  if (!signal) return { ok: false, why: "does not identify a generation" };
  if (!genCompatible(signal, target.gen)) {
    return { ok: false, why: `identifies ${signal}, not ${target.gen}` };
  }
  const years = yearSignals(`${title} ${desc}`);
  if (years.length > 0) {
    const [from, to] = target.years ?? GEN_YEARS[target.gen];
    if (!years.some((y) => y >= from && y <= to)) {
      return { ok: false, why: `states model year ${years.join("/")}, outside ${from}–${to}` };
    }
  }
  if (target.gen === "992-2") {
    const hybrid = /t-hybrid|thybrid/.test(both);
    const late = years.some((y) => y >= 2025);
    if (!hybrid && !late) {
      return { ok: false, why: "no T-Hybrid mention and no 2025+ model year" };
    }
  }
  if (target.gen === "992-1" && /t-hybrid|thybrid/.test(both)) {
    return { ok: false, why: "T-Hybrid is a 992.2 car" };
  }
  // the title names the variant; a description may innocently say "Porsche
  // Classic" (an event) or "Carrera" (a circuit), so forbidden names are only
  // read from the title
  for (const f of target.forbidden) {
    if (hasToken(t, f)) return { ok: false, why: `names a different variant ("${f}")` };
  }
  // a series stem is checked leniently: it must not contradict the target, and
  // the individual members carry the strict variant test
  if (lenient) return { ok: true, why: "does not contradict this variant" };
  const missing = target.required.filter((r) => !hasModelToken(both, r));
  if (missing.length > 0) {
    return { ok: false, why: `does not name this variant (missing ${missing.join(", ")})` };
  }
  return { ok: true, why: "names this variant" };
}

/* ------------------------------------------------------------- target spec */

function genCodeOf(gen: GenerationId): string {
  if (gen === "992-1" || gen === "992-2") return "992";
  if (gen === "gseries") return "";
  return gen;
}

function buildQueries(target: Target): string[] {
  const clean = ascii(
    target.name.replace(/[“”"'’]/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim(),
  );
  const core = clean.replace(/^Porsche\s+/i, "").replace(/^911\s+/i, "").trim();
  const code = genCodeOf(target.gen);
  const modelKey = MODEL_PHRASES.find(
    (p) => hasModelToken(norm(target.name), p) && !BODY_TOKEN[p],
  );
  const out = [`Porsche ${clean}`];
  if (core && core !== clean) out.push(`Porsche ${core}`);
  if (code) out.push(`Porsche ${code} ${core || clean}`);
  if (code && modelKey) out.push(`Porsche ${code} ${modelKey}`);
  if (target.gen === "gseries") out.push(`Porsche 930 ${core || "Turbo"}`);
  return [...new Set(out)];
}

function hasHigherTier(models: ModelsFile | null, key: string): boolean {
  const m = models?.variants?.[key];
  if (!m) return false;
  return Boolean(m.glb || m.embedUrl);
}

function deriveTarget(
  gen: GenerationLite,
  v: VariantLite,
  models: ModelsFile | null,
): Target {
  const key = `${gen.id}/${v.id}`;
  const ov = OVERRIDES[key] ?? {};
  const n = norm(v.name);
  const displacement = DISPLACEMENTS.find((d) => hasToken(n, d)) ?? null;
  const modelKey =
    MODEL_PHRASES.filter((p) => hasModelToken(n, p) && !BODY_TOKEN[p]).sort(
      (a, b) => b.length - a.length,
    )[0] ?? null;
  const bodies = (v.bodyStyles ?? ["coupe"]).map((b) => b.toLowerCase());

  let required: string[] = [];
  if (modelKey) {
    required.push(ANCHORED_KEYS.has(modelKey) ? `911 ${modelKey}` : modelKey);
  }
  if (displacement) required.push(displacement);
  if (!bodies.includes("coupe")) required.push(BODY_TOKEN[bodies[0]] ?? bodies[0]);
  if (required.length === 0) {
    required = n
      .split(" ")
      .filter((w) => w.length >= 4 && !/^(porsche|911|edition|years|coupe)$/.test(w))
      .slice(0, 2);
  }
  required = required.filter((r) => !(ov.dropRequired ?? []).includes(r));
  for (const r of ov.extraRequired ?? []) if (!required.includes(r)) required.push(r);

  const forbidden: string[] = [];
  for (const p of SPECIAL_PHRASES) {
    if (required.includes(p) || required.includes(`911 ${p}`)) continue;
    if (hasToken(n, p)) continue;
    forbidden.push(p);
  }
  if (displacement) {
    for (const d of DISPLACEMENTS) if (d !== displacement) forbidden.push(d);
  }
  for (const d of ERA_FORBIDDEN[gen.id]) if (d !== displacement) forbidden.push(d);
  for (const f of ov.extraForbidden ?? []) forbidden.push(f);
  // a body style the variant is never offered in
  const offered = new Set(bodies);
  for (const [body, token] of Object.entries(BODY_TOKEN)) {
    if (!offered.has(body)) forbidden.push(token);
  }

  const target: Target = {
    key,
    gen: gen.id,
    variantId: v.id,
    name: v.name,
    required,
    forbidden,
    queries: [],
    priority: PRIORITY.indexOf(key),
    years: ov.years ?? null,
    skip: PRIORITY.indexOf(key) < 0 && hasHigherTier(models, key),
  };
  target.queries = [
    ...new Set([...buildQueries(target), ...(ov.extraQueries ?? [])]),
  ];
  return target;
}

/* ------------------------------------------------------- image utilities */

/**
 * One photographer, one key. Flickr imports render the uploader as a bare link
 * and hand-made uploads as a name; both have to collapse to the same key or a
 * genuine one-car series is thrown away.
 */
function authorKey(author: string): string {
  const cleaned = author
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/\b(?:from|and|at|the|via)\b/gi, " ")
    .replace(/[^a-zA-Z ]+/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) =>
      t
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, ""),
    )
    .filter((t) => t.length >= 2);
  return tokens.slice(0, 2).join(" ");
}

/** Capture date of a Commons file page, when the page records one. */
function dateKey(page: PageInfo): { day: string; exif: boolean } {
  const raw = page.date ?? "";
  const exif = /exif/i.test(raw);
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw) ?? /(\d{1,2})\s+(\w+)\s+(\d{4})/.exec(raw);
  if (m && m.length === 4 && /^\d{4}$/.test(m[1])) {
    return { day: `${m[1]}-${m[2]}-${m[3]}`, exif };
  }
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const dm = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(raw);
  if (dm) {
    const mi = months.indexOf(dm[2].toLowerCase());
    if (mi >= 0) return { day: `${dm[3]}-${String(mi + 1).padStart(2, "0")}-${dm[1].padStart(2, "0")}`, exif };
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})T/.exec(raw);
  if (iso) return { day: `${iso[1]}-${iso[2]}-${iso[3]}`, exif };
  return { day: "", exif };
}

/**
 * Paint colour of the car's own bodywork: the mean RGB of the central crop.
 * Two photographs of one car agree closely here, which is what separates a
 * genuine multi-session series from one stem holding several similar cars.
 */
async function paintSignature(file: string): Promise<{ hue: number; value: number } | null> {
  try {
    const meta = await sharp(file, { failOn: "none" }).rotate().metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return null;
    const left = Math.round(w * 0.2);
    const top = Math.round(h * 0.2);
    const stats = await sharp(file, { failOn: "none" })
      .rotate()
      .extract({
        left,
        top,
        width: Math.max(8, Math.round(w * 0.6)),
        height: Math.max(8, Math.round(h * 0.6)),
      })
      .stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hue = 0;
    if (d > 6) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue = ((hue * 60) + 360) % 360;
    }
    return { hue, value: max };
  } catch {
    return null;
  }
}

/** Largest circular distance between two hues, in degrees. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 64-bit difference hash — two frames closer than MIN_DIST are the same shot. */
async function dHash(file: string): Promise<bigint> {
  const stat = fs.statSync(file);
  const cache = cacheFile("dhash", `${file}:${stat.size}:${Math.round(stat.mtimeMs)}`);
  const hit = readCache<string>("dhash", `${file}:${stat.size}:${Math.round(stat.mtimeMs)}`);
  if (hit) return BigInt(`0x${hit}`);
  const raw = await sharp(file, { failOn: "none" })
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = y * 9 + x;
      bits = (bits << 1n) | (raw[i] > raw[i + 1] ? 1n : 0n);
    }
  }
  writeCache("dhash", `${file}:${stat.size}:${Math.round(stat.mtimeMs)}`, bits.toString(16));
  void cache;
  return bits;
}

function popcount(a: bigint, b: bigint): number {
  let x = a ^ b;
  let c = 0;
  while (x) {
    x &= x - 1n;
    c++;
  }
  return c;
}

/** Crop to the stage's 16:9 and scale to the frame size. */
async function renderFrame(src: string, dest: string): Promise<boolean> {
  try {
    const image = sharp(src, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return false;
    const ratio = FRAME_W / FRAME_H;
    let cw = w;
    let ch = Math.round(w / ratio);
    if (ch > h) {
      ch = h;
      cw = Math.round(h * ratio);
    }
    const left = Math.round((w - cw) / 2);
    const top = Math.round((h - ch) / 2);
    await sharp(src, { failOn: "none" })
      .rotate()
      .extract({ left, top, width: cw, height: ch })
      .resize({ width: FRAME_W, height: FRAME_H, fit: "fill" })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(dest);
    return fs.existsSync(dest) && fs.statSync(dest).size > 1024;
  } catch {
    return false;
  }
}

/**
 * The synthetic pan: ONE photograph re-rendered at N crop offsets on a seamless
 * loop (a slow sway with a breathing zoom). Honest motion, no invented angle.
 */
async function renderPan(src: string, dir: string, frames: number): Promise<number> {
  let written = 0;
  const meta = await sharp(src, { failOn: "none" })
    .rotate()
    .metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return 0;
  const ratio = FRAME_W / FRAME_H;
  let baseW = Math.min(w, Math.round(h * ratio));
  let baseH = Math.round(baseW / ratio);
  if (baseH > h) {
    baseH = h;
    baseW = Math.round(h * ratio);
  }
  for (let i = 0; i < frames; i++) {
    const t = frames > 1 ? i / frames : 0;
    const phase = 2 * Math.PI * t;
    const fx = 0.5 + 0.09 * Math.sin(phase);
    const fy = 0.5 + 0.02 * Math.sin(2 * phase);
    const zoom = 1.1 + 0.03 * Math.cos(phase);
    const cw = Math.max(16, Math.round(baseW / zoom));
    const ch = Math.max(9, Math.round(baseH / zoom));
    const left = Math.max(0, Math.min(w - cw, Math.round((w - cw) * fx)));
    const top = Math.max(0, Math.min(h - ch, Math.round((h - ch) * fy)));
    const dest = path.join(dir, `frame-${String(i).padStart(3, "0")}.webp`);
    try {
      await sharp(src, { failOn: "none" })
        .rotate()
        .extract({ left, top, width: cw, height: ch })
        .resize({ width: FRAME_W, height: FRAME_H, fit: "fill" })
        .webp({ quality: WEBP_QUALITY, effort: 4 })
        .toFile(dest);
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) return written;
      written++;
    } catch {
      return written;
    }
  }
  return written;
}

/** QA contact sheet: the winning sequence of one variant, in frame order. */
async function boardFor(label: string, files: string[], out: string): Promise<void> {
  const cols = 6;
  const cell = 200;
  const tagH = 22;
  const rows = Math.max(1, Math.ceil(files.length / cols));
  const composites: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const x = (i % cols) * cell;
    const y = tagH + Math.floor(i / cols) * cell;
    const buf = await sharp(files[i], { failOn: "none" })
      .resize({ width: cell - 4, height: cell - 4, fit: "cover" })
      .jpeg({ quality: 68 })
      .toBuffer();
    composites.push({ input: buf, left: x + 2, top: y + 2 });
    const tag = `<svg width="${cell}" height="${tagH}"><rect width="${cell}" height="${tagH}" fill="#101010"/><text x="4" y="16" font-family="monospace" font-size="13" fill="#ffffff">${i} · ${escapeRe(label)}</text></svg>`;
    composites.push({ input: Buffer.from(tag), left: x, top: 0 });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({
    create: {
      width: cols * cell,
      height: tagH + rows * cell,
      channels: 3,
      background: { r: 16, g: 16, b: 16 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 66 })
    .toFile(out);
}

/* --------------------------------------------------------------- manifest */

interface TurntablesFile {
  updatedAt: string;
  entries: Record<string, Entry>;
}

function loadJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`! ${file} is not valid JSON: ${String(err)}`);
    process.exit(1);
  }
}

function loadTurntables(): TurntablesFile {
  const file = loadJson<TurntablesFile>(TURNTABLES_JSON, {
    updatedAt: new Date().toISOString(),
    entries: {},
  });
  if (!file.entries || typeof file.entries !== "object") {
    return { updatedAt: file.updatedAt, entries: {} };
  }
  return file;
}

function loadTtCredits(): Map<string, CreditOut> {
  const file = loadJson<{ credits?: CreditOut[] }>(TT_CREDITS_JSON, { credits: [] });
  const map = new Map<string, CreditOut>();
  for (const c of file.credits ?? []) if (c.assetId) map.set(c.assetId, c);
  return map;
}

/**
 * Write all three manifests. data/models.json belongs to ASSET-3D and is being
 * edited concurrently, so it is re-read immediately before the write and only
 * the additive `turntables` key is touched — `generations` and `variants` are
 * passed through untouched.
 */
function persist(turntables: TurntablesFile, credits: Map<string, CreditOut>): void {
  turntables.updatedAt = new Date().toISOString();
  const entries: Record<string, Entry> = {};
  for (const k of Object.keys(turntables.entries).sort()) entries[k] = turntables.entries[k];
  fs.writeFileSync(
    TURNTABLES_JSON,
    `${JSON.stringify({ updatedAt: turntables.updatedAt, entries }, null, 2)}\n`,
  );
  const sorted = [...credits.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  fs.writeFileSync(
    TT_CREDITS_JSON,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), credits: sorted }, null, 2)}\n`,
  );
  const fresh = loadJson<ModelsFile>(MODELS_JSON, {});
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    map[k] = v.dir;
  }
  fs.writeFileSync(MODELS_JSON, `${JSON.stringify({ ...fresh, turntables: map }, null, 2)}\n`);
}

/* --------------------------------------------------------------- pipeline */

interface Plan {
  target: Target;
  frames: Frame[];
  synthetic: boolean;
  syntheticSource: string | null;
  pages: Map<string, PageInfo>;
  reason: string;
}

function members0(groups: Map<string, string[]>, stem: string): number {
  return groups.get(stem)?.length ?? 0;
}

function rawPathFor(fileTitle: string, meta: FileMeta): string {
  const ext = (path.extname(new URL(meta.origUrl).pathname) || ".jpg").toLowerCase();
  return path.join(RAW_DIR, `tt-${slug(fileTitle.slice(5), 44)}-${hash(fileTitle)}${ext}`);
}

/** Download a source once into the work dir; returns null when unavailable. */
async function ensureRaw(title: string, meta: FileMeta): Promise<string | null> {
  const raw = rawPathFor(title, meta);
  if (fs.existsSync(raw) && fs.statSync(raw).size > 4096) return raw;
  if (await download(meta.thumbUrl, raw)) return raw;
  if (await download(meta.origUrl, raw)) return raw;
  return null;
}

async function infoFor(title: string): Promise<{ meta: FileMeta; page: PageInfo } | null> {
  const meta = await fileMeta(title);
  if (!meta || meta.width < MIN_SOURCE_W) return null;
  const page = await pageInfo(title, meta.uploader);
  if (!page.ok) return null;
  return { meta, page };
}

async function analyse(target: Target, verbose: boolean): Promise<Plan> {
  const empty: Plan = {
    target,
    frames: [],
    synthetic: false,
    syntheticSource: null,
    pages: new Map(),
    reason: "",
  };
  if (target.skip) {
    empty.reason = "already served by a glb/Sketchfab embed — tier 3 unreachable, skipped";
    return empty;
  }

  /* 1 — search ------------------------------------------------------------ */
  const seen = new Map<string, SeriesInfo>();
  for (const query of target.queries) {
    for (const key of await searchCommons(query)) {
      if (!IMAGE_EXT.test(key) || seen.has(key) || BLACKLIST[key]) continue;
      if (!mentionsPorsche(key)) continue;
      if (isNoiseTitle(key) || isNotAFrame(key) || isSceneOnly(key)) continue;
      const s = seriesOf(key);
      if (!s.stem || isNotAFrame(s.tail) || isSceneOnly(s.stem)) continue;
      seen.set(key, s);
    }
  }
  const bar = frameBar(target);
  empty.reason = `no same-car series of ${bar}+ photos among ${seen.size} candidates`;

  /* 2 — group into same-car series ---------------------------------------- */
  const groups = new Map<string, string[]>();
  for (const [key, s] of seen) {
    const list = groups.get(s.stem) ?? [];
    list.push(key);
    groups.set(s.stem, list);
  }
  // the stem is the shoot's description, so it is checked before any page fetch:
  // it keeps the whole run off the ~40 members of an unrelated series
  const notes: string[] = [];
  const ranked = [...groups.entries()]
    .filter(([, members]) => members.length >= bar)
    .sort((a, b) => b[1].length - a[1].length)
    // a file-page fetch is the expensive step, so only this many series are opened
    .slice(0, MAX_GROUPS)
    .filter(([stem]) => {
      const identity = identityOk(stem, "", target, true);
      if (!identity.ok) {
        notes.push(`series "${stem}" (${members0(groups, stem)} photos): ${identity.why}`);
        if (verbose) console.log(`      ✗ series "${stem}": ${identity.why}`);
        return false;
      }
      return true;
    });
  if (ranked.length === 0) {
    empty.reason = notes[0] ?? `no series of ${bar}+ photos identifies this variant`;
    return empty;
  }
  const stemNotes = [...notes];
  notes.length = 0;

  /* 3 — licence + identity, member by member ------------------------------ */
  for (const [stem, members] of ranked) {
    const infos = new Map<string, { meta: FileMeta; page: PageInfo }>();
    await pool(members, CONCURRENCY, async (title) => {
      const info = await infoFor(title);
      if (info) infos.set(title, info);
    });
    const rejected: string[] = [];
    const accepted: string[] = [];
    const authors = new Set<string>();
    const descs = new Set<string>();
    const days = new Set<string>();
    let exifDays = 0;
    for (const title of members) {
      const info = infos.get(title);
      if (!info) {
        rejected.push(`${title}: licence/size not usable`);
        continue;
      }
      const identity = identityOk(title, info.page.desc, target);
      if (!identity.ok) {
        rejected.push(`${title}: ${identity.why}`);
        continue;
      }
      if (!info.page.author) {
        rejected.push(`${title}: no author on the file page`);
        continue;
      }
      authors.add(authorKey(info.page.author));
      descs.add(info.page.desc);
      const day = dateKey(info.page);
      if (day.day) {
        days.add(day.day);
        if (day.exif) exifDays++;
      }
      accepted.push(title);
    }
    const sameShoot = days.size === 1;
    const sameDescription = descs.size === 1;
    const rejection = ((): string => {
      if (accepted.length < bar) {
        return `series "${stem}": only ${accepted.length}/${members.length} usable — ${rejected[0] ?? "identity not established"}`;
      }
      if (authors.size !== 1) {
        return `series "${stem}": ${authors.size} different authors — not provably one car`;
      }
      // one photographer, one numbered series, one capture date = one session =
      // one car. Without that, the photographer's own description of the car has
      // to carry the identity (a series shot over several sittings).
      if (!sameShoot && !sameDescription) {
        return `series "${stem}": ${days.size || "no"} capture dates and ${descs.size} descriptions — not provably one car`;
      }
      if (!sameShoot && exifDays === 0 && descs.size !== 1) {
        return `series "${stem}": upload dates only and no shared description`;
      }
      return "";
    })();
    if (rejection) {
      notes.push(rejection);
      if (verbose) for (const r of rejected.slice(0, 2)) console.log(`        ✗ ${r}`);
      continue;
    }

    /* 4 — diversity: one frame per viewpoint ------------------------------ */
    // download + hash in parallel (the thumbnail host is the slow link), then
    // greedily keep the frames that are furthest from the ones already kept
    const raws = new Map<string, string>();
    const hashes = new Map<string, bigint>();
    const kept: {
      title: string;
      hash: bigint;
      paint: { hue: number; value: number } | null;
    }[] = [];
    const want = Math.min(TARGET_FRAMES, MAX_FRAMES);
    let dropped = 0;
    let oddPaint = 0;
    // in chunks, so a 40-photo series does not download all 40 when the first 24
    // are already distinct viewpoints
    for (let i = 0; i < accepted.length && kept.length < want; i += HASH_CHUNK) {
      const chunk = accepted.slice(i, i + HASH_CHUNK);
      await pool(chunk, CONCURRENCY, async (title) => {
        const info = infos.get(title)!;
        const raw = await ensureRaw(title, info.meta);
        if (!raw) return;
        raws.set(title, raw);
        hashes.set(title, await dHash(raw));
      });
      for (const title of chunk) {
        if (kept.length >= want) break;
        const hashValue = hashes.get(title);
        if (hashValue === undefined) {
          dropped++;
          continue;
        }
        if (kept.some((k) => popcount(k.hash, hashValue) < MIN_DIST)) {
          dropped++;
          continue;
        }
        const paint = await paintSignature(raws.get(title)!);
        // the paint of one car does not change between its photographs: a frame
        // whose bodywork colour is far from the frames already kept is a
        // different car and is dropped, however good the stem looks
        if (
          paint &&
          kept.some(
            (k) =>
              k.paint !== null &&
              (hueGap(k.paint.hue, paint.hue) > MAX_HUE_GAP ||
                Math.abs(k.paint.value - paint.value) > MAX_VALUE_GAP),
          )
        ) {
          oddPaint++;
          dropped++;
          continue;
        }
        kept.push({ title, hash: hashValue, paint });
      }
    }
    if (oddPaint > 0) {
      notes.push(
        `series "${stem}": ${oddPaint} frame(s) dropped — bodywork colour differs from the rest`,
      );
    }
    if (kept.length < bar) {
      const rejection2 = `series "${stem}": only ${kept.length} distinct angles after de-duplication (${dropped} duplicate/undownloadable)`;
      notes.push(rejection2);
      continue;
    }

    /* 5 — order: stated azimuth first, then the shoot's own numbering ------- */
    const ordered = kept
      .map((k) => ({ ...k, ...seen.get(k.title)! }))
      .sort((a, b) => {
        if (a.angle && b.angle) {
          const ai = ANGLE_ORDER.indexOf(a.angle);
          const bi = ANGLE_ORDER.indexOf(b.angle);
          if (ai !== bi) return ai - bi;
        }
        return a.seriesNo - b.seriesNo || a.title.localeCompare(b.title);
      });
    const frames: Frame[] = ordered.map((o) => ({
      fileTitle: o.title,
      angle: o.angle,
      seriesNo: o.seriesNo,
      creditId: `tt-${slug(o.title.slice(5), 44)}-${hash(o.title)}`,
    }));
    const stated = frames.filter((f) => f.angle !== null).length;
    return {
      target,
      frames,
      synthetic: false,
      syntheticSource: null,
      pages: new Map([...infos].map(([k, v]) => [k, v.page])),
      reason: [
        `same-car series "${stem}"`,
        `${frames.length} frames`,
        [...authors][0] ? `author ${[...authors][0]}` : null,
        sameShoot
          ? `one capture date ${[...days][0]}`
          : `identical descriptions, ${days.size} capture dates`,
        dropped > 0 ? `${dropped} duplicate/differing frame(s) dropped` : null,
        stated >= 3
          ? "ordered by the azimuth the file names state"
          : "ordered by the shoot's own numbering",
      ]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join(" · "),
    };
  }
  empty.reason =
    notes[0] ??
    stemNotes[0] ??
    `no series passed the same-car test (${ranked.length} candidate series)`;
  if (verbose) for (const n of stemNotes) console.log(`      ✗ ${n}`);
  return empty;
}

/** The best single photograph of this variant — the only synthetic pan source. */
async function bestSingle(
  target: Target,
): Promise<{ title: string; page: PageInfo; meta: FileMeta } | null> {
  const ranked: { title: string; page: PageInfo; meta: FileMeta }[] = [];
  const tried = new Set<string>();
  for (const query of target.queries) {
    for (const key of await searchCommons(query)) {
      if (!IMAGE_EXT.test(key) || tried.has(key) || BLACKLIST[key]) continue;
      tried.add(key);
      if (isNoiseTitle(key) || isNotAFrame(key) || isSceneOnly(key)) continue;
      const info = await infoFor(key);
      if (!info) continue;
      const identity = identityOk(key, info.page.desc, target);
      if (!identity.ok) continue;
      ranked.push({ title: key, page: info.page, meta: info.meta });
    }
  }
  if (ranked.length === 0) return null;
  // a landscape frame of the car as a whole subject makes the best pan source
  const score = (r: number): number => (r >= 1.4 && r <= 2.1 ? 2 : r >= 1.15 ? 1 : 0);
  ranked.sort(
    (a, b) =>
      score(b.meta.width / Math.max(1, b.meta.height)) -
      score(a.meta.width / Math.max(1, a.meta.height)),
  );
  return ranked[0];
}

async function build(
  target: Target,
  plan: Plan,
  credits: Map<string, CreditOut>,
): Promise<Entry | null> {
  const dirName = dirFor(target.key);
  const outDir = path.join(TURNTABLE_DIR, dirName);
  const retrieved = new Date().toISOString().slice(0, 10);

  /* synthetic pan --------------------------------------------------------- */
  if (plan.synthetic && plan.syntheticSource) {
    const title = plan.syntheticSource;
    const info = await infoFor(title);
    if (!info) return null;
    const raw = await ensureRaw(title, info.meta);
    if (!raw) return null;
    // a stale directory would leave frames past the new count and break probing
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const written = await renderPan(raw, outDir, SYNTHETIC_FRAMES);
    if (written < 2) {
      fs.rmSync(outDir, { recursive: true, force: true });
      return null;
    }
    const assetId = `tt-${slug(title.slice(5), 44)}-${hash(title)}`;
    credits.set(assetId, {
      assetId,
      kind: "image",
      source: "wikimedia",
      url: pageUrlFor(title),
      license: info.page.license,
      author: info.page.author,
      retrieved,
      sourceId: title,
      localPath: `/turntables/${dirName}`,
      note: [
        "licence parsed from the rendered Commons file page",
        `SYNTHETIC parallax pan — ${written} crop offsets of this ONE photograph, no invented viewing angles`,
        `Commons assessment: ${info.page.assessment ?? "none recorded"}`,
        `source ${info.meta.width}×${info.meta.height}px, rendered locally to ${written} WebP frames ${FRAME_W}×${FRAME_H}`,
      ].join("; "),
    });
    return {
      dir: `/turntables/${dirName}`,
      frames: written,
      synthetic: true,
      sources: [title],
    };
  }

  /* real same-car sequence ------------------------------------------------ */
  const sources: { title: string; page: PageInfo; meta: FileMeta }[] = [];
  for (const frame of plan.frames) {
    const info = await infoFor(frame.fileTitle);
    if (!info) return null;
    const raw = await ensureRaw(frame.fileTitle, info.meta);
    if (!raw) return null;
    sources.push({ title: frame.fileTitle, page: info.page, meta: info.meta });
  }
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let index = 0;
  const used: string[] = [];
  for (const s of sources) {
    const frame = plan.frames[index];
    const dest = path.join(outDir, `frame-${String(index).padStart(3, "0")}.webp`);
    const raw = rawPathFor(s.title, s.meta);
    if (!(await renderFrame(raw, dest))) continue;
    used.push(s.title);
    credits.set(frame.creditId, {
      assetId: frame.creditId,
      kind: "image",
      source: "wikimedia",
      url: pageUrlFor(s.title),
      license: s.page.license,
      author: s.page.author,
      retrieved,
      sourceId: s.title,
      localPath: `/turntables/${dirName}`,
      note: [
        "licence parsed from the rendered Commons file page",
        "turntable frame of ONE car: identical Commons series stem, identical file-page description, identical author",
        frame.angle
          ? `camera azimuth stated by the file name: "${frame.angle}"`
          : "camera azimuth not stated — frames follow the shoot's own numbering",
        `Commons assessment: ${s.page.assessment ?? "none recorded"}`,
        `source ${s.meta.width}×${s.meta.height}px, centre-cropped to 16:9 and rendered to WebP ${FRAME_W}×${FRAME_H}`,
      ].join("; "),
    });
    index++;
  }
  if (index < 2) {
    fs.rmSync(outDir, { recursive: true, force: true });
    return null;
  }
  return { dir: `/turntables/${dirName}`, frames: index, synthetic: false, sources: used };
}

/* ------------------------------------------------------------------- main */

function loadGenerations(): GenerationLite[] {
  return fs
    .readdirSync(GEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(GEN_DIR, f), "utf8")) as GenerationLite)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function argValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      out.push(args[i + 1]);
      continue;
    }
    if (args[i].startsWith(`${flag}=`)) out.push(args[i].slice(flag.length + 1));
  }
  return out;
}

async function boardsForPlan(plan: Plan): Promise<void> {
  const files: string[] = [];
  for (const frame of plan.frames.slice(0, TARGET_FRAMES)) {
    const meta = await fileMeta(frame.fileTitle);
    if (!meta) continue;
    const raw = rawPathFor(frame.fileTitle, meta);
    if (fs.existsSync(raw)) files.push(raw);
  }
  if (files.length === 0) return;
  const out = path.join(BOARD_DIR, `${slug(plan.target.key, 40)}.jpg`);
  await boardFor(plan.target.key, files, out);
  console.log(`        board ${out}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const analyseOnly = args.includes("--analyse");
  const onlyReal = args.includes("--only-real");
  const wantBoards = args.includes("--boards");
  const wantAll = args.includes("--all");
  const wantPriority = args.includes("--priority");
  const gens = argValues(args, "--gen") as GenerationId[];
  const explicitVariants = argValues(args, "--variants").flatMap((v) => v.split(","));
  if (
    !wantAll &&
    !wantPriority &&
    gens.length === 0 &&
    explicitVariants.length === 0
  ) {
    console.error(
      "usage: fetch-turntables.ts --priority | --all | --gen <id> | --variants <gen/id,...> [--analyse] [--only-real] [--boards]",
    );
    process.exit(1);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(TURNTABLE_DIR, { recursive: true });

  const all = loadGenerations();
  const models = loadJson<ModelsFile>(MODELS_JSON, {});
  const turntables = loadTurntables();
  const credits = loadTtCredits();

  let targets: Target[] = [];
  const explicit = new Set(explicitVariants);
  for (const gen of all) {
    if (gens.length > 0 && !gens.includes(gen.id)) continue;
    for (const v of gen.variants) {
      const key = `${gen.id}/${v.id}`;
      if (explicit.size > 0 && !explicit.has(key) && !explicit.has(v.id)) continue;
      targets.push(deriveTarget(gen, v, models));
    }
  }
  if (explicit.size > 0) {
    targets = targets.filter((t) => explicit.has(t.key) || explicit.has(t.variantId));
  }
  if (wantPriority) targets = targets.filter((t) => t.priority >= 0);
  // hero cars first, then roster order
  targets = targets
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ap = a.t.priority < 0 ? 999 : a.t.priority;
      const bp = b.t.priority < 0 ? 999 : b.t.priority;
      if (ap !== bp) return ap - bp;
      return a.i - b.i;
    })
    .map((x) => x.t);
  console.log(
    `${targets.length} target variants · analyse=${analyseOnly} · synthetic=${!onlyReal}`,
  );

  const missing: { key: string; why: string }[] = [];
  let real = 0;
  let synthetic = 0;
  for (const target of targets) {
    const t0 = Date.now();
    const plan = await analyse(target, analyseOnly);
    if (plan.frames.length === 0 && !analyseOnly && !onlyReal) {
      const single = await bestSingle(target);
      if (single) {
        plan.synthetic = true;
        plan.syntheticSource = single.title;
        plan.pages.set(single.title, single.page);
        plan.reason = `no same-car series ≥${MIN_REAL_FRAMES} (${plan.reason}); one photo → synthetic pan`;
      }
    }
    if (plan.frames.length === 0 && !plan.synthetic) {
      missing.push({ key: target.key, why: plan.reason });
      console.log(`  MISS ${target.key.padEnd(28)} ${plan.reason}`);
      if (!analyseOnly) {
        delete turntables.entries[target.key];
        persist(turntables, credits);
      }
      continue;
    }
    if (wantBoards && plan.frames.length > 0) await boardsForPlan(plan);
    if (analyseOnly) {
      console.log(`  PLAN ${target.key.padEnd(28)} frames=${String(plan.frames.length).padStart(2)} · ${plan.reason}`);
      continue;
    }
    const entry = await build(target, plan, credits);
    if (!entry) {
      missing.push({ key: target.key, why: `${plan.reason} — render failed` });
      console.log(`  MISS ${target.key}: render failed`);
      delete turntables.entries[target.key];
      persist(turntables, credits);
      continue;
    }
    turntables.entries[target.key] = entry;
    if (entry.synthetic) synthetic++;
    else real++;
    persist(turntables, credits);
    console.log(
      `  ${entry.synthetic ? "PAN " : "SEQ "} ${target.key.padEnd(28)} frames=${String(entry.frames).padStart(2)} · ${((Date.now() - t0) / 1000).toFixed(0)}s · ${plan.reason}`,
    );
  }

  fs.writeFileSync(
    path.join(WORK_DIR, "missing-turntables.json"),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), missing }, null, 2)}\n`,
  );
  console.log(
    `\nreal ${real} · synthetic ${synthetic} · missing ${missing.length} · public/turntables ${(du(TURNTABLE_DIR) / 1e6).toFixed(1)} MB`,
  );
  if (missing.length > 0) {
    console.log(`\nMISSING (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.key} — ${m.why}`);
  }
}

await main();

export {};
