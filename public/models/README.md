# 3D assets — provenance, licences, optimisation

Owner: **ASSET-3D**. Produced by `scripts/fetch-models.ts` (re-runnable:
`node scripts/fetch-models.ts`). Machine-readable index: `data/models.json`.

**Coverage:** 9/9 generation heroes · 34/136 roster variant entries ·
43 shortlist targets re-verified live against the Sketchfab API in the run that
wrote this file (`data/models.json` → `verifiedAt`).

---

## ⚠️ Gitignore blocker (needs the LEAD)

`.gitignore` line 12 contains `public/models/**/*`, so **neither the GLB below
nor this README is tracked by git** (`git check-ignore -v` confirms it). The
lead (owner of `.gitignore`) needs one of:

```
!public/models/*/
!public/models/*/model.glb
!public/models/README.md
```

or an explicit `git add -f public/models/`. Until then the GLB exists on disk
only. `public/decoders/{draco,basis}` is **not** ignored and is already tracked.

## ⚠️ Sketchfab GLB downloads are impossible here

`GET https://api.sketchfab.com/v3/models/<uid>/download` returns **401
Unauthorized** without an OAuth access token. No Sketchfab token is available
to this project and none is requested. Therefore:

- **every** Sketchfab-backed entry in `data/models.json` is an official
  `<iframe>` embed URL of the form
  `https://sketchfab.com/3d-models/<slug>-<uid>?embed=1`, always derived from
  the `viewerUrl` that `GET /v3/models/<uid>` returns — no uid, slug, licence or
  author is ever hand-written;
- the only local `.glb` in this repo comes from a repository that is directly
  downloadable without auth **and** carries an open licence file.

### Licence allow-list

Only these three `license.label` values are accepted (exact match, read verbatim
from the API):

| Sketchfab `license.label` | accepted |
|---|---|
| `CC0 Public Domain` | yes |
| `CC Attribution` | yes |
| `CC Attribution-ShareAlike` | yes |
| `CC Attribution-NonCommercial` | **no** |
| `CC Attribution-NonCommercial-ShareAlike` | **no** |

The strict match matters: `"CC Attribution-NonCommercial"` *contains* the string
`"CC Attribution"`, so a loose `includes()` test would silently admit
non-commercial uploads (this is how most `Ddiaz Design`, `OUTPISTON`, `vecarz`,
`MattDoesBlender` and `Outlaw Games` uploads are excluded). `fetch-models.ts`
**aborts** if a pinned uid ever 404s or changes to a non-allowed label, so
`data/models.json` can never drift into an unusable embed.

No **CC0** 911 model exists on Sketchfab: across ~190 name-filtered searches,
every allowed-licensed hit was `CC Attribution` or `CC Attribution-ShareAlike`.

---

## Audited this run (STEP 1) — 33 pre-existing entries re-fetched

Every uid that the previous run had written was re-fetched with
`GET /v3/models/<uid>` and checked for (a) 200/existence, (b) `license.label`
inside the allow-list, (c) `author` equality, (d) `embedUrl === viewerUrl + "?embed=1"`.

**Result: all 33 Sketchfab entries (32 unique uids) passed all four checks — no licence, author or
slug in the old file was wrong.** Two structural defects were found and fixed,
and three entries were rejected on provenance grounds:

| Was | Problem found on re-fetch | Now |
|---|---|---|
| `964` generation **and** `964/carrera-4` = `(FREE) Porsche 911 Carrera 4S` (`d01b2544…`, CC BY-SA) | uploader's description only says "part of a prototype car configurator" and names no model year — it cannot be verified as a **964** rather than a 997/992-era Carrera 4S. Shipping it would put a modern car on the 964 chapter hero. | **rejected**; `964` + `964/carrera-4` = `22edb81d…` *"1989 Porsche 911 (964) Carrera 4"* (CC BY, 176,928 verts, description names the car exactly) |
| `964/carrera-4` = `cae36664…` *"Porsche 911 (964)"* | description: *"Shout out to @tonielpro520 for the original car [1993 964 **Turbo**] … I'm making my own **wide body** 911"* — i.e. it is the 964 **Turbo** geometry, wide-bodied, not a Carrera 4 | replaced by `22edb81d…` |
| `996/gt2` = `2f39754f…` *"Porsche 911 GT2 **RS** (996)"* | the 2004 GT2 RS is a **different car** from the 2000–2005 GT2 the variant documents (the API description even says "Years: 2002, Price: $99,990", which is GT2-spec data on a GT2 RS body) | **`null`** + note |
| `991/gt3-rs` = `c08b312e…` *"Porsche 911 GT3 RS (991.1) '16"* | description claims a *"5.6L naturally aspirated flat-6"* — the 991.1 GT3 RS has a 4.0-litre engine, so the uploader's metadata is unreliable | swapped for `2b02e300…` *"Porsche 911 991.1 GT3 RS"* (CC BY, 137,519 verts vs 19,621) |
| `gseries` + `gseries/turbo-3.0-930` | entry carried `license: "MIT"` **and** a Sketchfab `embedUrl` of somebody else's CC BY model — a false attribution in `/credits` | embed **cleared** (`embedUrl: null`) when the local GLB is attached, so the record names only the asset that actually renders |

Also dropped from `variants`: the old flat keys collided across generations
(`turbo`, `gt3`, `carrera`, `gts`, `targa-4s`, `s-t`, `carrera-4s`, `gt2-rs`… each
exist in 2–6 chapters), so `993/turbo`, `996/gt2`, `997/gt2-rs`, `991/gt3-rs` and
`991/turbo-s` had been silently **overwritten** in the previous output even though
their pinned uids verified fine. See "Key shape" below.

### Added this run (all re-fetched and licence-verified)

| Target | uid | model name | author | licence | verts |
|---|---|---|---|---|---|
| `964/carrera-4` + `964` hero | `22edb81d9ccf46c09a1add7a9ebda2c0` | 1989 Porsche 911 (964) Carrera 4 | 007 | CC Attribution | 176,928 |
| `993/turbo` | `72f2943569434e4e93ab63f403c6aa1c` | Porsche 911 993 Turbo Low-poly | Nieve5677 | CC Attribution | 69,157 |
| `993/carrera-4s` | `5d90416b06854a369e566d3fa286c692` | 1996 Porsche 993 Carrera 4s | _shobh19 | CC Attribution | 3,954 |
| `991/gt3-rs` | `2b02e300bb094a2293f4b714e2ae7ddf` | Porsche 911 991.1 GT3 RS | Casacade Models | CC Attribution | 137,519 |
| `991/carrera-s` | `e8e06ddd8d3f4419a5252d187f6f217e` | Porsche 911 Carrera S (991.2) | Mona x Supercars | CC Attribution | 14,893 |
| `997/gt2-rs` | `41419345868e406eaec8a271e33de3c1` | Porsche 911 GT2 RS With Angle Eyes | COOL601 | CC Attribution | 148,999 |
| `992-1/carrera-4s` | `e2be40c215e34812af7dfb933bc7967a` | 2019 Porsche 911 Carrera 4S 992 | Maroi Mister Let Me Think Official 3D Studio | CC Attribution | 33,542 |

### Confirmed MISSING (no allowed-licensed model exists)

Every one of these was searched by name (not by like-count ranking) with the
licence allow-list applied; the reasons are printed by
`node scripts/fetch-models.ts` and stored as the target `note` in the script.

`901/carrera-rs-2.7` · `gseries/turbo-s-3.3` · `gseries/turbo-le-1989` ·
`gseries/carrera-rs-3.0` · `gseries/carrera-rsr-3.0` ·
`gseries/carrera-club-sport` · `gseries/speedster-1989` · `964/carrera-4s` ·
`964/rs-3.8` · `964/rsr-3.8` · `964/speedster` · `964/cup` · `993/carrera-rs` ·
`993/turbo-s` · `993/gt2` · `993/gt2-evo` · `993/speedster` · `993/club-sport` ·
`996/gt3` · `996/gt3-rs` · `996/gt2` · `996/turbo-s` · `997/carrera` ·
`997/gt3` · `997/turbo` · `997/turbo-s` · `997/gts` · `997/sport-classic` ·
`991/carrera-t` · `991/speedster` · `992-1/turbo` · `992-2/turbo-s` ·
`992-2/carrera-gts` · `992-2/gt3` · `992-2/gt3-s-c` · `992-2/spirit-70`
(+ every other roster id with no target in the script: plain 2.0/2.2/2.4 F-cars,
996/997 specials, etc.)

Notable near-misses that were **not** used because they are a different car:

- `996/gt3` → only *"1996 Porsche 911 GT1"* (race car) and *"2007 Porsche 996
  GT300 Yunker Power Taisan"* (JDM build) exist under an allowed licence.
- `997/gt3` → only the 997 **GT3 RS 4.0** exists.
- `992-2/gt3` → only *"992.2 GT3 RS Manthey Kit"* uploads exist.
- `992-2/gt3-s-c` → only a 992 **Carrera S Cabriolet** (2019) exists.
- `992-2/carrera-gts` → only the **Targa** 4 GTS shell exists (already used for
  `992-2/targa-4-gts`; the roster's `carrera-gts` is a coupe).
- `993/turbo` → the 69k-vertex "low-poly" 993 Turbo is the only exact match.

---

## Key shape of `data/models.json` (please read before merging)

```jsonc
{
  "updatedAt": "ISO", "verifiedAt": "ISO",
  "generations": { "<genId>": Model3D|null },              // 9 keys
  "variants": {
    "<genId>/<variantId>": Model3D|null,                  // 136 keys — AUTHORITATIVE
    "<variantId>":             Model3D|null               // 78 bare aliases
  }
}
```

`data/roster.json` reuses 20 variant ids across generations (`turbo`, `gt3`,
`gt3-rs`, `gt2`, `gt2-rs`, `carrera`, `carrera-4`, `carrera-4s`, `carrera-s`,
`carrera-t`, `targa`, `targa-4`, `targa-4s`, `speedster`, `turbo-s`, `america-
roadster`, `gt3-touring`, `s-t`, `sport-classic`, `gts`), so a bare
`Record<variantId, …>` cannot express both `993/turbo` and `996/turbo`. Both key
styles are therefore written:

- **use `"${gen.id}/${variant.id}"` when merging** (unambiguous, 1:1 with the
  roster, 136 entries);
- the bare ids are a compatibility alias resolved to the **newest generation
  that actually has a model** (`turbo` → 996, `gt3` → 992.1, `carrera-4s` →
  992.1). Reading a bare id therefore gives the *latest* car with that name, not
  the car of the chapter being merged — drop the aliases if you only need one
  form, but keep in mind `Object.keys(variants).length` is then 214, not 136.

---

## Known provenance caveats (recorded, not hidden)

- **Re-uploads.** Several winners (`007`, `Mona x Supercars`, `DisneyCars`,
  `Dave Love SketchFab`, `Galaxy Car Showroom`, `HiQ3D`, `Casacade Models`,
  `Samydepapelo3`) are re-uploads of geometry that originated elsewhere. The
  licence label recorded in `data/models.json` is the one the API reports *for
  that exact uid*; that is the only thing this pipeline can verify.
- **Uploader metadata errors.** `Mona x Supercars`' "GT3 RS (991.1)" describes a
  5.6-litre engine; their "GT2 RS (996)" describes a 2002 GT2. Where the
  description contradicts the car, this pipeline trusts the model **name** and
  said so in the target `note`.
- **`992-1/dakar`** uses a HiQ3D upload whose own description attributes the
  original to Ddiaz Design. The Ddiaz original (`3d08be7f0ed04c368d487ee72bc05225`)
  reports **CC Attribution-NonCommercial-ShareAlike**, which is outside the
  allow-list, so the remix is the only usable Dakar record and its licence is
  contested. Swap to `null` if the lead prefers strict provenance.
- **`991/gt2-rs`** (`98767072b9f94f8eb6c4512b7be891c4`) — the uploader's
  description states the asset was "sourced from third-party platforms such as
  Facebook, VK and MediaFire" and credits another author. The API label is
  `CC Attribution`; the chain of title is not verifiable.
- **`992-1/s-t`** (`f39f7c539a3440428c22a3da2f52af43`) — this is Ddiaz Design's
  *own* upload and its API label really is `CC Attribution`, so it is safe.
- **`901/targa` (10k verts), `gseries/turbo-flachbau` (3k), `gseries/sc`
  (rally-liveried), `993/carrera-4s` (4k), `993/turbo` (low-poly by title),
  `992-1/turbo-s` ("WIP, no interior")** are deliberately low quality. They are
  the only allowed-licensed models that exist for those variants, and they are
  better than `null`. Swap them out if a better source appears.
- **Generation heroes** are the single most iconic licensed car of the era:
  901 = 1964 911 · G-series = 1975 930 Turbo (local GLB) · 964 = Carrera 4 ·
  993 = 1995 Carrera · 996 = 996 · 997 = GT3 RS (997.2) · 991 = Carrera S ·
  992.1 = Carrera S · 992.2 = Targa 4 GTS (992.2).

---

## Committed local GLB

### `930-turbo-1975/model.glb`

| | |
|---|---|
| Path | `public/models/930-turbo-1975/model.glb` |
| Size | **2,206,432 bytes** (2.21 MB) — under the 3 MB budget in `docs/CONTRACTS.md` |
| Used for | generation hero `gseries`, variant `gseries/turbo-3.0-930` |
| Subject | 1975 Porsche 911 Turbo (930), exterior + interior |
| Repo licence | **MIT** — `LICENSE` re-fetched and asserted on every pipeline run |
| Repo | <https://github.com/UtkarshPathrabe/Porche-911-930-Turbo-1975-3D-Model> |
| Repo author | Utkarsh Pathrabe — <https://github.com/UtkarshPathrabe> |
| Car geometry | **INFERRED** — see below |
| Fallback | Sketchfab CC BY embed `8568d9d14a994b9cae59499f0dbed21e` (*"FREE 1975 Porsche 911 (930) Turbo"*, Lionsharp Studios) |

#### ⚠️ Geometry provenance is inferred, not verified

The repository's `LICENSE` is MIT and covers the author's own work, but:

1. the optimised glTF's scene is literally named **`Sketchfab_Scene`**, so the
   car geometry came from a Sketchfab download;
2. the repository's README **credits no 3D source at all**;
3. an independent redistribution of the same asset
   (<https://github.com/briankusuma/3D-porche-911>) credits *"FREE 1975 Porsche
   911 (930) Turbo"*, and its `skfb.ly/6WZyV` short link resolves (HTTP 301) to
   uid `8568d9d14a994b9cae59499f0dbed21e` — whose API record says author
   **Lionsharp Studios**, licence **CC Attribution**, and whose description says
   *"Please give a credit to Lionsharp Studios for the 3D model."*

So the honest record is **two licences**: MIT for the repo/scene, CC BY 4.0
(attribution required) for the car geometry. `data/models.json` states exactly
that — `license: "MIT (repo) + CC Attribution (geometry, inferred)"`,
`author: "Utkarsh Pathrabe (repo) + Lionsharp Studios (geometry, inferred)"` —
and the word *inferred* is deliberate. If the lead wants zero inference, delete
`public/models/930-turbo-1975/` and re-run `node scripts/fetch-models.ts`; both
targets then fall back to the CC BY Sketchfab embed automatically.

#### Optimisation chain

All via `npx @gltf-transform/cli@latest` (glTF-Transform v4.5.1):

```
scene.gltf + scene.bin (8.82 MB) + 27 PNG textures (62.4 MB)   = 74.21 MB
  optimize --compress draco --texture-compress webp                     4,690,588 B   ← over budget
  optimize --compress draco --texture-compress webp --texture-size 1024 2,206,432 B   ← shipped
```

Passes applied: `dedup`, `instance`, `palette`, `flatten`, `join`, `weld`,
`simplify`, `resample`, `prune`, `sparse`, `textureCompress`, `draco`.
Result: 450,120 render vertices, bounding box 3.12 × 1.87 × 6.23 m (car-sized,
origin at ground level), 14 meshes / 14 materials with
`KHR_materials_clearcoat` (paint) and `KHR_materials_transmission` (glass),
26 WebP images, no animations, no rig.

#### Consumer requirements (for 3D-HERO)

`extensionsRequired: ["EXT_texture_webp", "KHR_draco_mesh_compression"]`:

- it will **not** load without a Draco decoder — use
  `useGLTF("/models/930-turbo-1975/model.glb", true)` (drei) or a
  `DRACOLoader` pointed at the local copy:
  `new DRACOLoader().setDecoderPath("/decoders/draco/")`
  (drei's boolean shortcut uses a **gstatic.com** decoder by default — the
  self-hosted decoders at `public/decoders/draco/` exist to avoid that);
- `EXT_texture_webp` needs **WebGL2**. If the renderer is WebGL1 the whole GLB
  throws rather than degrading;
- `/decoders/basis/` is present for any future KTX2 asset but is **not** used by
  this file (no `KHR_texture_basisu` in the GLB).

**Known cosmetic artefact.** The source scene bakes a floor decal reading
"1975 PORSCHE 911 turbo" into the ground texture. Inherited from the upstream
asset, not added here; only visible when framed from above.

---

## Reproducing

```bash
node scripts/fetch-models.ts             # re-verify licences, rewrite data/models.json (GLB re-used)
node scripts/fetch-models.ts --refresh   # + print live runners-up per target
node scripts/fetch-models.ts --offline   # no network; keep last verified records
node scripts/fetch-models.ts --no-glb    # skip the direct-licence GLB step entirely
node scripts/fetch-models.ts --rebuild-glb   # force the 74 MB download + re-optimise
```

The script is idempotent: normal re-runs re-verify every pinned target against the live
API (a few seconds) and rewrite the same file with a fresh `updatedAt`. The GLB
is only re-downloaded when missing or `--rebuild-glb` is passed.

`tsx` is **not** in `package.json` (and must not be added), so the script is
written as Node-native TypeScript and runs on plain `node` via Node's built-in
type stripping (verified on Node 26.7). `npx tsx scripts/fetch-models.ts` also
works without it being a dependency.