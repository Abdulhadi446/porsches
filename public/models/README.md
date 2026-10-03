# 3D assets — provenance, licences, optimisation

Owner: **ASSET-3D**. Produced by `scripts/fetch-models.ts` (re-runnable:
`node scripts/fetch-models.ts`). Machine-readable index: `data/models.json`;
per-model credits in `data/model-credits.json`.

**Coverage:** 9/9 generation heroes · 35/136 roster variant entries ·
2 committed local GLBs · **18** sources probed on every run
(`data/models.json` → `verifiedAt`, `sourceAudit`).

> **Second pass, 2026-10-03 (this run).** Every existing artefact was re-verified
> from scratch rather than trusted: both GLBs were re-downloaded, re-optimised and
> came back **byte-identical** (`--rebuild-glb`, same MD5s), both `asset.extras`
> blocks were re-read out of the binaries, both uids were re-fetched from the
> Sketchfab API, and both subjects were re-checked against the Sketchfab
> thumbnails (a 930 wide-body whale-tail Turbo; a 991-roofline Carrera 4S with
> yellow calipers). The source sweep was re-run and **extended by five sources**
> (Kenney Racing/Toy Car Kit, Wikimedia Commons 3D, Smithsonian Open Access,
> archive.org, HuggingFace). Net new models: **none** — see the audit table for
> why each source is empty or inadmissible.

> **`.gitignore` is fixed.** The previous run of this file reported that
> `public/models/**/*` was untracked. `.gitignore` no longer contains that line
> and `git check-ignore -v public/models/*/model.glb` returns nothing, so both
> GLBs and this README are tracked normally.

---

## ⚠️ Sketchfab GLB downloads are still impossible — but that is no longer the whole story

`GET https://api.sketchfab.com/v3/models/<uid>/download` returns **401
Unauthorized** without an OAuth access token. No Sketchfab token is available
to this project and none is requested. Therefore:

- **every** Sketchfab-backed entry in `data/models.json` is an official
  `<iframe>` embed URL of the form
  `https://sketchfab.com/3d-models/<slug>-<uid>?embed=1`, always derived from
  the `viewerUrl` that `GET /v3/models/<uid>` returns — no uid, slug, licence or
  author is ever hand-written;
- the **public metadata** API (`GET /v3/models/<uid>`, `GET /v3/search`) needs
  no token at all. Every licence/author claim in this repo is verified through
  it, every run.

The earlier conclusion "no open-licence GLB exists" was **under-scoped**: it
only looked at sketchfab.com's own download endpoint. Anonymous direct `.glb`
downloads of the *same* Sketchfab assets exist elsewhere, and the sweep below
found two.

### Two kinds of local-GLB source, both re-verified on every run

| | `DIRECT_SOURCES` | `MIRROR_SOURCES` |
|---|---|---|
| what | a GitHub repo | a host that re-serves Sketchfab's own GLB export |
| licence evidence | a `LICENSE` file in the repo, text re-read and asserted | the `asset.extras` block Sketchfab's exporter writes into every GLB |
| independent check | — | the same uid re-fetched from `GET /v3/models/<uid>` |
| current entries | `930-turbo-1975` | `991-carrera-4s` |

Sketchfab bakes its own attribution into each export. Verbatim out of the
committed `991-carrera-4s/model.glb` (the earlier revision of this file quoted
the uploader's name here — that was wrong and is fixed):

```json
"asset": { "generator": "Sketchfab-16.74.0", "extras": {
  "author":  "Karol Miklas (https://sketchfab.com/karolmiklas)",
  "license": "CC-BY-SA-4.0 (http://creativecommons.org/licenses/by-sa/4.0/)",
  "source":  "https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf",
  "title":   "(FREE) Porsche 911 Carrera 4S" } }
```

Note the tension, which is real and is **not** resolved by guessing: the block
names *Karol Miklas* while `GET /v3/models/<uid>` reports the uploader as
*Lionsharp Studios* (`@lionsharp`). The API is the authority for "who published
it"; the boilerplate is quoted as-is. Both names appear in
`data/models.json` and `data/model-credits.json`.

`fetch-models.ts` reads that block with **two HTTP range requests** (24 bytes
for the chunk header, then exactly the JSON chunk), asserts the `source` uid and
the licence string, and then re-fetches the uid from the public Sketchfab API.
A mirror that disagreed with the API **aborts the run** — which matters, because
one does disagree (see the audit table).

---

## Source audit — every source probed, this run

Machine-readable copy in `data/models.json` → `sourceAudit`
(`{source, anonymousDownload, probedAt, status, note}`).

| source | anon. download? | what is actually there |
|---|---|---|
| **poly.pizza** | **yes** | Anonymous `.glb` over `https://static.poly.pizza/<uuid>.glb` (the model page embeds the URL). 14 queries: 911 / porsche / porsche 911 / 930 turbo / 964 / 991 / 992 / 993 / 996 / 997 / GT3 / turbo / sports car / coupe. **Zero titles or descriptions contain "porsche" or "911"** — the search is title-based with fuzzy filler (a nonsense query still returns hits), so nothing on this site is a 911. All hits are generic cars: Quaternius *Sports Car* (CC0, verified against the thumbnail — an Audi-A4-ish sedan), DeLorean, RX-7, Ferrari F40, Camaro, Bricklin SV1, *Retro car* whose own description says "Suzuki Vitara 1997". No CC0 bundle pages exist, individual models only. **Re-verified on this pass:** 13 queries re-fetched and the card titles parsed by hand — `porsche`, `porsche 911`, `930 turbo` and `GT3` return only Quaternius *Sports Car* / *Sports Hatchback* / *Sportster*; `964`/`991`/`992`/`993`/`996`/`997` return an empty result shell (96 kB, zero cards). Verdict unchanged: no 911 of any generation on this site. |
| **kenney.nl** (Car Kit) | **yes** | Direct zip, HTTP 200, 4.81 MB, `License.txt` = "Creative Commons Zero, CC0". 45 models: ambulance, box, cone, debris-*, delivery, firetruck, garbage-truck, hatchback-sports, kart-oo*, police, race*, sedan*, suv*, taxi, tractor, truck, van, wheel-*. No 911, and nothing recognisable as a Porsche. |
| **kenney.nl** (Racing Kit / Toy Car Kit) | **yes** | Both zips anonymous (HTTP 200: 6.08 MB / 5.25 MB). Racing Kit = `raceCar{White,Red,Green,Orange}` + track furniture; Toy Car Kit = `vehicle-{drag-racer,monster-truck,racer,racer-low,speedster,suv,truck,vintage-racer}` + track pieces. Stylised toy shapes, no 911 silhouette. This exhausts Kenney's car content. |
| **wikimedia commons** (3D files) | **yes** | The `api.wikimedia.org` REST host the image pipeline already uses answers fine, but a 911 search returns photographs only; glb/stl/obj queries return nothing. Commons has no 911 mesh. |
| **si.edu** open access | **yes** | HTTP 200 anonymously, but the only Porsche hits are printed matter (a 1960s book of Porsche posters). No car models in the 3D collection. |
| **archive.org** | **yes** | Search API anonymous; hits are mirrored Thingiverse printables (CC BY / CC BY-SA) and licence-less YouTube captures. Nothing is a 911 vehicle model. |
| **huggingface.co** (ObjaverseXL sketchfab shards) | **yes** | Public and `gated:false`, but files are untitled `shards-0000NN.tar` feature dumps — no index, no per-item licence column, and finding one car means scanning multi-GB shards. Rejected on unverifiable per-item provenance, not on access. |
| **get3dmodels.com** | **yes** | Anonymous direct `.glb`, HTTP 200, no auth. The whole catalogue — 2 967 model URLs, enumerated from `sitemap_index.xml` — has exactly 10 Porsche entries, 7 of them 911s. **Accepted 2, rejected 5** — see below. This site's own cards mislabel licences; only `asset.extras` is trustworthy. |
| **sketchfab.com** download API | **no** | 401 without an OAuth token. Metadata API is public and is what every licence check uses. |
| **github.com** | **yes** | Anonymous repo search + `raw.githubusercontent` downloads both work. ~20 queries, plus a licence-filtered second pass (`license:mit` / `apache-2.0` / `cc0-1.0`). Every repo holding real geometry is unlicensed (⇒ rejected), a different car, or a duplicate of a model already in use — details below. Code search needs auth, so a Sketchfab uid cannot be searched for directly. |
| **blendkit.com** (ex-BlenderKit) | **no** | Search API is anonymous and returns 146 Porsche 911 assets, but `/api/v1/downloads/<uuid>/` answers **401 "Unauthorized access. Please log in."** Licence is BlenderKit's own *royalty-free*, not Creative Commons — out of scope twice over. |
| **free3d.com** | **no** | HTTP 403 (Cloudflare). |
| **cgtrader.com** free tier | **no** | HTTP 202, zero-byte body (bot mitigation). |
| **turbosquid.com** free | **no** | HTTP 403. |
| **3dsky.org** | **no** | HTTP 200 but results are client-rendered and downloads sit behind "Sign in". |
| **opengameart.org** | **yes** | Downloads work, but the only Porsche submission is *Car - Porsche 911 Carrera 1998* by TituroFox (CC0, 441.9 KB zip) — filed as **2D Art**, a top-down sprite, not a model. |
| **quaternius.com** | **no** | Cars Pack is CC0 but the download is gated behind Patreon credits, and it ships FBX/OBJ/Blend only. No Porsche in it. |
| **blendswap.com** | **no** | `/search/*` is 404; nothing probeable anonymously. |

### get3dmodels.com — accepted vs rejected

Licence is read from `asset.extras` and cross-checked against
`api.sketchfab.com`, never from the mirror's own card.

| model | `asset.extras.license` | API `license.label` | verdict |
|---|---|---|---|
| FREE 1975 Porsche 911 (930) Turbo | CC-BY-4.0 | CC Attribution | **accepted** — already the committed `930-turbo-1975` |
| (FREE) Porsche 911 Carrera 4S | CC-BY-SA-4.0 | CC Attribution-ShareAlike | **accepted** — new, committed as `991-carrera-4s` |
| Porsche 911 GT3™ (2022 = 992.2) | CC-BY-NC-**4.0** | — | **rejected: non-commercial.** The mirror's card calls it "Creative Commons Attribution", which is simply wrong |
| 1998 Porsche 911 GT1 Straßenversion | CC-BY-NC-SA-4.0 | — | rejected: non-commercial (and a race car) |
| 2010 Porsche 911 GT3 Cup | CC-BY-NC-SA-4.0 | — | rejected: non-commercial |
| 2014 Porsche 911 RSR | CC-BY-NC-SA-4.0 | — | rejected: non-commercial |
| 2012 Porsche 911 GT3 RS 4.0 | CC-BY-NC-SA-4.0 | — | rejected: non-commercial |
| 2014 / 2015 Porsche 919 Hybrid, 2010 918 RSR, 2009 RS Spyder | CC-BY-NC-SA-4.0 | — | rejected: non-commercial **and** not a 911 |

**Re-read in full on this pass.** All 11 Porsche GLBs on the mirror were fetched
with two HTTP range requests each and every `asset.extras` block quoted again, so
the verdicts above do not rest on the earlier run: `8568d9d1…` = CC-BY-4.0,
`d01b2544…` = CC-BY-SA-4.0, `b0a1d1f2…` = CC-BY-NC-4.0 (DreamCar),
`17ad4a92…` / `7d9c91fe…` / `63d9f850…` / `b2a0382d…` = CC-BY-NC-SA-4.0
(OUTPISTON), `8f81b20b…` = 919 Hybrid. The mirror is therefore **exhausted**:
two admissible 911s, both already committed, nothing else obtainable.

### GitHub — what was looked at and why it failed

- `wSaiven/Porsche-911` — `LICENSE` is genuine Apache-2.0, and the repo contains
  **that file and nothing else**. Rejected: no geometry.
- `C3ddy/first-threejs-project` — MIT `LICENSE`, but the README credits
  *"Outlaw GamesTM on Sketchfab … 2018 Porsche 718 Cayman GTS"*. Rejected: wrong
  car (a 718 Cayman, not a 911) and an NC-licensed re-upload.
- `mohanadalsa296-cloud/Porche911.glb`, `Dhe-Engine/1967-porsche-911`,
  `Dhe-Engine/porsche-911`, `Kom1sh/911-gt3`, `VaheHayrapetyan1/car-3d-viewer`,
  `volkanongun/threejs-import-sketchfab-porsche911`, `ASouthernCat/Porsche911-carshow-threejs`,
  `NH1500/Porsche-964`, `Maniwar/porsche996turbo`, `mohanadalsa296-cloud` — **all
  rejected: no LICENSE file ⇒ treated as all-rights-reserved**, per the lead's rule.
- `yuenkev/911Turbo` — no OSI licence, but it ships the upstream Sketchfab
  attribution block (`license.txt`), so it was used as **licence evidence** for
  the 930, see below. Not used as a byte source.
- `Hanckewk/3D-Carrera-911-model-` and `adriannadev/porsche-model` — both
  redistribute the same Carrera 4S; `adriannadev` carries the CC BY-SA block at
  repo root. Superseded by the direct mirror download.
- `jajh90/r3f-porsche` (react-three-fiber demo, found by a licence-filtered
  second pass) — ships `public/model/car/model-transformed.glb`, 17 MB, and its
  `Car.tsx` header repeats the *same* attribution block as the committed 930
  (`author: Karol Miklas … CC-BY-4.0 … uid 8568d9d14a994b9cae59499f0dbed21e`).
  Useful as **independent third-party corroboration** of the 930's provenance;
  rejected as a byte source because it is the same asset, unoptimised. Note its
  `LICENSE` is the GPL-2 `create-r3f-app` template, not the MIT the GitHub API
  reports — another reason the API's `license` field is not trusted here.
- `Krapiva/porsche911`, `edwingeorgeshaji/Porsche-911-Carrera-Webpage`,
  `Ammarrazin/porschewiki`, `matheusfernandes-git/porsche-model` — licence file
  present but **no 3D geometry** in the tree (one is a pricing scraper, one a
  markdown wiki, one a Next.js site with JPGs). Rejected: nothing to ship.

---

## Licence allow-list

Only these three Sketchfab `license.label` values are accepted (exact match, read
verbatim from the API):

| Sketchfab `license.label` | accepted |
|---|---|
| `CC0 Public Domain` | yes |
| `CC Attribution` | yes |
| `CC Attribution-ShareAlike` | yes |
| `CC Attribution-NonCommercial` | **no** |
| `CC Attribution-NonCommercial-ShareAlike` | **no** |

The strict match matters: `"CC Attribution-NonCommercial"` *contains* the string
`"CC Attribution"`, so a loose `includes()` test would silently admit
non-commercial uploads. `fetch-models.ts` **aborts** if a pinned uid ever 404s or
changes to a non-allowed label, so `data/models.json` can never drift into an
unusable embed.

No **CC0** 911 model exists on Sketchfab: across ~190 name-filtered searches,
every allowed-licensed hit was `CC Attribution` or `CC Attribution-ShareAlike`.

---

## Committed local GLBs

### `930-turbo-1975/model.glb`

| | |
|---|---|
| Path | `public/models/930-turbo-1975/model.glb` |
| Size | **2,206,432 bytes** (2.21 MB) — under the 3 MB budget in `docs/CONTRACTS.md` |
| Used for | generation hero `gseries`, variant `gseries/turbo-3.0-930` (and the bare alias `turbo-3.0-930`) |
| Subject | 1975 Porsche 911 Turbo (930), exterior + interior |
| Byte source | <https://github.com/UtkarshPathrabe/Porche-911-930-Turbo-1975-3D-Model> — `LICENSE` re-fetched and asserted on every pipeline run: "MIT License … Permission is hereby granted, free of charge" |
| Repo author | Utkarsh Pathrabe — <https://github.com/UtkarshPathrabe> |
| Car geometry | **VERIFIED** — see below (was "inferred" in the previous run) |
| Car geometry source | Sketchfab uid [`8568d9d14a994b9cae59499f0dbed21e`](https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e) — *"FREE 1975 Porsche 911 (930) Turbo"*, uploader **Lionsharp Studios** (@lionsharp), **CC Attribution** (CC BY 4.0); the export's own attribution block names *Karol Miklas* |
| Triangles / verts | 150,040 triangles · 450,120 render vertices · 14 meshes / 14 materials · 26 WebP images · no animation, no rig |
| Bounding box | 3.12 × 1.87 × 6.23 m (includes the source's floor decal), origin at ground level |

#### Geometry provenance is now VERIFIED, not inferred

The previous run of this file said the geometry attribution was *inferred*
because the optimised scene is named `Sketchfab_Scene` and the repo credits no
3D source. Three independent pieces of evidence now close that gap, and
`fetch-models.ts` re-checks (1) and (2) on **every** run:

1. **`asset.extras` of Sketchfab's own export**, read from the get3dmodels
   mirror with two range requests **and** out of the repo's own `scene.gltf`:
   `"author": "Karol Miklas (https://sketchfab.com/karolmiklas)"`,
   `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`,
   `"source": "…-8568d9d14a994b9cae59499f0dbed21e"`,
   `"title": "FREE 1975 Porsche 911 (930) Turbo"`. (The earlier revision of this
   file quoted the *API* uploader name in this slot; the binary says Karol
   Miklas. Fixed.)
2. **`GET api.sketchfab.com/v3/models/8568d9d14a994b9cae59499f0dbed21e`**
   (no token): uploader **Lionsharp Studios** (@lionsharp), `license.label` =
   **CC Attribution**, `license.url` = <http://creativecommons.org/licenses/by/4.0/>,
   and a description that opens "Please give a credit to Lionsharp Studios for
   the 3D model".
3. **Three independent third-party redistributions** carry Sketchfab's CC BY 4.0
   text for that exact uid: `briankusuma/3D-porche-911`, `yuenkev/911Turbo`, and
   — found on this pass — `jajh90/r3f-porsche`, whose `Car.tsx` header repeats
   the block verbatim (`author: Karol Miklas … CC-BY-4.0 … uid 8568d9d1…`).
   All three name *Karol Miklas* in the boilerplate while the API names
   *Lionsharp Studios* as uploader; the API record for the uid is the authority
   and both names are recorded.

`data/models.json` therefore now states
`license: "CC Attribution 4.0 (car geometry) + MIT (repo scene assembly)"`,
`author: "Lionsharp Studios (car geometry; the Sketchfab export's own attribution
block names Karol Miklas) + Utkarsh Pathrabe (repo)"` — the word *inferred* is
gone because the evidence no longer is.

#### Optimisation chain

All via `npx @gltf-transform/cli@4.5.1`:

```
scene.gltf + scene.bin (8.82 MB) + 27 PNG textures (62.4 MB)   = 74.21 MB
  optimize --compress draco --texture-compress webp                     4,690,588 B   ← over budget
  optimize --compress draco --texture-compress webp --texture-size 1024 2,206,432 B   ← shipped
```

Passes applied: `dedup`, `instance`, `palette`, `flatten`, `join`, `weld`,
`simplify`, `resample`, `prune`, `sparse`, `textureCompress`, `draco`.
26 WebP images, `KHR_materials_clearcoat` (paint) and
`KHR_materials_transmission` (glass).

#### Known cosmetic artefact

The source scene bakes a floor decal reading "1975 PORSCHE 911 turbo" into the
ground texture. Inherited from the upstream asset, not added here; only visible
when framed from above.

---

### `991-carrera-4s/model.glb`

| | |
|---|---|
| Path | `public/models/991-carrera-4s/model.glb` |
| Size | **905,340 bytes** (884 KB) — under the 3 MB budget |
| Used for | variant `991/carrera-4s` |
| Subject | Porsche 911 **Carrera 4S (991)**, coupe, silver, Fuchs-style wheels, yellow calipers |
| Licence | **CC Attribution-ShareAlike 4.0, adapted** |
| Author | **Lionsharp Studios** (Sketchfab uploader @lionsharp, per the API); the export's baked attribution block names *Karol Miklas* — both recorded, see the caveat below |
| Byte source | `https://www.get3dmodels.com/download/free_porsche_911_carrera_4s.glb` — HTTP 200, 21,076,404 B, no auth, no token |
| Credit page | <https://www.get3dmodels.com/vehicles/porsche-911-carrera-4s/> |
| Sketchfab uid | [`d01b254483794de3819786d93e0e1ebf`](https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf) — *"(FREE) Porsche 911 Carrera 4S"*, `license.label` = **CC Attribution-ShareAlike** |
| Triangles | **192,592** · 577,776 render vertices · 126,584 uploaded · 12 meshes / 12 materials · 8 WebP images · no animation, no rig |
| Bounding box | **1.981 × 1.259 × 4.382 m** (x −0.99041…0.99050, y 0…1.25853, z −2.19106…2.19090) — origin on the ground at the centre of the car |

#### Why this is a 911, and which one

The uploader's own text names **no model year** — the description only says
"Model of a Porsche 911 that was a part of a prototype car configurator running
on WebGL". Three checks were used instead, and all three agree:

1. **The source imagery.** The 1920×1080 Sketchfab thumbnail shows a 911 with the
   991 roofline, the 991 C-pillar/shoulder, and the 991's slim horizontal rear
   light — *not* the 992's full-width light bar, and not a 964/993's upright
   lamp. The "Carrera 4S" rocker decal is legible.
2. **Measured dimensions.** 1.98 m wide over the mirrors, 1.26 m tall, 4.38 m
   long. A 991 is 1.852 × 1.303 × 4.491 m; a 964 is 1.736 × 1.280 × 4.250 m.
   Height and length match the 991; width matches once mirrors are included.
3. **Same uploader as the committed 930**, whose generation is not in doubt.

**Residual uncertainty, stated plainly:** 991.1 vs 991.2 facelift is **not**
distinguishable from the side-on source imagery, and the GLB carries no badge
close-up. It is recorded as a 991 `Carrera 4S` and nothing more specific. The
roster's `991/carrera-4s` variant is exactly this car, so the mapping is
1:1.

This is also why the same model stays **off** `964/carrera-4` and
`964/carrera-4s` — the previous run rejected it there for exactly the same
reason it was unusable before (unnameable year), and finding it *is* a 991 makes
it a 964 with certainty no, not with more confidence.

#### Author-name caveat

Sketchfab's own CC attribution block for this uid reads
`"author": "Karol Miklas (https://sketchfab.com/karolmiklas)"`, while
`GET /v3/models/<uid>` reports the uploader as **Lionsharp Studios**
(`@lionsharp`) — the same account that uploaded the 930. The API record is the
authority for "who uploaded it"; the boilerplate is quoted verbatim rather than
silently normalised. Both names are in
`data/models.json` → `variants["991/carrera-4s"].author`.

#### ShareAlike obligation

CC BY-SA 4.0 requires derivatives to carry the same licence. The optimisation
below (stray-mesh removal, pivot move, Draco, WebP) is an adaptation, so this
GLB and any further derivative must stay **CC BY-SA 4.0** with attribution. This
is recorded as `"license": "CC Attribution-ShareAlike 4.0 (adapted)"`.

#### Optimisation chain

```
free_porsche_911_carrera_4s.glb        21,076,404 B   652,660 tris · 45 meshes · 10 PNG
  strip ^Plane / ^Cube meshes             21,075,760 B   (graph edited; orphans pruned later)
  center --pivot below                    21,071,332 B
  optimize --compress draco
          --texture-compress webp
          --texture-size 1024               905,340 B   ← shipped, first try
```

The chain is **byte-reproducible**: re-running it today produced a file with the
same MD5 (`c786e6c9125f826b743f6f787f3294c2`) as the committed one.

`--texture-compress webp` **is** available in gltf-transform 4.5.1, so no
fallback to Draco-only was needed. The result is 4.3 % of the 3 MB budget with
no `--simplify` pass.

**What the strip step removed** (9 nodes, 57,565 triangles): the Sketchfab
showroom `Plane_0` ground quad, a thin `Plane.005_0` strip, and — the reason it
matters — `Plane.002_0`, a 57,549-triangle plane whose stored vertices run to
**±143 m in x and ±285 m in z**. Left in, that single mesh blows the scene
bounding box up to 207 × 172 × 288 m and any automatic framing would show a speck.
The step only detaches nodes from the graph and rewrites the GLB header; no
vertex is touched, and `optimize`'s `prune` pass then deletes the orphaned
meshes and accessors outright.

#### Consumer requirements (for 3D-HERO / VARIANT-PAGES)

`extensionsRequired: ["EXT_texture_webp", "KHR_draco_mesh_compression"]` — the
same as the 930, so both models load through one code path:

- it will **not** load without a Draco decoder. Use
  `useGLTF("/models/991-carrera-4s/model.glb", true)` (drei) or a
  `DRACOLoader` pointed at the self-hosted copy:
  `new DRACOLoader().setDecoderPath("/decoders/draco/")`
  (drei's boolean shortcut uses a **gstatic.com** decoder by default — the
  local decoders at `public/decoders/draco/` exist to avoid that);
- `EXT_texture_webp` needs **WebGL2**. On WebGL1 the whole GLB throws rather than
  degrading;
- `/decoders/basis/` is present for any future KTX2 asset but is **not** used by
  either file (no `KHR_texture_basisu` in either GLB).

---

## Key shape of `data/models.json` (please read before merging)

```jsonc
{
  "updatedAt": "ISO", "verifiedAt": "ISO",
  "generations": { "<genId>": Model3D|null },              // 9 keys
  "variants": {
    "<genId>/<variantId>": Model3D|null,                  // 136 keys — AUTHORITATIVE
    "<variantId>":             Model3D|null               // 78 bare aliases
  },
  "sourceAudit": [{ source, anonymousDownload, probedAt, status, note }]  // 13 entries
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
  the car of the chapter being merged — note that bare `carrera-4s` still resolves
  to the 992.1 embed, **not** to the new 991 GLB, by design. Drop the aliases if
  you only need one form, but keep in mind `Object.keys(variants).length` is then
  214, not 136.

When a local GLB wins, the `embedUrl` is set to `null` on purpose: keeping it
would pair one record's licence with an `<iframe>` of somebody else's model,
which is a false attribution in `/credits`.

---

## Known provenance caveats (recorded, not hidden)

- **Re-uploads.** Several embed winners (`007`, `Mona x Supercars`, `DisneyCars`,
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
  993 = 1995 Carrera · 996 = 996 · 997 = GT3 RS (997.2) · 991 = Carrera S
  (embed — the local 991 GLB is a Carrera **4S** and is deliberately not
  promoted to the chapter hero, which the previous run documented as the
  Carrera S) · 992.1 = Carrera S · 992.2 = Targa 4 GTS (992.2).
- **`991/carrera-4s` is the only variant where a local GLB outranks nothing** —
  the target had no model at all before. It is not used as a fallback for any
  other key, so deleting `public/models/991-carrera-4s/` and re-running simply
  returns that one target to `null`.

---

## Reproducing

```bash
node scripts/fetch-models.ts             # re-verify licences, re-attempt the sweep, rewrite both JSONs
node scripts/fetch-models.ts --refresh   # + print live runners-up per target
node scripts/fetch-models.ts --offline   # no network; keep last verified records
node scripts/fetch-models.ts --no-glb    # skip both GLB build steps
node scripts/fetch-models.ts --no-sweep  # keep the previous sourceAudit untouched
node scripts/fetch-models.ts --rebuild-glb   # force the 74 MB / 21 MB re-download + re-optimise
```

The script is idempotent: two consecutive runs produce byte-identical
`data/models.json` apart from `updatedAt`/`verifiedAt`/`probedAt`. A normal
re-run re-verifies all 44 pinned uids against the live API, re-reads the repo
`LICENSE` and both `asset.extras` licence blocks (2 range requests each),
re-checks that the committed `991` GLB still carries its uid, and re-probes all
18 sources — about 20 seconds. The GLBs are only rebuilt when missing or
`--rebuild-glb` is passed.

**Reproducibility was re-tested on this pass.** `node scripts/fetch-models.ts
--rebuild-glb --no-sweep` re-downloaded all 74 MB of upstream assets plus the
21 MB mirror export, re-ran the whole strip → centre → Draco/WebP chain, and both
outputs came back with the **same MD5 as the committed files**
(`9de1d41b2c563445156996e0d707178e` for the 930,
`c786e6c9125f826b743f6f787f3294c2` for the 991). The licence assertions fired in
the log: `geometry licence ok: 8568d9d14a994b9cae59499f0dbed21e — asset block
"CC-BY-4.0 …", API "CC Attribution", author "Lionsharp Studios
(https://sketchfab.com/lionsharp)"`, and 9 stray showroom meshes stripped from the
991.

> `@gltf-transform/cli` is **not** a project dependency (it is invoked as
> `npx --yes @gltf-transform/cli@4.5.1`, which is why every GLB reports
> `generator: "glTF-Transform v4.5.1"`). A rebuild therefore needs npm registry
> access. Adding it to `devDependencies` is a LEAD decision — `package.json` is
> not mine to touch. `--texture-compress webp` **is** supported in 4.5.1, so the
> full flag set is used and no Draco-only fallback was needed anywhere.

`tsx` is **not** in `package.json` (and must not be added), so the script is
written as Node-native TypeScript and runs on plain `node` via Node's built-in
type stripping (verified on Node 26.7). `npx tsx scripts/fetch-models.ts` also
works without it being a dependency.