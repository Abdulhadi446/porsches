# Porsche 911 Showcase

An unofficial, non-commercial fan showcase of every Porsche 911 generation — nine
chapters from the 901 prototype to the 992.2 T-Hybrid era, 161 fully spec'd
variants, 179 prerendered routes, a WebGL hero, a scroll-driven timeline, image
sequences, 3D and a credits page that names every author and licence.

> **Unofficial fan project.** Not affiliated with, endorsed by, sponsored by or
> connected to Dr. Ing. h.c. F. Porsche AG or Porsche North America. "Porsche",
> "911", "Carrera", "Turbo", "GT3" and every badge and logo are trademarks of
> Porsche AG and are used here only to identify the cars being documented. No
> Porsche imagery, typeface or marks are reproduced in the site's own design; the
> site is not affiliated with any Porsche press kit. If you are Porsche AG and
> want something changed, open an issue.

## Stack

| Layer       | Choice                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework   | Next.js 16 (App Router, React 19, TypeScript strict)                                                              |
| Build       | `next build` (Turbopack is Next 16's default bundler; `--webpack` still available), 179 static + 3 dynamic routes |
| Styling     | Tailwind CSS v4 (`@tailwindcss/postcss`), CSS custom-property design tokens                                       |
| 3D          | three.js 0.186 · @react-three/fiber · drei · postprocessing (Bloom, DoF, vignette)                                |
| Animation   | GSAP + ScrollTrigger, Lenis smooth scroll, framer-motion (route-local only)                                       |
| Images      | `next/image` over pre-converted AVIF/WebP produced locally by sharp                                               |
| Data        | JSON in `data/`, validated by `data/schema.ts`; slim client catalogue built at build time                         |
| Media       | Cloudflare R2 (public bucket + custom domain) serves the two render trees; committed models/sounds stay local     |
| Type/format | TypeScript 6 (`strict`), ESLint 9 + `eslint-config-next`                                                          |
| CI          | GitHub Actions (`.github/workflows/ci.yml`)                                                                       |
| Run mode    | Local Next.js server                                                                                              |

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

The site builds and runs with **no media at all**: the two render trees
(`public/images/**` ~409 MB, `public/turntables/**` ~81 MB) are generated
artefacts, not source, so a fresh clone renders the committed silhouette
placeholder (`/public/images/_placeholder/911-silhouette.svg`) wherever a real
render is missing. Nothing throws and no route 500s — that is by design, not a
bug. (As of this commit `.gitignore` covers `public/images/**/*` but **not**
`public/turntables/**`; see [docs/DEPLOY.md](docs/DEPLOY.md) §10.)

```bash
npm run check          # merge-assets --check + tsc --noEmit + eslint
npm run build && npm start
node scripts/smoke.mjs http://localhost:3111   # 177-route crawl, needs Playwright chromium
node scripts/test-licence-parse.mjs             # licence parser regression test
```

Node 24 LTS is used by CI. The scripts also run unflagged on Node 26 via native
type stripping, which is what the development machine uses.

## Regenerating the assets

The fetch scripts talk to the **Wikimedia REST API** (`api.wikimedia.org`). The
Commons Action API host (`commons.wikimedia.org`) is blocked from some networks,
including the machine this was built on, and must not be used. The API is
rate-limited and answers bursts with `429` + `Retry-After`; every loop already
paces itself (`P911_CONCURRENCY`, `P911_GAP_MS`, retry with backoff) — do not
"optimise" the pacing away.

```bash
npm run ci:assets                       # the whole pipeline below in one command
npm run assets:images                   # fetch-images --all + convert-images (700 Commons files)
node scripts/convert-images.ts --verify # every referenced render exists on disk
node scripts/fetch-turntables.ts --all  # 103 image sequences (81 MB)
npm run merge:assets                    # fold the manifests into data/generations/*.json
npm run catalog                         # rebuild the slim client catalogue
```

`npm run ci:assets` is fetch → convert → turntables → merge → catalogue, without
`next build`. Roughly 10 min for the images and considerably longer for the
turntables, all of it network-bound. Useful knobs: `P911_WORK_DIR` (resumable API
cache + raw downloads, default `/tmp/opencode/p911`), `P911_CONCURRENCY`,
`P911_GAP_MS`, `P911_DOWNLOAD_GAP_MS`, `P911_TT_WIDTH`, `P911_DEBUG=1` (trace
every rejected candidate title). `.github/workflows/assets.yml` runs the same
pipeline on demand (or weekly) and uploads the result as an artifact — it never
commits and never deploys.

`data/generations/*.json`, `data/client-catalog.json` and `data/credits.json` **are**
committed; the render trees are not. Anything that writes into `data/` has to be
committed for a deploy to see it.

## Serving media from Cloudflare R2

The two render trees are too large for git (~485 MB across 5 595 files), so they
live in a **public R2 bucket** behind a custom domain. `mediaSrc()` in
`lib/assets.ts` rewrites `/images/**` and `/turntables/**` to that origin at
build time via `NEXT_PUBLIC_MEDIA_HOST`; `next.config.ts` derives the matching
`images.remotePatterns` entry from the same variable so the two cannot disagree.
Models, sounds and the Draco/Basis decoders stay committed — R2 only carries the
two generated trees.

```bash
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
  npm run assets:upload-r2            # both trees (loads .env when present)
node scripts/upload-r2.ts --dry-run   # preview, no writes
```

Set `NEXT_PUBLIC_MEDIA_HOST=https://content.thetrillioniar.me` on the Vercel
project (build-time). Left unset, the paths are returned unchanged and the site
serves the committed silhouette placeholder — the env var is a pure upgrade.

**CORS is required, not optional.** R2 only returns `Access-Control-Allow-Origin`
when the bucket has a CORS policy allowing the site's origins. Without it the
browser blocks every image: turntable frames render as raw `<img>` straight from
R2, and the Next optimizer path crawls or times out on Vercel. Paste this into
Cloudflare → R2 → bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://content.thetrillioniar.me",
      "https://porsches.vercel.app",
      "https://*.vercel.app",
      "http://localhost:3000",
      "http://localhost:3111"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag", "Cache-Control"],
    "MaxAgeSeconds": 86400
  }
]
```

Verify with `curl -H "Origin: https://porsches.vercel.app" -I <asset-url>` — the
response must include `access-control-allow-origin`. Object keys mirror the
on-disk `public/` layout, so the custom domain serves keys **without** the bucket
prefix: `https://<domain>/public/images/…` is a 200, `https://<domain>/<bucket>/public/…`
is a 404. Full walkthrough, reference values and troubleshooting are in
[docs/DEPLOY.md](docs/DEPLOY.md) §10a.

## Licence and attribution

- **Images — Wikimedia Commons only.** 700 files, each licence read from that
  file's own licence template and recorded with its author: 366 × CC BY-SA 4.0,
  121 × CC BY 2.0, 113 × CC BY-SA 2.0, 38 × CC0, 36 × CC BY-SA 3.0, 17 × CC BY 4.0,
  7 × CC BY 3.0, 2 × public domain. Nothing is hotlinked; originals are
  downloaded and re-rendered locally. CC BY-SA renders inherit share-alike.
- **Turntable frames — Wikimedia Commons only.** 210 credit records in
  `data/turntable-credits.json`. Three sources whose licence could not be
  positively verified were deleted along with their frames. The frames are served
  from R2 (see above), not hotlinked.
- **3D** — Sketchfab **embeds** (streamed from Sketchfab, never rehosted) plus two
  local GLBs under the 3 MB budget, both with recorded authorship. Sketchfab's
  download API is OAuth-gated, so an embed is the only token-free route.
- **Video** — YouTube embeds only, never downloaded, every id verified live
  through oEmbed.
- **Porsche Newsroom is never used for imagery.** Its terms restrict content to
  journalists' own reporting and forbid passing images to third parties, so it is
  cited as a text source only.
- **Fonts** — Anton, Inter and JetBrains Mono via `next/font/google`, self-hosted
  at build time (SIL Open Font License 1.1).
- **No analytics, no cookies, no tracking, no ads.**

Every record is rendered on [`/credits`](app/credits/page.tsx) — 840 entries
(700 images, 46 models, 94 videos). Turntable frame credits live in
`data/turntable-credits.json` (210 records) and are **not** currently rendered on
`/credits`; that is a lead-owned follow-up, written up in
[docs/DEPLOY.md](docs/DEPLOY.md) §10.

Where a photo is a stand-in (no licensed Commons photo of that exact trim) the
alt text says so, and where no multi-angle photography of one car exists the
turntable is a disclosed parallax pan of a single photograph — flagged
`turntableSynthetic` in the data and labelled in the viewer.

## Documentation

| Doc                                    | What is in it                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| [TODO.md](TODO.md)                     | **What is left to do**, measured and prioritised (P0 integrity → P3 deploy gaps)       |
| [docs/STATUS.md](docs/STATUS.md)       | What is built, what was verified, known gaps and placeholders, deliberate omissions    |
| [docs/research.md](docs/research.md)   | Sourcing and licence research per generation and per provider; environment constraints |
| [docs/perf.md](docs/perf.md)           | Performance and accessibility audit, measured numbers, open proposals                  |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | File-ownership map and the data interchange contracts                                  |
| `/credits`                             | Runtime credits page — every image, model and video with author and licence            |
