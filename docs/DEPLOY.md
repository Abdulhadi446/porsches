# Deploying

Target: **Vercel**, Next.js 16 App Router, built from git. Everything below was
checked against the repository as of 2026-10-03; platform limits are quoted from
Vercel's documentation (links inline) with the date they were read. Anything I
could not verify is labelled **not verified** — do not treat it as fact.

> **Short version:** the default Vercel build does **not** regenerate media. It
> merges the committed manifests, rebuilds the client catalogue and runs
> `next build` — deterministic, a few minutes, no rate-limited network calls. The
> site then serves the committed silhouette placeholder wherever a real render is
> missing. Regenerating ~490 MB of media is a separate, manual job
> (`.github/workflows/assets.yml`), because it is slow, network-bound and
> Wikimedia rate-limits it.

---

## 1. Prerequisites

| | |
|---|---|
| Node | **24.x** — Vercel offers 20.x / 22.x / 24.x and 24 is the default; Node 20 is deprecated from 2026-10-01. Nothing newer than 24 is available on Vercel. |
| Package manager | npm (`package-lock.json` is committed; the install command is `npm ci`) |
| Accounts | A Vercel account and the GitHub repository. No API tokens are needed for the default build. |
| Local Node | 26.x works for everything (native type stripping runs the `.ts` scripts unflagged); CI and Vercel stay on 24 so a green run means the same thing everywhere. |

## 2. Deploy, step by step

1. **Push the repository** to GitHub. `public/images/**` and the media manifests
   in `data/` are what a deploy sees; the render trees are not in git.
2. **Import the project** in the Vercel dashboard (*Add New → Project*), or from
   the CLI:
   ```bash
   npx vercel link
   npx vercel            # preview deployment
   npx vercel --prod     # production deployment
   ```
   The CLI honours `.vercelignore`; the Git integration does not.
3. **Check the project settings** (*Settings → Build and Deployment*):
   * Framework Preset: **Next.js** (also set in `vercel.json`)
   * Node.js Version: **24.x** — set it here. `vercel.json` has no key for it;
     the only other way to pin it is `"engines": { "node": "24.x" }` in
     `package.json`, which is lead-owned.
   * Install Command: `npm ci` (from `vercel.json`)
   * Build Command: `npm run deploy:build:switch` (from `vercel.json`; the
     media switch is explained below)
   * Region: optional. Default `iad1`. For an EU audience pick a single EU
     region (`fra1`) — Hobby allows any single region; multi-region needs Pro.
4. **Environment variables**: none are required. See §4 if you want the build to
   fetch media.
5. **Deploy**, then run the post-deploy checklist in §7.

### What `vercel.json` sets

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm ci",
  "devCommand": "next dev --port $PORT",
  "buildCommand": "npm run deploy:build:switch",
  "headers": [
    {
      "source": "/turntables/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" }
      ]
    }
  ]
}
```

* `buildCommand` is one boring `npm run`, which is exactly the shape of Vercel's own
  default for Next.js ("Vercel checks for the `build` command in `scripts` and uses
  this"). The conditional lives in the npm script, not in `vercel.json`, because npm
  always runs a script through a shell while the shell semantics of a raw
  `buildCommand` string are not something to bet a deploy on:
  * `npm run deploy:build` (the default) =
    `node scripts/merge-assets.ts && node scripts/build-client-catalog.ts && next build`
    — the same two steps as the existing `prebuild` hook, written out so the deploy
    does not depend on npm lifecycle behaviour.
  * `npm run deploy:build:assets` (`P911_FETCH_ASSETS=1`) =
    `node scripts/fetch-images.ts --all && node scripts/convert-images.ts && node scripts/fetch-turntables.ts --all && node scripts/merge-assets.ts && node scripts/build-client-catalog.ts && next build`
    — every flag here was read out of the scripts' own argument parsing
    (`fetch-images.ts --all`, `fetch-turntables.ts --all`, no flags for
    `convert-images.ts`).
  * `npm run deploy:build:switch` is
    `if [ "${P911_FETCH_ASSETS:-0}" = "1" ]; then npm run deploy:build:assets; else npm run deploy:build; fi`.
  * Reproduce a deploy build locally with `npm run deploy:build:switch`, or with
    `P911_FETCH_ASSETS=1 npm run deploy:build:switch`.
* `devCommand` only affects `vercel dev`. It passes `$PORT`, which Vercel's docs
  require of a custom dev command. Local development uses `npm run dev` instead.
* The `headers` rule covers `/turntables/*`, which `next.config.ts` does not
  cover (it only sets long caching for `/models/*` and `/images/*`). Frame URLs
  are not content-hashed — a regenerated sequence keeps its filenames — so a one
  day TTL with a week of `stale-while-revalidate` is the honest trade-off.
  Every header/rewrite in `vercel.json` counts towards Vercel's 2048-routes-per-
  deployment limit; one rule is not a concern.

### `.vercelignore`

Vercel's documented source-upload limit is **100 MB on Hobby / 1 GB on Pro**
(vercel.com/docs/limits). This working tree holds ~409 MB of renders plus ~81 MB
of turntable frames, so a CLI deploy without `.vercelignore` fails before the
build starts. `.vercelignore` therefore excludes `public/images/*` (re-including
`public/images/_placeholder`, the committed SVG that `lib/assets.ts` falls back
to) and `public/turntables`, plus build noise. Syntax follows `.gitignore`,
negation included. If `/images/_placeholder/911-silhouette.svg` ever 404s in
production, that negation is the first thing to delete.

Note: `.vercelignore` only affects CLI uploads. A Git-integrated deploy uploads
whatever the repository contains — see the `.gitignore` warning in §10.

## 3. Why media generation is off by default

`P911_FETCH_ASSETS=1` works and is documented, but it should not be the default:

1. **The build is capped at 45 minutes.** Vercel interrupts the build step and
   fails the deployment at 45 minutes on every plan (vercel.com/docs/limits,
   read 2026-10-03). The turntable pipeline alone paces itself at a 1500 ms floor
   between API calls by default (`P911_GAP_MS`) across 161 variant targets, plus
   image download and sharp conversion of ~2,700 AVIF renders. *(Estimated, not
   measured: this is the single biggest reason not to do it.)*
2. **The API rate-limits us.** `api.wikimedia.org` answers bursts with
   `429` + `Retry-After`; this project has already tripped that once. A build
   that dies at minute 38 wastes a deployment (100/day on Hobby) and hammers a
   public API from a cloud provider's address range.
3. **Every deploy would re-upload ~490 MB.** Renders and frames are large,
   already-compressed, and change a few times a month at most.
4. **Reproducibility.** The committed tree must be enough to produce a working
   site. `merge-assets` and `build-client-catalog` are deterministic and read
   only from `data/`; the fetch scripts are neither.
5. **The site already degrades honestly.** `lib/assets.ts` returns the committed
   placeholder instead of throwing rather than failing a page, and CI is built to
   prove that a media-less build still prerenders every route and passes the
   smoke crawl (§7 lists the post-deploy checklist).

The one caveat: `next/font/google` in `app/layout.tsx` fetches Anton, Inter and
JetBrains Mono from Google's servers **during the build**. So the "default build"
is not fully network-free — it needs egress to `fonts.googleapis.com`. If a build
environment blocks that, the fonts have to be self-hosted (lead-owned file). The
media fetch to Wikimedia is the only rate-limited, multi-hundred-request part.

### If you want real media in production

Two options:

* **Serve the media from Cloudflare R2 — the implemented, recommended path.**
  Upload the two trees with `npm run assets:upload-r2` and set
  `NEXT_PUBLIC_MEDIA_HOST` on the project. Full steps, caching and the fallback
  behaviour are in §10a. The media is versioned by the bucket, not by the build,
  so the Vercel build stays fast and offline and there is no 45-minute risk.
* **`P911_FETCH_ASSETS=1` for a one-off deploy.** Set it on the project (or as a
  build-step-only variable), deploy, then remove it so later deploys stay cheap.
  Accept the 45-minute risk. This fetches from Wikimedia inside the build, which
  is the slow, rate-limited path — prefer R2 unless you specifically want the
  build to own media generation.

## 4. Environment variables

None are secrets; none are required.

| Variable | Where | Default | Effect |
|---|---|---|---|
| `P911_FETCH_ASSETS` | build step | unset | `1` runs the full media pipeline inside the build (§3) |
| `P911_WORK_DIR` | scripts | `/tmp/opencode/p911` | resumable API cache + raw Commons downloads |
| `P911_CONCURRENCY` | `fetch-images` / `fetch-turntables` | `4` / `3` | parallel requests |
| `P911_GAP_MS` (alias `P911_MIN_GAP_MS`) | `fetch-images` / `fetch-turntables` | `350` / `1500` | minimum gap between API calls |
| `P911_DOWNLOAD_GAP_MS` | `fetch-turntables` | `120` | gap between file downloads |
| `P911_CONVERT_CONCURRENCY` | `convert-images` | `3` | parallel sharp jobs |
| `P911_TT_WIDTH` | `fetch-turntables` | `640` | turntable frame long edge |
| `P911_DEBUG` | `fetch-turntables` | unset | `1` traces every candidate title and rejection |
| `P911_VERIFY_QUIET` | `convert-images --verify` | unset | `1` prints the summary only |
| `NEXT_PUBLIC_MEDIA_HOST` | Vercel build | unset | R2 custom-domain origin (e.g. `https://media.example.com`); rewrites `/images/**` and `/turntables/**` (§10a) |
| `R2_ACCOUNT_ID` | `assets:upload-r2` | unset | R2 account id, for the S3-compatible upload |
| `R2_ACCESS_KEY_ID` | `assets:upload-r2` | unset | R2 API token key id |
| `R2_SECRET_ACCESS_KEY` | `assets:upload-r2` | unset | R2 API token secret |
| `R2_BUCKET` | `assets:upload-r2` | unset | target bucket name |
| `NEXT_TELEMETRY_DISABLED` | anywhere | unset | `1` silences Next telemetry |

A Sketchfab API token is only needed for `npm run assets:models`
(`scripts/fetch-models.ts`), which is not part of any deploy. Without a token the
app uses Sketchfab embeds, which is the intended state. The R2 credentials are
only needed to re-upload media (§10a); they are never present at build time and
never ship to the browser — only `NEXT_PUBLIC_MEDIA_HOST` is inlined.

## 5. What the build costs

Measured on the development box (8 cores, 7 GB RAM, Node 26.7, 2026-10-03):

| Step | Time |
|---|---|
| `node scripts/merge-assets.ts --check` | < 1 s — reports `9 generations, 161 variants`, `840 total` credits, `missing media: none` |
| `node scripts/build-client-catalog.ts` | ~1 s (163 kB artefact) |
| `npx tsc --noEmit` | 24 s cold, seconds warm (incremental) |
| `npx eslint .` | 30 s |
| `npm run deploy:check` (all three) | 33 s |
| CI stub generation (700 AVIFs via sharp) | < 1 s, 341 bytes each — the workflow's script was extracted and run against a copy of `data/images.json` to confirm it writes 700 decodable files and is idempotent |

Not measured, and therefore estimates only:

| Step | Expectation |
|---|---|
| `npx next build` (179 static pages) | A few minutes on 8 cores / 7 GB; STATUS.md §2 records a clean build of all 179 pages on this box but no wall-clock. Vercel's build machine specs are **not verified** here (see vercel.com/docs/builds/managing-builds#build-machine-types). If a build OOMs, set `NODE_OPTIONS=--max-old-space-size=4096`. |
| `fetch-images.ts --all` + `convert-images.ts` | ~10 min for fetch and convert together (STATUS.md §5), not split out; unmeasured |
| `fetch-turntables.ts --all` | Unmeasured, the longest step; ~81 MB of frames |
| `node scripts/smoke.mjs <url>` | 177 routes through headless Chromium with the image optimiser; unmeasured |

The default Vercel build therefore does only `merge-assets` + `build-client-catalog`
+ `next build`: no Wikimedia traffic, no 490 MB of uploads.

## 6. CI (`.github/workflows/ci.yml`)

On every push to `main`, every PR and on demand:

1. `npm ci`
2. `node scripts/merge-assets.ts --check`, and the job fails unless the log
   contains `missing media: none` — i.e. `data/generations/*.json` is in sync
   with `data/images.json`, `data/models.json`, `data/videos.json` and
   `data/turntables.json`
3. `npx tsc --noEmit`
4. `npx eslint .`
5. `node scripts/test-licence-parse.mjs`
6. **stub render generation** — the render trees are generated and absent from a
   clean checkout, so CI synthesises a 341-byte AVIF at every path in
   `data/images.json` (700 files, ~240 kB). Nothing is fetched: the optimiser, the layout, the credits page and
   the smoke crawl all exercise real image URLs, and the result is byte-for-byte
   as reproducible as the rest of the build. Without this step the crawl fails on
   every eagerly-loaded hero image.
7. `npx next build` — deliberately *not* `npm run build`: no `prebuild` hook runs,
   so this proves the committed data is sufficient to build.
8. `npx next start --port 3111` + `node scripts/smoke.mjs http://localhost:3111`

Two things CI deliberately cannot catch, both noted in the README:

* `data/client-catalog.json` carries a `generatedAt` stamp, so "is it stale?" is
  not a diff CI can make. Run `npm run catalog` after touching
  `data/generations/*.json`.
* A real-media run. `.github/workflows/assets.yml` (`workflow_dispatch`, plus a
  weekly cron) fetches, converts, merges, verifies every referenced render with
  `convert-images.ts --verify`, builds, runs the same smoke crawl against the real
  files and uploads the result as a 14-day artifact. It never commits and never
  deploys.

## 7. Post-deploy smoke checklist

Run from the repository root (the script reads `data/generations/` with a relative
path). It needs Playwright's Chromium: `npx playwright install chromium`.

```bash
node scripts/smoke.mjs https://<your-domain>
```

It crawls all 177 routes and fails on any non-200, console error, page error,
same-origin 4xx response or broken image. Then:

- [ ] `node scripts/smoke.mjs https://<your-domain>` → `SMOKE OK`
- [ ] `curl -sI https://<your-domain>/` and `/credits`, one `/911/<gen>` and one
      `/911/<gen>/<variant>` → `200`
- [ ] `curl -sI https://<your-domain>/images/_placeholder/911-silhouette.svg` → `200`
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "https://<your-domain>/_next/image?url=%2Fimages%2F901%2Fimg-porsche-901-prototype-at-pebble-beach-concours-2023-b01f8f66-1920.avif&w=1280&q=75"`
      → `200` when media is deployed, `400`/`404` when it is not (expected, not a
      defect — see §8)
- [ ] `curl -sI https://<your-domain>/models/930-turbo-1975/model.glb` → `200` and
      `/models/991-carrera-4s/model.glb` → `200` (both GLBs are committed, so they
      must always be present)
- [ ] Build log: Node 24.x, framework `nextjs`, 179 prerendered routes
- [ ] Deployment → Resources → Static Assets: the size matches the intent
      (~490 MB with media, a few MB without)
- [ ] `/credits` lists 840 records and the licence strings look right
- [ ] Lighthouse / Web Vitals are not expected to regress — `/` LCP was measured
      at 1.13 s and the other key routes at 0.92–1.73 s (STATUS.md §2)

## 8. When something looks wrong

| Symptom | Cause / fix |
|---|---|
| `Build step did not complete within the maximum of 45 minutes` | Media generation is in the build. Unset `P911_FETCH_ASSETS`. |
| `DeploymentError: File size limit exceeded (100 MB)` | Media was uploaded as source. The `.vercelignore` rules are not matching, or you deployed with the Git integration from a branch that carries `public/turntables` (see §10). |
| Placeholder silhouettes everywhere | Expected without media. To ship media, read §3. |
| `/_next/image` returns `400` and the body mentions `q` | The requested quality is not in `images.qualities`. `next.config.ts` declares `[70, 75, 82, 90]`; a component asking for anything else is the bug (this is perf.md P0-B). |
| `/_next/image` returns `400`/`500` with a missing source | The `src` in the data has no file behind it — either media was never generated or `--verify` was skipped. |
| `/_next/image` 500 with a sharp load error | Next.js installs sharp automatically on Vercel, so a `devDependencies` sharp is normally fine; there is at least one report of sharp 0.35.3 failing to load on a Vercel Next.js 16 server (<https://github.com/lovell/sharp/issues/4567>). `NEXT_SHARP_PATH` or a different sharp version is the escape hatch. **Not verified here.** |
| Three 404s for `/turntables/<gen>__<variant>/frame-0NN.webp` past the end of a sequence | By design: `components/variant/turntable-3d.tsx` probes sequentially and stops after three misses. Harmless. |
| Turntable frames 404 during the crawl in CI | The probe only runs when the section scrolls into view; CI stubs images but not frames. If it ever fires, the crawl reports 3 × 404 per turntable variant. |

## 9. Cloudflare Pages / Workers

**Not viable as a drop-in, and not verified.** Stated plainly rather than
hedged:

* There is no supported "Next.js on Pages" path any more. Cloudflare's own docs
  now point at `vinext` for new apps and `@opennextjs/cloudflare` for existing
  OpenNext apps (developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/,
  read 2026-10-03). The OpenNext docs state all minor/patch versions of Next.js 16
  are supported.
* Three concrete blockers, all outside this repository's ownership: (1) an
  adapter plus a `wrangler.jsonc`/`open-next.config.ts` and new dev dependencies;
  (2) image optimisation — the current `next.config.ts` relies on the built-in
  Next optimiser, and Cloudflare requires either a Cloudflare Images binding or a
  custom `loaderFile`, which changes how `qualities`, `dangerouslyAllowSVG` and
   `remotePatterns` behave; (3) Worker runtime memory is 128 MB per request
  (Workers limits page, 2026-10-03) against Vercel's much larger function memory
   — 179 of 182 routes are prerendered so most traffic would be static assets, but
   `/compare`, `/search` and `/variants` are dynamic and **whether they fit in
  128 MB is not verified**.
* The size limits are not the problem: Workers static assets allow 20,000 files
  (Free) / 100,000 (Paid) with a 25 MiB per-file cap, and the two media trees are
  ~5,700 files of individually small AVIF/WebP. Pages builds time out after 20
  minutes, which on its own rules Pages out for a build of this size.

Recommendation: Vercel is the supported target; treat Cloudflare as a possible
R2 host for the media (§3), not as the app host.

## 10. What ships in git vs. what a deploy generates

As of 2026-10-10 the split is clean, so a Git-integrated deploy is predictable:

| Path | In git? | On a fresh deploy |
|---|---|---|
| `public/models/**` (39 GLBs, ~38 MB) | **yes** — versioned so a deploy never depends on the rate-limited Sketchfab fetch | real 3D everywhere the manifest marks `verified` |
| `public/sounds/*.ogg` (2 engine recordings, ~480 KB) | **yes** | engine-start sound works |
| `public/decoders/**` (Draco/Basis WASM) | **yes** | GLB decoding works |
| `public/images/**` (~416 MB renders) | **no** — gitignored, regenerated by `assets:images`, uploaded to **R2** (§10a) | real images, served from the R2 custom domain |
| `public/turntables/**` (~81 MB frames) | **no** — gitignored, regenerated by `assets:turntables`, uploaded to **R2** (§10a) | real turntables, served from the R2 custom domain |

`.vercelignore` additionally excludes `public/images/*` (re-including
`_placeholder`) and `public/turntables` from a **CLI** upload so it stays under
Vercel's 100 MB source limit. A **Git-integrated** deploy uploads only what is
tracked, and neither media tree is tracked — so it is also under the limit by
construction. Real images and turntables come from R2 (§10a); the older
`P911_FETCH_ASSETS=1` in-build fetch (§3) still works but is the slower, rate-
limited path.

## 10a. Serving media from Cloudflare R2

The two big media trees are too large to ship in git (~485 MB across 5 595
files), so they live in a **public R2 bucket** behind a custom domain, and the
site rewrites `/images/**` and `/turntables/**` to that origin at runtime.
Models, sounds and the decoders stay committed — R2 only carries the two
generated trees.

**One-time setup**

1. Create a bucket (Cloudflare dashboard → R2 → Create bucket). Public access is
   fine: every file is CC-licensed and attributed on `/credits`.
2. Attach a **custom domain** to the bucket (e.g. `media.example.com`). This is
   the origin the site will use; it is HTTPS and cached by Cloudflare's edge.
3. Create an **R2 API token** (Account → R2 → API tokens) with object read+write
   on that bucket. It exposes three values used below.

**Upload the media**

```bash
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
  npm run assets:upload-r2            # both trees
# preview first, no writes:
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
  node scripts/upload-r2.ts --dry-run
```

The script (`scripts/upload-r2.ts`) PUTs over R2's S3-compatible API with SigV4
signed by hand — no AWS SDK, no new dependency. It **never deletes** (except the
explicit `--delete-only <keys>` mode), skips unchanged files (same size, via a
signed HEAD) unless `--force`, and always skips `public/images/_placeholder/**`
so the committed local fallback stays a deploy fallback rather than a bucket
object. It loads the `R2_*` vars from `.env` when present, retries transient
network errors (`ETIMEDOUT`/`ENETUNREACH`/`ECONNRESET`) with a small concurrency
pool, and reports per-file progress. Re-running after a partial upload is safe.

**Bucket shape (the gotcha that breaks the first URL attempt).** The object keys
mirror the on-disk layout under `public/`, so they are `public/images/…` and
`public/turntables/…`. The custom domain serves keys **without** the bucket
prefix: `https://<domain>/public/images/…` returns 200, while
`https://<domain>/<bucket>/public/images…` returns 404. `mediaSrc()` in
`lib/assets.ts` already inserts the `/public` segment, so the two must stay in
lockstep — if you ever change the key layout, change `mediaSrc()` too.

**Working reference values (this project).** account id
`3849f17a9bbe8ad4f0af846f269c30a9`, bucket `porsches`, custom domain
`content.thetrillioniar.me`, public dev URL
`https://pub-6fdfd945b83248eaa377046c982aab48.r2.dev`. The last upload wrote
5 595 objects (484.7 MB) with 1 skipped (the placeholder) and 0 failed.

**Point the site at the bucket**

Set `NEXT_PUBLIC_MEDIA_HOST=https://media.example.com` on the Vercel project
(build-time). `mediaSrc()` in `lib/assets.ts` rewrites the two prefixes, and
`next.config.ts` derives the matching `images.remotePatterns` entry from the
same variable so the two cannot disagree. Left unset (a plain clone, or a
deploy that never uploaded media) the paths are returned unchanged and the site
keeps serving the committed placeholder — so the env var is a pure upgrade, and
the placeholder path is never rewritten to R2.

**Caching.** `/images/*` are content-stable per render set and get
`max-age=31536000, immutable`; `/turntables/*` get `max-age=86400,
stale-while-revalidate=604800` because a regenerated sequence reuses filenames.
Turntable frames render through `SafeImage` with `plain` (already-final 640px
AVIF), so they bypass the Next optimizer and are fetched straight from R2.

## 11. Open items the lead owns

These turned up while wiring the deploy and are **not** fixed here:

1. **Turntable credits are not rendered.** `data/turntable-credits.json` (210
   records) is written by `scripts/fetch-turntables.ts` and read by nothing; the
   `/credits` page renders the records in `data/credits.json` only. Frames are
   re-renders of Commons files, so their authors and licences should appear on
   `/credits` (`merge-assets.ts` + `app/credits/page.tsx`, both lead-owned).
2. **`991/turbo-gt` has no hero image / gallery.** `merge-assets.ts` reports
   `missing media (2)` for it. It is an honest content gap, not a build failure:
   the car has no reachable primary Porsche source, and the one licensed Commons
   photo (MB-one, CC BY-SA) is not yet verified as a 991.2. Until it is verified,
   `data/images.json` must not be keyed to a 992 Turbo photo.
3. **Pinning the Node version in the repo** (`engines` in `package.json` or an
   `.nvmrc`) would make CI, Vercel and local runs agree without a dashboard
   setting. Both paths are lead-owned.
4. **Consider moving `sharp` to `dependencies`.** Next.js installs sharp
   automatically on Vercel, so `devDependencies` should be fine — but that is a
   documented courtesy, not a guarantee for this project shape.

## 12. What I could not verify

Stated plainly so nobody mistakes an estimate for a measurement:

* **No Vercel deployment was performed.** `vercel.json` uses only documented
  properties (`framework`, `installCommand`, `devCommand`, `buildCommand`,
  `headers`) and every npm script it invokes was run locally, but the first real
  deploy has not happened.
* **`npx next build` was run locally** with `NEXT_PUBLIC_MEDIA_HOST` set (it
  completes, writes a fresh `BUILD_ID`, and the prerendered HTML carries the
  R2 custom-domain rewrite), and the 179-route smoke crawl passed against that
  build — so the build wall-clock and the R2 image path are measured. Whether a
  Vercel build container OOMs is still unmeasured (§5 lists what was measured).
* **The CI workflows have never executed end to end.** Both files parse as YAML
  and every command in them was run locally where it does not need a build
  (`merge-assets --check`, `tsc`, `eslint`, the licence test, the stub generator,
  and `npm run deploy:check`). The `next build` → `next start` → `smoke.mjs`
  sequence has not been run against a fresh checkout, so the stubs' effect on the
  crawl is reasoned, not observed: without them every eagerly-loaded hero image
  would request a path that does not exist, and `scripts/smoke.mjs` records any
  same-origin response ≥ 400 plus any image with `naturalWidth === 0` as a failure.
  First run may need one iteration.
* **`.vercelignore` negation** (`!public/images/_placeholder`) follows documented
  `.gitignore`-style semantics but has not been exercised against a real upload.
  If the placeholder SVG 404s in production, delete that one line.
* **Vercel build-machine resources, CDN upload behaviour for ~490 MB of build
  output, and the exact upload path for `public/` files** were not researched in
  depth. What is verified is the 45-minute build cap, the 100 MB / 1 GB source
  upload limit, the 15,000-file CLI source limit and the 2,048-routes-per-
  deployment limit (vercel.com/docs/limits, read 2026-10-03).
* **Cloudflare specifics** in §9 are read from Cloudflare's and OpenNext's
  documentation, not from a deployment.
