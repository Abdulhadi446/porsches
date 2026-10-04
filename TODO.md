# TODO — what is left on the 911 showcase

Generated 2026-10-03 from the repo's own data and audits. Every count here was measured, not
estimated; the command that produced it is noted where useful. Cross-references:
`docs/STATUS.md` (full state), `docs/perf.md` (perf/a11y audit), `docs/research.md` (research +
licence rules), `docs/DEPLOY.md` (deploy), `docs/CONTRACTS.md` (ownership).

**Nothing in this list is a crash or a broken build.** The site builds clean, 179/179 routes return
200 with no console errors and no broken images, every route is inside the 2.5 s LCP budget, and
`tsc`/`eslint` are clean. Everything below is a content gap, a nicety, or an unverified claim.

---

## P0 — integrity work still outstanding

- [ ] **Untrack 2 815 turntable frames (81 MB) that are in git.** `.gitignore` has
      `public/turntables/**/*`, but files already committed stay tracked — ignore rules do not
      untrack. `.git` is 81 MB for this reason, and every clone/deploy pays for it.
      `git rm -r --cached public/turntables && git commit -m "untrack generated turntable frames"`
      (keep `public/turntables/README.md`). Do this only after deciding the deploy story below.
- [ ] **Delete 71 leftover bare-id image directories (403 MB of duplicates).** Earlier fetch runs
      wrote `/public/images/carrera/`, `/public/images/turbo-s/`, … alongside the canonical
      `/public/images/964/carrera-4s/` style paths. Both exist; the manifest now uses only the
      gen-scoped ones. Safe to delete the bare-id dirs *after* confirming with
      `node scripts/convert-images.ts --verify` that nothing references them.

## P1 — content gaps

### 3D
- [ ] **36 variants have no 3D at all** (no GLB, no embed, no turntable). They render the composed
      "3D coming soon" panel. Per generation:
      - `992-2` (12): `carrera-t`, `targa-4s`, `carrera-gts`, `carrera-4-gts`, `turbo-s`, `gt3`,
        `gt3-rs`, `gt3-s-c`, `spirit-70`, `carrera-s-mt-package`, `carrera-4-gts-transfagarasan`,
        `gt3-90-fa-porsche` — no Commons file names a T-Hybrid car or dates one to 2025+, so no
        sequence can be built even from photos that exist
      - `901` (6): `911-t-2.0`, `911-l-2.0`, `911-e-2.0`, `cabriolet-hebmuller`, `911-r`, `911-t-r`
      - `964` (7), `gseries` (4), `996` (3), `991` (2: `935`, `turbo-gt`), `993` (1: `gt1`),
        `992-1` (1: `turbo-50`)
- [ ] **90 of 103 turntables are parallax pans of a single photo, not real orbits.** Labelled
      `turntableSynthetic: true` in the data and disclosed in the viewer. Only 13 are genuine
      multi-angle same-car sequences. **Highest-value human task: one photographer walking one car
      around one car park** converts four of these at once — `964/carrera-4`, `991/gt2-rs`,
      `991/r`, `992-1/gt3-rs` each already have a near-miss Commons series that fails only on mixed
      authors or several capture dates.
- [ ] **Top 10 to shoot for real:** `992-2/turbo-s`, `992-2/carrera-gts`, `992-1/gt3-rs`,
      `964/carrera-4`, `997/gt2-rs`, `991/r`, `997/sport-classic`, `gseries/turbo-3.3-930`,
      `901/911-2.0`, `992-1/s-t`.
- [ ] **Optional highest-leverage upgrade: a Sketchfab API token.** Downloads are OAuth-gated
      (401 without a token), which is why only 2 real 911 GLBs exist under an open licence despite
      an 18-source sweep. With a token, the existing pipeline downloads the models it has already
      licence-verified, runs `gltf-transform optimize --compress draco --texture-compress webp`
      under the 3 MB budget, and wires them into the viewer. Nothing else needs to change.

### Imagery
- [ ] **`991/turbo-gt` has no hero image and no gallery** — the only variant on the site in that
      state. Cause: Porsche never published anything about the 2018 Turbo GT, so the search returns
      nothing era-accurate. Either drop the variant (it has no specs either) or find one photo with
      a verifiable caption.
- [ ] **74 variants share a hero photo with a sibling variant**, 33 use a family stand-in, because
      Commons has no licensed photo of those trims. Alt text says "stand-in photo (…)" — worth a
      second pass to replace with era-correct images where they exist.
- [ ] Re-check the 10 Commons files the images agent blacklisted (photo contradicted caption) still
      are not referenced anywhere in `data/images.json`.

### Video
- [ ] **10 variants have no dedicated video** and fall back to their generation's films:
      `901/cabriolet-hebmuller`, `901/911-s-2.4`, `gseries/carrera-2.7`, `gseries/turbo-s-3.3`,
      `996/carrera-4s`, `997/gts`, `992-1/turbo-s`, `992-2/carrera-4-gts`, `992-2/targa-4-gts`,
      `992-2/gt3-touring`. For each, search for a newly published film.

### Data honesty (no code needed, research only)
- [ ] **76 generation-level + 284 variant-level `missing[]` notes** are recorded rather than guessed.
      The notable unresolved ones:
      - `901` **Hebmüller Cabriolet production count** — unverifiable; the widely quoted "130" is
        flagged do-not-publish
      - Conflicting production totals: Carrera RS 2.7 (1 580 / 1 590), 964 (63 762 / 62 172 /
        66 571), 993 (68 881 / 68 029 / 67 535), 997 (213 004 / 215 092), 991 (217 930 / 233 540),
        964 Turbo S Flachbau (75/76/90/93), 993 Turbo S (345/336/435)
      - **901-era 0–100 km/h and kerb weights** — Porsche never published them; only magazine
        0–60 figures exist
      - **992.2 DIN weights** for Carrera Cabriolet / Carrera S Cabriolet / Carrera 4S / Targa 4S
        (US curb weights are used instead)
      - **991.2 Turbo GT** has every spec `null` on purpose — Porsche published nothing
- [ ] **`993/gt1`** is included with a `missing[]` caveat that it is arguably not a "911" (mid-engined
      GT1). Decide whether it stays.

## P2 — performance debt (all measured; none blocking)

- [ ] **Initial JS is ~1.0 MB** (down from 2.03 MB). Remainder is React/Next runtime + the 160 kB
      client catalogue + GSAP/Lenis on scroll. Next lever: move the palette index off the main
      thread or drop framer-motion from the remaining UI islands.
- [ ] **TBT on `/`** is dominated by three.js parse/execute after the idle callback. No longer
      blocks LCP, but visible at 4× CPU throttle.
- [ ] **`inlineCss` is enabled but unverified in production** — measured locally (FCP 2044 → 1036 ms
      on `/compare`), never deployed.
- [ ] **Real-device WebGL cost is unmeasured.** Every 3D measurement on this box runs on software GL,
      where the hero deliberately refuses to mount a canvas at all. Needs a check on real hardware.
- [ ] **INP not measured** (only TBT). Lighthouse run-to-run variance on this shared 8-core box is
      46–93 perf for identical builds, so use the CDP-throttled methodology in `docs/perf.md §8`.

## P3 — deployment & verification gaps

- [ ] **No Vercel deploy has ever been run.** `vercel.json`, `.github/workflows/ci.yml` and
      `docs/DEPLOY.md` exist and the CI chain is written, but it has never executed end to end.
      Set Node 24.x in the dashboard (vercel.json cannot express it).
- [ ] **`.vercelignore` negation untested** against a real upload.
- [ ] **Cloudflare Pages marked "not verified"** — needs an adapter plus a custom image loader, and
      the 3 dynamic routes exceed the 128 MB Worker memory limit.
- [ ] **Decide where the generated media lives.** 416 MB of images and 81 MB of turntable frames are
      gitignored, so a plain Vercel deploy ships **no images at all** (placeholders only). Options:
      object storage + `remotePatterns` (recommended, documented in `docs/DEPLOY.md`), or
      `P911_FETCH_ASSETS=1` per build (slow, rate-limited).
- [ ] **No screenshot/visual regression baseline.** A future agent found two content bugs (blurry
      heroes, a chapter hero clobbered by an unrelated fetch) that every automated check passed.
      Worth a Playwright screenshot job over the 9 generation pages + a few variants.

## Process notes (learned the hard way — don't repeat these)

- [ ] **`pkill -f "next start"` does not work** — Next renames the process to `next-server`. Use
      `pkill -f next-server` or kill by PID from `ps -eo pid,etimes,cmd | grep next-server`.
- [ ] **Never run two `next build`s concurrently.** Overlapping builds corrupted `.next` twice and
      500'd all 48 gseries pages. Build in the foreground; `rm -rf .next` only when nothing else runs.
- [ ] **Run `merge-assets` before `build-client-catalog`** (both are in `prebuild`, but running them
      by hand in the wrong order silently ships stale data).
- [ ] **Wikimedia rate limits hard.** A tight 210-request loop returned 429. Use the cache under
      `$P911_WORK_DIR` (default `/tmp/opencode/p911`) and throttle; the Commons Action API host
      (`commons.wikimedia.org`) is blocked from this machine — use `api.wikimedia.org`.