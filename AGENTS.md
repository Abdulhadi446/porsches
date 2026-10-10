# AGENTS.md

Unofficial Porsche 911 fan showcase — Next.js 16 App Router, React 19, Tailwind v4, three.js/R3F,
GSAP+Lenis. 9 generations · 164 variants · 179 prerendered routes. No analytics, no cookies.

Read before changing anything: `docs/CONTRACTS.md` (ownership map + data contracts),
`docs/STATUS.md` (what is verified), `TODO.md` (measured remaining work),
`docs/research.md` (sourcing/licence rules), `components/hero/README.md` and
`components/fx/README.md` (component contracts).

## Commands

```bash
npm run check        # merge-assets --check + tsc --noEmit + eslint   (all three must be silent/clean)
npm run build        # prebuild rewrites data/ first — expect a dirty tree afterwards
npm run dev          # same predev hook
node scripts/smoke.mjs http://localhost:3111   # crawls every route in data/generations (179 today)
node scripts/test-licence-parse.mjs           # licence-template parser regression
node scripts/fix-tailwind-var-utilities.mjs --check
node scripts/convert-images.ts --verify       # every referenced render exists on disk
```

- There is **no test framework** (no jest/vitest/playwright-test). `scripts/smoke.mjs` +
  `test-licence-parse.mjs` are the only automated checks. Chromium is already installed locally.
- `scripts/smoke.mjs` builds its route list from `data/generations/*.json` — a new variant is
  picked up automatically. It fails on any same-origin 4xx, console error or broken image.
- `npm run check` does **not** include the Tailwind guard or the licence test; CI runs those
  separately. `merge-assets --check` never exits non-zero — CI greps its stdout for the exact
  line `missing media: none`.

## Data pipeline — the invariants that bite

- **Media lives in the manifests, not in `data/generations/*.json`.** `scripts/merge-assets.ts:180`
  overwrites `heroImage` / `timelineImage` / `gallery` / `model3d` / `videos` / `credits` in the
  generation files from `data/images.json`, `data/models.json`, `data/videos.json`,
  `data/turntables.json` + the credit files — on **every** `npm run dev` / `npm run build`.
  Hand-editing those fields is silently reverted. Edit the manifest → `npm run merge:assets` →
  `npm run catalog` → commit `data/`.
- **Order matters:** `merge-assets` before `build-client-catalog` (the catalog is built from the
  merged generation files). `prebuild`/`predev` already do this.
- **Spec fields are never touched by the merge** (`power`, `years`, `description`, `missing[]`).
  Those are hand-authored per `data/schema.ts`.
- `data/*.json` are committed; `public/images/**` and `public/turntables/**` are generated and
  gitignored. A fresh clone has no media and renders
  `/public/images/_placeholder/911-silhouette.svg` by design — that is not a bug to fix in code.
- **Client components import `#lib/client-catalog`, never `#lib/generations`.** The raw JSON is
  ~1.4 MB and was 2 MB of initial JS; only server components may touch the full data
  (`lib/client-catalog.ts` header). Resolve data in the server component, pass plain props down.
- Unverifiable figure → `null` + a `missing[]` note. Never estimate, never invent a spec.

## Frontend rules

- Server components own data; `"use client"` leaves take plain props (see
  `app/911/[generation]/[variant]/page.tsx`). All variant routes are prerendered via
  `generateStaticParams`.
- Aliases: `@/*`, `#data/*`, `#lib/*`, `#components/*`, `#styles/*` (`tsconfig.json:25`).
- Colours come from `styles/tokens.css` (`@theme` → utilities: `bg-ink`, `text-metal-500`,
  `z-nav`, `text-mono-xs`). No hardcoded hex in components; canvas/WebGL code reads
  `getComputedStyle` or the `FX_TOKEN_COLORS` SSR mirror.
- **Tailwind v4 custom-property syntax is `(--token)`, never v3 `[--token]`.** The v3 form emits
  invalid CSS (`padding-inline:--gutter`) that the browser silently drops — it once killed every
  gutter/radius/duration site-wide. Guard: `node scripts/fix-tailwind-var-utilities.mjs --check`.
- **One WebGL context for the whole page.** The hero forces `gl.forceContextLoss()` on unmount
  and uses `frameloop="demand"`; `components/fx` creates no context at all and defers to
  `setFxCapabilityOverride`. `prefers-reduced-motion` means *no canvas*, not a static render.
- New decorative effects belong in `components/fx` with a static first paint, a reduced-motion
  path and an idle/visibility pause — read its README first.

## Licensing (hard constraints)

- Stills and turntable frames: **Wikimedia Commons only**, via the REST host
  `api.wikimedia.org`. `commons.wikimedia.org` (Action API) is blocked on this machine.
  Read the licence from the file's **own licence template** first — the old "first
  creativecommons.org link" heuristic mislabelled licences (`test-licence-parse.mjs` guards it).
- **Never download Porsche Newsroom imagery** (terms forbid redistribution) — text source only.
- 3D: Sketchfab **embeds** only (the download API is 401 without an OAuth token); local GLB only
  if the licence is verified and the file is < 3 MB. Video: YouTube embeds, ids verified by
  oEmbed, never downloaded.
- `turntableSynthetic: true` marks a parallax pan of one photo, not a real orbit. It stays
  flagged and disclosed in the viewer — do not quietly drop the flag.

## Gates

`ci.yml` is the authority on what must pass, in order: `merge-assets --check` (must print
`missing media: none`) → `tsc --noEmit` → `eslint .` → licence test → synthesise AVIF stubs →
`npx next build` → smoke. It uses `npx next build` on purpose: no `prebuild`, so it proves the
committed `data/` is self-sufficient.

Known: the committed data currently prints `missing media (2)` for `991/turbo-gt`
(no hero, no gallery), so that first CI step fails on content, not code. GitHub currently
registers only `assets.yml` — `ci.yml` is not registered, so run the gates locally.

Perf: Lighthouse on this 8-core box swings 46–93 for identical builds. Use the CDP-throttled
method in `docs/perf.md §8`, not the score.

## Traps

- **Never run two `next build`s at once** — overlapping builds have twice corrupted `.next` and
  500'd all gseries pages. `rm -rf .next` only when nothing else is building.
- `pkill -f "next start"` does nothing; the process renames itself to `next-server`.
- 2 815 turntable frames (81 MB) are **still tracked in git** despite `.gitignore` — ignore rules
  do not untrack. See `TODO.md` P0 for the exact `git rm --cached` command; don't do it until
  the deploy story is settled (`vercel.json`, `.vercelignore` and `docs/DEPLOY.md` are currently
  deleted in the working tree, while `README.md`/`TODO.md` still link to `docs/DEPLOY.md`).
- Fetch scripts are rate-limited and self-paced (`P911_CONCURRENCY`, `P911_GAP_MS`,
  `P911_WORK_DIR`, …). Do not "optimise" the pacing; bursts get `429`.
- When delegating to subagents, `docs/CONTRACTS.md` holds the exclusive file-ownership map and
  the "never fabricate, cite or write `missing`" rule.
