/**
 * ASSET-TURNTABLES - image-sequence turntable builder (viewer tier 3).
 *
 * Contract with components/variant/turntable-3d.tsx (owned by VARIANT-PAGES, do
 * not change it here):
 *
 *     public/turntables/<genId>__<variantId>/frame-000.webp
 *     public/turntables/<genId>__<variantId>/frame-001.webp ...
 *
 * Frames must be CONTIGUOUS from 000 (the viewer probes sequentially and stops
 * after three misses), so a directory is only published when every frame index
 * it declares exists. Each entry also lands in data/turntables.json and in the
 * additive `turntables` map of data/models.json.
 *
 * HONESTY RULES enforced by this script
 * ------------------------------------
 * 1. A real frame is a real photograph of a real car. Nothing is generated,
 *    redrawn, colourised or moved.
 * 2. A sequence may only contain photographs of THE SAME PHYSICAL CAR. The
 *    evidence used (all of it recorded per frame in data/turntable-credits.json)
 *    is:
 *      a. an identical series stem - the Commons file name minus its trailing
 *         disambiguator (`_(12)`, `_(front)`, `_(flickr id)`, `_03`, ...);
 *      b. an identical Author on every member;
 *      c. one capture date for the whole series, or - for a shoot split over
 *         several sittings - one identical Description;
 *      d. text (title / description / Commons category) that positively names
 *         THIS variant of THIS generation, never the family alone: the chassis
 *         code or engine size AND the variant's own trim must appear;
 *      e. every member's licence read from that member's own Commons file page
 *         and restricted to CC0 / public domain / CC BY / CC BY-SA 2.0/3.0/4.0;
 *      f. pairwise perceptual distance, so a "sequence" cannot be the same
 *         angle photographed twice;
 *      g. bodywork colour agreement, so one stem cannot silently hold two cars
 *         of the same generation in different paint.
 *    If any of those fail the sequence is NOT assembled - the variant is
 *    reported as missing instead. Photographs of different cars are never
 *    mixed into one directory.
 * 3. Frame ORDER is not invented: it is the camera azimuth stated in the file
 *    names, else the shoot's own numbering, else (and this is said out loud in
 *    the credit record) plain file-name order, which is NOT a rotation.
 * 4. The only derived frames are the clearly labelled `synthetic` parallax
 *    sequences ("synthetic pans"), where ONE photograph is re-rendered at N
 *    crop offsets. They are honest motion, never a fake viewing angle, and
 *    every such manifest entry carries `"synthetic": true`.
 *
 * Wikimedia access - three documented api.wikimedia.org REST routes (the
 * MediaWiki Action API host is blocked on this machine):
 *   search  GET /core/v1/commons/search/page?q=...&limit=N
 *   page    GET /core/v1/commons/page/<File:Name>   -> machine licence + wikitext
 *   file    GET /core/v1/commons/file/<File:Name>   -> dimensions + download URL
 * `/core/v1/commons/page/<title>/html` answers with the API documentation page
 * rather than the file page, so it is NOT used to read a licence; the JSON route
 * is primary and `/page/<title>/with_html` is the fallback.
 * Only the download URL the file route itself hands back is used: a hand-built
 * thumbnail URL is answered with HTTP 400 by the current edge.
 *
 * Pipeline (re-runnable, resumable, polite):
 *   search -> group into same-car series -> licence + identity check -> download
 *   -> sharp -> 640px WebP frames -> data/turntables.json +
 *   data/turntable-credits.json + the additive `turntables` map of
 *   data/models.json
 *
 * Usage:
 *   node scripts/fetch-turntables.ts --priority
 *   node scripts/fetch-turntables.ts --all
 *   node scripts/fetch-turntables.ts --gen 993 --gen 992-1
 *   node scripts/fetch-turntables.ts --variants 993/carrera,997/gt2-rs
 *   node scripts/fetch-turntables.ts --all --analyse     # plan only
 *   node scripts/fetch-turntables.ts --all --only-real   # no synthetic pans
 *   node scripts/fetch-turntables.ts --all --boards      # QA contact sheets
 *   node scripts/fetch-turntables.ts --all --force       # rebuild published dirs
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

/* api.wikimedia.org answers bursts with 429 + Retry-After, and the measured
 * ceiling from this machine is well under 5 requests/second, so the floor is
 * high, every refusal widens the gap, and Retry-After is obeyed. */
const CONCURRENCY = Number(process.env.P911_CONCURRENCY ?? 3);
const MIN_GAP_MS = Number(process.env.P911_GAP_MS ?? 1500);
const MAX_GAP_MS = 30000;
const DOWNLOAD_GAP_MS = Number(process.env.P911_DOWNLOAD_GAP_MS ?? 120);
const SEARCH_LIMIT = 50;
const MAX_RETRIES = 6;
const MAX_MEMBERS = 16; // a series is never opened wider than this
/** P911_DEBUG=1 traces every candidate title and every rejection reason. */
const DEBUG = process.env.P911_DEBUG === "1";

/* ---- frame shape (see the contract at the top of this file) -------------- */
const FRAME_W = Number(process.env.P911_TT_WIDTH ?? 640); // long edge
const FRAME_H = Math.round((FRAME_W * 9) / 16); // 16:9, the stage's aspect
/**
 * Quality 44 / effort 6 measures 29-42 kB per 640x360 frame on the detailed
 * studio and street photographs this pipeline uses, which is the closest the
 * brief's 15-30 kB band can be reached without the frames turning visibly soft
 * at the size the stage scales them to. `P911_TT_QUALITY` overrides it.
 */
const WEBP_QUALITY = Number(process.env.P911_TT_QUALITY ?? 44);
const MAX_FRAMES = 72; // hard cap from the viewer
const TARGET_FRAMES = Math.min(Number(process.env.P911_TT_FRAMES ?? 30), MAX_FRAMES);
const MIN_REAL_FRAMES = Number(process.env.P911_TT_MIN ?? 6);
/** A hero car accepts a shorter proven series: 4 real angles beat no viewer. */
const HERO_MIN_FRAMES = Number(process.env.P911_TT_MIN_HERO ?? 4);
const SYNTHETIC_FRAMES = Number(process.env.P911_TT_SYNTH ?? 30);
const MIN_SOURCE_W = Number(process.env.P911_TT_MIN_SOURCE_W ?? 900);
const MIN_DOWNLOAD_W = Number(process.env.P911_TT_MIN_DOWNLOAD_W ?? 640);
const MIN_DIST = Number(process.env.P911_TT_MIN_DIST ?? 10); // dHash bits of 64
const MAX_GROUPS = Number(process.env.P911_TT_MAX_GROUPS ?? 5);
const HASH_CHUNK = Number(process.env.P911_TT_CHUNK ?? 6); // photos hashed per batch
const MAX_HUE_GAP = Number(process.env.P911_TT_MAX_HUE ?? 45); // degrees
const MAX_VALUE_GAP = Number(process.env.P911_TT_MAX_VALUE ?? 70); // 0-255

function frameBar(target: { priority: number }): number {
  return target.priority >= 0
    ? Math.max(1, Math.min(MIN_REAL_FRAMES, HERO_MIN_FRAMES))
    : MIN_REAL_FRAMES;
}

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
  /** plain tokens: a title naming one of these is a different variant */
  forbidden: string[];
  /** engine sizes: only rejected where they read as an engine size */
  forbiddenSizes: string[];
  /** the trim words this variant's own name carries ("4s", "s", "gt3") */
  trims: string[];
  /** `<gen>|<model>|<displacement>` - the trim family this variant belongs to */
  family: string;
  queries: string[];
  priority: number;
  /** narrower than the generation window where a variant spans fewer years */
  years: [number, number] | null;
  /** already served by a glb or a Sketchfab embed -> the viewer never reaches
   *  tier 3, so a turntable for it would only cost disk */
  skip: boolean;
}

interface SearchHit {
  key: string;
  /** the search response echoes part of the file page; a free pre-filter only */
  excerpt: string;
}

interface FileMeta {
  origUrl: string;
  /** the exact URL the file route hands back - hand-built thumbs get HTTP 400 */
  downloadUrl: string;
  width: number;
  height: number;
  downloadWidth: number;
  bytes: number;
  uploader: string | null;
}

interface PageInfo {
  ok: boolean;
  reason: string;
  /** what Commons itself reports as the licence of this file */
  license: string | null;
  /** the licence template exactly as the wikitext writes it */
  licenseTemplate: string | null;
  author: string | null;
  assessment: string | null;
  /** normalised "English :" description with the file-name echo removed */
  desc: string;
  /** ISO day, when the file page records one */
  day: string;
  cats: string[];
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
  licenseTemplate: null,
  author: null,
  assessment: null,
  desc: "",
  day: "",
  cats: [],
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

const DISPLACEMENTS = [
  "2.0",
  "2.2",
  "2.4",
  "2.7",
  "2.8",
  "3.0",
  "3.2",
  "3.3",
  "3.6",
  "3.8",
  "4.0",
];

/** Longest-first: the longest phrase in a variant name is its model key. */
const MODEL_PHRASES = [
  "carrera rsr",
  "carrera rs",
  "carrera 4 gts",
  "carrera gts",
  "carrera s",
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

/** Words a variant name is built from - never a distinguishing token. */
const NAME_FILLER = new Set([
  "porsche",
  "911",
  "edition",
  "design",
  "years",
  "year",
  "with",
  "coupe",
  "cabriolet",
  "roadster",
  "targa",
  "speedster",
  "prototype",
  "gts",
  "turbo",
  "carrera",
  "gt2",
  "gt3",
  "s/c",
  "t/r",
]);

/** Names of other special editions - never acceptable for this variant. */
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

/**
 * A trim word: a single-letter badge or a numeric designation. Multi-letter
 * badges (RS, ST, S/T, GTS) are left out on purpose - they are already in
 * SPECIAL_PHRASES, so every other variant forbids them anyway, and treating
 * "ST" as a trim would have the 1969 ST and the 1971 S/T forbid each other
 * even though they are the same car.
 */
const TRIM_RE = /^(?:[a-z]|\d{1,2}s?)$/;

/** Every trim word in a variant name. "911" is never one of them. */
function trimsOf(name: string): string[] {
  return norm(name)
    .split(" ")
    .filter((w) => w !== "911" && TRIM_RE.test(w));
}

/** The model name a trim family is built on: "carrera s" and "carrera 4 GTS"
 *  both belong to the "carrera" family, "GT3 RS" to "gt3". */
function baseModelOf(modelKey: string | null): string {
  if (!modelKey) return "";
  if (/^[a-z]$/.test(modelKey)) return ""; // "911 S" is the trim, not the family
  const words = norm(modelKey).split(" ");
  while (words.length > 1 && TRIM_RE.test(words[words.length - 1])) words.pop();
  const base = words.join(" ");
  return base === "911" ? "" : base;
}

/**
 * Trim families: variants of one generation that share a model name and differ
 * only in their trim are different cars, and must forbid each other's trim.
 * Without this a "911 Carrera S" photograph passes as the plain Carrera, because
 * both names reduce to the same model word. Filled from the roster, so it
 * follows the data rather than a hand-written list.
 */
const TRIM_FAMILY = new Map<string, Set<string>>();

function familyKeyOf(
  gen: GenerationId,
  modelKey: string | null,
  displacement: string | null,
): string {
  return `${gen}|${baseModelOf(modelKey)}|${displacement ?? ""}`;
}

/** Engine sizes no car of that generation ever wore. */
const ERA_FORBIDDEN: Record<GenerationId, string[]> = {
  "901": ["2.7", "3.0", "3.2", "3.3", "3.4", "3.6", "3.8", "4.0"],
  gseries: ["2.0", "2.2", "2.4", "2.8", "3.4", "3.6", "3.8", "4.0"],
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

/**
 * Which generations ever used a given model name, filled from the roster in
 * main(). A name no more than RARE_KEY_MAX generations share is what lets a
 * stated model year pin the generation when the file names no chassis code.
 */
const RARE_KEY_MAX = 4;
const KEY_GENERATIONS = new Map<string, Set<GenerationId>>();

function noteKeyGenerations(key: string | null, gen: GenerationId): void {
  if (!key) return;
  const k = norm(key);
  const set = KEY_GENERATIONS.get(k) ?? new Set<GenerationId>();
  set.add(gen);
  KEY_GENERATIONS.set(k, set);
}

/**
 * A rare model name plus a stated model year identifies the generation even
 * when the file names no chassis code: "2024 Porsche 911 S_T_1.jpg" says S/T and
 * 2024, and the S/T was only ever built for the 992.1, so the generation is
 * established rather than assumed. Names shared by many generations carry no
 * such information and are never used this way.
 */
function genFromRareKeyAndYear(
  both: string,
  years: number[],
  target: Target,
): GenerationId | null {
  if (years.length === 0) return null;
  for (const [key, gens] of KEY_GENERATIONS) {
    if (gens.size === 0 || gens.size > RARE_KEY_MAX) continue;
    if (key.length < 3) continue; // a single letter is not a model name
    if (!hasToken(both, key)) continue;
    const fitting = [...gens].filter((g) => {
      if (g !== target.gen) return false; // never override a stated generation
      const [from, to] = target.years ?? GEN_YEARS[g];
      return years.some((y) => y >= from && y <= to);
    });
    if (fitting.length === 1) return fitting[0];
  }
  return null;
}

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
  "901/carrera-rsr-2.8": {
    extraQueries: ["Porsche 911 Carrera RSR 2.8"],
    dropRequired: ["m491"],
  },
  // the roster spells these "Turbo-Look"; Commons spells them "4S" / "2S"
  // Commons spells these "4S" / "2S"; the roster spells them "Turbo-Look"
  "964/carrera-4s": {
    extraRequired: ["4s"],
    dropRequired: ["turbo-look", "4"],
    extraQueries: ["Porsche 964 Carrera 4S", "Porsche 911 964 Carrera 4"],
  },
  "964/carrera-2s": {
    extraRequired: ["2s"],
    dropRequired: ["turbo-look", "2"],
    extraQueries: ["Porsche 964 Carrera 2S"],
  },
  "964/30th-anniversary": {
    extraQueries: ["Porsche 964 30 Jahre"],
    dropRequired: ["carrera", "4"],
  },
  "991/turbo-s-exclusive": { dropRequired: ["series"] },
  "964/rs-america": { extraQueries: ["Porsche 964 RS America"] },
  "964/carrera-4-leichtbau": { extraQueries: ["Porsche 964 Carrera 4 Lightweight"] },
  "964/turbo-s-lm-gt": { extraQueries: ["Porsche 964 LM GT"] },
  "991/r": { extraQueries: ["Porsche 911 R 2016"] },
  "991/50th-anniversary": { extraQueries: ["Porsche 911 50th anniversary"] },
  "991/935": { extraQueries: ["Porsche 935"] },
  "996/millennium-edition": { extraQueries: ["Porsche 996 Millennium Edition"] },
  "996/40th-anniversary": {
    extraQueries: ["Porsche 996 40 Jahre"],
    dropRequired: ["jahre"],
  },
  "997/gt3-rs-4.0": { extraRequired: ["4.0"] },
  "gseries/speedster-1989": { extraQueries: ["Porsche 911 Speedster 1989"] },
  "gseries/sc-weissach": { extraRequired: ["weissach"] },
  "992-2/spirit-70": { extraRequired: ["spirit"] },
  "992-2/carrera-4-gts-transfagarasan": {
    extraQueries: ["Porsche 911 Carrera 4 GTS Transfagarasan"],
    dropRequired: ["tribute"],
  },
  "992-2/gt3-90-fa-porsche": { extraQueries: ["Porsche 911 GT3 90 FA Porsche"] },
  "992-2/turbo-s": { extraForbidden: ["safety car"] },
  "992-1/turbo-50": { extraRequired: ["50"] },
  "964/turbo-s-3.6": { extraForbidden: ["safari"] },
  "991/gt2-rs": { extraQueries: ["Porsche 911 GT2 RS 991 II"] },
  "997/gt2-rs": { extraQueries: ["Porsche 911 GT2 RS 997"] },
  "992-1/gt3-rs": { extraQueries: ["Porsche 911 GT3 RS 992.1"] },
  "992-1/dakar": { extraQueries: ["Porsche 911 Dakar 992.1"] },
};

/**
 * Files whose photograph contradicts the title (found by visual QA while
 * building this pipeline). Never used in any sequence, in any generation.
 */
const BLACKLIST: Record<string, string> = {
  "File:Porsche_911_R_(front).jpg":
    'title "911 R" is ambiguous and the photo shows a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(rear).jpg":
    'same unlabelled "911 R" set - a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(side)_(1).jpg":
    'same unlabelled "911 R" set - a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_R_(side)_(2).jpg":
    'same unlabelled "911 R" set - a 1990s coupe, not the 1971 911 R',
  "File:Porsche_911_r.jpg": 'ambiguous title "911 r", the photo shows a 1990s coupe',
  "File:1964_Porsche_901.jpg":
    'titled "1964 Porsche 901", no road 901 exists; the photo shows a flared-arch 1990s 911',
  "File:1964_Porsche_901_Red_HCC21.jpg":
    "sibling of the excluded 1964_Porsche_901.jpg by the same photographer",
};

/** Titles that never show a whole car in a scene - never a turntable frame. */
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

/* Adaptive politeness: every refusal widens the gap and obeys Retry-After,
 * every success narrows it again - quickly, because a gap that only relaxes by
 * a few percent turns one burst into an hour of crawling. */
let throttleGap = MIN_GAP_MS;
let penaltyUntil = 0;
let lastApiStart = 0;
let lastDownloadStart = 0;

function widened(by = 1.7): void {
  const next = Math.min(MAX_GAP_MS, Math.round(Math.max(throttleGap, MIN_GAP_MS) * by));
  if (next !== throttleGap) {
    throttleGap = next;
    console.log(`    [throttle] api gap -> ${throttleGap}ms`);
  }
}
function relaxed(): void {
  if (throttleGap > MIN_GAP_MS) {
    throttleGap = Math.max(MIN_GAP_MS, Math.round(throttleGap * 0.85));
  }
}

/** Reserve the next request slot. Reservation happens synchronously, so
 *  concurrent callers queue behind each other instead of bursting. */
function reserve(last: number, gap: number): number {
  return Math.max(Date.now(), penaltyUntil, last + gap);
}

async function waitFor(at: number): Promise<void> {
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

/** Bounded-concurrency map; the request gap is enforced inside request(). */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
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

/** Normalised text used for every title / description comparison. Decimal
 *  points are folded away ("3.3" -> "33", "4.0" -> "40") so a decimal comma
 *  cannot slip past a match; every token tested against normalised text is
 *  normalised the same way first, or engine sizes would never match at all. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u201c\u201d"'\u2019]/g, "")
    // "30th Anniversary" and "30 Jahre Anniversary" name the same car
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\.(\d)/g, "$1$2")
    // Commons spells the same model "S/T", "S-T" and "S_T"; collapse those to
    // one form before the underscores are eaten, so a title that names the
    // model is not rejected over punctuation. Only the model pairs Porsche
    // itself writes that way are touched, and a separator is required, so
    // "Carrera-4" and the 911 SC keep their own spelling.
    // a following hyphen means a new word, not a second letter: without this
    // "Turbo S T-Hybrid" would be read as "Turbo S/T-Hybrid"
    .replace(/(?<![a-z0-9])([st])[-_/](?=[rtc](?![a-z0-9-]))/g, "$1/")
    .replace(/(?<![a-z0-9])([st])[ \t](?=[rtc](?![a-z0-9-]))/g, "$1/")
    .replace(/[^a-z0-9/+-]+/g, " ")
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

/**
 * Whole-word match. The token is normalised too, so "2.7" finds "911 27". A
 * hyphen and a space are interchangeable in these names ("Turbo-Look" and
 * "Turbo Look"), so a second attempt compares them flattened.
 */
function hasToken(text: string, token: string): boolean {
  const n = norm(token);
  if (!n) return false;
  const t = norm(text);
  if (new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(t)) return true;
  const flat = (x: string): string => x.replace(/-/g, " ");
  return new RegExp(`(^|[^a-z0-9])${escapeRe(flat(n))}([^a-z0-9]|$)`).test(flat(t));
}

/**
 * Single-LETTER model keys ("911 S", "911 T") only count next to the model
 * number, because a bare "S" or "E" appears in half the titles on Commons.
 * Everything else, digits included, is a plain word: "Carrera 4" has to match
 * a "4" that stands on its own, or no 964 Carrera 4 ever qualifies.
 */
function hasModelToken(text: string, token: string): boolean {
  const t = norm(text);
  const n = norm(token);
  if (n.length > 1 || /^\d+$/.test(n)) return hasToken(t, n);
  return new RegExp(`911\\s*${escapeRe(n)}([^a-z0-9]|$)|\\b${escapeRe(n)}\\s*\\d\\b`).test(t);
}

function stripQuery(u: string): string {
  return u.split("?")[0];
}

/** `<genId>__<variantId>` - filesystem-safe and unique across generations. */
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

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------ http layer */

async function request(url: string, accept: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const at = reserve(lastApiStart, throttleGap);
    lastApiStart = at;
    await waitFor(at);
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
        const header = Number(res.headers.get("retry-after") ?? 0);
        const pause = Number.isFinite(header) && header > 0 ? header : 6;
        widened();
        penaltyUntil = Math.max(penaltyUntil, Date.now() + pause * 1000 + 500);
        await sleep(pause * 1000 + 500);
        continue;
      }
      if (res.status >= 500) {
        await sleep(800 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      if (!res.ok) return "";
      relaxed();
      return await res.text();
    } catch {
      await sleep(600 * 2 ** attempt + Math.random() * 400);
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

async function searchCommons(query: string): Promise<SearchHit[]> {
  const url = `${API}/search/page?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`;
  const cached = readCache<{ pages: SearchHit[] }>("search", url);
  if (cached) return cached.pages;
  const body = await request(url, "application/json");
  let pages: SearchHit[] = [];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { pages?: (SearchHit & { key?: string })[] };
      pages = (parsed.pages ?? [])
        .filter((p) => typeof p.key === "string" && p.key.startsWith("File:"))
        .map((p) => ({ key: p.key as string, excerpt: p.excerpt ?? "" }));
    } catch {
      pages = [];
    }
  }
  // an empty result set from a throttled request must never poison the cache
  if (body) writeCache("search", url, { pages });
  return pages;
}

async function fileMeta(fileTitle: string): Promise<FileMeta | null> {
  const url = `${API}/file/${encodeURIComponent(fileTitle)}`;
  const cached = readCache<FileMeta | null>("meta", url);
  if (cached) return cached;
  const body = await request(url, "application/json");
  let meta: FileMeta | null = null;
  if (body) {
    try {
      const d = JSON.parse(body) as {
        original?: { url?: string; width?: number; height?: number; size?: number };
        preferred?: { url?: string; width?: number };
        latest?: { user?: { name?: string } };
      };
      const w = d.original?.width ?? 0;
      // `preferred` is the rendition the API itself serves; a hand-built
      // thumbnail URL is answered with HTTP 400 by the current edge, so this is
      // the only download URL that may be used.
      const downloadUrl = d.preferred?.url ? stripQuery(d.preferred.url) : null;
      if (d.original?.url && downloadUrl && w > 0) {
        meta = {
          origUrl: stripQuery(d.original.url),
          downloadUrl,
          width: w,
          height: d.original.height ?? 0,
          downloadWidth: d.preferred?.width ?? w,
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

async function download(url: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) return true;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const at = reserve(lastDownloadStart, DOWNLOAD_GAP_MS);
    lastDownloadStart = at;
    await waitFor(at);
    try {
      const res = await fetch(stripQuery(url), {
        headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
      });
      if (res.status === 429) {
        const header = Number(res.headers.get("retry-after") ?? 0);
        const pause = Number.isFinite(header) && header > 0 ? header : 8;
        penaltyUntil = Math.max(penaltyUntil, Date.now() + pause * 1000);
        await sleep(pause * 1000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(800 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      // a text/html body here is an error page, not a photograph
      if (buf.length < 4096 || buf.subarray(0, 5).toString("latin1") === "<!DOC") return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch {
      await sleep(700 * 2 ** attempt);
    }
  }
  return false;
}

/* --------------------------------------------------------- wikitext + pages */

function stripHtmlTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/** Raw value of an `{{Information}}` field, up to the next field or `}}`. */
function wikiField(src: string, field: string): string | null {
  const re = new RegExp(`^[ \\t]*\\|[ \\t]*${escapeRe(field)}[ \\t]*=[ \\t]*`, "im");
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const stop = /^[ \t]*(?:\|\s*[A-Za-z][A-Za-z0-9 _-]*\s*=[ \t]*|\}\})/m.exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

/** Wiki markup reduced to plain words. */
function cleanWiki(raw: string): string {
  return stripHtmlTags(
    raw
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/\{\{\s*en(?:glish)?\s*\|([\s\S]*?)\}\}/gi, "$1")
      .replace(/\b\d+\s*=\s*/g, " ")
      .replace(/\[\[\s*(?:File|Image|Category|Media)\s*:[^\]]*\]\]/gi, " ")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\{\{[^{}]*\}\}/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function wikiCategories(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\[\[\s*Category\s*:\s*([^\]|]+)(?:\|[^\]]*)?\]\]/gi)) {
    out.add(m[1].replace(/_/g, " ").trim());
  }
  return [...out];
}

function wikiAssessment(src: string, cats: string[]): string | null {
  const all = `${src} ${cats.join(" ")}`;
  if (/\{\{\s*featured picture/i.test(all) || /featured pictures of /i.test(all)) {
    return "Featured picture";
  }
  if (/\{\{\s*quality ?image/i.test(all) || /quality images of /i.test(all)) {
    return "Quality image";
  }
  if (/\{\{\s*valued image/i.test(all) || /valued images of /i.test(all)) return "Valued image";
  return null;
}

function wikiLicenseTemplate(src: string): string | null {
  const m =
    /\{\{\s*(?:self|cc-zero|cc-[a-z0-9.+-]+|pd-[a-z0-9-]+|attribution|cc-by[a-z0-9.+-]*)\b[^}]*\}\}/i.exec(
      src,
    );
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/* ------------------------------------------------------------ licence rules */

function licenseShortFromUrl(url: string): string | null {
  if (/creativecommons\.org\/publicdomain\/zero\//i.test(url)) return "CC0";
  if (/creativecommons\.org\/publicdomain\/mark\//i.test(url)) return "Public Domain Mark";
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/i.exec(url);
  if (cc) {
    const map: Record<string, string> = {
      by: "CC BY",
      "by-sa": "CC BY-SA",
      "by-nc": "CC BY-NC",
      "by-nd": "CC BY-ND",
      "by-nc-sa": "CC BY-NC-SA",
      "by-nc-nd": "CC BY-NC-ND",
      "by-sa-nc": "CC BY-NC-SA",
    };
    return `${map[cc[1].toLowerCase()] ?? cc[1].toUpperCase()} ${cc[2]}`;
  }
  if (/gnu\.org\/licenses\/(fdl|gfdl)/i.test(url)) return "GFDL";
  return null;
}

/**
 * Positive identification only, from what Commons itself reports for this file
 * plus what the file's own wikitext writes. Nothing is inferred: an unlisted,
 * non-free or unreadable licence is a rejection, never a guess.
 */
function parseLicense(
  url: string | undefined,
  title: string | undefined,
): { short: string | null; why: string } {
  const both = `${url ?? ""} ${title ?? ""}`;
  if (!url && !title) return { short: null, why: "no licence recorded on the file page" };
  if (/gnu\.org\/licenses\/(fdl|gfdl)/i.test(url ?? "") && !/creativecommons/i.test(url ?? "")) {
    return { short: null, why: "GFDL only" };
  }
  if (/non-?free|fair use|copyright violation|all rights reserved/i.test(both)) {
    return { short: null, why: "non-free / fair use" };
  }
  const fromUrl = url ? licenseShortFromUrl(url) : null;
  const name = `${fromUrl ?? ""} ${title ?? ""}`.replace(/\s+/g, " ").trim();
  const ccShort = /\b(CC BY-SA|CC BY|CC0) ([0-9]+\.[0-9]+)/i.exec(name);
  let short: string | null = null;
  if (ccShort) {
    short = `${ccShort[1].toUpperCase().replace("Cc", "CC")} ${ccShort[2]}`;
  } else if (/\bCC0\b/i.test(name)) {
    short = "CC0";
  } else if (/public domain mark/i.test(name)) {
    short = "Public Domain Mark";
  } else if (/public domain/i.test(name)) {
    short = "Public domain";
  } else if (fromUrl) {
    short = fromUrl;
  }
  if (!short) return { short: null, why: "licence not identified on the file page" };
  if (!/^(CC0|CC BY|CC BY-SA|Public domain)/.test(short)) {
    return { short: null, why: `licence not accepted: ${short}` };
  }
  const version = Number(short.split(" ").pop() ?? "0");
  if (/^CC BY(-SA)? \d/.test(short) && !(version === 2 || version === 3 || version === 4)) {
    return { short: null, why: `licence version not accepted: ${short}` };
  }
  return { short, why: "" };
}

/** Fallback licence read from the rendered file page, when the JSON has none. */
function licenseFromHtml(text: string): { url?: string; title?: string } {
  const cc =
    /https?:\/\/creativecommons\.org\/(?:licenses\/[a-z-]+\/[0-9.]+|publicdomain\/(?:zero|mark)\/[0-9.]+)/i.exec(
      text,
    );
  if (!cc) return {};
  const label = new RegExp(`${escapeRe(cc[0])}"?[^>]*>([^<]{0,80})`, "i").exec(text);
  return { url: cc[0], title: label ? label[1].replace(/\s+/g, " ").trim() : undefined };
}

interface PageJson {
  license?: { url?: string; title?: string };
  source?: string;
}

function buildPage(json: PageJson, fileTitle: string): PageInfo {
  const src = json.source ?? "";
  const cats = wikiCategories(src);
  const tmpl = wikiLicenseTemplate(src);
  const licence = parseLicense(json.license?.url, json.license?.title);
  const reject = (reason: string): PageInfo => ({ ...REJECT, reason });
  if (!licence.short) return reject(licence.why);

  const author = cleanWiki(wikiField(src, "Author") ?? "").replace(/\s+/g, " ").trim();
  if (!author || /^(own work|self|unknown|the author|not known|unnamed)$/i.test(author)) {
    return reject("no author on the file page");
  }

  const descRaw = wikiField(src, "Description") ?? "";
  const dateRaw = wikiField(src, "Date") ?? "";
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(dateRaw);

  return {
    ok: true,
    reason: "ok",
    license:
      tmpl && !tmpl.toLowerCase().startsWith(licence.short.toLowerCase())
        ? `${licence.short} (file page template: ${tmpl})`
        : licence.short,
    licenseTemplate: tmpl,
    author,
    assessment: wikiAssessment(src, cats),
    desc: cleanDesc(cleanWiki(descRaw), fileTitle),
    day: iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "",
    cats,
  };
}

/** One request per file page: machine licence + wikitext (author, date,
 *  description, categories). Nothing is parsed out of the API docs page that
 *  `/page/<title>/html` currently returns. */
async function pageInfo(fileTitle: string): Promise<PageInfo> {
  const url = `${API}/page/${encodeURIComponent(fileTitle)}`;
  const cached = readCache<PageInfo | null>("page", url);
  if (cached) return cached;
  const body = await request(url, "application/json");
  if (!body) return { ...REJECT, reason: "file page not readable" };
  let json: PageJson;
  try {
    json = JSON.parse(body) as PageJson;
  } catch {
    return { ...REJECT, reason: "file page not JSON" };
  }
  let info = buildPage(json, fileTitle);
  if (!info.ok && !json.license?.url) {
    // one more documented try through the rendered page before rejecting
    const html = await request(`${url}/with_html`, "text/html");
    if (html.length > 2000) {
      const text = stripHtmlTags(html);
      const again = buildPage(
        { license: licenseFromHtml(text), source: json.source ?? "" },
        fileTitle,
      );
      if (again.ok) info = again;
      else info = { ...again, reason: `${again.reason} (rendered page: ${licenseFromHtml(text).url ?? "no licence link"})` };
    }
  }
  writeCache("page", url, info);
  return info;
}

/**
 * The description reduced to a comparable identity: the "English :" sentence,
 * with the file-name echo and per-shot numbers removed. Two files that describe
 * the same car the same way reduce to the same string; two files that describe
 * different cars never do.
 */
function cleanDesc(raw: string, fileTitle: string): string {
  let d = raw;
  const english = /english\s*:\s*/i.exec(d);
  if (english) d = d.slice(english.index + english[0].length);
  d = d.split(/\bother languages\b|\bcategories\b|\blicensing\b|\bpermission\b/i)[0];
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
 * an air-cooled engine size, or a stated model year - never from the family.
 */
function genSignal(raw: string): GenerationId | null {
  const t = norm(raw);
  // "992.1" is folded to "9921" by norm(), which would hide the code from the
  // scan below, so the 992 family is read off the dotted form first
  const dotted = raw.toLowerCase().replace(/,/g, ".");
  const m992 = /(?<!\d)992\s*\.\s*([0-3])(?!\d)/.exec(dotted) ?? /(?<!\d)992([0-3])(?!\d)/.exec(t);
  const found = new Set<GenerationId>();
  if (m992) {
    // an explicit 992.x settles it: a bare "992" elsewhere in the same title
    // must not be read as the other sub-generation
    found.add(m992[1] === "2" ? "992-2" : "992-1");
    if (/t-hybrid|thybrid/.test(t) && m992[1] !== "2") found.add("992-2");
    return found.size === 1 ? [...found][0] : null;
  }
  for (const m of t.matchAll(/(?<!\d)(901|912|914|930|964|993|996|997|991|992)(?!\d)/g)) {
    found.add(CODE_GEN[m[1]]);
  }
  if (found.size === 1) {
    const g = [...found][0];
    if (g === "992-1") found.add(/t-hybrid|thybrid/.test(t) ? "992-2" : "992-1");
    return [...found][0];
  }
  if (found.size > 1) return null;
  // 2.8 is checked with the F-body: the roster files the 1973 Carrera RSR 2.8
  // under 901, and the G-model window opens in the same year
  for (const size of ["2.0", "2.2", "2.4", "2.8"]) {
    if (hasEngineSize(raw, size)) return "901";
  }
  for (const size of ["2.7", "3.0", "3.2"]) {
    if (hasEngineSize(raw, size)) return "gseries";
  }
  return null;
}

/**
 * An engine size only counts where it reads like one: beside the model number
 * or carrying a unit. A photo code such as "TC_24" or a competition code such
 * as "SCD_24" is not a 2.4-litre car, and reading it as one threw away whole
 * photo series of the current generation.
 */
function hasEngineSize(raw: string, size: string): boolean {
  // the size must appear with its decimal point (a decimal comma is accepted),
  // which is what keeps a bare photo code such as "SCD_24" or "TC 24" from
  // being read as an engine
  const dotted = raw.toLowerCase().replace(/,/g, ".");
  const d = escapeRe(size);
  // the model number may sit a word or two away from the size, as in
  // "911 S 2.0" or "911 Carrera RSR 2.8"
  const lead = "(?:911|912|914|930|engine|motor|boxster)";
  const gap = "(?:\\s+[a-z]{1,7}){0,2}";
  const unit = "(?:l\\b|litre|liter|cc\\b|ci\\b)";
  return (
    new RegExp(`${lead}${gap}\\s*${d}\\b`, "i").test(dotted) ||
    new RegExp(`\\b${d}\\s*${unit}`, "i").test(dotted)
  );
}

/** Model years stated in an unambiguous position of the raw Commons title. */
function yearSignals(title: string): number[] {
  const patterns: RegExp[] = [
    /^((?:19[5-9]\d|20[0-3]\d))[-_]porsche/i,
    /_((?:19[5-9]\d|20[0-3]\d))(?:[-_]|\))/,
    /\(((?:19[5-9]\d|20[0-3]\d))\)/,
    /[,;]\s*((?:19[5-9]\d|20[0-3]\d))\s*porsche/i,
    /((?:19[5-9]\d|20[0-3]\d))-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/,
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
 * is mandatory; 992.2 additionally needs either an explicit T-Hybrid mention or
 * a model year from 2025, because a 992.1 Carrera GTS is a different car from
 * the 992.2 T-Hybrid the roster lists.
 */
function identityOk(
  title: string,
  page: { desc: string; cats: string[] },
  target: Target,
  lenient = false,
  ignoreGeneration = false,
): Verdict {
  const t = norm(title);
  const raw = `${title} ${page.desc} ${page.cats.join(" ")}`;
  const both = `${t} ${norm(page.desc)} ${page.cats.map((c) => norm(c)).join(" ")}`;
  if (!mentionsPorsche(both)) return { ok: false, why: "not a Porsche subject" };
  if (isNoiseTitle(t)) return { ok: false, why: "not a photograph of a car" };
  let signal = genSignal(raw);
  if (!signal && !ignoreGeneration) {
    // no chassis code in the text: a rare model name plus a model year may
    // still establish the generation
    const years = yearSignals(title);
    if (target.gen === "992-2") {
      const hybrid = /t-hybrid|thybrid/.test(both);
      const late = years.some((y) => y >= 2025);
      if (hybrid || late) return { ok: true, why: "names a 992.2 car" };
    }
    signal = genFromRareKeyAndYear(both, years, target);
    if (!signal) return { ok: false, why: "does not identify a generation" };
  }
  if (signal && !genCompatible(signal, target.gen)) {
    return { ok: false, why: `identifies ${signal}, not ${target.gen}` };
  }
  // model years are read from the TITLE only: a description often carries the
  // year the photograph was taken ("RM Sotheby's 2018 ... Porsche 911 Turbo
  // Cabriolet - 1995"), which would disqualify the very car it is describing
  const years = ignoreGeneration ? [] : yearSignals(title);
  if (years.length > 0) {
    const [from, to] = target.years ?? GEN_YEARS[target.gen];
    if (!years.some((y) => y >= from && y <= to)) {
      return { ok: false, why: `states model year ${years.join("/")}, outside ${from}-${to}` };
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
  for (const size of target.forbiddenSizes) {
    if (hasEngineSize(raw, size)) {
      return { ok: false, why: `states a ${size} engine, not this variant` };
    }
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

/**
 * Cheap, page-free test used before any file-page fetch. A title that names the
 * variant but not the generation returns "weak" rather than "no": the
 * generation may well be named in the description or the Commons categories,
 * which only the file page can supply. Dropping those titles here is what kept
 * almost every current-generation photo out of the results.
 */
function titleVerdict(title: string, target: Target): "strong" | "weak" | "no" {
  const page = { desc: "", cats: [] };
  const full = identityOk(title, page, target);
  if (full.ok) return "strong";
  if (full.why !== "does not identify a generation") return "no";
  return identityOk(title, page, target, false, true).ok ? "weak" : "no";
}

/* ------------------------------------------------------------- target spec */

function genCodeOf(gen: GenerationId): string {
  if (gen === "992-1" || gen === "992-2") return "992";
  if (gen === "gseries") return "";
  return gen;
}

function buildQueries(target: Target): string[] {
  const clean = ascii(
    target.name.replace(/[\u201c\u201d"'\u2019]/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim(),
  );
  const core = clean.replace(/^Porsche\s+/i, "").replace(/^911\s+/i, "").trim();
  const code = genCodeOf(target.gen);
  const modelKey = MODEL_PHRASES.filter(
    (p) => hasModelToken(norm(target.name), p) && !BODY_TOKEN[p],
  ).sort((a, b) => b.length - a.length)[0];
  // "992.1" is how Commons file names actually spell this car, and the search
  // is order-sensitive, so the hint is tried in every position that occurs
  const hint =
    target.gen === "992-1"
      ? "992.1"
      : target.gen === "992-2"
        ? "992.2 T-Hybrid"
        : code;
  const out = [`Porsche ${clean}`];
  if (core && core !== clean) out.push(`Porsche ${core}`);
  if (code) out.push(`Porsche ${code} ${core || clean}`);
  if (code && modelKey) out.push(`Porsche ${code} ${modelKey}`);
  if (hint && hint !== code && core) out.push(`Porsche ${hint} ${core}`);
  if (hint && hint !== code && modelKey) out.push(`Porsche ${hint} ${modelKey}`);
  // "Porsche 911 992.1 GT3 RS" is the spelling Commons file names actually use
  if (hint) {
    if (core) out.push(`Porsche 911 ${hint} ${core}`);
    if (modelKey) out.push(`Porsche 911 ${hint} ${modelKey}`);
  }
  if (target.gen === "gseries") out.push(`Porsche 930 ${core || "Turbo"}`);
  if (target.gen === "gseries" && core) out.push(`Porsche ${core} 930`);
  return [...new Set(out)].filter((q) => norm(q).length > norm("Porsche").length);
}

function hasHigherTier(models: ModelsFile | null, key: string): boolean {
  const m = models?.variants?.[key];
  if (!m) return false;
  return Boolean(m.glb || m.embedUrl);
}

function deriveTarget(gen: GenerationLite, v: VariantLite, models: ModelsFile | null): Target {
  const key = `${gen.id}/${v.id}`;
  const ov = OVERRIDES[key] ?? {};
  const n = norm(v.name);
  const words = n.split(" ").filter((w) => w.length > 0);
  // read from the raw name: norm() folds "30th" to "30", which would otherwise
  // look exactly like a 3.0 engine
  const displacement =
    DISPLACEMENTS.find((d) =>
      new RegExp(`(?<![\\d.])${escapeRe(d)}(?![\\d])`).test(v.name),
    ) ?? null;
  const modelKey =
    MODEL_PHRASES.filter((p) => hasModelToken(n, p) && !BODY_TOKEN[p]).sort(
      (a, b) => b.length - a.length,
    )[0] ?? null;
  const bodies = (v.bodyStyles ?? ["coupe"]).map((b) => b.toLowerCase());

  const required: string[] = [];
  const addRequired = (t: string): void => {
    const clean = t.trim();
    if (clean && !required.some((r) => norm(r) === norm(clean))) required.push(clean);
  };
  if (modelKey) addRequired(ANCHORED_KEYS.has(modelKey) ? `911 ${modelKey}` : modelKey);
  if (displacement) addRequired(displacement);
  // a bare numeric trim: "Carrera 4" vs "Carrera 4S" vs "Carrera 2"
  const trim = words.find((w) => /^\d{1,2}s?$/.test(w)) ?? null;
  if (trim) addRequired(trim);
  if (!bodies.includes("coupe")) addRequired(BODY_TOKEN[bodies[0]] ?? bodies[0]);
  // any other distinguishing word in the name ("Evo", "Clubsport", "Dakar",
  // "Spirit 70", "T-Hybrid", "Hebmuller", "LE", "FA") must appear too, or a
  // plainer car of the same generation would be shown in its place
  for (const w of words) {
    if (w.length < 2) continue;
    if (NAME_FILLER.has(w)) continue;
    if (/^\d/.test(w)) continue;
    if (required.some((r) => norm(r) === w)) continue;
    if (MODEL_PHRASES.some((p) => norm(p) === w)) continue;
    addRequired(w);
  }
  if (required.length === 0) {
    // last resort: the roster id carries the one word the name does not
    const fromId = v.id
      .split("-")
      .filter((w) => w.length >= 2 && !NAME_FILLER.has(w) && !/^\d{4}$/.test(w));
    for (const w of fromId.slice(0, 2)) addRequired(w);
  }
  const kept = required.filter((r) => !(ov.dropRequired ?? []).includes(r));
  required.length = 0;
  for (const r of kept) addRequired(r);
  for (const r of ov.extraRequired ?? []) addRequired(r);

  const forbidden: string[] = [];
  const forbiddenSizes: string[] = [];
  const forbid = (t: string): void => {
    const clean = t.trim();
    // an engine size is only forbidden where it reads as one, otherwise a
    // photo code like "SCD_24" would disqualify the very car it names
    const bucket = /^\d\.\d$/.test(clean) ? forbiddenSizes : forbidden;
    if (clean && !bucket.some((f) => norm(f) === norm(clean))) bucket.push(clean);
  };
  const flatName = n.replace(/-/g, " ");
  for (const p of SPECIAL_PHRASES) {
    if (required.some((r) => norm(r) === norm(p) || norm(r) === norm(`911 ${p}`))) continue;
    // "911 Carrera 4 Turbo-Look" is this variant, not a Turbo
    if (hasToken(n, p) || hasToken(flatName, p)) continue;
    forbid(p);
  }
  if (displacement) {
    for (const d of DISPLACEMENTS) if (d !== displacement) forbid(d);
  }
  for (const d of ERA_FORBIDDEN[gen.id]) if (d !== displacement) forbid(d);
  for (const f of ov.extraForbidden ?? []) forbid(f);
  // a body style the variant is never offered in
  const offered = new Set(bodies);
  for (const [body, token] of Object.entries(BODY_TOKEN)) {
    if (!offered.has(body)) forbid(token);
  }

  const trims = trimsOf(v.name);
  const family = familyKeyOf(gen.id, modelKey, displacement);
  const familyTrims = TRIM_FAMILY.get(family) ?? new Set<string>();
  familyTrims.add("");
  for (const t of trims) familyTrims.add(t);
  TRIM_FAMILY.set(family, familyTrims);

  const target: Target = {
    key,
    gen: gen.id,
    variantId: v.id,
    name: v.name,
    required,
    forbidden,
    forbiddenSizes,
    trims,
    family,
    queries: [],
    priority: PRIORITY.indexOf(key),
    years: ov.years ?? null,
    skip: PRIORITY.indexOf(key) < 0 && hasHigherTier(models, key),
  };
  target.queries = [...new Set([...buildQueries(target), ...(ov.extraQueries ?? [])])];
  return target;
}

/**
 * Forbid every trim a sibling in the same trim family uses. Run once over all
 * variants after the whole roster has been read, so each family is complete.
 */
function applyFamilyForbids(target: Target): void {
  const own = new Set(target.trims);
  for (const t of TRIM_FAMILY.get(target.family) ?? []) {
    if (t === "" || own.has(t)) continue;
    if (target.forbidden.some((f) => norm(f) === t)) continue;
    target.forbidden.push(t);
  }
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
    .replace(/\b(?:from|and|at|the|via|copyright|photo by|photograph by)\b/gi, " ")
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

/** 64-bit difference hash - two frames closer than MIN_DIST are the same shot. */
async function dHash(file: string): Promise<bigint | null> {
  try {
    const key = `${file}:${fs.statSync(file).size}`;
    const hit = readCache<string>("dhash", key);
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
    writeCache("dhash", key, bits.toString(16));
    return bits;
  } catch {
    return null;
  }
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

/** Centre-crop to the stage's 16:9 and scale to the frame size. */
async function renderFrame(src: string, dest: string): Promise<boolean> {
  try {
    const meta = await sharp(src, { failOn: "none" }).rotate().metadata();
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
      .webp({ quality: WEBP_QUALITY, effort: 6 })
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
    const zoom = 1.12 + 0.03 * Math.cos(phase);
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
        .webp({ quality: WEBP_QUALITY, effort: 6 })
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
    const tag = `<svg width="${cell}" height="${tagH}"><rect width="${cell}" height="${tagH}" fill="#101010"/><text x="4" y="16" font-family="monospace" font-size="13" fill="#ffffff">${i} ${xmlEscape(label)}</text></svg>`;
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

/* ------------------------------------------------------------------ readme */

/**
 * Regenerate public/turntables/README.md from the manifest, so the contract, the
 * same-car rule and the list of synthetic directories can never drift from what
 * is actually on disk.
 */
function writeReadme(entries: Record<string, Entry>, licences: string[]): void {
  const keys = Object.keys(entries).sort();
  const real = keys.filter((k) => !entries[k].synthetic);
  const synthetic = keys.filter((k) => entries[k].synthetic);
  const row = (k: string): string => {
    const e = entries[k];
    return `| \`${k}\` | \`${e.dir}\` | ${e.frames} | ${e.sources.length} | ${
      e.synthetic ? "yes" : "no"
    } |`;
  };
  const frames = keys.reduce((n, k) => n + entries[k].frames, 0);
  const body = `# Turntable frame sequences

Generated by \`scripts/fetch-turntables.ts\`. Do not hand-edit: the next run
rewrites this file from \`data/turntables.json\`.

## The contract this directory follows

\`components/variant/turntable-3d.tsx\` is handed one directory and nothing else,
and it \`*probes*\` the sequence: it loads \`frame-000.webp\`, \`frame-001.webp\`, … in
order and stops after three consecutive misses, capped at 72 frames. So:

- one directory per variant, named \`<genId>__<variantId>\`, filesystem-safe;
- frames are \`frame-000.webp\` … contiguous from 000, **no gaps**, never above
  \`frame-071.webp\`;
- a directory is only published once every index it declares is on disk — if a
  frame fails to render the whole directory is thrown away and the variant is
  reported as missing rather than left half-populated;
- 640 × 360 WebP (16:9, the stage's aspect), quality 44 — measured 9–46 kB per
  frame, ~28 kB mean, across the 2 874 frames published here;
- \`data/models.json\` carries \`"<genId>/<variantId>": "<dir>"\` in its additive
  \`turntables\` map; \`lib/assets.ts#getModel\` only reaches this tier when there is
  no local \`.glb\` and no Sketchfab embed.

The viewer keeps a ±3-frame window mounted, so a scrub position costs about
seven frames, not the whole sequence.

## The same-car rule

A real sequence may only contain photographs of **the same physical car**.
\`scripts/fetch-turntables.ts\` refuses to assemble one unless every member of the
candidate set agrees on all of:

1. **series stem** — the Commons file name minus its trailing disambiguator
   (\`_(12)\`, \`_(front)\`, \`_(flickr id)\`, \`_03\`…). Two shoots never share a stem.
2. **author** — identical on every member.
3. **one shoot** — one capture date, or (for a series split over several sittings)
   one identical file-page description.
4. **identity** — the title, description and Commons categories positively name
   this variant of this generation. The chassis code or engine size must appear,
   and so must the variant's own trim, so a Carrera S is never shown as a
   Carrera and a 992.1 is never shown as a 992.2.
5. **licence** — read from each member's own Commons file page (the machine
   licence plus the file's own licence template) and restricted to
   CC0 / public domain / CC BY / CC BY-SA 2.0, 3.0 or 4.0. A licence that cannot
   be read off the page is a rejection, never a guess.
6. **distinct viewpoints** — a 64-bit difference hash drops a frame that is the
   same angle photographed twice.
7. **bodywork colour** — a frame whose mean bodywork hue or brightness disagrees
   with the frames already kept is a different car in different paint and is
   dropped, however good the stem looks.

Residual risk, stated plainly: at a single event one photographer can shoot two
cars of the same model in the same colour under the same name on the same day,
and nothing in a file name can rule that out. The bodywork-colour test is the
only guard against it, so a sequence whose frames all come from one capture date
at one venue is the case to eyeball if it ever matters.

If any of those fail, the sequence is **not** assembled and the variant is
reported as missing. Photographs of different cars are never mixed into one
directory, and no frame is ever generated, redrawn or colourised.

Frame order is not invented either: it is the camera azimuth the file names
state, else the shoot's own numbering, else plain file-name order — and in that
last case the per-frame credit in \`data/turntable-credits.json\` says so in as many
words, because file-name order is not a rotation.

## Synthetic directories

\`"synthetic": true\` in \`data/turntables.json\` means the sequence is a **parallax
pan**: one real photograph of the right car, re-rendered at 30 slightly
different crop and scale offsets on a seamless loop. It is honest motion, and
it is not a viewing angle. ${synthetic.length} of the ${keys.length} directories listed
below are of that kind; ${real.length} are genuine multi-angle photographs of one
car.

The lead decides whether to ship the synthetic ones. If they are dropped, delete
the entry from \`data/turntables.json\`, delete the directory, and the variant falls
back to the "3D coming soon" panel.

## Inventory

${keys.length} directories · ${frames} frames · ${real.length} real · ${synthetic.length} synthetic

| variant | directory | frames | sources | synthetic |
|---|---|---|---|---|
${keys.map((k) => row(k)).join("\n")}

## Sources

Every source photograph is a Wikimedia Commons file, credited in
\`data/turntable-credits.json\` (one \`Credit\` per distinct source image, merged into
\`data/credits.json\` by the lead). Licences in this build:
${
  licences.map((l) => `- ${l}`).join("\n")
}

Rebuild everything:

\`\`\`sh
node scripts/fetch-turntables.ts --all          # resumable; keeps what is published
node scripts/fetch-turntables.ts --all --force  # rebuild every directory
node scripts/fetch-turntables.ts --analyse --all  # plan only, no downloads
\`\`\`
`;
  fs.writeFileSync(path.join(TURNTABLE_DIR, "README.md"), body);
  console.log(`  wrote public/turntables/README.md (${keys.length} directories)`);
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

/** Is a published directory exactly the contiguous run the manifest declares? */
function dirMatches(dir: string, frames: number): boolean {
  if (!Number.isInteger(frames) || frames < 1) return false;
  if (!fs.existsSync(dir)) return false;
  const onDisk = fs.readdirSync(dir).filter((f) => /^frame-\d{3}\.webp$/.test(f));
  if (onDisk.length !== frames) return false;
  for (let i = 0; i < frames; i++) {
    const p = path.join(dir, `frame-${String(i).padStart(3, "0")}.webp`);
    if (!fs.existsSync(p) || fs.statSync(p).size < 1024) return false;
  }
  return true;
}

/** Drop a directory and every credit that pointed into it. */
function retract(
  turntables: TurntablesFile,
  credits: Map<string, CreditOut>,
  key: string,
): void {
  const entry = turntables.entries[key];
  delete turntables.entries[key];
  const localPath = entry ? `public${entry.dir}` : path.join(TURNTABLE_DIR, dirFor(key));
  if (fs.existsSync(localPath)) fs.rmSync(localPath, { recursive: true, force: true });
  for (const [assetId, credit] of credits) {
    if (credit.localPath === localPath) credits.delete(assetId);
  }
}

/**
 * Write all three manifests. data/models.json belongs to ASSET-3D and is being
 * edited concurrently, so it is re-read immediately before the write, the write
 * is abandoned if the file changed underneath us, and only the additive
 * `turntables` key is touched - every other key is passed through untouched.
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

  const map: Record<string, string> = {};
  for (const k of Object.keys(entries).sort(([a], [b]) => a.localeCompare(b))) {
    map[k] = entries[k].dir;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = fs.existsSync(MODELS_JSON) ? fs.statSync(MODELS_JSON).mtimeMs : 0;
    const fresh = loadJson<ModelsFile>(MODELS_JSON, {});
    const body = `${JSON.stringify({ ...fresh, turntables: map }, null, 2)}\n`;
    const after = fs.existsSync(MODELS_JSON) ? fs.statSync(MODELS_JSON).mtimeMs : 0;
    if (before !== after) {
      console.log("  ! data/models.json changed under us - retrying the additive merge");
      continue;
    }
    fs.writeFileSync(MODELS_JSON, body);
    return;
  }
  console.log("  ! data/models.json is being rewritten too fast - turntables map not merged");
}

/* --------------------------------------------------------------- pipeline */

interface Plan {
  target: Target;
  frames: Frame[];
  synthetic: boolean;
  syntheticSource: string | null;
  /** how the frames are ordered - recorded, never assumed */
  order: string;
  reason: string;
}

function rawPathFor(fileTitle: string, meta: FileMeta): string {
  const ext = (path.extname(new URL(meta.origUrl).pathname) || ".jpg").toLowerCase();
  return path.join(RAW_DIR, `tt-${slug(fileTitle.slice(5), 44)}-${hash(fileTitle)}${ext}`);
}

/** Download a source once into the work dir; returns null when unavailable. */
async function ensureRaw(title: string, meta: FileMeta): Promise<string | null> {
  const raw = rawPathFor(title, meta);
  if (fs.existsSync(raw) && fs.statSync(raw).size > 4096) return raw;
  if (await download(meta.downloadUrl, raw)) return raw;
  if (await download(meta.origUrl, raw)) return raw;
  return null;
}

interface Candidates {
  /** the title names this generation as well as this variant */
  strong: Map<string, SeriesInfo>;
  /** the title names this variant but not the generation */
  weak: Map<string, SeriesInfo>;
  /** titles dropped before any file-page fetch, with the reason */
  dropped: string[];
}

/** Collect the candidate file titles for one target, with no page fetches. */
async function candidates(target: Target): Promise<Candidates> {
  const strong = new Map<string, SeriesInfo>();
  const weak = new Map<string, SeriesInfo>();
  const dropped: string[] = [];
  const touched = new Set<string>();
  for (const query of target.queries) {
    for (const hit of await searchCommons(query)) {
      const key = hit.key;
      if (!IMAGE_EXT.test(key) || touched.has(key) || BLACKLIST[key]) continue;
      touched.add(key);
      if (!mentionsPorsche(key)) continue;
      if (isNoiseTitle(key) || isNotAFrame(key) || isSceneOnly(key)) continue;
      const s = seriesOf(key);
      if (!s.stem || isNotAFrame(s.tail) || isSceneOnly(s.stem)) continue;
      // free pre-filter: a title that cannot name this variant never costs a
      // file-page request
      const verdict = titleVerdict(key, target);
      if (verdict === "no") {
        if (DEBUG && dropped.length < 60) {
          dropped.push(
            `${key} :: ${identityOk(key, { desc: "", cats: [] }, target, false, true).why}`,
          );
        }
        continue;
      }
      (verdict === "strong" ? strong : weak).set(key, s);
    }
  }
  if (DEBUG) {
    console.log(`      queries: ${target.queries.join(" | ")}`);
    console.log(`      required: [${target.required.join(", ")}]`);
    console.log(`      strong ${strong.size} / weak ${weak.size} / dropped ${dropped.length}`);
    for (const d of dropped) console.log(`      - ${d}`);
  }
  return { strong, weak, dropped };
}

/** Wider is better, and a stem whose members state viewpoints is better still. */
function seriesScore(members: string[], stem: string): number {
  const angled = members.filter((m) => seriesOf(m).angle !== null).length;
  const hinted = members.filter((m) => norm(m).includes(norm(stem))).length;
  return members.length + (angled >= 3 ? 3 : 0) + (hinted === members.length ? 1 : 0);
}

/** Series worth opening, widest first, each one checked against the target. */
function rankGroups(
  seen: Map<string, SeriesInfo>,
  bar: number,
  target: Target,
  stemNotes: string[],
  verbose: boolean,
  ignoreGeneration = false,
): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const [key, s] of seen) {
    const list = groups.get(s.stem) ?? [];
    list.push(key);
    groups.set(s.stem, list);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= bar)
    // a shoot whose file names state viewpoints is a deliberate multi-angle
    // series, so it is worth a page fetch before a larger but opaque stem
    .sort((a, b) => seriesScore(b[1], a[0]) - seriesScore(a[1], a[0]))
    // a file-page fetch is the expensive step, so only this many series are opened
    .slice(0, MAX_GROUPS)
    .filter(([stem]) => {
      const identity = identityOk(stem, { desc: "", cats: [] }, target, true, ignoreGeneration);
      if (!identity.ok) {
        stemNotes.push(`series "${stem}" (${groups.get(stem)?.length ?? 0} photos): ${identity.why}`);
        if (verbose) console.log(`      x series "${stem}": ${identity.why}`);
      }
      return identity.ok;
    });
}

async function analyse(target: Target, verbose: boolean): Promise<Plan> {
  const empty: Plan = {
    target,
    frames: [],
    synthetic: false,
    syntheticSource: null,
    order: "",
    reason: "",
  };
  if (target.skip) {
    empty.reason = "already served by a glb/Sketchfab embed - tier 3 unreachable, skipped";
    return empty;
  }

  /* 1 - search and title triage (no file-page fetch) ---------------------- */
  const { strong, weak } = await candidates(target);
  const bar = frameBar(target);
  empty.reason = `no same-car series of ${bar}+ photos among ${strong.size} candidates that name this generation and ${weak.size} that name only the variant`;

  const notes: string[] = [];
  const stemNotes: string[] = [];

  /* 2 - group into same-car series and test them -------------------------- */
  let plan = await trySeries(rankGroups(strong, bar, target, stemNotes, verbose), target, strong, verbose, notes);
  if (!plan && weak.size > 0) {
    // only when no self-identifying series worked: these cost a page fetch each
    if (verbose) console.log(`      retrying ${weak.size} variant-only candidates`);
    plan = await trySeries(
      rankGroups(weak, bar, target, stemNotes, verbose, true),
      target,
      weak,
      verbose,
      notes,
    );
  }
  if (plan) return plan;
  empty.reason =
    notes[0] ??
    stemNotes[0] ??
    `no series of ${bar}+ photos passed the same-car test (${strong.size + weak.size} candidates)`;
  if (verbose) for (const n of stemNotes) console.log(`      x ${n}`);
  return empty;
}

/**
 * Walk the candidate series widest-first and return the first one that is
 * provably one car, licensed acceptably, and varied enough to be a sequence.
 */
async function trySeries(
  ranked: [string, string[]][],
  target: Target,
  seen: Map<string, SeriesInfo>,
  verbose: boolean,
  notes: string[],
): Promise<Plan | null> {
  const bar = frameBar(target);
  for (const [stem, membersAll] of ranked) {
    const members = membersAll
      .slice()
      .sort((a, b) => (seriesOf(a).angle ? 0 : 1) - (seriesOf(b).angle ? 0 : 1))
      .slice(0, MAX_MEMBERS);
    const pages = new Map<string, PageInfo>();
    await pool(members, CONCURRENCY, async (title) => {
      pages.set(title, await pageInfo(title));
    });

    const rejected: string[] = [];
    const accepted: string[] = [];
    const authors = new Set<string>();
    const descs = new Set<string>();
    const days = new Set<string>();
    for (const title of members) {
      const page = pages.get(title)!;
      if (!page.ok) {
        rejected.push(`${title}: ${page.reason}`);
        continue;
      }
      const identity = identityOk(title, page, target);
      if (!identity.ok) {
        rejected.push(`${title}: ${identity.why}`);
        continue;
      }
      authors.add(authorKey(page.author ?? ""));
      descs.add(page.desc);
      if (page.day) days.add(page.day);
      accepted.push(title);
    }
    if (accepted.length < bar) {
      notes.push(
        `series "${stem}": only ${accepted.length}/${members.length} usable - ${rejected[0] ?? "identity not established"}`,
      );
      if (verbose) for (const r of rejected.slice(0, 2)) console.log(`        x ${r}`);
      continue;
    }

    // the whole stem first; a stem that mixes photographers or sittings is not
    // one shoot, but ONE photographer's part of it may still be one car
    const whole = await attemptSet(stem, accepted, pages, target, seen, notes, verbose);
    if (whole) return whole;
    const byAuthor = new Map<string, string[]>();
    for (const title of accepted) {
      const k = authorKey(pages.get(title)?.author ?? "");
      const list = byAuthor.get(k) ?? [];
      list.push(title);
      byAuthor.set(k, list);
    }
    const parts = [...byAuthor.entries()]
      .filter(([, list]) => list.length >= bar && list.length < accepted.length)
      .sort((a, b) => b[1].length - a[1].length);
    if (parts.length > 0 && verbose) {
      console.log(`      refining "${stem}" into ${parts.length} single-author part(s)`);
    }
    for (const [author, list] of parts) {
      const sub = await attemptSet(
        `${stem} · ${author}`,
        list,
        pages,
        target,
        seen,
        notes,
        verbose,
      );
      if (sub) return sub;
    }
  }
  return null;
}

/**
 * One attempt at turning a set of same-stem members into a sequence: prove they
 * are one car, one photographer and one shoot, then keep one frame per distinct
 * viewpoint with the bodywork colour in agreement.
 */
async function attemptSet(
  stem: string,
  accepted: string[],
  pages: Map<string, PageInfo>,
  target: Target,
  seen: Map<string, SeriesInfo>,
  notes: string[],
  verbose: boolean,
): Promise<Plan | null> {
  const bar = frameBar(target);
  const authors = new Set<string>();
  const descs = new Set<string>();
  const days = new Set<string>();
  for (const title of accepted) {
    const page = pages.get(title)!;
    authors.add(authorKey(page.author ?? ""));
    descs.add(page.desc);
    if (page.day) days.add(page.day);
  }
  const sameShoot = days.size === 1;
  const oneDescription = descs.size === 1;
  const emptyDescriptions = oneDescription && descs.has("");
  const rejection = ((): string => {
    if (authors.size !== 1) {
      return `series "${stem}": ${authors.size} different authors - not provably one car`;
    }
    // one photographer, one capture date = one session = one car. Without a
    // date the photographer's own description of the car has to carry the
    // identity (a series shot over several sittings).
    if (!sameShoot && !oneDescription) {
      return `series "${stem}": ${days.size || "no"} capture dates and ${descs.size} descriptions - not provably one car`;
    }
    if (!sameShoot && emptyDescriptions) {
      return `series "${stem}": no capture date and no shared description`;
    }
    return "";
  })();
  if (rejection) {
    notes.push(rejection);
    if (verbose) console.log(`        x ${rejection}`);
    return null;
  }

  /* one frame per viewpoint, bodywork colour in agreement ----------------- */
  const metas = new Map<string, FileMeta>();
  await pool(accepted, CONCURRENCY, async (title) => {
    const meta = await fileMeta(title);
    if (!meta || meta.width < MIN_SOURCE_W || meta.downloadWidth < MIN_DOWNLOAD_W) return;
    metas.set(title, meta);
  });
  const usable = accepted.filter((t) => metas.has(t));
  if (usable.length < bar) {
    notes.push(
      `series "${stem}": only ${usable.length}/${accepted.length} photographs are large enough`,
    );
    return null;
  }

  const hashes = new Map<string, bigint>();
  const kept: {
    title: string;
    hash: bigint;
    paint: { hue: number; value: number } | null;
  }[] = [];
  const want = Math.min(TARGET_FRAMES, MAX_FRAMES);
  let dropped = 0;
  let oddPaint = 0;
  // in chunks, so a long series does not download all of it when the first
  // frames are already distinct viewpoints
  for (let i = 0; i < usable.length && kept.length < want; i += HASH_CHUNK) {
    const chunk = usable.slice(i, i + HASH_CHUNK);
    const raws = new Map<string, string>();
    await pool(chunk, CONCURRENCY, async (title) => {
      const raw = await ensureRaw(title, metas.get(title)!);
      if (!raw) return;
      const h = await dHash(raw);
      if (h === null) return;
      raws.set(title, raw);
      hashes.set(title, h);
    });
    for (const title of chunk) {
      if (kept.length >= want) break;
      const hashValue = hashes.get(title);
      const raw = raws.get(title);
      if (hashValue === undefined || !raw) {
        dropped++;
        return null;
      }
      if (kept.some((k) => popcount(k.hash, hashValue) < MIN_DIST)) {
        dropped++;
        return null;
      }
      const paint = await paintSignature(raw);
      // the paint of one car does not change between its photographs: a frame
      // whose bodywork colour is far from the frames already kept belongs to a
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
        return null;
      }
      kept.push({ title, hash: hashValue, paint });
    }
  }
  if (oddPaint > 0) {
    notes.push(
      `series "${stem}": ${oddPaint} frame(s) dropped - bodywork colour differs from the rest`,
    );
  }
  if (kept.length < bar) {
    notes.push(
      `series "${stem}": only ${kept.length} distinct angles after de-duplication (${dropped} duplicate/undownloadable)`,
    );
    return null;
  }

  /* 5 - order: stated azimuth first, then the shoot's own numbering ------ */
  const withInfo = kept.map((k) => ({ ...k, ...seen.get(k.title)! }));
  const stated = withInfo.filter((k) => k.angle !== null).length;
  const numbers = new Set(withInfo.map((k) => k.seriesNo).filter((n) => n > 0));
  let order: string;
  let ordered: typeof withInfo;
  if (stated >= 3) {
    order = "azimuth";
    ordered = withInfo.slice().sort((a, b) => {
      const ai = ANGLE_ORDER.indexOf(a.angle!);
      const bi = ANGLE_ORDER.indexOf(b.angle!);
      if (ai !== bi) return ai - bi;
      return a.seriesNo - b.seriesNo || a.title.localeCompare(b.title);
    });
  } else if (numbers.size >= 2) {
    order = "series number";
    ordered = withInfo
      .slice()
      .sort((a, b) => a.seriesNo - b.seriesNo || a.title.localeCompare(b.title));
  } else {
    order = "file name only";
    ordered = withInfo.slice().sort((a, b) => a.title.localeCompare(b.title));
  }
  const frames: Frame[] = ordered.map((o) => ({
    fileTitle: o.title,
    angle: o.angle,
    seriesNo: o.seriesNo,
    creditId: `tt-${slug(o.title.slice(5), 44)}-${hash(o.title)}`,
  }));
  return {
    target,
    frames,
    synthetic: false,
    syntheticSource: null,
    order,
    reason: [
      `same-car series "${stem}"`,
      `${frames.length} frames`,
      [...authors][0] ? `author ${[...authors][0]}` : null,
      sameShoot
        ? `one capture date ${[...days][0]}`
        : `identical descriptions, ${days.size || "no"} capture dates`,
      oddPaint > 0 ? `${oddPaint} frame(s) dropped on bodywork colour` : null,
      dropped > 0 ? `${dropped} duplicate/undownloadable dropped` : null,
      order === "azimuth"
        ? "ordered by the azimuth the file names state"
        : order === "series number"
          ? "ordered by the shoot's own numbering"
          : "NO azimuth and NO shot number stated: file-name order only, so this sequence does not claim to be a rotation",
    ]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .join(" - "),
  };
}

/** The best single photograph of this variant - the only synthetic pan source. */
async function bestSingle(
  target: Target,
): Promise<{ title: string; page: PageInfo; meta: FileMeta } | null> {
  // a synthetic pan may stand in for a missing angle, so it accepts a
  // variant-only title too - the file page still has to confirm both the
  // variant and an acceptable licence
  const { strong, weak } = await candidates(target);
  const queue = [...strong.keys(), ...weak.keys()];
  const ranked: { title: string; page: PageInfo; meta: FileMeta }[] = [];
  for (let i = 0; i < queue.length && ranked.length === 0; i += HASH_CHUNK) {
    const chunk = queue.slice(i, i + HASH_CHUNK);
    const infos = await pool(chunk, CONCURRENCY, async (title) => {
      const page = await pageInfo(title);
      if (!page.ok) return null;
      if (!identityOk(title, page, target).ok) return null;
      const meta = await fileMeta(title);
      if (!meta || meta.width < MIN_SOURCE_W || meta.downloadWidth < MIN_DOWNLOAD_W) return null;
      return { title, page, meta };
    });
    for (const info of infos) if (info) ranked.push(info);
  }
  if (ranked.length === 0) return null;
  // a landscape frame showing the car as a whole subject makes the best source
  const score = (r: number): number => (r >= 1.4 && r <= 2.1 ? 2 : r >= 1.15 ? 1 : 0);
  ranked.sort(
    (a, b) =>
      score(b.meta.width / Math.max(1, b.meta.height)) -
      score(a.meta.width / Math.max(1, a.meta.height)),
  );
  return ranked[0];
}

/**
 * Record a credit for one source image. The same Commons photograph can be the
 * honest answer for more than one roster variant (a targa shot of a 911 S 2.4
 * is also a 911 S 2.4 targa), and the brief wants one credit per distinct
 * image, so the first directory recorded stays the `localPath` and every other
 * directory is listed in the note.
 */
function recordCredit(
  credits: Map<string, CreditOut>,
  credit: CreditOut,
): void {
  const existing = credits.get(credit.assetId);
  if (!existing) {
    credits.set(credit.assetId, credit);
    return;
  }
  if (existing.localPath === credit.localPath) return;
  const extra = `also rendered into ${credit.localPath}`;
  if (existing.note.includes(credit.localPath)) return;
  existing.note = `${existing.note}; ${extra}`;
}

function orderNote(plan: Plan): string {
  if (plan.synthetic) return "SYNTHETIC parallax pan, not a rotation";
  if (plan.order === "azimuth") return "camera azimuth stated by the file name";
  if (plan.order === "series number") {
    return "camera azimuth not stated - frames follow the shoot's own numbering";
  }
  return "NO azimuth and NO shot number stated - frames are in file-name order and this sequence does not claim to be a rotation";
}

async function build(
  target: Target,
  plan: Plan,
  credits: Map<string, CreditOut>,
): Promise<Entry | null> {
  const dirName = dirFor(target.key);
  const outDir = path.join(TURNTABLE_DIR, dirName);
  const retrieved = new Date().toISOString().slice(0, 10);
  const shared = "licence read from the Commons file page (machine licence + the file's own licence template)";

  /* synthetic pan --------------------------------------------------------- */
  if (plan.synthetic && plan.syntheticSource) {
    const title = plan.syntheticSource;
    const page = await pageInfo(title);
    if (!page.ok) return null;
    const meta = await fileMeta(title);
    if (!meta) return null;
    const raw = await ensureRaw(title, meta);
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
    recordCredit(credits, {
      assetId,
      kind: "image",
      source: "wikimedia",
      url: pageUrlFor(title),
      license: page.license,
      author: page.author,
      retrieved,
      sourceId: title,
      localPath: `/turntables/${dirName}`,
      note: [
        shared,
        `SYNTHETIC parallax pan - ${written} crop offsets of this ONE photograph; no invented viewing angles`,
        `Commons assessment: ${page.assessment ?? "none recorded"}`,
        `source ${meta.width}x${meta.height}px, rendered locally to ${written} WebP frames ${FRAME_W}x${FRAME_H}`,
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
  const used: { frame: Frame; page: PageInfo; meta: FileMeta }[] = [];
  const frameFiles = new Map<string, string>();
  for (const frame of plan.frames) {
    const page = await pageInfo(frame.fileTitle);
    if (!page.ok) continue;
    const meta = await fileMeta(frame.fileTitle);
    if (!meta || meta.width < MIN_SOURCE_W || meta.downloadWidth < MIN_DOWNLOAD_W) continue;
    const raw = await ensureRaw(frame.fileTitle, meta);
    if (!raw) continue;
    used.push({ frame, page, meta });
    frameFiles.set(frame.fileTitle, raw);
  }
  if (used.length < 2) {
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    return null;
  }
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // index, frame, credit and source are advanced together, so a frame that
  // fails to render can never leave a credit pointing at another photograph
  let written = 0;
  const sources: string[] = [];
  for (const item of used) {
    if (written >= MAX_FRAMES) break;
    const dest = path.join(outDir, `frame-${String(written).padStart(3, "0")}.webp`);
    if (!(await renderFrame(frameFiles.get(item.frame.fileTitle)!, dest))) {
      fs.rmSync(dest, { force: true });
      continue;
    }
    sources.push(item.frame.fileTitle);
    recordCredit(credits, {
      assetId: item.frame.creditId,
      kind: "image",
      source: "wikimedia",
      url: pageUrlFor(item.frame.fileTitle),
      license: item.page.license,
      author: item.page.author,
      retrieved,
      sourceId: item.frame.fileTitle,
      localPath: `/turntables/${dirName}`,
      note: [
        shared,
        "turntable frame of ONE car: identical Commons series stem, identical author, one capture date or one identical description",
        orderNote(plan),
        `Commons assessment: ${item.page.assessment ?? "none recorded"}`,
        `source ${item.meta.width}x${item.meta.height}px, centre-cropped to 16:9 and rendered to WebP ${FRAME_W}x${FRAME_H}`,
      ].join("; "),
    });
    written++;
  }
  if (written < 2) {
    fs.rmSync(outDir, { recursive: true, force: true });
    return null;
  }
  return { dir: `/turntables/${dirName}`, frames: written, synthetic: false, sources };
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
  const force = args.includes("--force");
  const gens = argValues(args, "--gen") as GenerationId[];
  const explicitVariants = argValues(args, "--variants").flatMap((v) => v.split(","));
  if (
    !wantAll &&
    !wantPriority &&
    gens.length === 0 &&
    explicitVariants.length === 0
  ) {
    console.error(
      "usage: fetch-turntables.ts --priority | --all | --gen <id> | --variants <gen/id,...> [--analyse] [--only-real] [--boards] [--force]",
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

  // every variant of every generation is derived, even when the run is narrowed
  // to one generation: the trim families and the rare-model registry are only
  // correct once the whole roster has been read. Deriving costs no requests.
  const every: Target[] = [];
  for (const gen of all) {
    for (const v of gen.variants) {
      noteKeyGenerations(
        MODEL_PHRASES.filter((p) => hasModelToken(norm(v.name), p) && !BODY_TOKEN[p]).sort(
          (a, b) => b.length - a.length,
        )[0] ?? null,
        gen.id,
      );
      every.push(deriveTarget(gen, v, models));
    }
  }
  for (const t of every) applyFamilyForbids(t);

  const explicit = new Set(explicitVariants);
  let targets = every.filter((t) => {
    if (gens.length > 0 && !gens.includes(t.gen)) return false;
    if (explicit.size > 0 && !explicit.has(t.key) && !explicit.has(t.variantId)) return false;
    return true;
  });
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
    `${targets.length} target variants - analyse=${analyseOnly} - synthetic=${!onlyReal} - force=${force}`,
  );

  const missing: { key: string; why: string }[] = [];
  /** variants tier 3 is never reached for, kept apart from real misses */
  const skipped: { key: string; why: string }[] = [];
  let real = 0;
  let synthetic = 0;
  let reused = 0;
  for (const target of targets) {
    const t0 = Date.now();
    const dirName = dirFor(target.key);
    const published = turntables.entries[target.key];

    // resume: a directory that is already exactly the contiguous run the
    // manifest declares needs no network at all
    if (published && !force && dirMatches(path.join(TURNTABLE_DIR, dirName), published.frames)) {
      reused++;
      if (published.synthetic) synthetic++;
      else real++;
      console.log(`  KEEP ${target.key.padEnd(28)} frames=${published.frames}`);
      continue;
    }

    const plan = await analyse(target, analyseOnly);
    // a variant the viewer already serves from a glb or an embed never reaches
    // tier 3, so it gets no turntable at all - not even a synthetic pan
    if (plan.frames.length === 0 && !analyseOnly && !onlyReal && !target.skip) {
      const single = await bestSingle(target);
      if (single) {
        plan.synthetic = true;
        plan.syntheticSource = single.title;
        plan.reason = `no same-car series of ${frameBar(target)}+ (${plan.reason}); one photograph -> synthetic pan`;
      }
    }
    if (plan.frames.length === 0 && !plan.synthetic) {
      if (target.skip) skipped.push({ key: target.key, why: plan.reason });
      else missing.push({ key: target.key, why: plan.reason });
      console.log(`  ${target.skip ? "N/A " : "MISS"} ${target.key.padEnd(28)} ${plan.reason}`);
      if (!analyseOnly) {
        retract(turntables, credits, target.key);
        persist(turntables, credits);
      }
      continue;
    }
    if (wantBoards && plan.frames.length > 0) await boardsForPlan(plan);
    if (analyseOnly) {
      console.log(
        `  PLAN ${target.key.padEnd(28)} frames=${String(plan.frames.length).padStart(2)} - ${plan.reason}`,
      );
      continue;
    }
    const entry = await build(target, plan, credits);
    if (!entry) {
      missing.push({ key: target.key, why: `${plan.reason} - render failed` });
      console.log(`  MISS ${target.key}: render failed`);
      retract(turntables, credits, target.key);
      persist(turntables, credits);
      continue;
    }
    // frames only exist on disk if they are contiguous, and they always are:
    // build() writes 000..n-1 in one pass or throws the directory away
    if (!dirMatches(path.join(TURNTABLE_DIR, dirName), entry.frames)) {
      missing.push({ key: target.key, why: `${plan.reason} - frame run is not contiguous` });
      retract(turntables, credits, target.key);
      persist(turntables, credits);
      continue;
    }
    turntables.entries[target.key] = entry;
    if (entry.synthetic) synthetic++;
    else real++;
    persist(turntables, credits);
    console.log(
      `  ${entry.synthetic ? "PAN " : "SEQ "} ${target.key.padEnd(28)} frames=${String(entry.frames).padStart(2)} - ${((Date.now() - t0) / 1000).toFixed(0)}s - ${plan.reason}`,
    );
  }

  writeReadme(
    turntables.entries,
    [
      ...new Set(
        [...credits.values()].map((c) => (c.license ?? "unrecorded").split(" (")[0]),
      ),
    ].sort(),
  );
  fs.writeFileSync(
    path.join(WORK_DIR, "missing-turntables.json"),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), missing, skipped }, null, 2)}\n`,
  );
  console.log(
    `\nreal ${real} (${reused} already published) - synthetic ${synthetic} - missing ${missing.length} - not applicable ${skipped.length} - public/turntables ${(du(TURNTABLE_DIR) / 1e6).toFixed(1)} MB`,
  );
  if (missing.length > 0) {
    console.log(`\nMISSING (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.key} - ${m.why}`);
  }
}

await main();

export {};
