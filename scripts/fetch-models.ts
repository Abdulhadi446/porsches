/**
 * ASSET-3D pipeline — owner: ASSET-3D.
 *
 * Run:   node scripts/fetch-models.ts      (Node >= 22 strips the types natively)
 *        npx tsx scripts/fetch-models.ts   (if `tsx` is ever added to the repo)
 *
 * Flags:
 *   --offline   do not touch the network; keep whatever data/models.json holds
 *   --refresh   re-query the Sketchfab search API even if a pinned uid verifies
 *   --no-glb    skip the direct-licence GLB download/optimise step
 *
 * WHAT THIS SCRIPT CANNOT DO
 * --------------------------
 * Sketchfab's model-download endpoint (`GET /v3/models/<uid>/download`) returns
 * **401 Unauthorized** without an OAuth access token. No Sketchfab token is
 * available to this project and none is requested, so every Sketchfab-backed
 * entry in data/models.json is an **official `<iframe>` embed URL**, never a
 * re-hosted GLB. Local .glb files only ever come from DIRECT_SOURCES below,
 * i.e. repositories that are (a) downloadable without authentication and
 * (b) carry an open licence whose text this script re-reads from the repo on
 * every run.
 *
 * Idempotent: re-running re-verifies licences and rewrites the same file.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Model3D } from "#data/schema";

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_JSON = join(ROOT, "data", "models.json");
const PUBLIC_MODELS = join(ROOT, "public", "models");
const API = "https://api.sketchfab.com/v3";

/** Hard perf budget from docs/CONTRACTS.md. */
const GLB_BYTE_BUDGET = 3_000_000;

/**
 * Licence allow-list. Deliberately EXACT-match: Sketchfab's
 * "CC Attribution-NonCommercial" / "…-NonCommercial-ShareAlike" labels contain
 * the string "CC Attribution" as a substring, so a loose `includes()` test would
 * silently admit NC-licensed uploads. Only these three labels are accepted.
 */
const ALLOWED_LICENSES = new Set([
  "CC0 Public Domain",
  "CC Attribution",
  "CC Attribution-ShareAlike",
]);

const ARGS = new Set(process.argv.slice(2));
const OFFLINE = ARGS.has("--offline");
const REFRESH = ARGS.has("--refresh");
const DO_GLB = !ARGS.has("--no-glb");

// ---------------------------------------------------------------------------
// shortlist
// ---------------------------------------------------------------------------

/**
 * `pinned` uids are the manually ranked winners. They were each verified with
 * `GET https://api.sketchfab.com/v3/models/<uid>` (which returns the full
 * licence block) and are re-verified on every run of this script — if a licence
 * ever changes to a non-allowed label the run aborts instead of silently
 * shipping an unusable embed. `queries` are re-run against the search API so the
 * shortlist stays current and so `--report` can print live runner-up candidates.
 */
interface Target {
  /** `${genId}` for generation heroes, `${genId}/${variantId}` for variants. */
  key: string;
  kind: "generation" | "variant";
  queries: string[];
  pinned: string[];
  /** why a target has no model, when `pinned` is empty */
  note?: string;
}

const GENERATION_TARGETS: Target[] = [
  {
    key: "901",
    kind: "generation",
    pinned: ["ab60b9e064e645ab96aeabe7772e4d49"],
    queries: ["porsche 901", "1964 porsche 911", "porsche 911 1970", "porsche 911 classic"],
  },
  {
    key: "gseries",
    kind: "generation",
    pinned: ["8568d9d14a994b9cae59499f0dbed21e"],
    queries: ["porsche 930 turbo", "porsche 911 turbo 930", "1975 porsche 911 930 turbo"],
  },
  {
    key: "964",
    kind: "generation",
    pinned: ["d01b254483794de3819786d93e0e1ebf"],
    queries: ["porsche 964", "porsche 911 964", "porsche 911 964 turbo"],
  },
  {
    key: "993",
    kind: "generation",
    pinned: ["b711966542e143e2829a21e0230fa30e"],
    queries: ["porsche 993", "porsche 911 993", "porsche 993 carrera"],
  },
  {
    key: "996",
    kind: "generation",
    pinned: ["bf3bcbc17f274bc792b0aca30ce1a0d7"],
    queries: ["porsche 996", "porsche 911 996", "porsche 996 turbo"],
  },
  {
    key: "997",
    kind: "generation",
    pinned: ["7e25beb0e2c841f0bf51f94fde651fd4"],
    queries: ["porsche 997", "porsche 911 997", "porsche 997 gt3 rs"],
  },
  {
    key: "991",
    kind: "generation",
    pinned: ["97785983d3a949cf87e9ee6bf49f4032"],
    queries: ["porsche 991", "porsche 911 991", "porsche 991 gt3"],
  },
  {
    key: "992-1",
    kind: "generation",
    pinned: ["318cfb7279a94e8f96095ec0236f02ad"],
    queries: ["porsche 992", "porsche 911 992", "porsche 992 gt3 rs"],
  },
  {
    key: "992-2",
    kind: "generation",
    pinned: ["b668f8a336b54954b04fa0dade507300"],
    queries: ["porsche 911 992.2", "porsche 911 targa 4 gts", "porsche 911 turbo s 2025"],
  },
];

const VARIANT_TARGETS: Target[] = [
  // ---- 901 / F-body -------------------------------------------------------
  { key: "901/911-2.0", kind: "variant", pinned: ["ab60b9e064e645ab96aeabe7772e4d49"],
    queries: ["1964 porsche 911", "porsche 911 2.0"] },
  { key: "901/st", kind: "variant", pinned: ["1fce7028d0d34ddc801905dadd1d0ce6"],
    queries: ["porsche 911 st", "911 st 1971"] },
  { key: "901/targa", kind: "variant", pinned: ["7e2018a0bccf48d6b26cd2285d544f19"],
    queries: ["porsche 911 targa"], note: "only a ~10k-vertex low-poly targa exists under CC0/CC BY / CC BY-SA" },
  { key: "901/carrera-rs-2.7", kind: "variant", pinned: [],
    queries: ["porsche 911 carrera rs 2.7"],
    note: "every 2.7 Carrera RS on Sketchfab is CC BY-NC-SA, which is outside the licence allow-list" },
  // ---- g-series / 930 -----------------------------------------------------
  { key: "gseries/turbo-3.0-930", kind: "variant", pinned: ["8568d9d14a994b9cae59499f0dbed21e"],
    queries: ["porsche 930 turbo 1975"] },
  { key: "gseries/turbo-3.3-930", kind: "variant", pinned: ["d792213008744efa9253a9147523ca2d"],
    queries: ["porsche 911 turbo 3.3 1980", "930 turbo 3.3"] },
  { key: "gseries/turbo-flachbau", kind: "variant", pinned: ["16e4693a8f4144e4a071685289869dd6"],
    queries: ["porsche 930 flachbau", "911 turbo slantnose"],
    note: "3k-vertex low-poly slantnose only" },
  { key: "gseries/turbo-s-3.3", kind: "variant", pinned: [], queries: ["porsche 911 turbo s 1989"],
    note: "no CC0/CC BY / CC BY-SA model of the 930 Turbo S exists; the only matches are 964 Turbo S uploads" },
  { key: "gseries/turbo-le-1989", kind: "variant", pinned: [], queries: ["porsche 911 turbo le"],
    note: "no CC0/CC BY / CC BY-SA model exists" },
  { key: "gseries/sc", kind: "variant", pinned: ["1986766bfeb845f2ad2aa898e4be0cdf"],
    queries: ["porsche 911 sc"], note: "only a rally-liveried 911 SC is available" },
  { key: "gseries/carrera-3.2", kind: "variant", pinned: ["26953936409c4ee7b9de11caa37e52f1"],
    queries: ["porsche 911 3.2 carrera", "porsche 911 g50"] },
  { key: "gseries/carrera-rs-3.0", kind: "variant", pinned: [], queries: ["porsche 911 carrera rs 3.0"],
    note: "available uploads are CC BY-NC-SA or mislabelled 993 Carrera RS" },
  { key: "gseries/carrera-rsr-3.0", kind: "variant", pinned: [], queries: ["porsche 911 carrera rsr 3.0"],
    note: "race-prepped RSR models are all non-commercial licensed" },
  { key: "gseries/carrera-club-sport", kind: "variant", pinned: [], queries: ["porsche 911 club sport g50"],
    note: "no allowed-licence model exists" },
  { key: "gseries/speedster-1989", kind: "variant", pinned: [], queries: ["porsche 911 speedster 1989"],
    note: "no allowed-licence model exists" },
  // ---- 964 ----------------------------------------------------------------
  { key: "964/carrera-4", kind: "variant", pinned: ["cae366648d134fa3a3ee810ba1f6c2fc"],
    queries: ["porsche 911 964", "porsche 964"] },
  { key: "964/carrera-4s", kind: "variant", pinned: ["d01b254483794de3819786d93e0e1ebf"],
    queries: ["porsche 964 turbo look", "free porsche 911 carrera 4s"] },
  { key: "964/turbo-3.6", kind: "variant", pinned: ["e0dd6206dcc74f37a833b47c2a1d7572"],
    queries: ["porsche 964 turbo", "porsche 911 turbo 3.6"] },
  { key: "964/turbo-s-3.6", kind: "variant", pinned: ["b868c5883b9c4ff889bc7f439e01cd7e"],
    queries: ["porsche 964 turbo s", "porsche 911 964 turbo s 3.6"] },
  { key: "964/rs-3.8", kind: "variant", pinned: [], queries: ["porsche 964 rs 3.8", "porsche 964 carrera rs"],
    note: "the only CC-labelled 964 RS is a 311-vertex PSX-style model, too low-poly to ship" },
  { key: "964/rsr-3.8", kind: "variant", pinned: [], queries: ["porsche 964 rsr 3.8"],
    note: "race models are non-commercial licensed" },
  { key: "964/speedster", kind: "variant", pinned: [], queries: ["porsche 964 speedster"],
    note: "no allowed-licence model exists" },
  { key: "964/cup", kind: "variant", pinned: [], queries: ["porsche 964 cup"],
    note: "no allowed-licence model exists" },
  // ---- 993 ----------------------------------------------------------------
  { key: "993/carrera", kind: "variant", pinned: ["b711966542e143e2829a21e0230fa30e"],
    queries: ["porsche 993", "porsche 911 993"] },
  { key: "993/turbo", kind: "variant", pinned: ["72f2943569434e4e93ab63f403c6aa1c"],
    queries: ["porsche 993 turbo"], note: "only a low-poly 993 Turbo exists under an allowed licence" },
  { key: "993/carrera-rs", kind: "variant", pinned: [], queries: ["porsche 993 carrera rs"],
    note: "available uploads are CC BY-NC-SA or mislabelled 992 tributes" },
  { key: "993/turbo-s", kind: "variant", pinned: [], queries: ["porsche 993 turbo s"],
    note: "no allowed-licence model exists" },
  { key: "993/gt2", kind: "variant", pinned: [], queries: ["porsche 993 gt2"],
    note: "only RAUH-Welt / RWB-bodied 993 GT2 conversions are allowed-licensed, which misrepresent the variant" },
  { key: "993/gt2-evo", kind: "variant", pinned: [], queries: ["porsche 993 gt2 evo"],
    note: "no allowed-licence model exists" },
  { key: "993/speedster", kind: "variant", pinned: [], queries: ["porsche 993 speedster"],
    note: "no allowed-licence model exists" },
  { key: "993/club-sport", kind: "variant", pinned: [], queries: ["porsche 993 club sport"],
    note: "no allowed-licence model exists" },
  // ---- 996 ----------------------------------------------------------------
  { key: "996/turbo", kind: "variant", pinned: ["0aca89de30b94126bc7020109b2f3ef0"],
    queries: ["porsche 996 turbo", "porsche 911 turbo 996"] },
  { key: "996/gt2", kind: "variant", pinned: ["2f39754f878b4c82ba0c0b938eeafc15"],
    queries: ["porsche 996 gt2 rs"] },
  { key: "996/gt3", kind: "variant", pinned: [], queries: ["porsche 996 gt3", "porsche 911 gt3 996"],
    note: "NO CC0/CC BY / CC BY-SA 996 GT3 exists; every match is either a 992 GT3 or a non-commercial licence" },
  { key: "996/gt3-rs", kind: "variant", pinned: [], queries: ["porsche 996 gt3 rs"],
    note: "no allowed-licence model of the 2004 996 GT3 RS exists" },
  { key: "996/turbo-s", kind: "variant", pinned: [], queries: ["porsche 996 turbo s"],
    note: "no allowed-licence model exists" },
  // ---- 997 ----------------------------------------------------------------
  { key: "997/gt2-rs", kind: "variant", pinned: ["41419345868e406eaec8a271e33de3c1"],
    queries: ["porsche 911 gt2 rs angle eyes", "porsche 997 gt2 rs"] },
  { key: "997/gt3-rs", kind: "variant", pinned: ["7e25beb0e2c841f0bf51f94fde651fd4"],
    queries: ["porsche 997 gt3 rs"] },
  { key: "997/gt3-rs-4.0", kind: "variant", pinned: ["95226a73526b46e680b091f1caf6191f"],
    queries: ["porsche 997 gt3 rs 4.0"] },
  { key: "997/gt2", kind: "variant", pinned: ["c48298e703c44f2187d5562ef64f4dcf"],
    queries: ["porsche 911 gt2 997"] },
  { key: "997/turbo-s", kind: "variant", pinned: [], queries: ["porsche 997 turbo s"],
    note: "NO CC0/CC BY / CC BY-SA 997 Turbo S exists on Sketchfab" },
  { key: "997/sport-classic", kind: "variant", pinned: [], queries: ["porsche 997 sport classic"],
    note: "the 2009 997 Sport Classic has no allowed-licence model; only the 2023 (992.1) car does" },
  { key: "997/gt3", kind: "variant", pinned: [], queries: ["porsche 997 gt3"],
    note: "no allowed-licence model of the 997 GT3 exists" },
  // ---- 991 ----------------------------------------------------------------
  { key: "991/gt2-rs", kind: "variant", pinned: ["98767072b9f94f8eb6c4512b7be891c4"],
    queries: ["porsche 991 gt2 rs"],
    note: "uploader states the asset was sourced from third-party platforms; licence label is CC Attribution as reported by the API" },
  { key: "991/gt3-rs", kind: "variant", pinned: ["c08b312e73754d0db8ab1e266eca8a28"],
    queries: ["porsche 991 gt3 rs"] },
  { key: "991/turbo-s", kind: "variant", pinned: ["1924ab5a79b7451e95b9a659f3db715d"],
    queries: ["porsche 991 turbo s", "porsche 911 991.2 turbo s"] },
  { key: "991/r", kind: "variant", pinned: ["a8f40dc2180142c0887d251199d74077"],
    queries: ["porsche 911 r 2017"] },
  { key: "991/carrera-t", kind: "variant", pinned: [], queries: ["porsche 991 carrera t"],
    note: "no allowed-licence model exists" },
  { key: "991/speedster", kind: "variant", pinned: [], queries: ["porsche 991 speedster"],
    note: "available uploads are CC BY-NC-SA" },
  // ---- 992.1 --------------------------------------------------------------
  { key: "992-1/gt3-rs", kind: "variant", pinned: ["bbb0f6181a52416bb776713cfd4987dd"],
    queries: ["porsche 992 gt3 rs", "2023 porsche 911 gt3 rs 992"] },
  { key: "992-1/dakar", kind: "variant", pinned: ["326e90718d164f018e9a673849a3161b"],
    queries: ["porsche 911 dakar", "porsche 911 dakar rallye design package"],
    note: "chosen upload is a remix; the original Ddiaz Design upload reports CC BY-NC-SA on the API" },
  { key: "992-1/sport-classic", kind: "variant", pinned: ["38903fc72658408287a5972285494bd6"],
    queries: ["porsche 911 sport classic 2023"] },
  { key: "992-1/s-t", kind: "variant", pinned: ["f39f7c539a3440428c22a3da2f52af43"],
    queries: ["porsche 911 s t", "2024 porsche 911 st"] },
  { key: "992-1/turbo-s", kind: "variant", pinned: ["b0a77bb9395548aabcfe51b2ca476b8b"],
    queries: ["porsche 911 turbo s 992"], note: "uploader marks the model WIP / no interior" },
  { key: "992-1/gt3", kind: "variant", pinned: ["a23f04a665a84177ac97551ce0c720eb"],
    queries: ["porsche 992 gt3", "2022 porsche 911 gt3 992"] },
  { key: "992-1/gts", kind: "variant", pinned: ["4e98dd91d11d4809bb80102edfbde42b"],
    queries: ["porsche 992 gts", "2018 porsche 911 carrera gts"] },
  { key: "992-1/targa-4s", kind: "variant", pinned: ["616ebc4356c74a3b8554c396eb3bd34c"],
    queries: ["porsche 992 targa 4s"] },
  { key: "992-1/targa-4s-heritage", kind: "variant", pinned: ["c9af184fba65488db9138d9cffcea832"],
    queries: ["porsche 911 targa 4s heritage design"] },
  // ---- 992.2 --------------------------------------------------------------
  { key: "992-2/targa-4-gts", kind: "variant", pinned: ["214a61d759e942e2887290b6e4e50d49"],
    queries: ["porsche 911 targa 4 gts", "porsche 911 gts t hybrid"] },
  { key: "992-2/turbo-s", kind: "variant", pinned: [], queries: ["porsche 911 turbo s 2025", "porsche 992 turbo s t hybrid"],
    note: "the 992.2 Turbo S T-Hybrid is too new to be modelled; only 992.1 Turbo S uploads exist" },
  { key: "992-2/carrera-gts", kind: "variant", pinned: [], queries: ["porsche 911 carrera gts 2024"],
    note: "no allowed-licence coupe Carrera GTS model; only the Targa 4 GTS shell is modelled" },
  { key: "992-2/gt3-s-c", kind: "variant", pinned: [], queries: ["porsche 911 gt3 s/c", "porsche 911 gt3 sc open top"],
    note: "unveiled 2026-04-14 — no 3D model of any licence exists yet" },
  { key: "992-2/spirit-70", kind: "variant", pinned: [], queries: ["porsche 911 spirit 70"],
    note: "no 3D model of any licence exists" },
  { key: "992-2/gt3", kind: "variant", pinned: [], queries: ["porsche 911 gt3 2025"],
    note: "992.2 GT3 is visually identical to 992.1 and only 992.1 uploads are labelled as such" },
];

const TARGETS = [...GENERATION_TARGETS, ...VARIANT_TARGETS];

// ---------------------------------------------------------------------------
// directly-downloadable, openly-licensed sources (the only path to a local GLB)
// ---------------------------------------------------------------------------

interface DirectSource {
  /** folder name under public/models/ and the Model3D.glb basename folder */
  id: string;
  repo: string;
  branch: string;
  /** licence file inside the repo — re-read and asserted on every run */
  licensePath: string;
  /** substring that MUST appear in the licence text, else the run aborts */
  licenseMustContain: string[];
  license: string;
  author: string;
  authorUrl: string;
  /** entry asset (gltf + external bin/textures) inside the repo */
  entry: string;
  /** generation ids this GLB is the hero for */
  generations: string[];
  /** variant ids this GLB represents */
  variants: string[];
  /** fallback Sketchfab embed uid, used when the GLB cannot be produced */
  fallbackEmbedUid: string;
}

const DIRECT_SOURCES: DirectSource[] = [
  {
    id: "930-turbo-1975",
    repo: "UtkarshPathrabe/Porche-911-930-Turbo-1975-3D-Model",
    branch: "main",
    licensePath: "LICENSE",
    licenseMustContain: ["MIT License", "Permission is hereby granted, free of charge"],
    license: "MIT",
    author: "Utkarsh Pathrabe",
    authorUrl: "https://github.com/UtkarshPathrabe",
    entry: "scene.gltf",
    generations: ["gseries"],
    variants: ["gseries/turbo-3.0-930"],
    fallbackEmbedUid: "8568d9d14a994b9cae59499f0dbed21e",
  },
];

// ---------------------------------------------------------------------------
// api plumbing
// ---------------------------------------------------------------------------

interface SfLicense {
  label?: string;
  fullName?: string;
  requirements?: string;
  url?: string;
}
interface SfModel {
  uid: string;
  name: string;
  viewerUrl: string;
  vertexCount: number | null;
  faceCount: number | null;
  animationCount: number | null;
  isDownloadable?: boolean;
  publishedAt?: string;
  description?: string;
  license?: SfLicense;
  user?: { displayName?: string; username?: string };
}
interface SfSearchResult extends SfModel {
  license?: SfLicense;
  likeCount?: number;
}

async function apiGet<T>(path: string): Promise<T | null> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

function embedUrl(model: SfModel): string {
  // viewerUrl is https://sketchfab.com/3d-models/<slug>-<uid>; never hand-build
  // the slug, always derive the embed from the API response.
  return `${model.viewerUrl}?embed=1`;
}

const detailCache = new Map<string, SfModel | null>();

async function verifyModel(uid: string): Promise<SfModel | null> {
  if (detailCache.has(uid)) return detailCache.get(uid) ?? null;
  const model = await apiGet<SfModel>(`/models/${uid}`);
  if (model && !ALLOWED_LICENSES.has(model.license?.label ?? "")) {
    throw new Error(
      `licence check failed for ${uid} ("${model.name}"): label is ` +
        `"${model.license?.label ?? "none"}", which is outside the allow-list ` +
        `[${[...ALLOWED_LICENSES].join(", ")}]. Refusing to write data/models.json.`,
    );
  }
  detailCache.set(uid, model);
  return model;
}

interface Candidate {
  uid: string;
  name: string;
  license: string;
  author: string | null;
  username: string | null;
  vertexCount: number | null;
  likeCount: number | null;
  viewerUrl: string;
}

/** Re-run the shortlist's queries and return the best live candidates. */
async function searchCandidates(target: Target): Promise<Candidate[]> {
  if (OFFLINE || target.queries.length === 0) return [];
  const byUid = new Map<string, Candidate>();
  for (const q of target.queries) {
    const data = await apiGet<{ results?: SfSearchResult[] }>(
      `/search?type=models&q=${encodeURIComponent(q)}&downloadable=true&count=24&sort_by=-likeCount`,
    );
    for (const r of data?.results ?? []) {
      const label = r.license?.label ?? "";
      if (!ALLOWED_LICENSES.has(label)) continue;
      if (byUid.has(r.uid)) continue;
      byUid.set(r.uid, {
        uid: r.uid,
        name: r.name,
        license: label,
        author: r.user?.displayName ?? null,
        username: r.user?.username ?? null,
        vertexCount: r.vertexCount,
        likeCount: r.likeCount ?? null,
        viewerUrl: r.viewerUrl,
      });
    }
  }
  const list = [...byUid.values()];
  list.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
  const pool = REFRESH ? list : list.filter((c) => !target.pinned.includes(c.uid));
  return pool.slice(0, REFRESH ? 3 : 2);
}

// ---------------------------------------------------------------------------
// direct GLB pipeline
// ---------------------------------------------------------------------------

function rawUrl(src: DirectSource, path: string): string {
  return `https://raw.githubusercontent.com/${src.repo}/${src.branch}/${path}`;
}

/** Plain-text fetch (LICENSE files are not JSON). */
async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return await res.text();
    } catch {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

async function assertLicense(src: DirectSource): Promise<string> {
  const text = await fetchText(rawUrl(src, src.licensePath));
  if (typeof text !== "string" || text.length < 40) {
    throw new Error(`${src.repo}/${src.licensePath} could not be read — aborting (no licence = all rights reserved).`);
  }
  for (const needle of src.licenseMustContain) {
    if (!text.includes(needle)) {
      throw new Error(
        `${src.repo}/${src.licensePath} does not contain "${needle}". ` +
          `The declared licence (${src.license}) no longer matches the repository — aborting.`,
      );
    }
  }
  return text;
}

async function pull(src: DirectSource, uri: string, dest: string): Promise<void> {
  if (existsSync(dest) && statSync(dest).size > 0) return;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(rawUrl(src, uri));
  if (!res.ok) throw new Error(`could not download ${uri} from ${src.repo}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function downloadSource(src: DirectSource, workDir: string): Promise<string> {
  const entryPath = join(workDir, src.entry);
  await pull(src, src.entry, entryPath);
  const entry = JSON.parse(readFileSync(entryPath, "utf8")) as {
    images?: { uri?: string }[];
    buffers?: { uri?: string }[];
  };
  const uris = [
    ...new Set(
      [
        ...(entry.images ?? []),
        ...(entry.buffers ?? []),
      ]
        .map((i) => i.uri)
        .filter((u): u is string => Boolean(u)),
    ),
  ];
  for (const uri of uris) await pull(src, uri, join(workDir, uri.replace(/^\.\//, "")));
  return entryPath;
}

function optimise(entryPath: string, outGlb: string, textureSize: number | null): void {
  const args = [
    "--yes",
    "@gltf-transform/cli@latest",
    "optimize",
    entryPath,
    outGlb,
    "--compress",
    "draco",
    "--texture-compress",
    "webp",
  ];
  if (textureSize) args.push("--texture-size", String(textureSize));
  execFileSync("npx", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 30 * 60 * 1000 });
}

interface GlbResult {
  id: string;
  glb: string;
  bytes: number;
  license: string;
  author: string;
  sourceId: string;
  sourceUrl: string;
  dropped: string | null;
}

async function buildGlb(src: DirectSource): Promise<GlbResult> {
  const outDir = join(PUBLIC_MODELS, src.id);
  const outGlb = join(outDir, "model.glb");
  mkdirSync(outDir, { recursive: true });

  const base: Omit<GlbResult, "glb" | "bytes" | "dropped"> = {
    id: src.id,
    license: src.license,
    author: src.author,
    sourceId: src.repo,
    sourceUrl: `https://github.com/${src.repo}`,
  };

  const workDir = join(tmpdir(), `asset3d-${src.id}`);
  mkdirSync(workDir, { recursive: true });
  await assertLicense(src);
  const entryPath = await downloadSource(src, workDir);

  let dropped: string | null = null;
  try {
    optimise(entryPath, outGlb, null);
    let bytes = statSync(outGlb).size;
    if (bytes > GLB_BYTE_BUDGET) {
      optimise(entryPath, outGlb, 1024);
      bytes = statSync(outGlb).size;
    }
    if (bytes > GLB_BYTE_BUDGET) {
      dropped = `optimised GLB is ${bytes} bytes, over the ${GLB_BYTE_BUDGET} byte budget — dropped, falling back to embed`;
      rmSync(outDir, { recursive: true, force: true });
    }
    return { ...base, glb: `/models/${src.id}/model.glb`, bytes, dropped };
  } catch (err) {
    dropped = `optimise failed (${(err as Error).message.split("\n")[0]}) — dropped, falling back to embed`;
    rmSync(outDir, { recursive: true, force: true });
    return { ...base, glb: "", bytes: 0, dropped };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------

interface Roster {
  generations: Record<string, { id: string; name: string }[]>;
}

function loadRoster(): Roster {
  return JSON.parse(readFileSync(join(ROOT, "data", "roster.json"), "utf8")) as Roster;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface ModelsFile {
  updatedAt: string;
  generations: Record<string, Model3D | null>;
  variants: Record<string, Model3D | null>;
}

function embedOnly(model: SfModel): Model3D {
  return {
    embedUrl: embedUrl(model),
    sourceId: model.uid,
    license: model.license?.label ?? null,
    author: model.user?.displayName ?? model.user?.username ?? null,
    glb: null,
    turntable: null,
    bytes: null,
  };
}

/**
 * Chronological generation order (same order as the `GenerationId` union in
 * data/schema.ts). Roster variant ids are only unique *within* a generation —
 * `turbo-s`, `gt3`, `carrera`, `gts`… repeat across chapters — so
 * `ModelsFile.variants` (a flat `Record<variantId, Model3D|null>` per
 * docs/CONTRACTS.md) can only hold one record per id. Policy: the record from
 * the NEWEST generation that has a model wins.
 */
const GEN_ORDER: Record<string, number> = {
  "901": 1,
  gseries: 2,
  "964": 3,
  "993": 4,
  "996": 5,
  "997": 6,
  "991": 7,
  "992-1": 8,
  "992-2": 9,
};

async function main(): Promise<void> {
  console.warn(
    "───────────────────────────────────────────────────────────────\n" +
      "  NOTE: Sketchfab GLB downloads require an OAuth access token.\n" +
      "  This project has no token, so NO Sketchfab model is downloaded.\n" +
      "  Every Sketchfab-backed entry below is an official <iframe> embed.\n" +
      "───────────────────────────────────────────────────────────────",
  );

  const roster = loadRoster();
  const previous: ModelsFile = existsSync(MODELS_JSON)
    ? (JSON.parse(readFileSync(MODELS_JSON, "utf8")) as ModelsFile)
    : { updatedAt: "", generations: {}, variants: {} };
  const out: ModelsFile = { updatedAt: "", generations: {}, variants: {} };
  for (const gen of Object.keys(roster.generations)) out.generations[gen] = null;
  for (const variants of Object.values(roster.generations)) {
    for (const v of variants) out.variants[v.id] = null;
  }

  const glbs: GlbResult[] = [];
  if (DO_GLB) {
    for (const src of DIRECT_SOURCES) {
      process.stderr.write(`glb: ${src.id} … `);
      const res = await buildGlb(src);
      glbs.push(res);
      console.warn(res.dropped ? `dropped — ${res.dropped}` : `${res.bytes} bytes`);
    }
  }

  /** variantId -> newest-generation-wins winner, resolved during the loop */
  const variantPicks = new Map<string, { gen: number; model: Model3D }>();
  const collisions: string[] = [];
  let pinnedCount = 0;

  for (const target of TARGETS) {
    const [genId, variantId] = target.key.split("/");
    const key = target.kind === "generation" ? genId : (variantId ?? genId);
    const record: Model3D | null = null;
    let resolved: Model3D | null = record;

    if (target.pinned.length > 0) {
      const model = await verifyModel(target.pinned[0]);
      if (!model) {
        // --offline, or the API blipped: keep whatever was verified last time.
        const prior = previous.generations[key] ?? previous.variants[key];
        if (prior) {
          resolved = prior;
          console.warn(`  ${target.key.padEnd(28)} kept  (offline — reusing last verified record)`);
        } else {
          console.error(`  !! ${target.key}: uid ${target.pinned[0]} could not be verified and no prior record exists`);
        }
      } else {
        pinnedCount++;
        resolved = embedOnly(model);

        // a committed local GLB outranks the embed (see lib/assets.ts getModel)
        const glb = glbs.find((g) => {
          if (g.dropped || g.bytes > GLB_BYTE_BUDGET) return false;
          const src = DIRECT_SOURCES.find((s) => s.id === g.id);
          if (!src) return false;
          return target.kind === "generation"
            ? src.generations.includes(genId)
            : src.variants.includes(target.key);
        });
        if (glb) {
          resolved = {
            ...resolved,
            glb: glb.glb,
            bytes: glb.bytes,
            license: glb.license,
            author: glb.author,
            sourceId: glb.sourceId,
          };
        }
      }
    }

    if (target.kind === "generation") {
      out.generations[genId] = resolved;
    } else if (resolved) {
      const gen = GEN_ORDER[genId] ?? 0;
      const prev = variantPicks.get(key);
      if (prev) {
        collisions.push(key);
        if (gen >= prev.gen) variantPicks.set(key, { gen, model: resolved });
      } else {
        variantPicks.set(key, { gen, model: resolved });
      }
    }

    if (!OFFLINE && target.queries.length > 0) {
      const alts = await searchCandidates(target);
      if (alts.length > 0) {
        console.warn(
          `  ${target.key.padEnd(28)} ${resolved ? "OK  " : "null"} ` +
            `runners-up: ${alts.map((c) => `${c.uid.slice(0, 8)} (${c.license}, ${c.likeCount ?? 0} likes)`).join(" | ")}`,
        );
        continue;
      }
    }
    if (!resolved) console.warn(`  ${target.key.padEnd(28)} null — ${target.note ?? "no allowed-licence model"}`);
  }

  for (const [id, pick] of variantPicks) out.variants[id] = pick.model;

  out.updatedAt = new Date().toISOString();
  mkdirSync(dirname(MODELS_JSON), { recursive: true });
  writeFileSync(MODELS_JSON, `${JSON.stringify(out, null, 2)}\n`);

  const all = Object.values(out.generations).concat(Object.values(out.variants));
  const withGlb = all.filter((m) => m?.glb).length;
  const withEmbed = all.filter((m) => m?.embedUrl).length;
  console.warn(
    `\nwrote data/models.json — ${pinnedCount} pinned targets verified, ` +
      `${withEmbed} embed records (${withGlb} of them with a local GLB), ` +
      `${Object.keys(out.variants).length} unique variant ids keyed.\n` +
      `REMINDER: Sketchfab GLB downloads are impossible without a token; embeds are the only Sketchfab delivery.`,
  );
  if (collisions.length > 0) {
    console.warn(
      `NOTE: ${collisions.length} variant ids exist in more than one generation ` +
        `(${[...new Set(collisions)].sort().join(", ")}). data/models.json can only key one record per ` +
        `variant id, so the newest generation wins. See public/models/README.md.`,
    );
  }
}

await main();