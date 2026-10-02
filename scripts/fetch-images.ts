/**
 * ASSET-IMAGES — Wikimedia Commons image fetcher.
 *
 * Pipeline (VERIFIED on this machine — see docs/research.md §2.1; the normal
 * `commons.wikimedia.org/w/api.php` Action API is BLOCKED here, so licences are
 * parsed from the rendered file page instead of `extmetadata`):
 *
 *   1. search   GET https://api.wikimedia.org/core/v1/commons/search/page?q=…&limit=N
 *   2. meta     GET https://api.wikimedia.org/core/v1/commons/file/<File:Name>
 *   3. licence  GET https://api.wikimedia.org/core/v1/commons/page/<File:Name>/html
 *               → parse the rendered "Licensing" block + "Author" field.
 *               ACCEPT ONLY CC0 / public domain / CC BY / CC BY-SA 2.0/3.0/4.0.
 *   4. download from thumb.wikimedia.org (width-specific thumbnail of the
 *      upload.wikimedia.org original), `?utm_*` stripped. Nothing is hotlinked.
 *
 * A file is only used as a variant's *own* photo when its title names that variant.
 * Anything else is a same-family stand-in (recorded in the alt text and in the
 * credit note); a gallery is never padded with a different car's chassis.
 *
 * Usage (both runners work; tsx is preferred, nothing is added to package.json):
 *   npx tsx scripts/fetch-images.ts --all
 *   npx tsx scripts/fetch-images.ts --gen 901 --gen gseries --dry-run
 *   node --experimental-strip-types scripts/fetch-images.ts --gen 964
 *
 * Resumable: API responses are cached and originals are kept under $P911_WORK_DIR
 * (default /tmp/opencode/p911). data/images.json and data/credits.json are rewritten
 * after every generation, so a partial run always leaves valid data behind.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USER_AGENT =
  "porsche-911-showcase-image-pipeline/1.0 (unofficial fan showcase; contact: repository owner)";
const API = "https://api.wikimedia.org/core/v1/commons";

const WORK_DIR = process.env.P911_WORK_DIR ?? "/tmp/opencode/p911";
const CACHE_DIR = path.join(WORK_DIR, "cache");
const RAW_DIR = path.join(WORK_DIR, "raw");

const IMAGES_JSON = path.join(ROOT, "data/images.json");
const CREDITS_JSON = path.join(ROOT, "data/credits.json");
const GEN_DIR = path.join(ROOT, "data/generations");

const CONCURRENCY = Number(process.env.P911_CONCURRENCY ?? 4);
const MIN_GAP_MS = Number(process.env.P911_MIN_GAP_MS ?? 150);
const MAX_GAP_MS = 4000;
const SEARCH_LIMIT = 30;
const TARGET_W = 1920;
const MIN_SOURCE_W = 800;
const MAX_VARIANT_IMAGES = 8;
const TARGET_GALLERY = 5;
const MAX_RETRIES = 4;
const AVIF_WIDTHS = [640, 1280, 1920];

/* ----------------------------------------------------------------- types */

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

interface ImageRefOut {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  blurDataURL: string | null;
  creditId: string;
}

interface GenerationEntry {
  heroImage: ImageRefOut | null;
  timelineImage: ImageRefOut | null;
}

interface VariantEntry {
  heroImage: ImageRefOut | null;
  gallery: ImageRefOut[];
}

interface ImagesFile {
  generatedAt: string;
  generations: Record<string, GenerationEntry>;
  variants: Record<string, VariantEntry>;
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

interface FileMeta {
  origUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
  uploader: string | null;
}

interface LicenceInfo {
  ok: boolean;
  reason: string;
  license: string | null;
  author: string | null;
  assessment: string | null;
}

interface Candidate {
  fileTitle: string;
  rank: number;
  why: string;
}

interface Selection {
  title: string;
  tier: "exact" | "family" | "generation";
  note: string;
}

/* ------------------------------------------------------------ utilities */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adaptive politeness: Wikimedia answers HTTP 429 when we burst. Every 429
 *  doubles the gap between requests, every success relaxes it again. */
let throttleGap = MIN_GAP_MS;

function throttled(): void {
  throttleGap = Math.min(MAX_GAP_MS, Math.round(throttleGap * 1.8));
}

function relaxed(): void {
  throttleGap = Math.max(MIN_GAP_MS, Math.round(throttleGap * 0.97));
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
  return out.length > 0 ? out : "image";
}

/** Normalised text used for every title comparison. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[“”"'’]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(^|[^0-9])([234])[-.]([0-8])([^0-9]|$)/g, "$1$2.$3$4")
    .replace(/[^a-z0-9.+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Commons search cannot match diacritics, so queries are folded to ASCII. */
function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasToken(text: string, token: string): boolean {
  const t = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(text);
}

/** Single-letter trims (S/E/T/L/R) only count when they sit next to the model
 *  number or an engine size — otherwise "St. Moritz" would read as an "ST". */
function hasModelToken(text: string, token: string): boolean {
  if (token.length > 1) return hasToken(text, token);
  const t = escapeRe(token);
  return new RegExp(`911\\s*${t}([^a-z0-9]|$)|\\b${t}\\s*[234]\\.`).test(text);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripQuery(u: string): string {
  return u.split("?")[0];
}

/** Width-specific Commons thumbnail derived from the original upload URL. */
function thumbUrlFor(origUrl: string, width: number): string {
  const clean = stripQuery(origUrl);
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(
    clean,
  );
  if (!m) return clean;
  const [, base, h1, h2, name] = m;
  return `${base.replace("upload", "thumb")}/thumb/${h1}/${h2}/${name}/${width}px-${name}`;
}

function avifWidthsFor(sourceWidth: number): number[] {
  const w = AVIF_WIDTHS.filter((x) => x <= sourceWidth);
  return w.length > 0 ? w : [sourceWidth];
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

/* -------------------------------------------------------- commons calls */

interface SearchHit {
  key: string;
}

async function searchCommons(query: string): Promise<SearchHit[]> {
  const url = `${API}/search/page?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`;
  const cached = readCache<{ pages: SearchHit[] }>("search", url);
  if (cached) return cached.pages;
  const body = await request(url, "application/json");
  let pages: SearchHit[] = [];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { pages?: SearchHit[] };
      pages = (parsed.pages ?? []).filter((p) => typeof p.key === "string" && p.key.startsWith("File:"));
    } catch {
      pages = [];
    }
  }
  writeCache("search", url, { pages });
  return pages;
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
      const h = d.original?.height ?? 0;
      if (d.original?.url && w > 0) {
        meta = {
          origUrl: stripQuery(d.original.url),
          thumbUrl: thumbUrlFor(d.original.url, TARGET_W),
          width: w,
          height: h,
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

async function licenceFor(fileTitle: string, uploader: string | null): Promise<LicenceInfo> {
  const url = `${API}/page/${encodeURIComponent(fileTitle)}/html`;
  const cached = readCache<LicenceInfo | null>("licence", url);
  if (cached !== null) return cached;
  const body = await request(url, "text/html");
  const info = parseLicence(body, uploader);
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

/* -------------------------------------------------------- licence parse */

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
  const v = version;
  const map: Record<string, string> = {
    by: "CC BY",
    "by-sa": "CC BY-SA",
    "by-nc": "CC BY-NC",
    "by-nd": "CC BY-ND",
    "by-nc-sa": "CC BY-NC-SA",
    "by-nc-nd": "CC BY-NC-ND",
  };
  return `${map[code] ?? code.toUpperCase()} ${v}`;
}

/**
 * Positive identification only. Anything that is not clearly CC0 / PD / CC BY /
 * CC BY-SA is rejected, so every published licence string is parsed from the
 * rendered Commons file page — never guessed.
 */
function parseLicence(html: string, uploader: string | null): LicenceInfo {
  const reject = (reason: string): LicenceInfo => ({
    ok: false,
    reason,
    license: null,
    author: null,
    assessment: null,
  });
  if (!html || html.length < 800) return reject("file page html unavailable");

  const text = htmlToText(html);
  const own = ownLicenceSentence(text);
  const assessment = /this is a featured picture/i.test(text)
    ? "Featured picture"
    : /this is a quality image/i.test(text)
      ? "Quality image"
      : /this is a valued image/i.test(text)
        ? "Valued image"
        : null;
  const author = parseAuthor(text, uploader);

  if (own && /non-?free|fair use|copyright violation/i.test(own)) return reject("non-free / fair use");

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
  if (!short && /public domain|no known copyright restrictions/i.test(text)) short = "Public domain";
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
  };
}

function ownLicenceSentence(text: string): string | null {
  const patterns = [
    /This (?:file|image|work|photo|photograph|media) is licensed under the ([^.]*?licen[sc]e)\./i,
    /This (?:file|image|work|photo|photograph) is in the public domain[^.]*\./i,
    /This (?:file|image|work|photo|photograph) has been released (?:in)?to the public domain[^.]*\./i,
    /This (?:file|image|work|photo|photograph) has been released into the public domain[^.]*\./i,
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
    .trim();
}

function parseAuthor(text: string, uploader: string | null): string | null {
  const head = text.slice(0, 8000);
  const stop = INFO_BOX_LABELS.map(escapeRe).join("|");
  const strict = new RegExp(`\\bAuthor\\b\\s+([^|]{1,180}?)(?=\\s*(?:${stop})\\b)`, "i").exec(head);
  if (strict) {
    const a = strict[1].replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
    if (a.length > 0 && a.length < 160 && !/^(the|a|an|unknown|self|own work|user)$/i.test(a)) return a;
  }
  const loose = new RegExp(
    `\\bAuthor\\b\\s+(.{1,140}?)(?=\\s(?:Camera|Assessment|Licensing|File history)\\b)`,
    "i",
  ).exec(head);
  if (loose) {
    const a = loose[1].replace(/\s+/g, " ").trim();
    if (a.length > 1) return a;
  }
  return uploader ? `uploader ${uploader}` : null;
}

/* ------------------------------------------------------- variant specs */

const DISPLACEMENTS = ["2.0", "2.2", "2.4", "2.7", "3.0", "3.2", "3.3", "3.6", "3.8", "4.0"];

const BODY_TOKEN: Record<string, string> = {
  targa: "targa",
  cabriolet: "cabriolet",
  speedster: "speedster",
  roadster: "roadster",
};

/** Longest-first: the longest phrase present in a variant name becomes its model key. */
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
  "st",
  "4s",
  "2s",
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
  "935",
  "912",
  "901",
  "r",
  "s",
  "e",
  "l",
  "t",
];

/** Model words that identify a *different* special edition — never acceptable as
 *  an illustration of the variant being matched. */
const SPECIAL_PHRASES = [
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
  "935",
  "912",
  "901",
  "4s",
  "2s",
  "gts",
];

/** Model keys that only mean something when anchored to the model number. */
const ANCHORED_KEYS = new Set(["st", "s/t", "t/r", "r"]);

/** Generations whose Commons titles reliably carry the chassis number. */
const NEEDS_SIGNAL = new Set<GenerationId>(["964", "993", "996", "997", "991", "992-1", "992-2"]);

interface Override {
  extraRequired?: string[];
  dropRequired?: string[];
  extraForbidden?: string[];
  noExact?: boolean;
  extraQueries?: string[];
}

const OVERRIDES: Record<string, Override> = {
  "964/carrera-4s": { extraRequired: ["4s"] },
  "964/carrera-2s": { extraRequired: ["2s"] },
  "993/carrera-4s": { extraRequired: ["4s"] },
  "996/carrera-4s": { extraRequired: ["4s"] },
  "997/carrera-4s": { extraRequired: ["4s"] },
  "991/carrera-4s": { extraRequired: ["4s"] },
  "992-1/carrera-4s": { extraRequired: ["4s"] },
  "992-2/carrera-4s": { extraRequired: ["4s"] },
  "991/gt3-touring": { extraRequired: ["touring"] },
  "992-1/gt3-touring": { extraRequired: ["touring"] },
  "992-2/gt3-touring": { extraRequired: ["touring"] },
  "992-2/spirit-70": { extraRequired: ["spirit"] },
  "964/cup": { extraRequired: ["cup"] },
  "993/club-sport": { extraRequired: ["club"] },
  "993/gt2-evo": { extraRequired: ["evo"] },
  "gseries/carrera-club-sport": { extraRequired: ["club"] },
  "gseries/sc": { extraForbidden: ["sc rs"] },
  // a bare "911 Carrera RS" title means the 2.7; the 3.0 always carries its size
  "901/carrera-rs-2.7": { dropRequired: ["2.7"] },
  "992-1/turbo-50": { extraRequired: ["50"] },
  "901/s-t": { noExact: true },
  "901/911-r": { extraQueries: ["Porsche 911 R 1971", "Porsche 911 R homologation"] },
  "991/r": { extraQueries: ["Porsche 911 R 2016"] },
  "901/911-t-r": { extraQueries: ["Porsche 911 T/R"] },
  "992-2/gt3-90-fa-porsche": { noExact: true },
  "992-2/carrera-4-gts-transfagarasan": { noExact: true },
  "992-2/gt3-s-c": { extraQueries: ["Porsche 911 GT3 S/C"] },
  "901/912": { extraQueries: ["Porsche 912"] },
  "901/porsche-901": { extraQueries: ["Porsche 901 prototype"] },
  "901/cabriolet-hebmuller": { extraQueries: ["Porsche 911 Cabriolet Hebmuller"] },
  "901/st": { extraQueries: ["Porsche 911 ST 1971"] },
  "964/turbo-s-lm-gt": { extraQueries: ["Porsche 964 LM GT"] },
  "964/rs-america": { extraQueries: ["Porsche 964 RS America"] },
  "964/carrera-4-leichtbau": { extraQueries: ["Porsche 964 Carrera 4 Lightweight"] },
  "993/gt2": { extraQueries: ["Porsche 993 GT2"] },
  "996/millennium-edition": { extraQueries: ["Porsche 996 Millennium Edition"] },
  "991/50th-anniversary": { extraQueries: ["Porsche 911 50th anniversary"] },
  "964/30th-anniversary": { extraQueries: ["Porsche 964 30 Jahre"] },
  "996/40th-anniversary": { extraQueries: ["Porsche 996 40 Jahre"] },
  "991/935": { extraQueries: ["Porsche 935"] },
  "gseries/speedster-1989": { extraQueries: ["Porsche 911 Speedster 1989"] },
  "964/speedster": { extraQueries: ["Porsche 964 Speedster"] },
  "993/speedster": { extraQueries: ["Porsche 993 Speedster"] },
  "997/speedster": { extraQueries: ["Porsche 997 Speedster"] },
  "991/speedster": { extraQueries: ["Porsche 991 Speedster"] },
};

interface Spec {
  key: string;
  gen: GenerationId;
  variantId: string;
  name: string;
  required: string[];
  forbidden: string[];
  displacement: string | null;
  modelKey: string | null;
  bodies: string[];
  bodyExclusive: boolean;
  needsSignal: boolean;
  noExact: boolean;
  queries: string[];
}

function genCodeOf(gen: GenerationId): string {
  if (gen === "992-1" || gen === "992-2") return "992";
  return ["964", "993", "996", "997", "991"].includes(gen) ? gen : "";
}

function buildQueries(
  gen: GenerationId,
  name: string,
  displacement: string | null,
  modelKey: string | null,
  brief: string | null,
): string[] {
  const out: string[] = [];
  const code = genCodeOf(gen);
  const clean = ascii(name.replace(/[“”"'’]/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim());
  const core = clean.replace(/^Porsche\s+/i, "").replace(/^911\s+/i, "").trim();
  out.push(`Porsche ${clean}`);
  if (core && core !== clean) out.push(`Porsche ${core}`);
  if (code && modelKey) out.push(`Porsche ${code} ${modelKey}`);
  if (code && core) out.push(`Porsche ${code} ${core}`);
  if (displacement) out.push(`Porsche 911 ${displacement}`);
  if (gen === "gseries" && /turbo/i.test(clean)) out.push(`Porsche 930 ${core || "Turbo"}`);
  // broad fallback so a rare variant can still borrow photos of its own body/model
  if (brief && brief.length >= 3) out.push(`Porsche 911 ${brief}`);
  return [...new Set(out)];
}

function deriveSpec(gen: GenerationLite, v: VariantLite): Spec {
  const n = norm(v.name);
  const key = `${gen.id}/${v.id}`;
  const ov = OVERRIDES[key] ?? {};
  const displacement = DISPLACEMENTS.find((d) => hasToken(n, d)) ?? null;
  const modelKey =
    MODEL_PHRASES.filter((p) => hasToken(n, p) && !BODY_TOKEN[p]).sort((a, b) => b.length - a.length)[0] ??
    null;

  const bodies = (v.bodyStyles ?? ["coupe"]).map((b) => b.toLowerCase());
  const bodyExclusive = !bodies.includes("coupe");

  let required: string[] = [];
  if (modelKey) required.push(ANCHORED_KEYS.has(modelKey) ? `911 ${modelKey}` : modelKey);
  if (displacement) required.push(displacement);
  if (bodyExclusive) required.push(BODY_TOKEN[bodies[0]] ?? bodies[0]);
  if (required.length === 0) {
    // nothing recognisable — fall back to the distinctive words of the name
    const words = n
      .split(" ")
      .filter((w) => w.length >= 4 && !/^(porsche|911|edition|years|coupe)$/.test(w));
    required = words.slice(0, 2);
  }
  required = required.filter((r) => !(ov.dropRequired ?? []).includes(r));
  for (const r of ov.extraRequired ?? []) if (!required.includes(r)) required.push(r);

  const forbidden: string[] = [];
  for (const p of SPECIAL_PHRASES) {
    if (required.includes(p) || required.includes(`911 ${p}`)) continue;
    if (hasToken(n, p)) continue;
    forbidden.push(p);
  }
  if (displacement) for (const d of DISPLACEMENTS) if (d !== displacement) forbidden.push(d);
  if ((gen.id === "992-1" || gen.id === "992-2") && !hasToken(n, "t-hybrid")) forbidden.push("t-hybrid");
  for (const f of ov.extraForbidden ?? []) forbidden.push(f);

  const brief = bodyExclusive ? (BODY_TOKEN[bodies[0]] ?? bodies[0]) : modelKey;

  return {
    key,
    gen: gen.id,
    variantId: v.id,
    name: v.name,
    required,
    forbidden,
    displacement,
    modelKey,
    bodies,
    bodyExclusive,
    needsSignal: NEEDS_SIGNAL.has(gen.id),
    noExact: ov.noExact === true,
    queries: [
      ...new Set([
        ...buildQueries(gen.id, v.name, displacement, modelKey, brief),
        ...(ov.extraQueries ?? []),
      ]),
    ],
  };
}

/* ------------------------------------------------------- title matching */

const NOISE = [
  "diecast",
  "toy",
  "model car",
  "scale model",
  "scalemodel",
  "1:18",
  "1:24",
  "1:43",
  "1:64",
  "hot wheels",
  "matchbox",
  "lego",
  "papercraft",
  "drawing",
  "painting",
  "poster",
  "blueprint",
  "logo",
  "emblem",
  "brochure",
  "advertisement",
  "catalogue",
  "catalog",
  "forza",
  "gran turismo",
  "need for speed",
  "assetto",
  "video game",
  "racing game",
  "crash",
  "wreck",
  "accident",
  "burnt",
  "burned",
  "derailed",
  "kit car",
  "replica",
  "rat rod",
  "hot rod",
  "liberty walk",
  "police",
  "polizei",
  "military",
  "taxi",
  "engine bay",
  "gearbox",
  "brake disc",
  "steering wheel",
  "rear badge",
  "front badge",
];

const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;

/** Extra searches per generation: Commons' Quality/Featured images are the best
 *  photography on the site, but nothing in the REST API exposes that flag, so the
 *  category is queried directly and the licence page confirms the assessment. */
const QUALITY_QUERIES: Record<GenerationId, string[]> = {
  "901": [
    'Porsche 911 incategory:"Quality images"',
    'Porsche 911 2.4 incategory:"Quality images"',
    'Porsche 911 Targa incategory:"Quality images"',
    'Porsche 911 Carrera RS incategory:"Quality images"',
  ],
  gseries: [
    'Porsche 911 incategory:"Quality images"',
    'Porsche 911 SC incategory:"Quality images"',
    'Porsche 930 incategory:"Quality images"',
    'Porsche 911 Carrera incategory:"Quality images"',
  ],
  "964": ['Porsche 964 incategory:"Quality images"', 'Porsche 911 964 incategory:"Quality images"'],
  "993": ['Porsche 993 incategory:"Quality images"', 'Porsche 911 993 incategory:"Quality images"'],
  "996": ['Porsche 996 incategory:"Quality images"', 'Porsche 911 996 incategory:"Quality images"'],
  "997": ['Porsche 997 incategory:"Quality images"', 'Porsche 911 997 incategory:"Quality images"'],
  "991": ['Porsche 991 incategory:"Quality images"', 'Porsche 911 991 incategory:"Quality images"'],
  "992-1": ['Porsche 992 incategory:"Quality images"', 'Porsche 911 992 incategory:"Quality images"'],
  "992-2": ['Porsche 992 incategory:"Quality images"', 'Porsche 911 992 incategory:"Quality images"'],
};

function mentionsPorsche(title: string): boolean {
  return /porsche|911|912|930|964|993|996|997|991|992|901/.test(norm(title));
}

function isNoise(title: string): boolean {
  const t = norm(title);
  return NOISE.some((w) => t.includes(w));
}

/** Pre-1999 model year in an unambiguous Commons position (model-year context). */
function yearSignal(title: string): number | null {
  const patterns = [
    /\((19[6-8]\d)\)/,
    /\bbj\.?\s*(19[6-8]\d)/,
    /\b(19[6-8]\d)\s+porsche\b/,
    /,\s*(19[6-8]\d)\s*[,\)]/,
    /_(19[6-8]\d)(?:[-_.]|$)/,
  ];
  for (const re of patterns) {
    const m = re.exec(norm(title));
    if (m) return Number(m[1]);
  }
  return null;
}

/** "992" is reported for 992-series titles that do not say 992.1/992.2 — the
 *  T-hybrid is rarely written out, and both sub-generations look the same. */
type GenSignal = GenerationId | "992";

/** Which generation a file title is about — only from an explicit chassis code,
 *  an air-cooled displacement, or a pre-1999 model year. Never guessed otherwise. */
function genSignal(title: string): GenSignal | null {
  const t = norm(title);
  const found = new Set<GenSignal>();
  for (const m of t.matchAll(/(?<!\d)(901|912|914|930|964|993|996|997|991|992)(?!\d)/g)) {
    switch (m[1]) {
      case "901":
      case "912":
      case "914":
        found.add("901");
        break;
      case "930":
        found.add("gseries");
        break;
      case "964":
        found.add("964");
        break;
      case "993":
        found.add("993");
        break;
      case "996":
        found.add("996");
        break;
      case "997":
        found.add("997");
        break;
      case "991":
        found.add("991");
        break;
      case "992":
        found.add(
          /t-hybrid/.test(t) ? "992-2" : /992\.1/.test(t) ? "992-1" : ("992" as GenSignal),
        );
        break;
    }
  }
  if (found.size === 1) return [...found][0];
  if (found.size > 1) return null;
  if (hasToken(t, "2.0") || hasToken(t, "2.2") || hasToken(t, "2.4")) return "901";
  if (hasToken(t, "2.7") || hasToken(t, "3.0") || hasToken(t, "3.2") || hasToken(t, "sc ")) return "gseries";
  if (hasToken(t, "930")) return "gseries";
  const y = yearSignal(title);
  if (y === null) return null;
  if (y >= 1963 && y <= 1973) return "901";
  if (y >= 1974 && y <= 1989) return "gseries";
  if (y >= 1990 && y <= 1994) return "964";
  if (y >= 1995 && y <= 1998) return "993";
  return null;
}

/** 992.1 and 992.2 share the "992" code, so they accept each other's titles. */
function genCompatible(signal: GenSignal | null, gen: GenerationId): boolean {
  if (!signal) return false;
  if (signal === gen) return true;
  return signal === "992" && (gen === "992-1" || gen === "992-2");
}

interface Match {
  ok: boolean;
  score: number;
  why: string;
}

const NO: Match = { ok: false, score: 0, why: "" };

/** The file title names this exact variant. */
function matchExact(title: string, spec: Spec): Match {
  const t = norm(title);
  if (!IMAGE_EXT.test(title)) return { ...NO, why: "not a raster image" };
  if (!mentionsPorsche(title)) return { ...NO, why: "not a Porsche 911 subject" };
  if (isNoise(title)) return { ...NO, why: "not a photograph of a car" };
  if (spec.noExact) return { ...NO, why: "no Commons photo of this exact car can be identified" };
  const gs = genSignal(title);
  if (gs && !genCompatible(gs, spec.gen)) {
    return { ...NO, why: `title identifies ${gs}, not ${spec.gen}` };
  }
  if (spec.needsSignal && !gs) return { ...NO, why: `title does not identify ${spec.gen}` };
  for (const f of spec.forbidden) {
    if (hasToken(t, f)) return { ...NO, why: `title names a different variant ("${f}")` };
  }
  for (const r of spec.required) {
    if (!hasModelToken(t, r)) return { ...NO, why: `title lacks "${r}"` };
  }
  if (!bodyCompatible(t, spec)) return { ...NO, why: "body style not offered for this variant" };
  return { ok: true, score: 100 + 8 * spec.required.length, why: "title matches this variant" };
}

/** A different trim of the same car — only with a positive signal for this gen. */
function matchFamily(title: string, spec: Spec): Match {
  const t = norm(title);
  if (!IMAGE_EXT.test(title)) return { ...NO, why: "not a raster image" };
  if (!mentionsPorsche(title)) return { ...NO, why: "not a Porsche 911 subject" };
  if (isNoise(title)) return { ...NO, why: "not a photograph of a car" };
  if (!genCompatible(genSignal(title), spec.gen)) {
    return { ...NO, why: `title does not identify this generation (${spec.gen})` };
  }
  if (spec.displacement) {
    const d = DISPLACEMENTS.find((x) => hasToken(t, x));
    if (d && d !== spec.displacement) return { ...NO, why: `different engine size (${d})` };
  }
  for (const f of spec.forbidden) {
    if (hasToken(t, f)) return { ...NO, why: `title names a different variant ("${f}")` };
  }
  if (!bodyCompatible(t, spec)) return { ...NO, why: "body style not offered for this variant" };
  return { ok: true, score: 42, why: `same ${spec.gen} family, sibling trim` };
}

function bodyCompatible(t: string, spec: Spec): boolean {
  const hits = Object.keys(BODY_TOKEN).filter((b) => hasToken(t, BODY_TOKEN[b]));
  if (hits.length === 0) return true;
  if (spec.bodyExclusive) return hits.some((b) => spec.bodies.includes(b));
  return hits.every((b) => spec.bodies.includes(b));
}

function matchGeneration(title: string, gen: GenerationId): Match {
  if (!IMAGE_EXT.test(title)) return { ...NO, why: "not a raster image" };
  if (!mentionsPorsche(title) || isNoise(title)) return { ...NO, why: "not usable" };
  if (!genCompatible(genSignal(title), gen)) return { ...NO, why: `title does not identify ${gen}` };
  return { ok: true, score: 24, why: `identifies as ${gen}` };
}

function compositionScore(width: number, height: number): number {
  const ratio = width / Math.max(1, height);
  if (ratio >= 1.5) return 14;
  if (ratio >= 1.15) return 8;
  if (ratio < 0.85) return -10;
  return 0;
}

function subjectScore(title: string, rank: number): number {
  const t = norm(title);
  let s = Math.max(0, 12 - rank * 0.4);
  if (/front|frontal/.test(t)) s += 4;
  if (/rear|heck/.test(t)) s -= 2;
  if (/interior|cockpit|detail|engine/.test(t)) s -= 5;
  if (/panoramio|\d{6,}/.test(t)) s -= 1;
  return s;
}

function assessmentBonus(a: string | null): number {
  if (a === "Featured picture") return 60;
  if (a === "Quality image") return 26;
  if (a === "Valued image") return 10;
  return 0;
}

/* ------------------------------------------------------------ data i/o */

function loadGenerations(): GenerationLite[] {
  return fs
    .readdirSync(GEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(GEN_DIR, f), "utf8")) as GenerationLite)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function emptyImages(): ImagesFile {
  return { generatedAt: new Date().toISOString(), generations: {}, variants: {} };
}

function loadImages(): ImagesFile {
  if (!fs.existsSync(IMAGES_JSON)) return emptyImages();
  try {
    const d = JSON.parse(fs.readFileSync(IMAGES_JSON, "utf8")) as ImagesFile;
    if (d && typeof d === "object" && d.generations && d.variants) {
      return { generatedAt: d.generatedAt, generations: d.generations, variants: d.variants };
    }
  } catch {
    /* rebuild */
  }
  return emptyImages();
}

function loadCredits(): Map<string, CreditOut> {
  const map = new Map<string, CreditOut>();
  if (!fs.existsSync(CREDITS_JSON)) return map;
  try {
    const d = JSON.parse(fs.readFileSync(CREDITS_JSON, "utf8")) as { credits?: CreditOut[] };
    for (const c of d.credits ?? []) if (c.assetId) map.set(c.assetId, c);
  } catch {
    /* rebuild */
  }
  return map;
}

/** every creditId actually referenced by data/images.json */
function referencedCredits(images: ImagesFile): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.creditId === "string") out.add(obj.creditId);
    for (const v of Object.values(obj)) walk(v);
  };
  walk(images.generations);
  walk(images.variants);
  return out;
}

function writeData(images: ImagesFile, credits: Map<string, CreditOut>): void {
  images.generatedAt = new Date().toISOString();
  const used = referencedCredits(images);
  for (const id of [...credits.keys()]) if (!used.has(id)) credits.delete(id);
  const sorted = [...credits.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  fs.writeFileSync(IMAGES_JSON, `${JSON.stringify(images, null, 2)}\n`);
  fs.writeFileSync(
    CREDITS_JSON,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), credits: sorted }, null, 2)}\n`,
  );
}

function assetIdFor(fileTitle: string): string {
  return `img-${slug(fileTitle.slice(5), 58)}-${hash(fileTitle)}`;
}

function pageUrlFor(fileTitle: string): string {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, "_"))}`;
}

/* ------------------------------------------------------------- pipeline */

async function runGeneration(
  gen: GenerationLite,
  images: ImagesFile,
  credits: Map<string, CreditOut>,
  onlyVariants: Set<string>,
  dryRun: boolean,
): Promise<void> {
  const t0 = Date.now();
  const specs = gen.variants
    .filter((v) => onlyVariants.size === 0 || onlyVariants.has(v.id))
    .map((v) => deriveSpec(gen, v));
  console.log(`\n=== ${gen.id} · ${gen.code} · ${gen.name} · ${specs.length} variants`);

  /* 1 — search, keep only titles that name the variant ------------------- */
  const seenTitles = new Map<string, Candidate>();
  const perSpec = new Map<string, Candidate[]>();
  let queries = 0;

  for (const q of QUALITY_QUERIES[gen.id]) {
    queries++;
    const hits = await searchCommons(q);
    for (let i = 0; i < hits.length; i++) {
      const key = hits[i].key;
      if (!IMAGE_EXT.test(key)) continue;
      if (!mentionsPorsche(key) || isNoise(key)) continue;
      if (!matchGeneration(key, gen.id).ok) continue;
      if (!seenTitles.has(key)) seenTitles.set(key, { fileTitle: key, rank: 90 + i, why: "quality images category" });
    }
  }

  for (const spec of specs) {
    const cands: Candidate[] = [];
    const debug = process.env.P911_DEBUG === spec.variantId;
    const rejects = new Map<string, string[]>();
    for (const q of spec.queries) {
      queries++;
      const hits = await searchCommons(q);
      for (let i = 0; i < hits.length; i++) {
        const key = hits[i].key;
        if (cands.some((c) => c.fileTitle === key)) continue;
        const m = matchExact(key, spec);
        if (!m.ok) {
          if (debug) rejects.set(m.why, [...(rejects.get(m.why) ?? []), key]);
          continue;
        }
        if (!seenTitles.has(key)) seenTitles.set(key, { fileTitle: key, rank: i, why: m.why });
        cands.push({ fileTitle: key, rank: i, why: m.why });
      }
    }
    perSpec.set(spec.key, cands);
    if (dryRun) {
      console.log(`  ${spec.variantId.padEnd(30)} req=[${spec.required.join("|")}] → ${cands.length}`);
      if (debug) {
        console.log(`      ✓ ${cands.slice(0, 12).map((c) => c.fileTitle).join("\n        ")}`);
        for (const [why, files] of rejects) {
          console.log(`      ✗ ${why}: ${files.slice(0, 4).join(" ; ")}`);
        }
      }
    }
  }
  console.log(`  queries ${queries} · distinct titled files ${seenTitles.size}`);
  if (dryRun) return;

  /* 2 — metadata + licence, strictly positive identification ------------- */
  const titles = [...seenTitles.keys()];
  const metas = new Map<string, FileMeta>();
  const licences = new Map<string, LicenceInfo>();
  let checked = 0;
  await pool(titles, CONCURRENCY, async (title) => {
    const meta = await fileMeta(title);
    if (!meta || meta.width < MIN_SOURCE_W) {
      licences.set(title, {
        ok: false,
        reason: meta ? `source only ${meta.width}px wide` : "no file metadata",
        license: null,
        author: null,
        assessment: null,
      });
      return;
    }
    metas.set(title, meta);
    licences.set(title, await licenceFor(title, meta.uploader));
    checked++;
    if (checked % 100 === 0) console.log(`  licence-checked ${checked}/${titles.length}`);
  });
  const usable = titles.filter((t) => licences.get(t)?.ok === true);
  const rejected = new Map<string, number>();
  for (const t of titles) {
    if (licences.get(t)?.ok === true) continue;
    const why = licences.get(t)?.reason ?? "unknown";
    rejected.set(why, (rejected.get(why) ?? 0) + 1);
  }
  console.log(`  licence accepted ${usable.length}/${titles.length}`);
  console.log(
    `  rejected: ${[...rejected.entries()].map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`,
  );
  if (usable.length === 0) return;

  const bonusOf = (t: string): number => assessmentBonus(licences.get(t)?.assessment ?? null);
  const metaOf = (t: string): FileMeta => metas.get(t)!;
  const scoreOf = (t: string, base: number): number => {
    const m = metaOf(t);
    return base + bonusOf(t) + compositionScore(m.width, m.height) + subjectScore(t, seenTitles.get(t)?.rank ?? 99);
  };

  /* 3 — generation hero + timeline --------------------------------------- */
  const genRanked = usable
    .filter((t) => matchGeneration(t, gen.id).ok)
    .map((t) => ({ t, s: scoreOf(t, 24) }))
    .sort((a, b) => b.s - a.s);
  const heroTitle =
    genRanked.find((g) => {
      const m = metaOf(g.t);
      const r = m.width / m.height;
      return r >= 1.3 && r <= 2.1;
    })?.t ?? genRanked[0]?.t;
  const timelineTitle =
    genRanked.find((g) => {
      const m = metaOf(g.t);
      return m.width / m.height >= 1.6 && g.t !== heroTitle;
    })?.t ?? genRanked.find((g) => g.t !== heroTitle)?.t;

  /* 4 — per-variant selection: exact first, then same-family top-up ------ */
  const picks = new Map<string, Selection[]>();
  for (const spec of specs) {
    const chosen: Selection[] = [];
    const ranked = (perSpec.get(spec.key) ?? [])
      .filter((c) => licences.get(c.fileTitle)?.ok === true)
      .map((c) => ({ t: c.fileTitle, s: scoreOf(c.fileTitle, 100 + 8 * spec.required.length) }))
      .sort((a, b) => b.s - a.s);
    for (const r of ranked) {
      if (chosen.length >= MAX_VARIANT_IMAGES) break;
      if (chosen.some((x) => x.title === r.t)) continue;
      chosen.push({ title: r.t, tier: "exact", note: matchExact(r.t, spec).why });
    }
    if (chosen.length < TARGET_GALLERY) {
      const fam = usable
        .filter((t) => !chosen.some((x) => x.title === t))
        .map((t) => ({ t, m: matchFamily(t, spec) }))
        .filter((x) => x.m.ok)
        .map((x) => ({ t: x.t, s: scoreOf(x.t, x.m.score), why: x.m.why }))
        .sort((a, b) => b.s - a.s);
      for (const f of fam) {
        if (chosen.length >= MAX_VARIANT_IMAGES) break;
        chosen.push({ title: f.t, tier: "family", note: f.why });
      }
    }
    picks.set(spec.key, chosen);
  }

  /* 5 — download every distinct source once ------------------------------ */
  const dirOf = new Map<string, string>();
  if (heroTitle) dirOf.set(heroTitle, gen.id);
  if (timelineTitle) dirOf.set(timelineTitle, gen.id);
  for (const [specKey, list] of picks) {
    const dir = specKey.split("/")[1];
    for (const s of list) if (!dirOf.has(s.title)) dirOf.set(s.title, dir);
  }

  const useCount = new Map<string, number>();
  for (const title of dirOf.keys()) useCount.set(title, (useCount.get(title) ?? 0) + 1);
  const retrieved = new Date().toISOString().slice(0, 10);
  let downloaded = 0;
  let onDisk = 0;

  await pool([...dirOf.keys()], CONCURRENCY, async (title) => {
    const meta = metas.get(title);
    const lic = licences.get(title);
    if (!meta || !lic) return;
    const assetId = assetIdFor(title);
    const ext = (path.extname(new URL(meta.origUrl).pathname) || ".jpg").toLowerCase();
    const rawPath = path.join(RAW_DIR, `${assetId}${ext}`);
    let ok: boolean;
    if (fs.existsSync(rawPath) && fs.statSync(rawPath).size > 4096) {
      ok = true;
      onDisk++;
    } else {
      ok = await download(meta.thumbUrl, rawPath);
      if (!ok) ok = await download(meta.origUrl, rawPath);
      if (ok) downloaded++;
    }
    if (!ok) {
      console.log(`  ! download failed: ${title}`);
      return;
    }
    const widths = avifWidthsFor(meta.width);
    const shared = (useCount.get(title) ?? 0) > 1;
    credits.set(assetId, {
      assetId,
      kind: "image",
      source: "wikimedia",
      url: pageUrlFor(title),
      license: lic.license,
      author: lic.author,
      retrieved,
      sourceId: title,
      localPath: `/images/${dirOf.get(title)}/${assetId}-${widths[widths.length - 1]}.avif`,
      note: [
        "licence parsed from the rendered Commons file page",
        `Commons assessment: ${lic.assessment ?? "none recorded"}`,
        `source ${meta.width}×${meta.height}px (${Math.round(meta.bytes / 1024)} kB original), rendered locally to AVIF ${widths.join("/")} + WebP 1280`,
        shared
          ? `shared by ${useCount.get(title)} entries — a stand-in wherever no photo of that exact car is licensed on Commons`
          : null,
      ]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("; "),
    });
  });
  console.log(`  downloaded ${downloaded} · reused ${onDisk} already on disk`);

  /* 6 — emit ImageRefs ---------------------------------------------------- */
  const refFor = (title: string, alt: string): ImageRefOut | null => {
    const credit = credits.get(assetIdFor(title));
    if (!credit) return null;
    return { src: credit.localPath, alt, blurDataURL: null, creditId: credit.assetId };
  };

  images.generations[gen.id] = {
    heroImage: heroTitle ? refFor(heroTitle, `${gen.name} (${gen.code}) — hero photograph`) : null,
    timelineImage: timelineTitle
      ? refFor(timelineTitle, `${gen.name} (${gen.code}) — wide view for the timeline`)
      : null,
  };

  let withHero = 0;
  let withFive = 0;
  let standIn = 0;
  const missing: string[] = [];
  for (const spec of specs) {
    let list = picks.get(spec.key) ?? [];
    if (list.length === 0 && heroTitle) {
      // no licensed photo of that exact car exists — fall back to the generation
      // hero (truthful stand-in, no gallery padding)
      list = [{ title: heroTitle, tier: "generation", note: `${gen.name} (${gen.code})` }];
      standIn++;
    }
    const refs = list
      .map((s, i) =>
        refFor(
          s.title,
          s.tier === "exact"
            ? i === 0
              ? spec.name
              : `${spec.name} — photo ${i + 1}`
            : `${spec.name} — stand-in photo (${s.note})`,
        ),
      )
      .filter((r): r is ImageRefOut => r !== null);
    if (refs[0]) withHero++;
    if (refs.length >= 5) withFive++;
    if (!refs[0]) missing.push(spec.key);
    images.variants[spec.key] = { heroImage: refs[0] ?? null, gallery: refs.slice(1) };
  }

  // plain-id alias for variant ids that are unique across all nine files
  const counts = new Map<string, number>();
  for (const g of loadGenerations()) for (const v of g.variants) counts.set(v.id, (counts.get(v.id) ?? 0) + 1);
  for (const spec of specs) {
    if ((counts.get(spec.variantId) ?? 0) === 1) images.variants[spec.variantId] = images.variants[spec.key];
  }

  writeData(images, credits);
  console.log(
    `  ${gen.id}: hero ${withHero}/${specs.length} · gallery>=5 ${withFive}/${specs.length} · generation stand-ins ${standIn} · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  if (missing.length) console.log(`  MISSING ${gen.id}: ${missing.join(", ")}`);
}

/* ------------------------------------------------------------------ main */

function argValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const gens = argValues(args, "--gen") as GenerationId[];
  const variants = new Set(argValues(args, "--variant"));
  const dryRun = args.includes("--dry-run");
  if (!wantAll && gens.length === 0) {
    console.error("usage: fetch-images.ts --all | --gen <id> [--gen <id>] [--variant <id>] [--dry-run]");
    process.exit(1);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const all = loadGenerations();
  const targets = (wantAll ? all : all.filter((g) => gens.includes(g.id))).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  if (targets.length === 0) {
    console.error(`unknown generation; available: ${all.map((g) => g.id).join(", ")}`);
    process.exit(1);
  }

  const images = loadImages();
  const credits = loadCredits();
  for (const gen of targets) {
    await runGeneration(gen, images, credits, variants, dryRun);
  }
  writeData(images, credits);
  console.log(`\ndata/images.json + data/credits.json written · ${credits.size} credits`);
}

await main();

export {};