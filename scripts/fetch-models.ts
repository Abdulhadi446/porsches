/**
 * ASSET-3D pipeline — owner: ASSET-3D.
 *
 * Run:   node scripts/fetch-models.ts          (Node >= 22 strips the types natively)
 *        npx tsx scripts/fetch-models.ts       (tsx is NOT a dependency of this repo)
 *
 * Flags:
 *   --offline       do not touch the network; keep whatever data/models.json holds
 *   --refresh       re-query the Sketchfab search API and print live runners-up
 *   --no-glb        skip the direct-licence GLB download/optimise step
 *   --rebuild-glb   re-download + re-optimise the local GLB even if it is present
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
 * NOTHING in data/models.json is hand-written: uid, licence, author, slug and
 * embed URL all come from `GET /v3/models/<uid>` responses fetched during the
 * run. A target whose licence is outside ALLOWED_LICENSES aborts the run.
 *
 * Idempotent: re-running re-verifies licences and rewrites the same file. The
 * local GLB is only rebuilt when it is missing or `--rebuild-glb` is passed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Model3D } from "#data/schema";

// ---------------------------------------------------------------------------
// paths / constants
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
const REBUILD_GLB = ARGS.has("--rebuild-glb");

/**
 * Chronological generation order (same order as the `GenerationId` union in
 * data/schema.ts). Roster variant ids are only unique *within* a generation —
 * `turbo`, `gt3`, `carrera`, `gts`, `targa`, `s-t`… repeat across chapters.
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

// ---------------------------------------------------------------------------
// shortlist
// ---------------------------------------------------------------------------

/**
 * `pinned[0]` is the model chosen for the target. Every pinned uid is verified
 * with `GET https://api.sketchfab.com/v3/models/<uid>` on each run; the run
 * ABORTS if a uid 404s or reports a licence outside ALLOWED_LICENSES, so
 * data/models.json can never drift into a dead or unusable embed.
 *
 * Selection rules applied (docs/CONTRACTS.md + lead brief):
 *  - the uploader's model name AND description must identify the exact car
 *    (a generic "Porsche 911 (964)" wide-body build does not count as a 964
 *    Carrera 4; a "GT2 RS" does not count as a "GT2"),
 *  - prefer higher vertex counts among equally exact matches,
 *  - if no exact match exists, `pinned` is empty and `note` explains why.
 */
interface Target {
  /** `${genId}` for generation heroes, `${genId}/${variantId}` for variants. */
  key: string;
  kind: "generation" | "variant";
  pinned: string[];
  queries: string[];
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
    note: "served from the committed local GLB (see DIRECT_SOURCES); embed kept only as fallback",
  },
  {
    key: "964",
    kind: "generation",
    pinned: ["22edb81d9ccf46c09a1add7a9ebda2c0"],
    queries: ["porsche 964", "porsche 911 964", "1989 porsche 911 964 carrera 4"],
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
  { key: "901/carrera-rs-2.7", kind: "variant", pinned: [],
    queries: ["porsche 911 carrera rs 2.7", "911 rs 2.7 lightweight", "carrera rs 2.7 1973"],
    note: "no CC0/CC BY / CC BY-SA 2.7 Carrera RS exists: 20 name-matched searches return only 992 '2.7 Carrera Tribute' GT3 RS tributes or non-commercial uploads" },
  { key: "901/st", kind: "variant", pinned: ["1fce7028d0d34ddc801905dadd1d0ce6"],
    queries: ["porsche 911 st", "911 st 1972"] },
  { key: "901/targa", kind: "variant", pinned: ["7e2018a0bccf48d6b26cd2285d544f19"],
    queries: ["porsche 911 targa", "911 targa 1970"],
    note: "only low-poly targa uploads exist under an allowed licence (10k vertices)" },
  // ---- G-series / 930 ----------------------------------------------------
  { key: "gseries/turbo-3.0-930", kind: "variant", pinned: ["8568d9d14a994b9cae59499f0dbed21e"],
    queries: ["porsche 930 turbo 1975"],
    note: "served from the committed local GLB (see DIRECT_SOURCES)" },
  { key: "gseries/turbo-3.3-930", kind: "variant", pinned: ["d792213008744efa9253a9147523ca2d"],
    queries: ["porsche 911 turbo 3.3 1980", "930 turbo 3.3"] },
  { key: "gseries/turbo-flachbau", kind: "variant", pinned: ["16e4693a8f4144e4a071685289869dd6"],
    queries: ["porsche 930 flachbau", "911 turbo slantnose"],
    note: "3k-vertex low-poly slantnose only" },
  { key: "gseries/turbo-s-3.3", kind: "variant", pinned: [], queries: ["porsche 911 turbo s 1989", "930 turbo s"],
    note: "no CC0/CC BY / CC BY-SA model of the 930 Turbo S exists; the only allowed matches are 964 Turbo S uploads" },
  { key: "gseries/turbo-le-1989", kind: "variant", pinned: [], queries: ["porsche 911 turbo le"],
    note: "no allowed-licence model exists (name-matched searches return an Alpine GTA and a Renault 5)" },
  { key: "gseries/sc", kind: "variant", pinned: ["1986766bfeb845f2ad2aa898e4be0cdf"],
    queries: ["porsche 911 sc"], note: "only a rally-liveried 911 SC is available" },
  { key: "gseries/carrera-3.2", kind: "variant", pinned: ["26953936409c4ee7b9de11caa37e52f1"],
    queries: ["porsche 911 3.2 carrera", "porsche 911 g50"] },
  { key: "gseries/carrera-rs-3.0", kind: "variant", pinned: [], queries: ["porsche 911 carrera rs 3.0"],
    note: "no allowed-licence 3.0 Carrera RS exists (name-matched searches return none)" },
  { key: "gseries/carrera-rsr-3.0", kind: "variant", pinned: [], queries: ["porsche 911 carrera rsr 3.0"],
    note: "race-prepped RSR models are all non-commercial licensed" },
  { key: "gseries/carrera-club-sport", kind: "variant", pinned: [], queries: ["porsche 911 club sport g50"],
    note: "no allowed-licence model exists" },
  { key: "gseries/speedster-1989", kind: "variant", pinned: [], queries: ["porsche 911 speedster 1989"],
    note: "no allowed-licence model exists" },
  // ---- 964 ----------------------------------------------------------------
  { key: "964/carrera-4", kind: "variant", pinned: ["22edb81d9ccf46c09a1add7a9ebda2c0"],
    queries: ["1989 porsche 911 964 carrera 4", "porsche 964"] },
  { key: "964/carrera-4s", kind: "variant", pinned: [], queries: ["porsche 964 carrera 4s"],
    note: "the only allowed-licence 'Carrera 4S' upload ((FREE) Porsche 911 Carrera 4S, uid d01b254483794de3819786d93e0e1ebf) names no model year and its description only mentions a 'prototype car configurator', so it cannot be verified as a 964 rather than a 997-era car" },
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
  { key: "993/carrera-4s", kind: "variant", pinned: ["5d90416b06854a369e566d3fa286c692"],
    queries: ["1996 porsche 993 carrera 4s", "porsche 993 4s"],
    note: "4k-vertex low-poly, but it is the only allowed-licence 993 Carrera 4S" },
  { key: "993/turbo", kind: "variant", pinned: ["72f2943569434e4e93ab63f403c6aa1c"],
    queries: ["porsche 993 turbo", "porsche 911 turbo 993"],
    note: "69k-vertex '993 Turbo Low-poly' — the only allowed-licence 993 Turbo; name-matched searches return no other" },
  { key: "993/carrera-rs", kind: "variant", pinned: [], queries: ["porsche 993 carrera rs"],
    note: "no allowed-licence model exists (name-matched searches return none)" },
  { key: "993/turbo-s", kind: "variant", pinned: [], queries: ["porsche 993 turbo s"],
    note: "no allowed-licence model exists" },
  { key: "993/gt2", kind: "variant", pinned: [], queries: ["porsche 993 gt2"],
    note: "only RAUH-Welt / RWB-bodied 993 GT2 conversions are allowed-licensed, which misrepresent the variant" },
  { key: "993/gt2-evo", kind: "variant", pinned: [], queries: ["porsche 993 gt2 evo"],
    note: "no allowed-licence model exists" },
  { key: "993/speedster", kind: "variant", pinned: [], queries: ["porsche 993 speedster"],
    note: "no allowed-licence model exists" },
  { key: "993/club-sport", kind: "variant", pinned: [], queries: ["porsche 911 club sport 993"],
    note: "no allowed-licence model exists" },
  // ---- 996 ----------------------------------------------------------------
  { key: "996/turbo", kind: "variant", pinned: ["0aca89de30b94126bc7020109b2f3ef0"],
    queries: ["porsche 996 turbo", "porsche 911 turbo 996"] },
  { key: "996/gt3", kind: "variant", pinned: [], queries: ["porsche 996 gt3", "porsche 911 gt3 996"],
    note: "NO allowed-licence 996 GT3 exists: name-matched searches return only a 911 GT1 race car and a 'GT300 Yunker Power Taisan' JDM build" },
  { key: "996/gt3-rs", kind: "variant", pinned: [], queries: ["porsche 996 gt3 rs"],
    note: "no allowed-licence model of the 2004 996 GT3 RS exists" },
  { key: "996/gt2", kind: "variant", pinned: [], queries: ["porsche 996 gt2", "porsche 911 gt2 996"],
    note: "the only allowed-licence 996 GT2-badged model is the 'GT2 RS (996)' (uid 2f39754f878b4c82ba0c0b938eeafc15), a different car from the 2000–2005 GT2 this variant documents" },
  { key: "996/turbo-s", kind: "variant", pinned: [], queries: ["porsche 911 turbo s 996"],
    note: "no allowed-licence model exists (only 992 Turbo S uploads)" },
  // ---- 997 ----------------------------------------------------------------
  { key: "997/carrera", kind: "variant", pinned: [], queries: ["porsche 997.2 carrera", "porsche 911 997 coupe"],
    note: "no allowed-licence model exists" },
  { key: "997/gt3", kind: "variant", pinned: [], queries: ["porsche 911 gt3 997", "porsche 997 gt3"],
    note: "no allowed-licence 997 GT3 exists: the only name match is the 997 GT3 RS 4.0, a different car" },
  { key: "997/gt3-rs-4.0", kind: "variant", pinned: ["95226a73526b46e680b091f1caf6191f"],
    queries: ["porsche 911 gt3 rs 4.0 997"] },
  { key: "997/gt2-rs", kind: "variant", pinned: ["41419345868e406eaec8a271e33de3c1"],
    queries: ["porsche 997 gt2 rs", "gt2 rs angle eyes"] },
  { key: "997/gt2", kind: "variant", pinned: ["c48298e703c44f2187d5562ef64f4dcf"],
    queries: ["porsche 911 gt2 997"] },
  { key: "997/turbo", kind: "variant", pinned: [], queries: ["porsche 911 turbo 997"],
    note: "no allowed-licence model exists (only 992 Turbo S uploads)" },
  { key: "997/turbo-s", kind: "variant", pinned: [], queries: ["porsche 997 turbo s"],
    note: "NO allowed-licence 997 Turbo S exists on Sketchfab" },
  { key: "997/gts", kind: "variant", pinned: [], queries: ["porsche 997 gts"],
    note: "no allowed-licence 997 GTS exists" },
  { key: "997/sport-classic", kind: "variant", pinned: [], queries: ["porsche 997 sport classic"],
    note: "the 2009 997 Sport Classic has no allowed-licence model; only the 2023 (992.1) car does" },
  // ---- 991 ----------------------------------------------------------------
  { key: "991/carrera-s", kind: "variant", pinned: ["e8e06ddd8d3f4419a5252d187f6f217e"],
    queries: ["porsche 911 carrera s 991.2", "porsche 991.2 carrera s"] },
  { key: "991/gt2-rs", kind: "variant", pinned: ["98767072b9f94f8eb6c4512b7be891c4"],
    queries: ["porsche 991 gt2 rs"],
    note: "uploader states the asset was sourced from third-party platforms; the API label is CC Attribution as reported by the API" },
  { key: "991/gt3-rs", kind: "variant", pinned: ["2b02e300bb094a2293f4b714e2ae7ddf"],
    queries: ["porsche 911 991.1 gt3 rs", "porsche 991 gt3 rs"] },
  { key: "991/turbo-s", kind: "variant", pinned: ["1924ab5a79b7451e95b9a659f3db715d"],
    queries: ["porsche 991 turbo s", "porsche 911 991.2 turbo s"] },
  { key: "991/r", kind: "variant", pinned: ["a8f40dc2180142c0887d251199d74077"],
    queries: ["porsche 911 r 2017"] },
  { key: "991/carrera-t", kind: "variant", pinned: [], queries: ["porsche 991 carrera t"],
    note: "no allowed-licence model exists (name-matched searches return none)" },
  { key: "991/speedster", kind: "variant", pinned: [], queries: ["porsche 991 speedster"],
    note: "available uploads are CC BY-NC-SA" },
  // ---- 992.1 --------------------------------------------------------------
  { key: "992-1/carrera-4s", kind: "variant", pinned: ["e2be40c215e34812af7dfb933bc7967a"],
    queries: ["2019 porsche 911 carrera 4s 992", "porsche 992.1 carrera 4s"] },
  { key: "992-1/gt3-rs", kind: "variant", pinned: ["bbb0f6181a52416bb776713cfd4987dd"],
    queries: ["porsche 992 gt3 rs", "2023 porsche 911 gt3 rs 992"] },
  { key: "992-1/dakar", kind: "variant", pinned: ["326e90718d164f018e9a673849a3161b"],
    queries: ["porsche 911 dakar", "porsche 911 dakar rallye design package"],
    note: "chosen upload is a remix; the original Ddiaz Design upload reports CC BY-NC-SA on the API" },
  { key: "992-1/sport-classic", kind: "variant", pinned: ["38903fc72658408287a5972285494bd6"],
    queries: ["porsche 911 sport classic 2023"] },
  { key: "992-1/s-t", kind: "variant", pinned: ["f39f7c539a3440428c22a3da2f52af43"],
    queries: ["porsche 911 s t", "2024 porsche 911 st"] },
  { key: "992-1/turbo", kind: "variant", pinned: [], queries: ["porsche 911 turbo 992"],
    note: "no allowed-licence model of the base 992 Turbo exists (only 992 Turbo S and tuner variants)" },
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
  { key: "992-2/turbo-s", kind: "variant", pinned: [], queries: ["porsche 911 turbo s 2026", "992.2 turbo s"],
    note: "the 992.2 Turbo S T-Hybrid (IAA 2025) has no model of any allowed licence; name-matched searches return only 992.1 Turbo S and Techart builds" },
  { key: "992-2/carrera-gts", kind: "variant", pinned: [], queries: ["carrera gts t hybrid", "porsche 911 gts 2025"],
    note: "the only allowed-licence GTS is the 992.2 Targa 4 GTS shell, which is a different body (already attached to 992-2/targa-4-gts)" },
  { key: "992-2/gt3", kind: "variant", pinned: [], queries: ["992.2 gt3", "porsche 911 gt3 2025"],
    note: "the 992.2 GT3 coupe has no allowed-licence model; only 992.2 GT3 RS Manthey Kit uploads exist" },
  { key: "992-2/gt3-s-c", kind: "variant", pinned: [], queries: ["porsche 911 gt3 s/c", "911 gt3 cabriolet 2026"],
    note: "unveiled 2026-04-14 — the only name match is a 992 Carrera S Cabriolet, a different car" },
  { key: "992-2/spirit-70", kind: "variant", pinned: [], queries: ["porsche 911 spirit 70"],
    note: "no 3D model of any licence exists" },
];

const TARGETS = [...GENERATION_TARGETS, ...VARIANT_TARGETS];

// ---------------------------------------------------------------------------
// directly-downloadable, openly-licensed sources (the only path to a local GLB)
// ---------------------------------------------------------------------------

interface DirectSource {
  /** folder name under public/models/ */
  id: string;
  repo: string;
  branch: string;
  /** licence file inside the repo — re-read and asserted on every run */
  licensePath: string;
  /** substrings that MUST appear in the licence text, else the run aborts */
  licenseMustContain: string[];
  /**
   * Recorded licence/author. The repo's own LICENSE covers the scene
   * assembly; the glTF scene is named "Sketchfab_Scene", i.e. the car
   * geometry is third-party. See public/models/README.md — the geometry
   * attribution is recorded as INFERRED, never as a verified fact.
   */
  license: string;
  author: string;
  /** licence/author of the inferred upstream car geometry */
  geometryLicense: string;
  geometryAuthor: string;
  /** Sketchfab uid the geometry is inferred to derive from */
  geometrySourceId: string;
  /** entry asset (gltf + external bin/textures) inside the repo */
  entry: string;
  /** generation ids this GLB is the hero for */
  generations: string[];
  /** variant keys (`gen/variant`) this GLB represents */
  variants: string[];
}

const DIRECT_SOURCES: DirectSource[] = [
  {
    id: "930-turbo-1975",
    repo: "UtkarshPathrabe/Porche-911-930-Turbo-1975-3D-Model",
    branch: "main",
    licensePath: "LICENSE",
    licenseMustContain: ["MIT License", "Permission is hereby granted, free of charge"],
    license: "MIT (repo) + CC Attribution (geometry, inferred)",
    author: "Utkarsh Pathrabe (repo) + Lionsharp Studios (geometry, inferred)",
    geometryLicense: "CC Attribution",
    geometryAuthor: "Lionsharp Studios",
    geometrySourceId: "8568d9d14a994b9cae59499f0dbed21e",
    entry: "scene.gltf",
    generations: ["gseries"],
    variants: ["gseries/turbo-3.0-930"],
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
  likeCount?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
      await sleep(800);
    }
  }
  return null;
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
      await sleep(800);
    }
  }
  return null;
}

/** Embed URLs are derived from the API's own viewerUrl — the slug is never hand-built. */
function embedUrl(model: SfModel): string {
  return `${model.viewerUrl}?embed=1`;
}

const detailCache = new Map<string, SfModel | null>();

/** Fetch + hard-verify one uid. Throws (aborting the run) on 404 or a bad licence. */
async function verifyModel(uid: string): Promise<SfModel | null> {
  if (detailCache.has(uid)) return detailCache.get(uid) ?? null;
  const model = await apiGet<SfModel>(`/models/${uid}`);
  if (!model) {
    throw new Error(
      `uid ${uid} could not be fetched from the Sketchfab API (deleted, private, or a network ` +
        `failure on all 3 attempts). Refusing to write data/models.json — re-pin or drop the target.`,
    );
  }
  const label = model.license?.label ?? "";
  if (!ALLOWED_LICENSES.has(label)) {
    throw new Error(
      `licence check failed for ${uid} ("${model.name}"): the API reports ` +
        `"${label}", which is outside the allow-list [${[...ALLOWED_LICENSES].join(", ")}]. ` +
        `Refusing to write data/models.json.`,
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
  vertexCount: number | null;
  likeCount: number | null;
}

/** Re-run the shortlist's queries and return the best live runners-up. */
async function searchCandidates(target: Target): Promise<Candidate[]> {
  if (OFFLINE || target.queries.length === 0) return [];
  const byUid = new Map<string, Candidate>();
  for (const q of target.queries) {
    const data = await apiGet<{ results?: SfSearchResult[] }>(
      `/search?type=models&q=${encodeURIComponent(q)}&downloadable=true&count=24&sort_by=-relevance`,
    );
    for (const r of data?.results ?? []) {
      const label = r.license?.label ?? "";
      if (!ALLOWED_LICENSES.has(label)) continue;
      if (byUid.has(r.uid)) continue;
      byUid.set(r.uid, {
        uid: r.uid,
        name: r.name,
        license: label,
        author: r.user?.displayName ?? r.user?.username ?? null,
        vertexCount: r.vertexCount,
        likeCount: r.likeCount ?? null,
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

/** Re-read the repo's licence text and assert it still says what we recorded. */
async function assertLicense(src: DirectSource): Promise<string> {
  const text = await fetchText(rawUrl(src, src.licensePath));
  if (typeof text !== "string" || text.length < 40) {
    throw new Error(
      `${src.repo}/${src.licensePath} could not be read — aborting (no licence = all rights reserved).`,
    );
  }
  for (const needle of src.licenseMustContain) {
    if (!text.includes(needle)) {
      throw new Error(
        `${src.repo}/${src.licensePath} does not contain "${needle}". The declared licence ` +
          `(${src.license}) no longer matches the repository — aborting.`,
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
      [...(entry.images ?? []), ...(entry.buffers ?? [])]
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
  dropped: string | null;
}

/**
 * Build (or re-use) the optimised local GLB for one direct source. Idempotent:
 * an existing in-budget GLB is kept unless `--rebuild-glb` is passed, so a
 * normal re-run does not re-download ~74 MB of upstream assets.
 */
async function buildGlb(src: DirectSource): Promise<GlbResult> {
  const outDir = join(PUBLIC_MODELS, src.id);
  const outGlb = join(outDir, "model.glb");
  const base = {
    id: src.id,
    license: src.license,
    author: src.author,
    sourceId: src.repo,
  };

  await assertLicense(src);

  if (existsSync(outGlb) && !REBUILD_GLB) {
    const bytes = statSync(outGlb).size;
    if (bytes > 0 && bytes <= GLB_BYTE_BUDGET) {
      return { ...base, glb: `/models/${src.id}/model.glb`, bytes, dropped: null };
    }
    rmSync(outDir, { recursive: true, force: true });
  }

  mkdirSync(outDir, { recursive: true });
  const workDir = join(tmpdir(), `asset3d-${src.id}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const entryPath = await downloadSource(src, workDir);
    optimise(entryPath, outGlb, null);
    let bytes = statSync(outGlb).size;
    if (bytes > GLB_BYTE_BUDGET) {
      optimise(entryPath, outGlb, 1024);
      bytes = statSync(outGlb).size;
    }
    if (bytes > GLB_BYTE_BUDGET) {
      rmSync(outDir, { recursive: true, force: true });
      return {
        ...base,
        glb: "",
        bytes: 0,
        dropped: `optimised GLB is ${bytes} bytes, over the ${GLB_BYTE_BUDGET} byte budget — dropped, falling back to embed`,
      };
    }
    return { ...base, glb: `/models/${src.id}/model.glb`, bytes, dropped: null };
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    return {
      ...base,
      glb: "",
      bytes: 0,
      dropped: `optimise failed (${(err as Error).message.split("\n")[0]}) — dropped, falling back to embed`,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// roster / output shape
// ---------------------------------------------------------------------------

interface Roster {
  generations: Record<string, { id: string; name: string }[]>;
}

interface ModelsFile {
  updatedAt: string;
  verifiedAt?: string;
  generations: Record<string, Model3D | null>;
  variants: Record<string, Model3D | null>;
}

function loadRoster(): Roster {
  return JSON.parse(readFileSync(join(ROOT, "data", "roster.json"), "utf8")) as Roster;
}

/** One embed-only record, every field taken from the API response. */
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

async function main(): Promise<void> {
  console.warn(
    "────────────────────────────────────────────────────────────────\n" +
      "  WARNING: Sketchfab GLB downloads require an OAuth access token.\n" +
      "  `GET /v3/models/<uid>/download` returns 401 without one and this\n" +
      "  project has no token, so NO Sketchfab model is ever downloaded.\n" +
      "  Every Sketchfab-backed entry below is an official <iframe> embed.\n" +
      "  Local .glb files can only come from the licensed direct sources.\n" +
      "────────────────────────────────────────────────────────────────",
  );

  const roster = loadRoster();
  const previous: ModelsFile = existsSync(MODELS_JSON)
    ? (JSON.parse(readFileSync(MODELS_JSON, "utf8")) as ModelsFile)
    : { updatedAt: "", generations: {}, variants: {} };

  const glbs: GlbResult[] = [];
  if (DO_GLB) {
    for (const src of DIRECT_SOURCES) {
      process.stderr.write(`glb: ${src.id} … `);
      const res = await buildGlb(src);
      glbs.push(res);
      console.warn(res.dropped ? `dropped — ${res.dropped}` : `${res.bytes} bytes`);
    }
  }

  /** generation-level heroes */
  const out: ModelsFile = { updatedAt: "", generations: {}, variants: {} };
  for (const gen of Object.keys(roster.generations)) out.generations[gen] = null;

  /** `gen/variant` scoped records — unambiguous, one per roster entry */
  const scoped = new Map<string, Model3D | null>();
  for (const [genId, variants] of Object.entries(roster.generations)) {
    for (const v of variants) scoped.set(`${genId}/${v.id}`, null);
  }

  let verified = 0;
  const missing: { key: string; note: string }[] = [];

  for (const target of TARGETS) {
    const [genId, variantId] = target.key.split("/");
    const scopedKey = target.kind === "variant" ? target.key : null;
    const flatKey = target.kind === "variant" ? (variantId ?? genId) : null;
    let resolved: Model3D | null = null;

    if (OFFLINE) {
      // No network: keep exactly what the previous run verified.
      const prior = scopedKey
        ? (previous.variants[scopedKey] ?? previous.variants[flatKey ?? ""])
        : previous.generations[genId];
      resolved = prior ?? null;
      if (resolved) console.warn(`  ${target.key.padEnd(26)} kept   offline — reusing last verified record`);
    } else if (target.pinned.length > 0) {
      // Throws on 404 or an out-of-allow-list licence: better no file than a
      // wrong licence claim.
      const model = await verifyModel(target.pinned[0]);
      if (model) {
        verified++;
        resolved = embedOnly(model);

        // A committed local GLB outranks the embed (see lib/assets.ts getModel).
        // The embed URL is then CLEARED: keeping it would pair a MIT-labelled
        // record with a Sketchfab iframe of somebody else's model, which is a
        // false attribution in /credits.
        const glb = glbs.find((g) => {
          if (g.dropped || !g.glb || g.bytes > GLB_BYTE_BUDGET) return false;
          const src = DIRECT_SOURCES.find((s) => s.id === g.id);
          if (!src) return false;
          return target.kind === "generation"
            ? src.generations.includes(genId)
            : src.variants.includes(target.key);
        });
        if (glb) {
          resolved = {
            glb: glb.glb,
            embedUrl: null,
            sourceId: glb.sourceId,
            license: glb.license,
            author: glb.author,
            turntable: null,
            bytes: glb.bytes,
          };
        }
        console.warn(
          `  ${target.key.padEnd(26)} ok     ${model.name} — ${model.license?.label} — ` +
            `${model.user?.displayName ?? model.user?.username} (${model.vertexCount ?? "?"} verts)` +
            (glb ? ` + local GLB ${glb.bytes} B` : ""),
        );
      }
    }

    if (target.kind === "generation") out.generations[genId] = resolved;
    else if (scopedKey) scoped.set(scopedKey, resolved);

    if (!resolved) {
      missing.push({ key: target.key, note: target.note ?? "no allowed-licence model exists" });
      console.warn(`  ${target.key.padEnd(26)} null   ${target.note ?? "no allowed-licence model"}`);
    }

    if (!OFFLINE && REFRESH && target.queries.length > 0) {
      const alts = await searchCandidates(target);
      if (alts.length > 0) {
        console.warn(
          `         live runners-up: ` +
            alts
              .map((c) => `${c.uid.slice(0, 8)} "${c.name}" (${c.license}, ${c.likeCount ?? 0} likes)`)
              .join(" | "),
        );
      }
    }
  }

  // ---- write both key styles into `variants` -------------------------------
  // Contract shape is `{ "<variantId>": Model3D|null }`, but 20 of the 78 unique
  // roster variant ids repeat across generations, so a bare id cannot express
  // e.g. `993/turbo` AND `996/turbo`. Every roster entry is therefore written
  // twice: once under its unambiguous `gen/variant` key and once under the bare
  // id (newest generation wins). Consumers may read either form.
  for (const [key, model] of scoped) out.variants[key] = model;

  // id -> newest generation that actually HAS a model (null only if none does)
  const aliases = new Map<string, { gen: number; model: Model3D | null }>();
  for (const [key, model] of scoped) {
    const [genId, variantId] = key.split("/");
    const gen = GEN_ORDER[genId] ?? 0;
    const current = aliases.get(variantId);
    if (!current) aliases.set(variantId, { gen, model });
    else if (model && (current.model === null || gen >= current.gen)) {
      aliases.set(variantId, { gen, model });
    }
  }
  for (const [variantId, pick] of aliases) out.variants[variantId] = pick.model;

  out.updatedAt = new Date().toISOString();
  out.verifiedAt = out.updatedAt;
  mkdirSync(dirname(MODELS_JSON), { recursive: true });
  writeFileSync(MODELS_JSON, `${JSON.stringify(out, null, 2)}\n`);

  const all = [...Object.values(out.generations), ...scoped.values()];
  const withGlb = all.filter((m) => m?.glb).length;
  const withEmbed = all.filter((m) => m?.embedUrl).length;
  console.warn(
    `\ndata/models.json written — ${verified} uids re-verified against the Sketchfab API,\n` +
      `  generations: ${Object.values(out.generations).filter(Boolean).length}/${Object.keys(out.generations).length} with a model\n` +
      `  variants:    ${[...scoped.values()].filter(Boolean).length}/${scoped.size} roster entries with a model ` +
      `(${withEmbed} embeds, ${withGlb} local GLB) — plus ${Object.keys(out.variants).length - scoped.size} bare-id aliases\n` +
      `  MISSING (${missing.length}) — for docs/STATUS.md:\n` +
      missing.map((m) => `    - ${m.key}: ${m.note}`).join("\n") +
      `\nREMINDER: Sketchfab GLB downloads are impossible without a token; embeds are the only Sketchfab delivery.`,
  );
}

await main();