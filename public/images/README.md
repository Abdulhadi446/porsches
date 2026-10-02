# `public/images` — Porsche 911 showcase image library

Every image in this folder is a **locally re-encoded derivative** of a file that
lives on [Wikimedia Commons](https://commons.wikimedia.org/). Nothing here is
hotlinked at runtime, and no press/agency photography is included.

Regenerate with (no extra dependency — Node ≥ 22.18 strips the TypeScript types,
so the scripts run as-is; `node --experimental-strip-types` also works):

```bash
node scripts/fetch-images.ts --all         # search + licence check + download
node scripts/convert-images.ts             # sharp → AVIF/WebP + blur placeholders
node scripts/convert-images.ts --verify    # exists/missing report for data/images.json
node scripts/convert-images.ts --prune     # delete renders no ImageRef points at
node scripts/fetch-images.ts --gen 997 --dry-run   # title matching, no writes
```

Both scripts are resumable: API answers are cached and the downloaded originals
are kept outside the repo (`$P911_WORK_DIR`, default `/tmp/opencode/p911`), so
re-runs only do the missing work. Useful env vars: `P911_CONCURRENCY`,
`P911_GAP_MS` (politeness gap, lower only when every response is already
cached), `P911_DEBUG=<variantId>` (prints why each candidate title was
rejected), `P911_CONVERT_CONCURRENCY`.

## Layout

```
public/images/
  <genId>/<assetId>-<width>.avif|.webp   generation hero + timeline image
  <variantId>/<assetId>-<width>.avif|.webp variant hero + gallery
  _placeholder/911-silhouette.svg          lead-authored fallback (not ours)
```

* `<genId>` is one of `901`, `gseries`, `964`, `993`, `996`, `997`, `991`,
  `992-1`, `992-2`; `<variantId>` is the id used in `data/roster.json` /
  `data/generations/*.json`.
* `<assetId>` is `img-<slug-of-the-commons-filename>-<8 hex chars>` and is stable
  for a given Commons file (`assetId` is also the key in `data/credits.json`).
* Renders per image: **AVIF** at 640 / 1280 / 1920 (quality 62, effort 2) and
  **WebP** at 1280 (quality 72). Widths larger than the Commons source are never
  produced — that is why a small original only yields e.g. `-640.avif`.
* `ImageRef.src` always points at the **largest** AVIF that exists for that image.
  The sibling files follow the same naming scheme, so a `srcSet` can be derived
  from `src` if the UI ever wants one:
  `src.replace(/-\d+\.avif$/, "-640.avif")` etc.
* `ImageRef.blurDataURL` is a 16px-wide WebP data URL generated from the same
  source, for `next/image` placeholders and CSS background blurs.
* One Commons file is stored once, in the directory of the first entry that uses
  it. Other entries reference the same `src` — see *stand-ins* below.

## Licence rules

* **Source**: Wikimedia Commons only, fetched through `api.wikimedia.org`
  (the `commons.wikimedia.org` Action API is unreachable from the build machine,
  so licences are parsed from the rendered file page instead of `extmetadata`).
* **Accepted**: CC0, public domain / Public Domain Mark, CC BY and CC BY-SA
  2.0 / 3.0 / 4.0. Everything else — non-free, "fair use", CC BY-NC, CC BY-ND,
  an unidentifiable licence, a file that is not a raster image — is rejected and
  never downloaded.
* The exact licence sentence and the `Author` field come from the Commons file
  page HTML. Nothing is guessed; if the parse is ambiguous the file is skipped.
* One `data/credits.json` entry per **distinct** Commons file, with `url` = the
  canonical `commons.wikimedia.org/wiki/File:…` page, `license`, `author`,
  `retrieved`, `sourceId` (the `File:` title) and `localPath`.
* Porsche Newsroom images are **not** used — their terms forbid redistribution.
  Newsroom is cited as a text source only (see `sources[]` in the data files).
* No image is fetched from any host other than `api.wikimedia.org`,
  `upload.wikimedia.org` and `thumb.wikimedia.org`.

## Stand-ins (honest reuse)

Commons does not have a licensed photograph of every one of the 160+ catalogue
variants. When a variant has no photo of its own car:

1. a **family** photo of the same generation is used (e.g. a plain 964
   Carrera for the 964 Carrera 4S) — the `alt` text says
   `— stand-in photo (…)`;
2. failing that, the **generation hero** is used as the hero and the gallery is
   left empty.

A gallery is never padded with photos of a different chassis: a title only
qualifies when it names the variant (variant tier) or carries a positive
generation signal for the same family (family tier). `data/credits.json` records
how many entries share each file, and every `ImageRef` carries the `creditId`
that `/credits` renders.

Variants with no licensed imagery at all are listed in `docs/STATUS.md` with
`missing: "no licensed Commons imagery"`.