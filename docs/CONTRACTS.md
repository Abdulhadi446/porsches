# CONTRACTS — file ownership map (Step 1 deliverable)

Rules for every subagent:
1. **Only edit files you own.** If you need a change outside your ownership, STOP and report
   to the lead (final message = blocker report). Never edit another agent's files.
2. **Never fabricate.** Specs, licenses, model availability → cite a source or write
   `missing` / `null`.
3. **Commit when done** is the lead's job — you don't run `git`.
4. All media paths are relative to `/public`. All data conforms to `/data/schema.ts`.
5. Variant ids come from `/data/roster.json` (136 canonical ids). Data agents may APPEND new
   variants; asset/feature agents may assume every roster id exists.

## Ownership

| Owner | Paths (exclusive write access) |
|---|---|
| **LEAD** | `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `app/credits/**`, `app/911/**` (until handed to VARIANT-PAGES), `styles/tokens.css`, `data/schema.ts`, `data/roster.json`, `lib/**`, `docs/CONTRACTS.md`, `docs/research.md`, `docs/STATUS.md`, `docs/perf.md` (until PERF-A11Y), `scripts/merge-assets.ts` |
| **DATA-901** | `data/generations/901.json` |
| **DATA-GSERIES** | `data/generations/gseries.json` |
| **DATA-964** | `data/generations/964.json` |
| **DATA-993** | `data/generations/993.json` |
| **DATA-996** | `data/generations/996.json` |
| **DATA-997** | `data/generations/997.json` |
| **DATA-991** | `data/generations/991.json` |
| **DATA-992-1** | `data/generations/992-1.json` |
| **DATA-992-2** | `data/generations/992-2.json` |
| **ASSET-IMAGES** | `public/images/**`, `scripts/fetch-images.ts`, `scripts/convert-images.ts`, `data/images.json`, `data/credits.json` |
| **ASSET-3D** | `public/models/**`, `scripts/fetch-models.ts`, `data/models.json` |
| **ASSET-VIDEO** | `data/videos.json` |
| **3D-HERO** | `components/hero/**` |
| **SCROLL-TIMELINE** | `components/timeline/**` |
| **VARIANT-PAGES** | `app/911/**`, `components/variant/**` |
| **BG-EFFECTS** | `components/fx/**` |
| **NAV-UX** | `components/nav/**`, `app/compare/**`, `app/search/**`, `app/variants/**` (variant grid) |
| **PERF-A11Y** | `docs/perf.md` only; code fixes arrive as **proposals to the lead** (owner edits files) |

`app/911/**` and `components/nav/**` are currently lead-written STUBS — their owner replaces
them wholesale (keep routes: `/911/[generation]`, `/911/[generation]/[variant]`, `/compare`).

## Data interchange files (shape is contract; producer owns the file)

### `data/images.json` — producer: ASSET-IMAGES
```jsonc
{
  "generatedAt": "ISO",
  "generations": { "<genId>": { "heroImage": ImageRef|null, "timelineImage": ImageRef|null } },
  "variants": { "<variantId>": { "heroImage": ImageRef|null, "gallery": ImageRef[] } }
}
```
Merged into generation JSONs by the lead's `scripts/merge-assets.ts`. Every `ImageRef.creditId`
must exist in `data/credits.json`.

### `data/videos.json` — producer: ASSET-VIDEO
```jsonc
{ "updatedAt": "ISO", "entries": { "<genId>" | "<genId>/<variantId>": VideoRef[] } }
```
Every id verified live via `https://www.youtube.com/oembed?url=...&format=json`.

### `data/models.json` — producer: ASSET-3D
```jsonc
{
  "updatedAt": "ISO",
  "generations": { "<genId>": Model3D|null },
  "variants": { "<variantId>": Model3D|null }
}
```
`Model3d` preference order: local `.glb` (only if license verified + `< 3MB`) → Sketchfab
`embedUrl` → `turntable` images → `null`.

### `data/credits.json` — producer: ASSET-IMAGES (3D/VIDEO append via merge at integration)
`{ generatedAt, credits: Credit[] }` — one record per asset. Rendered by `/credits`.

## Asset license rules (from `docs/research.md`)
- Images: **Wikimedia Commons only**, via `api.wikimedia.org` REST (the Action API host is
  blocked here). License must parse as CC0 / CC BY / CC BY-SA / PD. Record author + license.
- **No Porsche Newsroom image downloads** (their terms forbid redistribution) — cite as text
  source only.
- 3D: Sketchfab **embeds** (no token available). Local GLB only from directly downloadable,
  licensed sources with recorded attribution.
- Video: YouTube embeds only, never downloaded. Verify with oEmbed.

## Lint / build gates (run before you report done)
```
npm run typecheck && npm run lint
```
Only the lead runs `npm run build`.
