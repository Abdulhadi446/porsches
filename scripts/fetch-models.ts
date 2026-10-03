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
 *   --no-sweep      skip the source audit (do not re-probe poly.pizza/kenney/…)
 *   --rebuild-glb   re-download + re-optimise the local GLBs even if present
 *
 * WHAT THIS SCRIPT CANNOT DO
 * --------------------------
 * Sketchfab's model-download endpoint (`GET /v3/models/<uid>/download`) returns
 * **401 Unauthorized** without an OAuth access token. No Sketchfab token is
 * available to this project and none is requested, so every Sketchfab-backed
 * entry in data/models.json is an **official `<iframe>` embed URL**, never a
 * re-hosted GLB *from sketchfab.com itself*.
 *
 * Local .glb files come from exactly two kinds of source, both of which are
 * re-verified on every run:
 *  - DIRECT_SOURCES — GitHub repositories that are downloadable without
 *    authentication AND carry an open licence file whose text this script
 *    re-reads and asserts;
 *  - MIRROR_SOURCES — hosts that re-serve Sketchfab's own GLB export over plain
 *    anonymous HTTPS. Sketchfab bakes its attribution into
 *    `asset.extras.{source,license,author}` on export, so this script reads
 *    that block, asserts the source uid and licence string, and then re-reads
 *    the *same* uid from `GET /v3/models/<uid>` (which is public, no token) to
 *    confirm the licence independently of the mirror. A mirror that disagreed
 *    with the API would abort the run — see public/models/README.md, where one
 *    such disagreement is documented (get3dmodels.com labels a CC BY-NC model
 *    as "Creative Commons Attribution").
 *
 * NOTHING in data/models.json is hand-written: uid, licence, author, slug and
 * embed URL all come from `GET /v3/models/<uid>` responses fetched during the
 * run, or from the mirror's own `asset.extras` + the matching API record. A
 * target whose licence is outside ALLOWED_LICENSES aborts the run.
 *
 * Idempotent: re-running re-verifies licences, re-attempts the source sweep
 * (SOURCE_AUDIT probes poly.pizza, kenney.nl, get3dmodels.com, blendkit,
 * free3d, cgtrader, turbosquid, 3dsky, opengameart, quaternius and the GitHub
 * repo search) and rewrites the same file. The local GLBs are only rebuilt when
 * they are missing or `--rebuild-glb` is passed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Credit, Model3D } from "#data/schema";

// ---------------------------------------------------------------------------
// paths / constants
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_JSON = join(ROOT, "data", "models.json");
const MODEL_CREDITS_JSON = join(ROOT, "data", "model-credits.json");
const PUBLIC_MODELS = join(ROOT, "public", "models");
const API = "https://api.sketchfab.com/v3";

/** Hard perf budget from docs/CONTRACTS.md. */
const GLB_BYTE_BUDGET = 3_000_000;

/** glTF-Transform CLI pinned so `optimize --texture-compress webp` is available. */
const GLTF_TRANSFORM = ["npx", "--yes", "@gltf-transform/cli@4.5.1"];

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
const DO_SWEEP = !ARGS.has("--no-sweep");
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
    note: "the only allowed-licence 'Carrera 4S' upload ((FREE) Porsche 911 Carrera 4S, uid d01b254483794de3819786d93e0e1ebf) is now committed as a LOCAL GLB under 991/carrera-4s: its roofline, rear light bar and 1.98 x 1.26 x 4.38 m bounding box identify it as a 991, which rules it out as a 964 as well" },
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
  { key: "991/carrera-4s", kind: "variant", pinned: ["d01b254483794de3819786d93e0e1ebf"],
    queries: ["porsche 911 carrera 4s", "porsche 991 carrera 4s"],
    note: "served from the committed local GLB (see MIRROR_SOURCES). The uploader's own text names no model year, so the 991 identification rests on the source imagery (991 roofline / 991 rear light bar, no 992 full-width bar) and on the measured 1.98 × 1.26 × 4.38 m bounding box; 991.1 vs 991.2 facelift is NOT distinguishable. Deliberately NOT used for 964/carrera-4 — see README." },
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
   * Recorded licence/author.
   *
   * The repo's own LICENSE (MIT) covers the repo; the glTF scene is named
   * "Sketchfab_Scene", i.e. the car geometry is third-party. The geometry's own
   * licence is no longer *inferred*: it is VERIFIED on every run from two
   * independent places that do not depend on this repo —
   *   1. the `asset.extras` block Sketchfab bakes into its own GLB export,
   *      re-read from the get3dmodels.com mirror (MIRROR_LICENCE_EVIDENCE),
   *   2. `GET /v3/models/<geometrySourceId>` (public, no token).
   * See public/models/README.md for the full evidence chain.
   */
  license: string;
  author: string;
  /** licence/author of the upstream car geometry */
  geometryLicense: string;
  geometryAuthor: string;
  /** Sketchfab uid the geometry derives from (verified, not inferred) */
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
    license: "CC Attribution 4.0 (car geometry) + MIT (repo scene assembly)",
    author: "Lionsharp Studios (car geometry) + Utkarsh Pathrabe (repo)",
    geometryLicense: "CC Attribution",
    geometryAuthor: "Lionsharp Studios",
    geometrySourceId: "8568d9d14a994b9cae59499f0dbed21e",
    entry: "scene.gltf",
    generations: ["gseries"],
    variants: ["gseries/turbo-3.0-930"],
  },
];

/**
 * Where the *geometry* licence of a DIRECT_SOURCE is re-verified from, on every
 * run. This is the `asset.extras` block that Sketchfab's exporter writes into
 * its own GLB — author, licence and canonical source uid. A mirror is only
 * trustworthy because the same block is cross-checked against
 * `GET /v3/models/<uid>`, which needs no token.
 */
const MIRROR_LICENCE_EVIDENCE: Record<
  string,
  { page: string; glb: string; uid: string; license: string }
> = {
  "8568d9d14a994b9cae59499f0dbed21e": {
    page: "https://www.get3dmodels.com/vehicles/1975-porsche-911-930-turbo/",
    glb: "https://www.get3dmodels.com/download/free_1975_porsche_911_930_turbo.glb",
    uid: "8568d9d14a994b9cae59499f0dbed21e",
    license: "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)",
  },
  "d01b254483794de3819786d93e0e1ebf": {
    page: "https://www.get3dmodels.com/vehicles/porsche-911-carrera-4s/",
    glb: "https://www.get3dmodels.com/download/free_porsche_911_carrera_4s.glb",
    uid: "d01b254483794de3819786d93e0e1ebf",
    license: "CC-BY-SA-4.0 (http://creativecommons.org/licenses/by-sa/4.0/)",
  },
};

// ---------------------------------------------------------------------------
// anonymous GLB mirrors of Sketchfab exports
// ---------------------------------------------------------------------------

/**
 * Hosts that re-serve Sketchfab's GLB export over plain anonymous HTTPS. Unlike
 * DIRECT_SOURCES these have no licence *file*; instead the licence travels
 * inside the asset itself, in the `asset.extras` block Sketchfab writes on
 * export:
 *
 *   "extras": { "author": "…", "license": "CC-BY-SA-4.0 (…)",
 *               "source": "https://sketchfab.com/3d-models/…-<uid>", "title": "…" }
 *
 * That block is re-read from the mirror on every run, asserted against
 * `sourceUid`/`licenseMustEqual`, and the *same* uid is then re-fetched from
 * `GET /v3/models/<uid>` (public, no token) so the licence is confirmed from
 * Sketchfab itself and not from the mirror's word. Disagreement aborts.
 */
interface MirrorSource {
  /** folder name under public/models/ */
  id: string;
  /** human-facing page on the mirror — the canonical credit URL */
  page: string;
  /** the anonymous direct download */
  file: string;
  /** Sketchfab uid that MUST appear in asset.extras.source */
  sourceUid: string;
  /** exact asset.extras.license string that MUST be present */
  licenseMustEqual: string;
  /** exact Sketchfab `license.label` the API must report for sourceUid */
  apiLicenseLabel: string;
  /** recorded licence/author written into data/models.json */
  license: string;
  author: string;
  /**
   * Mesh-name patterns detached from the node graph before optimising.
   * Sketchfab showroom exports ship a ground plane and, in this asset, a
   * 57k-triangle plane with corrupt vertices ±285 m that would wreck any
   * automatic framing. `optimize`'s `prune` pass then deletes them for good.
   */
  stripMeshPatterns: string[];
  /** generation ids this GLB is the hero for */
  generations: string[];
  /** variant keys (`gen/variant`) this GLB represents */
  variants: string[];
  /** one-line note recorded in public/models/README.md */
  note: string;
}

const MIRROR_SOURCES: MirrorSource[] = [
  {
    id: "991-carrera-4s",
    page: "https://www.get3dmodels.com/vehicles/porsche-911-carrera-4s/",
    file: "https://www.get3dmodels.com/download/free_porsche_911_carrera_4s.glb",
    sourceUid: "d01b254483794de3819786d93e0e1ebf",
    licenseMustEqual: "CC-BY-SA-4.0 (http://creativecommons.org/licenses/by-sa/4.0/)",
    apiLicenseLabel: "CC Attribution-ShareAlike",
    license: "CC Attribution-ShareAlike 4.0 (adapted)",
    author: "Lionsharp Studios (Sketchfab uploader; CC attribution block in the asset names Karol Miklas)",
    stripMeshPatterns: ["^Plane", "^Cube"],
    generations: [],
    variants: ["991/carrera-4s"],
    note: "991.1 vs 991.2 facelift not distinguishable from the source imagery",
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

/** Status-code probe that never throws (used by the source sweep). */
async function status(url: string, init?: RequestInit): Promise<number> {
  try {
    const res = await fetch(url, { redirect: "follow", ...init });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// source sweep — what was probed, whether an anonymous download exists, verdict
// ---------------------------------------------------------------------------

export interface SourceAuditEntry {
  source: string;
  anonymousDownload: "yes" | "no";
  note: string;
  /** ISO date the probe ran */
  probedAt: string;
  /** HTTP status of the probe, when there was one */
  status?: number | null;
}

interface Probe {
  source: string;
  url: string;
  /** stated up-front, from the probe that established it — never guessed */
  anonymousDownload: "yes" | "no";
  /** what the probe proves; baked into `note` verbatim */
  note: string;
  /** extra async check appended to the note (e.g. counting search hits) */
  enrich?: (body: string) => Promise<string> | string;
}

const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) asset3d-sweep" };

/**
 * One cheap request per source. The point is not to re-download assets but to
 * keep the "can we get this anonymously, and what is actually there" answer
 * honest over time — a site can start requiring a login between runs.
 */
const SWEEP: Probe[] = [
  {
    source: "poly.pizza",
    url: "https://poly.pizza/search/porsche",
    anonymousDownload: "yes",
    note: "anonymous GLB download works: the model page embeds https://static.poly.pizza/<uuid>.glb and serves it with no auth (CC0/CC-BY shown on the page). Searched 911 / porsche / porsche 911 / 930 turbo / 964 / 991 / 992 / 993 / 996 / 997 / GT3 / turbo / sports car / coupe. ZERO model titles or descriptions contain 'porsche' or '911' — the search is title-based with fuzzy filler (a nonsense query still returns hits). Every hit is a generic car (Quaternius 'Sports Car', DeLorean, RX-7, Ferrari F40, Camaro, Bricklin SV1, 'Retro car' whose own description says 'Suzuki Vitara 1997'), so nothing is recognisably a 911. No CC0 bundle pages exist; individual models only.",
  },
  {
    source: "kenney.nl (Car Kit)",
    url: "https://kenney.nl/assets/car-kit",
    anonymousDownload: "yes",
    note: "anonymous direct zip download works (HTTP 200, 4.81 MB) and License.txt says 'License: (Creative Commons Zero, CC0)'. The 45 models are ambulance/box/cone/debris-*/delivery/firetruck/garbage-truck/hatchback-sports/kart-oo*/police/race*/sedan*/suv*/taxi/tractor/truck/van/wheel-* — no 911, and none is recognisably a Porsche of any generation.",
  },
  {
    source: "get3dmodels.com (Sketchfab GLB mirror)",
    url: "https://www.get3dmodels.com/vehicles/porsche-911-carrera-4s/",
    anonymousDownload: "yes",
    note: "anonymous direct .glb download works (HTTP 200, no auth, no token). The whole catalogue — 2967 model URLs enumerated from sitemap_index.xml — contains exactly 10 Porsche entries, 7 of them 911s. Licence is read from the asset.extras block Sketchfab itself bakes into every export and cross-checked against api.sketchfab.com. ACCEPTED: 1975 930 Turbo (CC BY 4.0) and (FREE) Carrera 4S (CC BY-SA 4.0). REJECTED as non-commercial: Porsche 911 GT3 (2022, 992.2) CC BY-NC 4.0, 1998 GT1, 2010 GT3 Cup, 2014 RSR, 2012 GT3 RS 4.0 — all CC BY-NC-SA 4.0. NOTE: this site's own card mislabels the CC BY-NC GT3 as 'Creative Commons Attribution'; never trust its metadata, only the asset's own extras.",
  },
  {
    source: "sketchfab.com download API",
    url: "https://api.sketchfab.com/v3/models/8568d9d14a994b9cae59499f0dbed21e/download",
    anonymousDownload: "no",
    note: "GET /v3/models/<uid>/download returns 401 without an OAuth token. No Sketchfab token is available and none is requested, so every Sketchfab-backed entry stays an official ?embed=1 iframe. The public metadata API (GET /v3/models/<uid>, /v3/search) needs no token and is what every licence check uses.",
  },
  {
    source: "github.com repo search",
    url: "https://api.github.com/search/repositories?q=porsche+911+gltf+model&per_page=1",
    anonymousDownload: "yes",
    note: "anonymous repository search + raw.githubusercontent downloads both work. ~20 queries run (porsche 911 glb/gltf/obj, 911 three.js, porsche 964/993/996/930, sketchfab porsche). Every repo holding actual geometry is unlicensed (all-rights-reserved => rejected) or credits a different car: wSaiven/Porsche-911 is an Apache-2.0 licence file and NOTHING else; C3ddy/first-threejs-project is MIT but its README credits 'Outlaw GamesTM … 2018 Porsche 718 Cayman GTS' (not a 911, and NC); UtkarshPathrabe is the 930 source already in use. Code search needs auth, so a uid cannot be searched for directly.",
  },
  {
    source: "blendkit.com (ex-BlenderKit)",
    url: "https://www.blendkit.com/api/v1/search/?query=porsche%20911",
    anonymousDownload: "no",
    note: "search API is anonymous and returns 146 Porsche 911 assets ('royalty_free'), but /api/v1/downloads/<uuid>/ answers HTTP 401 'Unauthorized access. Please log in.' Licence is BlenderKit's own royalty-free, not a Creative Commons licence, so it is out of scope twice over.",
  },
  {
    source: "free3d.com",
    url: "https://free3d.com/search/models?query=porsche+911",
    anonymousDownload: "no",
    note: "HTTP 403 (Cloudflare) to anonymous requests; downloads sit behind an account. No probe possible.",
  },
  {
    source: "cgtrader.com free tier",
    url: "https://www.cgtrader.com/free-3d-models/vehicle/cars/porsche-911",
    anonymousDownload: "no",
    note: "HTTP 202 with a zero-byte body (bot mitigation); free downloads require a CGTrader account. No probe possible.",
  },
  {
    source: "turbosquid.com free",
    url: "https://www.turbosquid.com/Search/3DModels/free/porsche-911",
    anonymousDownload: "no",
    note: "HTTP 403 to anonymous requests; free downloads require a Turbosquid account. No probe possible.",
  },
  {
    source: "3dsky.org",
    url: "https://3dsky.org/search?keyword=porsche+911",
    anonymousDownload: "no",
    note: "HTTP 200 but the result list is rendered client-side and the nav shows 'Sign in' for downloads; no model URL is reachable without an account.",
  },
  {
    source: "opengameart.org",
    url: "https://opengameart.org/art-search-advanced?keys=porsche",
    anonymousDownload: "yes",
    note: "anonymous download works, but the ONLY porsche submission is 'Car - Porsche 911 Carrera 1998' by TituroFox (CC0, 441.9 KB zip) and it is filed as 2D Art — a top-down sprite, not a 3D model. Its 3D-art car packs are Kenney's toon kits, not 911s.",
  },
  {
    source: "quaternius.com",
    url: "https://quaternius.com/packs/cars.html",
    anonymousDownload: "no",
    note: "Cars Pack is CC0 and states 'Models 8', but the download is gated behind Patreon credits and the pack ships FBX/OBJ/Blend only (no glTF). No anonymous download, and no Porsche in it.",
  },
  {
    source: "blendswap.com",
    url: "https://www.blendswap.com/search/porsche",
    anonymousDownload: "no",
    note: "HTTP 404 — /search/* no longer exists and the 3D-model browse page needs a live session. Nothing probeable.",
  },
];

/**
 * Re-attempt the sweep. Each probe is one request; `enrich` hooks do the
 * counting. Offline runs reuse the previous file's audit untouched.
 */
async function runSweep(): Promise<SourceAuditEntry[]> {
  const probedAt = new Date().toISOString();
  const out: SourceAuditEntry[] = [];
  for (const probe of SWEEP) {
    const code = await status(probe.url, { headers: { ...UA, range: "bytes=0-65535" } });
    let note = probe.note;
    try {
      if (probe.enrich) {
        const body = await fetchText(probe.url);
        if (body) note += ` ${await probe.enrich(body)}`;
      }
    } catch {
      /* enrichment is best-effort */
    }
    out.push({
      source: probe.source,
      anonymousDownload: probe.anonymousDownload,
      note,
      probedAt,
      status: code,
    });
    console.warn(
      `  sweep ${probe.source.padEnd(44)} HTTP ${String(code).padStart(3)} anonymousDownload=${probe.anonymousDownload}`,
    );
  }
  return out;
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
    ...GLTF_TRANSFORM,
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

/** Move the scene pivot to the ground under the model (y=0), centred in x/z. */
function centerBelow(inGlb: string, outGlb: string): void {
  execFileSync("npx", [...GLTF_TRANSFORM, "center", inGlb, outGlb, "--pivot", "below"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60 * 1000,
  });
}

/** Minimal read-only GLB header parse: the JSON chunk of a binary glTF. */
function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  if (buf.toString("latin1", 0, 4) !== "glTF") throw new Error(`${path} is not a GLB`);
  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) return JSON.parse(buf.toString("utf8", off + 8, off + 8 + len)) as GlbJson;
    off += 8 + len;
  }
  throw new Error(`${path} has no JSON chunk`);
}

/**
 * Detach every node whose MESH name matches one of `patterns` from the node
 * graph and rewrite the GLB (chunks re-padded, BIN copied verbatim, no vertex
 * touched). `optimize`'s `prune` pass then deletes the now-unreferenced
 * meshes/accessors for good. Pure Node — no glTF dependency is available to
 * this repo (@gltf-transform/cli is npx-only, see package.json).
 */
function stripMeshes(inGlb: string, outGlb: string, patterns: string[]): string[] {
  const rx = patterns.map((p) => new RegExp(p, "i"));
  const buf = readFileSync(inGlb);
  if (buf.toString("latin1", 0, 4) !== "glTF") throw new Error(`${inGlb} is not a GLB`);

  let off = 12;
  let json: GlbJson | null = null;
  let bin: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8")) as GlbJson;
    else if (type === 0x004e4942) bin = Buffer.from(body);
    off += 8 + len;
  }
  if (!json) throw new Error(`${inGlb} has no JSON chunk`);

  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const drop = new Set<number>();
  const names: string[] = [];
  nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    const name = meshes[node.mesh]?.name ?? "";
    if (rx.some((r) => r.test(name))) {
      drop.add(i);
      names.push(name);
    }
  });
  const keep = (list?: number[]) => (list ?? []).filter((i) => !drop.has(i));
  for (const scene of json.scenes ?? []) scene.nodes = keep(scene.nodes);
  for (const node of nodes) if (node.children) node.children = keep(node.children);

  const jb = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20);
  const bpad = bin ? Buffer.alloc((4 - (bin.length % 4)) % 4) : Buffer.alloc(0);
  const total = 12 + 8 + jb.length + jpad.length + (bin ? 8 + bin.length + bpad.length : 0);
  const out = Buffer.alloc(total);
  out.write("glTF", 0, "latin1");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jb.length + jpad.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jb.copy(out, 20);
  jpad.copy(out, 20 + jb.length);
  if (bin) {
    const p = 20 + jb.length + jpad.length;
    out.writeUInt32LE(bin.length + bpad.length, p);
    out.writeUInt32LE(0x004e4942, p + 4);
    bin.copy(out, p + 8);
    bpad.copy(out, p + 8 + bin.length);
  }
  writeFileSync(outGlb, out);
  return [...new Set(names)];
}

interface GlbJson {
  asset?: { extras?: Record<string, string>; generator?: string; version?: string };
  scenes?: { name?: string; nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  meshes?: { name?: string }[];
  [k: string]: unknown;
}

/**
 * Read `asset.extras` from the head of a remote GLB with two HTTP range
 * requests: 24 bytes for the chunk header (JSON chunk length lives at offset
 * 12, its body starts at offset 20), then exactly the JSON chunk. Avoids
 * pulling 20-44 MB just to check a licence string.
 */
async function remoteGlbExtras(url: string): Promise<Record<string, string>> {
  const head = await fetch(url, { headers: { range: "bytes=0-23" } });
  if (!head.ok && head.status !== 206) throw new Error(`HEAD-range ${url}: HTTP ${head.status}`);
  const probe = Buffer.from(await head.arrayBuffer());
  if (probe.toString("latin1", 0, 4) !== "glTF") throw new Error(`${url} is not a GLB`);
  const jsonLen = probe.readUInt32LE(12);
  if (jsonLen > 8 * 1024 * 1024) throw new Error(`${url} JSON chunk implausibly large (${jsonLen})`);
  const body = await fetch(url, { headers: { range: `bytes=20-${19 + jsonLen}` } });
  if (!body.ok && body.status !== 206) throw new Error(`range ${url}: HTTP ${body.status}`);
  const parsed = JSON.parse(Buffer.from(await body.arrayBuffer()).toString("utf8")) as GlbJson;
  const extras = parsed.asset?.extras ?? {};
  return Object.fromEntries(Object.entries(extras).map(([k, v]) => [k, String(v)]));
}

interface GlbResult {
  id: string;
  glb: string;
  bytes: number;
  license: string;
  author: string;
  sourceId: string;
  /** canonical page URL for /credits (never the raw CDN url) */
  page: string;
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
    page: `https://github.com/${src.repo}`,
  };

  await assertLicense(src);
  await assertGeometryLicense(src.geometrySourceId, src.geometryLicense, src.geometryAuthor);

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

/**
 * Re-verify a third-party car geometry's licence from TWO places that are
 * independent of the repository it arrived in:
 *
 *   1. the `asset.extras` block Sketchfab's own GLB exporter bakes in
 *      (`author` / `license` / `source`), read with two HTTP range requests from
 *      the anonymous mirror listed in MIRROR_LICENCE_EVIDENCE;
 *   2. `GET /v3/models/<uid>` — the public Sketchfab API, which needs no token
 *      for *metadata* (only for `…/download`) — whose `license.label` must be
 *      inside ALLOWED_LICENSES.
 *
 * Throws (aborting the run) on any disagreement. This is what upgrades the
 * committed 930 GLB's geometry attribution from "inferred" to verified.
 */
async function assertGeometryLicense(uid: string, license: string, author: string): Promise<void> {
  const evidence = MIRROR_LICENCE_EVIDENCE[uid];
  if (!evidence) throw new Error(`no mirror licence evidence registered for geometry uid ${uid}`);
  const extras = await remoteGlbExtras(evidence.glb);
  if (!extras.source?.includes(uid)) {
    throw new Error(`${evidence.glb} reports asset.extras.source="${extras.source}", expected uid ${uid}`);
  }
  if (extras.license !== evidence.license) {
    throw new Error(
      `${evidence.glb} reports asset.extras.license="${extras.license}", expected "${evidence.license}"`,
    );
  }
  const api = await verifyModel(uid);
  const label = api?.license?.label ?? "(missing)";
  if (!api || !ALLOWED_LICENSES.has(label)) {
    throw new Error(`Sketchfab uid ${uid} reports licence "${label}" — outside the allow-list`);
  }
  if (author && !extras.author?.includes(author.split(" ")[0] ?? "")) {
    console.warn(
      `  note: geometry author in the asset block is "${extras.author}", recorded as "${author}"`,
    );
  }
  console.warn(
    `  geometry licence ok: ${uid} — asset block "${extras.license}", API "${label}", author "${extras.author}"`,
  );
}

/**
 * Build (or re-use) the optimised local GLB for one anonymous mirror source.
 * Same idempotency contract as buildGlb: an existing in-budget GLB is kept
 * unless --rebuild-glb is passed.
 */
async function buildMirrorGlb(src: MirrorSource): Promise<GlbResult> {
  const outDir = join(PUBLIC_MODELS, src.id);
  const outGlb = join(outDir, "model.glb");
  const base = {
    id: src.id,
    license: src.license,
    author: src.author,
    sourceId: src.sourceUid,
    page: src.page,
  };

  // licence first: never spend a 21 MB download on an unverifiable asset
  const extras = await remoteGlbExtras(src.file);
  if (!extras.source?.includes(src.sourceUid)) {
    throw new Error(`${src.file} reports asset.extras.source="${extras.source}", expected ${src.sourceUid}`);
  }
  if (extras.license !== src.licenseMustEqual) {
    throw new Error(
      `${src.file} reports asset.extras.license="${extras.license}", expected "${src.licenseMustEqual}"`,
    );
  }
  const api = await verifyModel(src.sourceUid);
  const label = api?.license?.label ?? "(missing)";
  if (!api || label !== src.apiLicenseLabel) {
    throw new Error(
      `Sketchfab uid ${src.sourceUid} reports licence "${label}", expected "${src.apiLicenseLabel}" — ` +
        `the mirror and the source disagree, refusing to ship`,
    );
  }

  if (existsSync(outGlb) && !REBUILD_GLB) {
    const bytes = statSync(outGlb).size;
    if (bytes > 0 && bytes <= GLB_BYTE_BUDGET) {
      // re-verify the COMMITTED file, not just the upstream one: the licence
      // block must have survived the strip/centre/optimise chain.
      const shipped: Record<string, string> = glbJson(outGlb).asset?.extras ?? {};
      if (!String(shipped.source ?? "").includes(src.sourceUid)) {
        throw new Error(
          `${outGlb} no longer carries asset.extras.source="${src.sourceUid}" (found "${String(shipped.source)}") — ` +
            `re-run with --rebuild-glb`,
        );
      }
      return { ...base, glb: `/models/${src.id}/model.glb`, bytes, dropped: null };
    }
    rmSync(outDir, { recursive: true, force: true });
  }

  const workDir = join(tmpdir(), `asset3d-${src.id}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  try {
    const raw = join(workDir, "source.glb");
    const res = await fetch(src.file);
    if (!res.ok) throw new Error(`download ${src.file}: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));

    const stripped = join(workDir, "stripped.glb");
    const dropped = stripMeshes(raw, stripped, src.stripMeshPatterns);
    const centred = join(workDir, "centred.glb");
    centerBelow(stripped, centred);

    mkdirSync(outDir, { recursive: true });
    optimise(centred, outGlb, 1024);
    let bytes = statSync(outGlb).size;
    if (bytes > GLB_BYTE_BUDGET) {
      optimise(centred, outGlb, 512);
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
    console.warn(`  stripped stray meshes: ${dropped.join(", ") || "(none)"}`);
    return { ...base, glb: `/models/${src.id}/model.glb`, bytes, dropped: null };
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    return {
      ...base,
      glb: "",
      bytes: 0,
      dropped: `mirror build failed (${(err as Error).message.split("\n")[0]}) — dropped, falling back to embed`,
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
  /** one line per source probed by the sweep — written verbatim to the file */
  sourceAudit?: SourceAuditEntry[];
  /** additive keys owned by other agents (e.g. `turntables`) — passed through */
  [key: string]: unknown;
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
      "  project has no token, so nothing is ever pulled from sketchfab.com\n" +
      "  itself: every Sketchfab-backed entry is an official <iframe> embed.\n" +
      "  Local .glb files come only from DIRECT_SOURCES (GitHub repos with an\n" +
      "  open licence file) and MIRROR_SOURCES (hosts that re-serve Sketchfab's\n" +
      "  own export anonymously, licence re-checked against the public API).\n" +
      "  Mislabelled metadata is rejected, not trusted — see sourceAudit.\n" +
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
    for (const src of MIRROR_SOURCES) {
      process.stderr.write(`glb: ${src.id} … `);
      const res = await buildMirrorGlb(src);
      glbs.push(res);
      console.warn(res.dropped ? `dropped — ${res.dropped}` : `${res.bytes} bytes`);
    }
  }

  let sourceAudit: SourceAuditEntry[] | undefined = previous.sourceAudit;
  if (!OFFLINE && DO_SWEEP) {
    process.stderr.write("sweep: probing every source …\n");
    sourceAudit = await runSweep();
  }

  /**
 * Top-level keys this file owns and rewrites from scratch. Anything else found
 * in the previous file belongs to another agent (e.g. ASSET-VIDEO's
 * `turntables` map, which scripts/fetch-turntables.ts appends here) and is
 * carried through untouched so a re-run never deletes someone else's data.
 */
const OWNED_KEYS = new Set(["updatedAt", "verifiedAt", "generations", "variants", "sourceAudit"]);

function foreignKeys(previous: ModelsFile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(previous as Record<string, unknown>)) {
    if (!OWNED_KEYS.has(key) && value !== undefined) out[key] = value;
  }
  return out;
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
          const direct = DIRECT_SOURCES.find((s) => s.id === g.id);
          if (direct) {
            return target.kind === "generation"
              ? direct.generations.includes(genId)
              : direct.variants.includes(target.key);
          }
          const mirror = MIRROR_SOURCES.find((s) => s.id === g.id);
          if (!mirror) return false;
          return target.kind === "generation"
            ? mirror.generations.includes(genId)
            : mirror.variants.includes(target.key);
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
  if (sourceAudit) out.sourceAudit = sourceAudit;
  // pass through anything another agent appended to this file
  const foreign = foreignKeys(previous);
  for (const [key, value] of Object.entries(foreign)) {
    if (key in out) continue;
    (out as Record<string, unknown>)[key] = value;
    console.warn(`  preserved foreign key "${key}" from the previous run`);
  }
  mkdirSync(dirname(MODELS_JSON), { recursive: true });
  writeFileSync(MODELS_JSON, `${JSON.stringify(out, null, 2)}\n`);

  // ---- per-model credits (merged into data/credits.json by the LEAD) -------
  const credits: Credit[] = glbs
    .filter((g) => g.glb && !g.dropped)
    .map((g) => {
      const noteBits = [`glb ${g.bytes} bytes (< ${GLB_BYTE_BUDGET} budget)`];
      if (g.sourceId.length === 32 && !g.sourceId.includes("/")) noteBits.push(`Sketchfab uid ${g.sourceId}`);
      const mirror = MIRROR_SOURCES.find((s) => s.id === g.id);
      if (mirror) {
        noteBits.push(`downloaded anonymously from ${mirror.file} (Sketchfab export, licence re-checked against api.sketchfab.com)`, mirror.note);
      } else {
        const direct = DIRECT_SOURCES.find((s) => s.id === g.id);
        noteBits.push(`repo ${direct?.repo ?? "?"}, car geometry uid ${direct?.geometrySourceId ?? "?"}`);
      }
      return {
        assetId: `model-${g.id}`,
        kind: "model",
        source: "other",
        url: g.page,
        license: g.license,
        author: g.author,
        retrieved: out.updatedAt,
        sourceId: g.sourceId,
        localPath: g.glb,
        note: noteBits.join("; "),
      } satisfies Credit;
    });
  if (credits.length > 0) {
    writeFileSync(MODEL_CREDITS_JSON, `${JSON.stringify({ generatedAt: out.updatedAt, credits }, null, 2)}\n`);
    console.warn(`data/model-credits.json written — ${credits.length} model credit(s) for the LEAD to merge`);
  }

  const all = [...Object.values(out.generations), ...scoped.values()];
  const withGlb = all.filter((m) => m?.glb).length;
  const withEmbed = all.filter((m) => m?.embedUrl).length;
  console.warn(
    `\ndata/models.json written — ${verified} uids re-verified against the Sketchfab API,\n` +
      `  generations: ${Object.values(out.generations).filter(Boolean).length}/${Object.keys(out.generations).length} with a model\n` +
      `  variants:    ${[...scoped.values()].filter(Boolean).length}/${scoped.size} roster entries with a model ` +
      `(${withEmbed} embeds, ${withGlb} local GLB) — plus ${Object.keys(out.variants).length - scoped.size} bare-id aliases\n` +
      `  sources:     ${sourceAudit?.length ?? 0} probed, ${(sourceAudit ?? []).filter((a) => a.anonymousDownload === "yes").length} allow anonymous download\n` +
      `  MISSING (${missing.length}) — for docs/STATUS.md:\n` +
      missing.map((m) => `    - ${m.key}: ${m.note}`).join("\n") +
      `\nREMINDER: Sketchfab GLB downloads are impossible without a token; embeds are the only Sketchfab delivery.`,
  );
}

await main();