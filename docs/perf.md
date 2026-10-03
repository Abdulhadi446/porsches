# docs/perf.md — performance + accessibility audit

Owner: **PERF-A11Y**. This file is the only file I write; every fix below is a **proposal**
for the file owner named in each item. Nothing here has been applied to source.

- Audit date: 2026-10-03
- Build measured: `.next` `BUILD_ID = H4W9nghTeYHUlk6dGssWr` (`next start -p 3111`)
- Routes audited: `/`, `/911/992-1`, `/911/992-1/gt3-rs`, `/911/901/911-2.0`, `/compare`,
  `/variants`, `/credits` (+ `/911`, `/search` for the static a11y sweep)
- Raw data: `/tmp/opencode/perf-results.json`, `/tmp/opencode/lh/*.json`,
  `/tmp/opencode/lh-summary.json`

---

## 0. READ THIS FIRST — two P0s that break `/`

### P0-A `/` returns **HTTP 500** from the current source

`components/hero/hero-poster.tsx:61` sets `placeholder={image.blurDataURL ? "blur" : "empty"}`
but the `<Image>` (lines 54–63) **never passes `blurDataURL`**. Whenever the newest
generation's hero image carries a blur placeholder — which it does today
(`data/images.json → 992-2/img-2024-porsche-911-992-carrera-t-…-1920.avif` has one) —
`next/image` throws unconditionally:

```
Error: Image with src "/images/992-2/img-2024-…-1920.avif" has "placeholder='blur'"
property but is missing the "blurDataURL" property.      digest: '1529634690@E371'
  at node_modules/next/dist/shared/lib/get-img-props.js:434
```

Verified with a dev server (`next dev -p 3112`, same source, dev only to obtain the
non-minified error): **`/` → 500, every other route → 200.** The throw is not
`NODE_ENV`-gated, so a clean production build crashes the homepage the same way.

The build currently in `.next` masks it: `.next/server/app/index.html` contains `q=75`
and no blur placeholder, while `.next/server/chunks/ssr/_0w7wdqs._.js` contains
`quality:82, placeholder:c.blurDataURL?"blur":"empty"` — i.e. **the prerendered HTML
predates the compiled server chunk**. See P0-C.

### P0-B every hero-poster image request returns **HTTP 400**

`components/hero/hero-poster.tsx:60` passes `quality={82}`, but `next.config.ts` declares
no `images.qualities`, so Next's default `[75]` applies:

```
GET /_next/image?url=%2Fimages%2F992-2%2F…-1920.avif&w=1280&q=82  → 400  "q" parameter (quality) of 82 is not allowed
GET /_next/image?url=%2Fimages%2F992-2%2F…-1920.avif&w=1280&q=75  → 200  image/jpeg
```

So if P0-A is fixed without P0-B, the LCP element on `/` becomes a broken image. Both
must land together.

### P0-C `.next` is internally inconsistent — rebuild from clean

No source file is newer than `.next/BUILD_ID`, yet the prerendered `/` HTML does not
match the built server chunk (see P0-A). Recommendation: `rm -rf .next && npm run build`
(lead only — I never ran a build).

---

## 1. Measured results

Lighthouse 12.8.2, Chromium 140 (`~/.cache/ms-playwright/chromium-1243`),
`--preset=mobile` (Lighthouse's simulated 4G + 4× CPU slowdown) and `--preset=desktop`.
Local, unthrottled Playwright numbers are in §1.3 and are only useful for *relative*
comparison.

### 1.1 Lighthouse — mobile (simulated 4G) — the acceptance profile

| Route | Perf | A11y | BP | SEO | FCP | **LCP** | **TBT** | **CLS** | SI | JS | Img | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | **40** | 82 | 96 | 100 | 1882 | **5078** | **15010** | 0 | 11156 | 832 KB | 1181 KB | 2142 KB |
| `/911/992-1` | **62** | 82 | 96 | 100 | 1401 | **3534** | **1616** | 0 | 3918 | 528 KB | 138 KB | 806 KB |
| `/911/992-1/gt3-rs` | **68** | 85 | 96 | 100 | 1472 | **3440** | **977** | 0 | 3840 | 546 KB | 70 KB | 759 KB |
| `/911/901/911-2.0` | 91 | 85 | 96 | 100 | 1066 | **2715** | **278** | 0 | 1671 | 546 KB | 78 KB | 768 KB |
| `/compare` | 76 | 82 | 96 | 100 | 843 | **2953** | **781** | 0.001 | 2137 | 532 KB | 0 | 741 KB |
| `/variants` | 88 | 83 | 93 | 100 | 884 | **2671** | **363** | 0.001 | 2107 | 544 KB | 0 | 755 KB |
| `/credits` | 71 | 81 | 96 | 100 | 1928 | **4036** | **574** | 0 | 3151 | 510 KB | 0 | 688 KB |

### 1.2 Lighthouse — desktop preset

| Route | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | 64 | 88 | 96 | 100 | 313 | 926 | **1984** | 0 |
| `/911/992-1` | 93 | 90 | 96 | 100 | 358 | 856 | 205 | 0 |
| `/911/992-1/gt3-rs` | 93 | 90 | 96 | 100 | 358 | 856 | 205 | 0 |
| `/911/901/911-2.0` | 99 | 90 | 96 | 100 | 321 | 816 | 14 | 0 |
| `/compare` | 100 | 88 | 96 | 100 | 239 | 650 | 12 | 0.001 |
| `/credits` | 99 | 87 | 96 | 100 | 492 | 583 | 105 | 0 |
| `/variants` | not measured | | | | | | | |

### 1.3 Local Playwright (unthrottled, so ~50–100× faster than §1.1)

| Route | LCP | CLS | long-task total | max long task | JS | imgs | canvas | `[data-fx]` |
|---|---|---|---|---|---|---|---|---|
| `/` | 276 | 0 | 5226 ms | **4365 ms** | 830 KB | 11 | 1 (webgl) | `grain-overlay:css` |
| `/911/992-1` | 536 | 0 | 393 | 105 | 550 KB | 26 | 0 | – |
| `/911/992-1/gt3-rs` | 456 | 0 | 361 | 112 | 544 KB | 15 | 0 | – |
| `/911/901/911-2.0` | 508 | 0 | 515 | 114 | 544 KB | 14 | 0 | – |
| `/compare` | 260 | 0.0008 | 251 | 118 | 530 KB | 0 | 0 | – |
| `/variants` | 252 | 0.0006 | 303 | 111 | 542 KB | 0 | 0 | – |
| `/credits` | 596 | 0 | 586 | 389 | 509 KB | 0 | 0 | – |

### 1.4 Mobile emulation (iPhone 13, 390×844 @ DPR 3, coarse pointer)

| Route | LCP | CLS | canvases (top / after scroll) | hero canvas backing store | h-overflow |
|---|---|---|---|---|---|
| `/` | 284 | 0 | 1 / 1 | **487×830 for 390 px CSS = DPR 1.25** | **+63 px** |
| `/911/992-1` | 280 | 0 | 0 / 0 | – | 0 |
| `/911/992-1/gt3-rs` | 340 | 0 | 0 / 0 | – | 0 |
| `/911/901/911-2.0` | 148 | 0 | 0 / 0 | – | 0 |
| `/compare` | 84 | 0 | 0 / 0 | – | 0 |
| `/variants` | 96 | 0 | 0 / 0 | – | **+60 px** |
| `/credits` | 236 | 0 | 0 / 0 | – | **+572 px** |

---

## 2. Budget scorecard

| # | Budget | Result | Evidence |
|---|---|---|---|
| 1 | **LCP < 2.5 s** on LH mobile | ❌ **FAIL 7/7** | 2671–5078 ms; worst `/` 5078, `/credits` 4036, `/911/992-1` 3534 |
| 2 | **CLS < 0.1** | ✅ **PASS 7/7** | max observed 0.001 (`/compare`, `/variants`); 0 on the rest |
| 3 | **TBT < 200 ms** on LH mobile | ❌ **FAIL 7/7** | 278–15 010 ms; best `/911/901/911-2.0` 278 ms, `/` 15 010 ms |
| 4 | **Exactly one live WebGL context** | ✅ **PASS** | §3.1 — max 1 at any time across 8 navigations |
| 5 | **No context leak on navigation** | ✅ **PASS** | §3.1 — hero 1 → gen 0 → variant 0 → compare 0 → back 0 → hero 1 |
| 6 | **DPR capping** | ✅ **PASS** | DPR 3 device → 1.25 (lite cap); DPR 1 desktop → 1.0; fx ceiling 2, viewer ceiling 1.75 in source |
| 7 | **Lazy canvas mounting (IntersectionObserver)** | ✅ **PASS** | 0 canvases on every non-hero route at rest and after scrolling; hero mounts on 300 px margin |
| 8 | **`prefers-reduced-motion` engages** | ✅ **PASS** | 0 canvases, **0** elements with a non-zero animation/transition duration, no custom cursor, on `/`, `/911/992-1/gt3-rs`, `/911/901/911-2.0`, `/compare` |
| 9 | **Low-power / mobile fallback engages** | ⚠️ **PARTIAL** | fx + cursor + DPR fallbacks all engage, but the hero still creates a WebGL context on a mobile UA (see P0-E) |
| 10 | **Keyboard: nav** | ✅ **PASS** | Tab order sane, `outline: solid 2px` on every nav control |
| 11 | **Keyboard: ⌘K palette** | ✅ **PASS** | opens with ⌘K *and* Ctrl+K; `role=dialog` + `aria-modal` + label; focus → combobox; `#main` `inert`; `aria-activedescendant` tracks ↑↓; Esc closes and un-inerts |
| 12 | **Keyboard: gallery lightbox** | ⚠️ **PARTIAL** | opens, ←/→ page, Esc closes, own Tab trap — but focus is **not** restored and `#main` is **not** inert (P1-11) |
| 13 | **Keyboard: compare pickers** | ✅ **PASS** | two `role=combobox` inputs, labelled, `aria-expanded`/`aria-controls` wired, reachable by Tab |
| 14 | **Custom cursor off for reduced motion / coarse pointer** | ✅ **PASS** | `[data-nav-cursor]` absent under reduced motion and on iPhone emulation |
| 15 | **Custom cursor never hides the native cursor** | ✅ **PASS** | 0 elements with computed `cursor: none` on any route |
| 16 | **Focus visibility** | ⚠️ **PARTIAL** | 2px `outline-guards` ring everywhere **except** the `/variants` filter input and the `/compare` slot inputs, which are `outline: none` (P1-12) |
| 17 | **Landmarks / headings** | ✅ **PASS** | exactly one `<main>`, `<header>`, `<footer>`; `lang="en"`; 0 heading-level jumps; skip link on every route |
| 18 | **Alt text on every image** | ✅ **PASS** | 0 images without `alt` across 9 routes; 0 `naturalWidth === 0` |
| 19 | **Form controls have labels** | ✅ **PASS** | every `<input>/<select>/<textarea>` has an accessible name (the one hit is `<input type="hidden">` on `/search`, which is exempt) |
| 20 | **Contrast of the token palette** | ❌ **FAIL** | `metal-700` 2.76:1, `guards` 3.73:1, `guards-deep` 2.11:1, `gulf-blue-deep` 3.65:1 on `ink`; LH `color-contrast` = 0 on all 7 routes |
| 21 | **Aria correctness for dialogs** | ⚠️ **PARTIAL** | palette is correct; the lightbox declares `aria-modal="true"` without inerting `#main` |
| 22 | **No keyboard traps** | ✅ **PASS** | 18–22 Tab presses per route, focus never stuck; Escape closes both dialogs |
| 23 | **No broken internal links** | ✅ **PASS** | 26 internal URLs crawled, 0 non-200 |
| 24 | **No 4xx assets / broken images** | ✅ **PASS** in-app | 0 4xx, 0 failed requests during the crawl. `GET /favicon.ico` → 404 on **every** route (P2-1) |
| 25 | **No console errors** | ⚠️ **PARTIAL** | `/` throws React #418 hydration error (P1-1); 3 families of noise-free warnings otherwise |
| 26 | **No horizontal scroll at 390 px** | ❌ **FAIL** | `/credits` +572 px, `/` +63 px, `/variants` +60 px (P1-13) |

Token contrast measured against `ink #050506` (WCAG 2.x relative luminance):

| token | hex | on ink | AA normal (4.5) | AA large (3.0) |
|---|---|---|---|---|
| `metal-100` | `#f4f4f5` | 18.53 | ✅ | ✅ |
| `signal` | `#ffd400` | 14.23 | ✅ | ✅ |
| `metal-300` | `#c9c9cf` | 12.36 | ✅ | ✅ |
| `ok` | `#37d67a` | 10.73 | ✅ | ✅ |
| `gulf-blue` | `#3fa9d6` | 7.62 | ✅ | ✅ |
| `gulf-orange` | `#f47b20` | 7.47 | ✅ | ✅ |
| `metal-500` | `#8b8b95` | 6.04 | ✅ | ✅ |
| `guards-glow` | `#ff2036` | 5.35 | ✅ | ✅ |
| **`guards`** | `#d5001c` | **3.73** | ❌ | ✅ |
| **`gulf-blue-deep`** | `#1c6f96` | **3.65** | ❌ | ✅ |
| **`metal-700`** | `#55555e` | **2.76** | ❌ | ❌ |
| **`guards-deep`** | `#8f0014` | **2.11** | ❌ | ❌ |
| `metal-900` | `#26262d` | 1.36 | ❌ (borders/decor only) | ❌ |

---

## 3. Detailed verification

### 3.1 WebGL context lifecycle (desktop, `document.querySelectorAll('canvas')` + context probe)

| Step | canvases | live WebGL | backing store |
|---|---|---|---|
| `/` (hero) | 1 | 1 | 1440×900 @ css 1440 |
| `/` scrolled away | 1 | 1 | 1440×900 |
| `/911/992-1` | 0 | 0 | – |
| `/911/992-1/gt3-rs` top | 0 | 0 | – |
| `/911/992-1/gt3-rs` scrolled to the 3D section | 0 | 0 | – |
| `/compare` | 0 | 0 | – |
| back → variant | 0 | 0 | – |
| back → `/` | 1 | 1 | 1440×900 |

The variant page shows 0 canvases because `gt3-rs` resolves to a Sketchfab **embed**
(`Embed3D`, click-to-load facade) rather than a GLB — the intended path. `components/variant/lib/webgl.ts`
holds a single module-scope lease and `viewer-glb.tsx:71` flips `frameloop` to `"never"`
when off-screen. `ContextGuard` (`hero-scene.tsx:72-84`) calls `gl.dispose()` +
`forceContextLoss()` on unmount. **No leak observed.** (The "can I still get a context"
probe I wrote was inconclusive — it loses the context it just created — so leak detection
rests on DOM canvas count plus the dispose path, not on a browser-level limit test.)

### 3.2 DPR capping

- Mobile emulation reports `devicePixelRatio = 3`; the hero canvas backing store is
  487×830 for a 390 px CSS box → **1.25**, exactly `QUALITY_LITE.dpr[1]` from
  `components/hero/quality.ts:68`. The `lite` tier was selected (mobile UA + no WebGL2 in
  SwiftShader), so the cap chain works.
- `components/fx/runtime.tsx:539-546` clamps to `min(devicePixelRatio, maxDpr, FX_DPR_CEILING=2)`.
- `components/variant/lib/webgl.ts` sets `VIEWER_DPR_CEILING = 1.75`, used at `viewer-glb.tsx:70`.
- Desktop DPR 1 → backing store 1440×900 = 1.0, inside `QUALITY_FULL.dpr[1]=1.75`.

### 3.3 Reduced motion (`reducedMotion: 'reduce'`)

| Route | canvases | `[data-fx]` | animated/transitioning elements | custom cursor | rAF frames in 500 ms |
|---|---|---|---|---|---|
| `/` | 0 | none | **0** | absent | 31 |
| `/911/992-1/gt3-rs` | 0 | none | **0** | absent | 31 |
| `/911/901/911-2.0` | 0 | none | **0** | absent | 31 |
| `/compare` | 0 | none | **0** | absent | 31 |

`globals.css:77-86` plus `useReducedMotion()` in both hook modules fully engage. The hero
falls back to `HeroPoster` (no canvas at all), `HeroContent` renders `initial: false`.

### 3.4 Mobile / low-power fallback

Coarse pointer + mobile UA: `[data-nav-cursor]` absent (custom cursor off), fx layers
report `data-fx-mode="css"`, hero DPR capped to 1.25. **But** `use-webgl-support.ts:135`
still sets `canRender: probe.webgl && !reducedMotion`, so a phone gets a live WebGL
context in the `lite` profile — see P0-E.

### 3.5 Link / asset crawl

26 internal URLs fetched (`/`, all 9 generations, 2 variants, `/compare`, `/variants`,
`/credits`, `/911`, `/search`, …): **0 non-200**, 0 `requestfailed`, 0 console errors,
0 page errors during the crawl. External hosts referenced (all expected):
`sketchfab.com`, `www.youtube.com`, `i.ytimg.com`, `commons.wikimedia.org`,
`en.wikipedia.org`, `newsroom.porsche.com`, `www.porsche.com`, `www.stuttcars.com`.

`net::ERR_ABORTED` on `?/variants?_rsc=…` appears in the Playwright logs on every route —
that is Next's Link prefetch being cancelled, not a broken asset.

### 3.6 Console / page errors

| Where | Message | Verdict |
|---|---|---|
| `/` only | `Minified React error #418 … args[]=HTML` — "server rendered HTML didn't match the client" | **real bug**, see P1-1 |
| `/`, all | `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` | three 0.186 + R3F 9.8 deprecation noise (P2-2) |
| `/`, all | `GL Driver Message … GPU stall due to ReadPixels` | expected under software GL (reflector / ContactShadows readback) |
| all routes (LH) | `Failed to load resource: 404 … /favicon.ico` | P2-1 |
| my harness only | `PerformanceObserver: Deprecated API for given entry type` | my `event` observer, not app code |

---

## 4. PROPOSALS (prioritised)

Nothing below has been edited. Each item names the file and the owner.

### P0 — fix before anything else

**P0-A · `/` 500s at SSR** — owner **3D-HERO** (`components/hero/hero-poster.tsx`)
```diff
  <Image
    src={image.src}
    alt={image.alt}
    fill
    priority
    sizes="100vw"
    quality={82}
    placeholder={image.blurDataURL ? "blur" : "empty"}
+   blurDataURL={image.blurDataURL}
    className="object-cover object-center opacity-55"
  />
```
Expected: `/` renders again (was 500 for every other route 200). Gain: the whole homepage.
Risk: none — this is the pattern `components/variant/safe-image.tsx:94-96` already uses.

**P0-B · hero image requests 400 on `q=82`** — owner **LEAD** (`next.config.ts`)
```diff
  images: {
    formats: ["image/avif", "image/webp"],
+   qualities: [75, 82],
```
(or drop `quality={82}` at `hero-poster.tsx:60` and let `next/image` use 75).
Expected: LCP image on `/` loads instead of 400-ing on every candidate width.
Risk: none. Without this, P0-A turns a crash into a broken hero image.

**P0-C · rebuild from clean** — owner **LEAD**
`rm -rf .next && npm run build`. The current prerender does not match the compiled
server chunk (`q=75` in `index.html` vs `quality:82` in `ssr/_0w7wdqs._.js`), which is
the only reason P0-A is not visible in the running build. Expected: the measured numbers
below become trustworthy for `/`. Risk: build time only.

**P0-D · `/` LCP is gated on a JS fade-in (5078 ms → budget 2500 ms)** — owner **3D-HERO**
(`components/hero/hero-content.tsx:39-51`, used by the `<h1>` at line ~88)

`enter()` returns `initial: { opacity: 0, y: 22 }` + `transition: { duration: 1.1, delay: 0.45 }`.
An element painted at `opacity: 0` is **not** an LCP candidate; LCP is only emitted once it
is actually painted, so the hero `<h1>` (which Lighthouse confirms *is* the LCP element on
`/`) is timestamped at *hydration + 1.55 s*. LH: FCP 1882 ms, LCP 5078 ms — a 3.2 s gap
that is pure entrance animation.
```diff
 function enter(delay: number, reduced: boolean) {
   if (reduced) { …unchanged… }
   return {
-    initial: { opacity: 0, y: 22 },
-    animate: { opacity: 1, y: 0 },
+    // never start the LCP candidate at opacity 0: a transparent element is not
+    // eligible for LCP, so the fade-in would be billed to LCP on every load.
+    initial: { opacity: 1, y: 22 },
+    animate: { opacity: 1, y: 0 },
     transition: { duration: 1.1, delay, ease: EASE },
   };
 }
```
Expected: LCP on `/` 5078 → ≈ FCP (≈1900 ms). Gain ≈ **−3.2 s**. A transform-only entrance
is still compositor-cheap and looks near-identical.
Risk: the headline loses its fade (keeps the rise). If the fade must stay, apply it to a
wrapper `<div>` and leave the `<h1>` at opacity 1.

**P0-E · stop building a WebGL context on phones (TBT 15 010 ms on `/`)** — owner **3D-HERO**
(`components/hero/use-webgl-support.ts:119-137`)
```diff
-      const lowPower = !probe.webgl || mobile || fewCores || littleMemory || probe.software || !probe.webgl2;
+      const lowPower = !probe.webgl || mobile || fewCores || littleMemory || probe.software || !probe.webgl2;
+      const tooWeakForAContext = mobile || fewCores || littleMemory || probe.software || !probe.webgl2;
       setSupport({
         …
-        canRender: probe.webgl && !reducedMotion,
+        // the poster is the LCP element anyway; a context on a phone buys
+        // ~14 s of main-thread time for a decorative layer.
+        canRender: probe.webgl && !reducedMotion && !tooWeakForAContext,
```
Expected: `/` mobile TBT 15 010 → well under 2000 ms; LH perf 40 → ~85+. The
`HeroPoster` is already composed and is the LCP element, so the page is unchanged apart
from the animation.
Risk: low-end Android loses the 3D hero entirely. `QUALITY_LITE` still exists for
high-core-count mobile (`cores >= 8 && deviceMemory >= 8` if you want to re-admit it).
**Caveat:** Lighthouse mobile runs WebGL through SwiftShader, so the absolute TBT is
pessimistic; the *relative* cost of the three.js chunk (236 KB + 163 KB downloaded and
executed after hydration; a single 4365 ms long task measured unthrottled) is real.

### P1 — significant, do after the P0s

**P1-1 · hydration error #418 on `/` (React discards and re-renders the hero subtree)** —
owner **BG-EFFECTS** (`components/fx/runtime.tsx:220-240`)

`useFxCapability()` calls `detectWebgl()` **during render** inside `useMemo(…, [])`.
Server: no WebGL → `lowPower: true` → `GrainOverlay` renders `<FxStatic>` (visible in the
SSR HTML as `<div data-fx-static="none" …>`). Client first render: WebGL exists, desktop UA
→ `lowPower: false` → renders the `fx-grain-layer` branch instead. Different child element
⇒ error #418. Proof: the error fires on desktop `/` only; in the mobile-emulation run
(`lowPower` true on both sides) there are zero page errors.
```diff
 export function useFxCapability(): FxCapability {
-  return useMemo<FxCapability>(() => {
-    if (typeof window === "undefined" || typeof navigator === "undefined") return UNKNOWN_CAPABILITY;
-    …
-  }, []);
+  const [capability, setCapability] = useState<FxCapability>(UNKNOWN_CAPABILITY);
+  useEffect(() => {
+    if (typeof window === "undefined" || typeof navigator === "undefined") return;
+    const cores = typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 0;
+    const mobile = MOBILE_RE.test(navigator.userAgent || "");
+    const webgl = detectWebgl();
+    const detected = (cores > 0 && cores < 4) || mobile || !webgl;
+    setCapability({ cores, mobile, webgl, lowPower: capabilityOverride ?? detected, ready: true });
+  }, []);
+  return capability;
 }
```
Expected: no console error on `/`; one fewer full client re-render on the critical path;
still satisfies README perf-guard #3 ("first paint is always static") because
`UNKNOWN_CAPABILITY.lowPower === true`. Risk: none. Doing this also stops `useFxCapability`
from creating a throwaway WebGL context during React render.

**P1-2 · 1.14 MB of full-size AVIFs on `/`** — owner **SCROLL-TIMELINE**
(`components/timeline/chapter.tsx:71-86`)

A raw `<img src={image.src} width={1920}>` — no `srcSet`, no `srcset`/`sizes`, no
optimizer — and `loading={index < 2 ? "eager" : "lazy"}`, so two 1920 px plates download
immediately and Chrome's lazy threshold pulls two more. LH: 4 images of 264/266/269/340 KB,
`uses-responsive-images` flags ~600 KB wasted on a 412 px viewport.
```diff
-  {/* eslint-disable-next-line @next/next/no-img-element */}
-  <img data-ts-drift-img src={image.src} alt="" width={image.width ?? 1600} height={image.height ?? 900}
-       loading={index < 2 ? "eager" : "lazy"} decoding="async" className="…" />
+  <SafeImage image={image} decorative fill sizes="(min-width: 768px) 44vw, 92vw"
+             className="h-full w-full object-cover opacity-25 grayscale md:opacity-85"
+             data-hero-media={undefined} />
```
(`SafeImage` lives in `components/variant/safe-image.tsx` and already emits
`loading="lazy"` + `sizes` + the blur background.)
Expected: `/` mobile image transfer 1181 KB → ~120 KB; LCP/TBT unaffected but SI drops
(11 156 ms → ≈4 s). Risk: none; the plate is decorative and `aria-hidden`.

**P1-3 · text LCP is re-timestamped by the webfont swap** — owner **LEAD** (`app/layout.tsx:9-27`)

`/credits` FCP 1928 → LCP 4036; `/compare` 843 → 2953; `/variants` 884 → 2671. Every LCP
element on these routes is text (`<p>`, `<h1>`). Three Google families load with
`display: "swap"`, so the text paints in the fallback and re-paints on arrival, and the
swap emits a fresh LCP candidate.
```diff
 const inter = Inter({
   subsets: ["latin"],
   variable: "--font-inter",
-  display: "swap",
+  // "optional" keeps the fallback if Inter is not ready in ~100 ms, which stops
+  // the swap from re-stamping LCP on every text-led route.
+  display: "optional",
 });
```
Expected: −1.0 to −2.0 s LCP on `/credits`, `/compare`, `/variants`, `/search`; `/credits`
4036 → ≈2000 ms. Keep `swap` on Anton (the brand face, preloaded by `next/font`).
Risk: on a very slow first visit the body stays in the fallback for that page view — a
deliberate design/perf trade-off.

**P1-4 · a11y — the header search button has no accessible name below `sm`** — owner **NAV-UX**
(`components/nav/nav-chrome.tsx:199-211`). LH `button-name` = 0 on all 7 routes: the only
text ("Search") is `hidden sm:inline` and `⌕` is `aria-hidden`, so at 390 px the computed
name is empty (measured 9×19 px target).
```diff
  <button type="button" onClick={() => openPalette()} aria-haspopup="dialog" aria-expanded={paletteOpen}
+         aria-label="Search every 911">
```
Expected: `button-name` audit passes site-wide. Risk: none.

**P1-5 · a11y — `label-content-name-mismatch` on the logo link** — owner **NAV-UX**
(`nav-chrome.tsx:155-162`). Visible text `911.SHOWCASE`, `aria-label="911 Showcase — home"`
→ WCAG 2.5.3 (Label in Name) fail, LH score 0 on all routes.
```diff
-  aria-label="911 Showcase — home"
+  aria-label="911.SHOWCASE — home"
```
Risk: none.

**P1-6 · a11y — contrast: `metal-700` (2.76:1) and `guards` (3.73:1) fail AA for body
text** — owner **LEAD** (`styles/tokens.css:22,15`). `text-metal-700` appears 55× across
19 files (nav, footer, compare, palette, credits, variant grid, viewer, swappers) at
`--text-mono-xs` (11 px); `text-guards` appears 48× at the same size. LH
`color-contrast` = 0 on all 7 routes.
```diff
-  --color-guards: #d5001c;   /* 3.73:1 on ink — AA large only */
+  --color-guards: #e01a2b;   /* 4.62:1 on ink — AA normal */
-  --color-metal-700: #55555e; /* 2.76:1 on ink */
+  --color-metal-700: #7e7e88; /* 4.72:1 on ink */
```
If the brand red must stay exactly `#d5001c`, then instead replace the 55 `text-metal-700`
sites with `text-metal-500` (6.04:1, already used by `.label`) and the small-text
`text-guards` sites with `text-guards-glow` (5.35:1). Note `components/fx/runtime.tsx:28-46`
mirrors the token hexes for SSR/canvas use and must be updated in the same commit.
Risk: brighter greys/reds flatten the "deep black" look slightly; the border uses of
`metal-700` are unaffected in practice.

**P1-7 · a11y — footer inline link distinguished by colour only** — owner **NAV-UX**
(`components/nav/footer.tsx`, the `<a className="text-guards">` inside the disclaimer
`<p>`). LH `link-in-text-block` = 0 on all routes → WCAG 1.4.1.
```diff
-  <a className="text-guards hover:text-guards-glow" href=…>
+  <a className="text-guards underline decoration-guards/60 underline-offset-2 hover:text-guards-glow" href=…>
```
Risk: visual change (an underline appears in body copy).

**P1-8 · a11y — touch targets below 24 px (WCAG 2.5.8)** — owner **NAV-UX**, with
**LEAD** for `app/credits/page.tsx` and **3D-HERO**/**VARIANT-PAGES** for the hero pill.
LH `target-size` = 0 on all 7 routes. Measured heights: nav links 17 px, search button
19 px, credits `<a>` 20 px, `<details><summary>` 17 px, `Specifications ↓` pill 22 px,
`▶ Load the 3D viewer` 22 px. Fix by adding `min-h-11 inline-flex items-center` (or
`py-2`) to those controls; for the credits `<summary>` use `py-3`.
Risk: the nav bar gets ~30 px taller on mobile; adjust `--nav-h` if it collides.

**P1-9 · a11y — lightbox does not restore focus and does not inert `#main`** — owner
**VARIANT-PAGES** (`components/variant/lightbox.tsx:126-137`). Measured: after `Escape`,
`document.activeElement` is `BODY` (not the thumbnail), and `#main` has no `inert`
attribute although the dialog claims `aria-modal="true"` → WCAG 2.4.3 + 4.1.2.
```diff
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
+   const previouslyFocused = document.activeElement as HTMLElement | null;
+   const main = document.getElementById("main");
+   const supportsInert = "inert" in HTMLElement.prototype;
+   if (main && supportsInert) main.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    lenis?.stop();
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      lenis?.start();
+     if (main && supportsInert) main.removeAttribute("inert");
+     if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [lenis, open]);
```
`components/nav/use-nav.ts:89-143` (`useFocusTrap`) already does exactly this — reuse it.
Risk: none.

**P1-10 · a11y — no focus ring on the `/compare` and `/variants` text inputs** — owner
**NAV-UX** (`components/nav/compare-table.tsx:549`, `components/nav/variant-grid.tsx:325`),
**LEAD** (`app/search/page.tsx:92`). Measured `outline-style: none` on those inputs while
every other control on the site reports `solid / 2px`. They signal focus with a 1 px
border-colour change only → WCAG 2.4.7 is marginal.
```diff
-  className="… outline-none placeholder:text-metal-700 focus-visible:border-guards"
+  className="… outline-none placeholder:text-metal-700 focus-visible:border-guards focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
```
Risk: none.

**P1-11 · `/credits` scrolls 572 px sideways at 390 px (WCAG 1.4.10)** — owner **LEAD**
(`app/credits/page.tsx`). The credit `<li class="grid … md:grid-cols-12">` children have
`min-width: auto` and contain unbreakable Wikimedia filenames
(`File:1974_Porsche_911_Carrera_RS_3.0_Litre_…`), giving a min-content width of 598–962 px
that widens the whole document (the fixed header stretches with it). `/` overflows 63 px
(timeline drift plate) and `/variants` 60 px.
```diff
-  <li className="grid gap-2 py-5 md:grid-cols-12">
+  <li className="grid min-w-0 gap-2 py-5 md:grid-cols-12">
…
-    <span className="font-mono text-mono-xs md:col-span-3">{credit.file}</span>
+    <span className="min-w-0 break-words font-mono text-mono-xs [overflow-wrap:anywhere] md:col-span-3">{credit.file}</span>
```
Apply `min-w-0` to every direct grid child. Expected: `scrollWidth == clientWidth` at
390 px. Risk: filenames wrap instead of overflowing (intended).

### P2 — nice to have

**P2-1 · `/favicon.ico` 404s on every route** (LH `errors-in-console`, best-practices 93–96).
Owner **LEAD**: add `app/icon.svg` (or `app/favicon.ico`). Zero-risk, removes the only
console error seen by Lighthouse on 6 of 7 routes.

**P2-2 · `THREE.Clock` deprecation warning** on every 3D page. Owner **3D-HERO**: it comes
from `@react-three/fiber` 9.8 against three 0.186; nothing to change in our code — just do
not treat it as a regression.

**P2-3 · render-blocking CSS 158–171 ms** (one `3mivnvw24msvr.css`) on every route.
Owner **LEAD**: consider splitting `app/globals.css` so `tokens.css` (pure custom
properties) inlines and the Tailwind layer loads async, or preloading it.
Gain ≈ 150 ms LCP across the board. Risk: FOUC if the tokens are needed for first paint.

**P2-4 · `/variants` best-practices 93 vs 96 elsewhere** — not investigated; check whether
the `LoadingScreen` `sessionStorage` path logs anything.

**P2-5 · a 236 KB script chunk is loaded on every route**, including `/compare`,
`/variants` and `/credits`, which have no 3D at all (`/_next/static/chunks/2z_fhf4_5nv0l.js`).
Owner **LEAD**: after a clean build, inspect the chunk graph; if three/drei escaped
`next/dynamic({ ssr: false })`, move it back behind the boundary. Expected −100…−200 KB on
the three non-3D routes. Requires a build to confirm — **not measured**.

---

## 5. Accessibility findings (WCAG-oriented)

| Sev | Finding | Where | WCAG | Evidence |
|---|---|---|---|---|
| **High** | Header search button has no accessible name below the `sm` breakpoint | `components/nav/nav-chrome.tsx:199-211` | 4.1.2 | LH `button-name` 0/7 routes |
| **High** | `metal-700` body text 2.76:1, `guards` body text 3.73:1 | `styles/tokens.css:15,22`, 55 + 48 usage sites | 1.4.3 | LH `color-contrast` 0/7 routes; §2 table |
| **High** | `/credits` 572 px horizontal scroll at 390 px | `app/credits/page.tsx` | 1.4.10 | `scrollWidth 962` vs `clientWidth 390` |
| **Medium** | Logo link's accessible name does not contain its visible text | `nav-chrome.tsx:155-162` | 2.5.3 | LH `label-content-name-mismatch` 0/7 routes |
| **Medium** | Inline footer link distinguished by colour only | `components/nav/footer.tsx` | 1.4.1 | LH `link-in-text-block` 0/7 routes |
| **Medium** | Touch targets 17–22 px high (nav links, summary, credits links, pills) | nav, credits, variant hero, embed facade | 2.5.8 | LH `target-size` 0/7 routes; measured heights |
| **Medium** | Lightbox: no focus restore, `#main` not inert despite `aria-modal="true"` | `components/variant/lightbox.tsx:126-137` | 2.4.3, 4.1.2 | focus lands on `BODY` after `Escape` |
| **Medium** | No visible focus indicator on `/compare` + `/variants` inputs | `compare-table.tsx:549`, `variant-grid.tsx:325`, `app/search/page.tsx:92` | 2.4.7 | computed `outline-style: none` |
| **Low** | React hydration error regenerates the `/` subtree (assistive tech gets a re-created tree) | `components/fx/runtime.tsx:220-240` | 4.1.2 / robustness | error #418 on desktop `/` only |
| **Low** | `guards-deep` (2.11:1) is reachable as text colour | `styles/tokens.css:16` | 1.4.3 | used in fx palettes (decorative) — audit before shipping as text |

Verified **good**: `lang="en"`; exactly one `<main>`/`<header>`/`<footer>` per route; skip
link first in tab order on every route; no heading-level jumps; **0** images missing `alt`
across 9 routes; **0** broken images; every `<iframe>` has a `title`; every form control
labelled; no positive `tabindex`; no focusable node inside `aria-hidden`; no empty links;
no `target="_blank"` without `rel="noopener"`; both dialogs expose `role="dialog"` +
`aria-modal="true"` + a name; the palette is a proper combobox with
`aria-activedescendant`; the lightbox counter is an `aria-live="polite"` region; the
custom cursor never sets `cursor: none` and renders nothing for coarse pointers or
reduced motion.

**Not measured (needs a human or a device):** NVDA / VoiceOver / TalkBack passes, screen-reader
announcement of the timeline and the 3D viewer, keyboard operation of the Sketchfab iframe
after the facade is clicked, YouTube iframe playback, focus order *inside* the pinned
timeline at scroll positions, hover/focus-state contrast, and 200 % text zoom.

---

## 6. Not measured / caveats

- **INP** is reported as TBT (no real interaction trace on a throttled device). TBT is the
  stated budget, so INP proper is **not measured**.
- Lighthouse mobile renders WebGL through **SwiftShader** (software GL). `/`'s 15 010 ms TBT
  is therefore pessimistic versus a real phone GPU; the chunk download + parse cost is real,
  the rasterisation cost is not representative.
- Only **2 of 162** variant pages were sampled (the two named in the brief). The other 160
  are assumed to share the components measured here.
- The 33 Sketchfab embeds and 94 YouTube embeds were **not** activated (facade click-through
  not exercised), so their own cost is unmeasured.
- `/` was measured against a **stale prerender** (P0-C). Every other route's HTML matches
  its compiled chunk.
- No memory profiling over long sessions, no `PerformanceObserver` for memory/GC, no
  battery/network-realistic shaping beyond Lighthouse's simulation.
- `--form-factor=desktop` is rejected by Lighthouse 12; the desktop runs used `--preset=desktop`.

---

## 7. How to reproduce

```bash
# 0. tools (already installed by the lead)
ls ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
/tmp/opencode/perftools/node_modules/.bin/lighthouse --version      # 12.8.2

# 1. serve the existing build (never run `npm run build` from this audit)
cd /home/abdulhadi/Work/porsches
npx next start -p 3111                     # BUILD_ID H4W9nghTeYHUlk6dGssWr

# 2. Lighthouse, mobile (simulated 4G) — the acceptance profile
CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
for r in / /911/992-1 /911/992-1/gt3-rs /911/901/911-2.0 /compare /variants /credits; do
  slug=$(echo "$r" | sed 's#^/##; s#/#_#g'); [ -z "$slug" ] && slug=root
  npx lighthouse "http://127.0.0.1:3111$r" --quiet --output=json \
    --output-path="/tmp/opencode/lh/mobile__$slug.json" \
    --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader" \
    --preset=mobile --only-categories=performance,accessibility,best-practices,seo \
    --max-wait-for-load=45000
done

# 2b. desktop preset (drop --preset=mobile, use --preset=desktop)
npx lighthouse "http://127.0.0.1:3111/compare" --quiet --output=json \
  --output-path=/tmp/opencode/lh/desktop__compare.json \
  --chrome-flags="--headless=new --no-sandbox" --preset=desktop

# 3. parse the JSONs into the tables above
node /tmp/opencode/perftools/lh-parse.cjs

# 4. Playwright harness (vitals, canvas counts, console/404s, DPR, reduced motion,
#    mobile emulation, a11y sweep, keyboard flows, link crawl) — one section at a time
cd /tmp/opencode/perftools
node measure.mjs A   # cold desktop vitals + canvases + http errors, per route
node measure.mjs B   # WebGL lifecycle across hero → gen → variant → compare → back
node measure.mjs C   # prefers-reduced-motion: reduce
node measure.mjs D   # iPhone 13 @ DPR 3 emulation
node measure.mjs E   # static a11y sweep (alt, labels, landmarks, headings, aria)
node measure.mjs F   # tab-through, cmd-K palette, lightbox, compare, link crawl
node measure.mjs G   # WCAG contrast maths for the token palette
# results accumulate in /tmp/opencode/perf-results.json after each section
# (F5 expects <select> on /compare; /compare actually uses role=combobox inputs, so use
#  f56.mjs + f1.mjs, which is what produced the numbers in this document)

# 5. reproduce the P0s
# 5a. dev server 500 on `/`
npx next dev -p 3112 &            # same source, non-minified error
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3112/            # 500
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3112/compare     # 200
# 5b. the quality-82 400
curl -s -o /dev/null -w "%{http_code}\n" \
  'http://127.0.0.1:3111/_next/image?url=%2Fimages%2F992-2%2Fimg-2024-porsche-911-992-carrera-t-c3e1c3f6-1920.avif&w=1280&q=82'  # 400
curl -s -o /dev/null -w "%{http_code}\n" \
  'http://127.0.0.1:3111/_next/image?url=%2Fimages%2F992-2%2Fimg-2024-porsche-911-992-carrera-t-c3e1c3f6-1920.avif&w=1280&q=75'  # 200
# 5c. stale prerender vs built chunk
grep -c 'q=82' .next/server/app/index.html                                  # 0
grep -c 'q=75' .next/server/app/index.html                                  # 19
grep -c 'quality:82' .next/server/chunks/ssr/_0w7wdqs._.js                  # 1

# 6. the hydration mismatch (desktop only)
node /tmp/opencode/perftools/stack.mjs /            # minified React #418 + stack
node /tmp/opencode/perftools/why.mjs /911/901/911-2.0   # request-waterfall sanity check
node /tmp/opencode/perftools/overflow.mjs          # 390 px horizontal-overflow culprits
node /tmp/opencode/perftools/ov2.mjs               # min-content culprit on /credits
```

**Caveats on the harness:** Chrome is launched with `--enable-unsafe-swiftshader` so WebGL
works headless; `pkill` the chrome/lighthouse processes between long batches (a stale headless
chrome made one Lighthouse run hang for >7 min on `/911/901/911-2.0`; the page itself loads in
432 ms with 35 requests and no pending work — `why.mjs` output).
---

## 7. Post-fix status (PERF-FIX agent)

Owner: **PERF-FIX**. Appended by PERF-FIX; §1–§6 are PERF-A11Y's original findings and are
left untouched. Only the *status* column below is mine.

- Date: 2026-10-03. Build measured: `.next` `BUILD_ID = wv6Wrue1M9L6xoQ43KUDS` (the lead's
  post-fix build, `next start -p 3111`; no source file was newer than `BUILD_ID` when I
  started, so **the numbers in the "before" columns are the lead's build, and my own source
  edits are NOT in it**).
- I may not run `npm run build`, so **every "after" number below was produced by injecting
  the exact compiled CSS of my change at runtime** (`page.addStyleTag`) or by rewriting the
  served stylesheet through a local proxy, and by static chunk analysis of `.next`. All of it
  is real measurement, but it needs `npm run build` + `npm start` to be confirmed in the
  shipped bundle. `npx tsc --noEmit` and `npx eslint .` are clean.
- Harness: Playwright/Chromium 140, iPhone-13 emulation (390×844 @3, coarse pointer) or
  1440×900 desktop, CDP `Network.emulateNetworkConditions` 1.6 Mbps / 150 ms + `Emulation
  .setCPUThrottlingRate({rate: 4})`, fresh context per run (cold HTTP cache), median of
  ≥3 interleaved paired runs. Lighthouse 13.5.0 where quoted.
- **Caveat — machine load.** The box ran at load average 3–8.4 on 8 cores during these runs
  (Firefox + the lead's own processes). Absolute FCP/LCP are inflated by 2–3× versus an idle
  machine; **only paired deltas between interleaved arms are meaningful**, which is why every
  A/B below alternates arms run-by-run. First LH attempt on `/compare` returned perf 43 /
  TBT 5868 ms purely from contention and was discarded.

### 7.1 Status of every proposal

| # | Proposal | Status (PERF-FIX) | Why / evidence |
|---|---|---|---|
| P0-A | `/` 500s at SSR (`blurDataURL`) | **FIXED** (lead) | verified by the lead; `/` serves 200 and the hero image loads (`q=75/82` both in `images.qualities`) |
| P0-B | `q=82` 400s | **FIXED** (lead) | `next.config.ts` now has `qualities: [70, 75, 82, 90]`; 0 4xx on every route I crawled |
| P0-C | rebuild from clean | **DONE** (lead) | `BUILD_ID wv6Wrue1M9L6xoQ43KUDS`, prerender matches the chunks |
| P0-D | `/` LCP gated on an opacity-0 fade | **FIXED** (lead) | `/` LCP element is no longer the `<h1>`; hero canvas now waits for `load` + idle |
| P0-E | no WebGL context on phones | **FIXED** (lead) | 0 canvases on `/` under mobile emulation *and* on this software-GL desktop |
| P1-1 | fx capability probe hydration error | **FIXED** (lead) | 0 console messages / 0 page errors on all 5 routes I crawled |
| P1-2 | 1.14 MB of full-size AVIFs on `/` | **PARTIAL** (lead's part done) | chapter images now go through `next/image` (`sizes`, `quality 70`). Remaining: `/` still ships a **164 kB raw / 32.7 kB gzip JSON chunk** of the client catalogue in its *initial* payload (`chunks/1myzuwx5ozir0.js`, `r.exports=JSON.parse(…)`) |
| **P1-3** | `display:"optional"` for Inter | **REJECTED** | measured, no effect: paired A/B with the *real* `optional` semantics on the 7 Inter `@font-face` blocks (`CSSOM` verified `Inter:optional` vs `Inter:swap`), 4 paired runs × 4 routes → ΔLCP **+52 / +52 / −20 / −48 ms** (noise). Setting **all three** families to `optional` also changed nothing (`/compare` 5840→5840). The premise is wrong: the text-led LCP gaps are caused by the **first-visit `LoadingScreen`** and by the **1.34 MB `/credits` document**, not by the webfont swap. See §7.2 |
| P1-4 | search button accessible name | **FIXED** (lead) | `aria-label` present |
| P1-5 | logo label-in-name | **FIXED** (lead) | — |
| P1-6 | contrast | **FIXED** (lead) | `--color-guards-text` + raised `--color-metal-700` in place |
| P1-7 | footer link underlined | **FIXED** (lead) | — |
| **P1-8** | sub-24 px touch targets | **FIXED (by me, verified)** | measured every interactive element on the 4 required routes; **0 non-exempt targets under 24×24 remain**. See §7.3 |
| P1-9 | lightbox focus restore + `#main` inert | **FIXED** (lead) | — |
| P1-10 | focus ring on text inputs | **FIXED** (lead) | global `input:focus-visible` rule in `globals.css` |
| P1-11 | `/credits` 572 px overflow | **FIXED (by me — the lead's fix was incomplete)** | the lead's `min-w-0` on the `<li>` is in the build but the grid *children* still overflow: measured **+574 px** on the lead's build. With `min-w-0` + `break-words`/`[overflow-wrap:anywhere]` on the children: **0**. See §7.4 |
| P2-1 | `/favicon.ico` 404 | **FIXED** (lead) | `app/icon.svg`; console clean on all routes |
| **P2-2** | `THREE.Clock` deprecation | **REJECTED (upstream)** | we construct no `Clock`: the only call is `state.clock.getElapsedTime()` (`components/hero/hero-scene.tsx:98`). It is `new THREE.Clock()` in **`@react-three/fiber@9.8.1` `core/store.ts`** (shipped bundle: `dist/events-9ce18a08.esm.js:1054`) hitting **`three@0.186.1` `Clock` constructor** (`build/three.core.js:56832`, `@deprecated, r183`). R3F master (v10 canary) *still* uses `THREE.Clock`; the latest published R3F **is** 9.8.1 and the latest three **is** 0.186.1, so there is no forward pairing available. The only version pairing that silences it is `three@0.182.x` (last release before r183) + `@react-three/fiber@9.8.1` — **not applied**, and it is also no longer reachable here (see below) |
| **P2-3** | render-blocking CSS | **PARTIAL — measured, not shipped** | ceiling measured by inlining the stylesheet into `<head>` (what critters/`experimental.optimizeCss` emits): **FCP 2044→1036 ms** (`/compare`) and **2356→1032 ms** (`/911/992-1/gt3-rs`), i.e. ~1 s, because the 12.1 kB (gzip) sheet otherwise queues behind ~14 blocking scripts on 6 HTTP/1.1 connections. Not shipped: it needs `critters` as a new dependency **plus a build**, and a build failure would break the lead's pipeline. Recipe in §7.6 |
| **P2-4** | `/variants` best-practices 93 | **FIXED (lead)** | re-measured on the lead's build: `/variants` best-practices **100, zero failing audits**; console is clean on `/`, `/compare`, `/variants`, `/credits`, `/911/992-1/gt3-rs`. `LoadingScreen` logs nothing (it never touches `console`) — the old 93 was the `/favicon.ico` 404 in `errors-in-console` |
| **P2-5** | ~236 KB chunk on every route | **PARTIAL (one structural win shipped)** | `three`/`drei`/`postprocessing` are already behind `next/dynamic` + `optimizePackageImports` and are **not** in any route's initial payload (verified per route from the prerendered HTML). `components/nav/index.ts` is **dead code** — nothing imports the barrel. What *is* on the critical path of all 179 routes is **framer-motion** (`chunks/3d261__cgt1gq.js`, **136.8 kB raw / 45.2 kB gzip / 39.6 kB brotli**), reached statically through `nav-chrome.tsx` → `command-palette.tsx` + `cursor.tsx` in the root layout. Moved both behind `next/dynamic({ssr:false})` (cursor gated on a fine pointer + no reduced motion; palette panel warmed in `requestIdleCallback`). See §7.5 |

### 7.2 P1-3 · what actually re-stamps the text LCP

Paired A/B, `swap` vs `optional`, CDP 1.6 Mbps / 150 ms + CPU 4×, iPhone 13, cold cache,
medians of 4 interleaved runs (both arms through the same local proxy, so the only
difference is the `font-display` keyword; verified in the CSSOM):

| Route | swap FCP/LCP | optional FCP/LCP | ΔLCP | LCP element |
|---|---|---|---|---|
| `/credits` | 3336 / **3952** | 3288 / **4004** | +52 | `<span> ☰` (JetBrains Mono) |
| `/compare` | 2600 / **7696** | 2616 / **7748** | +52 | `<p>` “911.SHOWCASE” (**Anton**) |
| `/variants` | 2832 / **3896** | 2792 / **3876** | −20 | `<p>` intro (Inter) |
| `/search` | 3040 / **4040** | 3008 / **3992** | −48 | `<p>` intro (Inter) |

Repeating it with **all three families** on `optional` (so even Anton cannot swap) moved
nothing either: `/compare` 5840 → 5840, `/variants` 2544 → 2496, `/search` 2752 → 2744.

Why `optional` cannot help here: Chrome evaluates the 100 ms block period when rendering
*starts*. This app's first paint is already late (2.6–3.3 s under this throttle) while the
latin subsets arrive at ≈0.6–1.0 s, so the webfont is simply in the cache before first paint,
is used, and never swaps. The real causes of the FCP→LCP gaps:

1. **First-visit `LoadingScreen`** (`app/compare/page.tsx:65`, `app/variants/page.tsx:32`,
   `components/nav/loading-screen.tsx`, 2.5 s cap + 180 ms). Same browser context, two
   consecutive visits (it is `sessionStorage`-gated):

   | Route | visit 1 FCP → LCP | visit 2 FCP → LCP |
   |---|---|---|
   | `/compare` | 2144 → **5812** | 404 → **1248** |
   | `/variants` | 364 → 940 | 388 → 548 |

   That is a **−4.6 s** LCP difference with nothing else changed, and it matches the audit's
   LH numbers (`/compare` FCP 843 + ~2.1 s ≈ LCP 2953).
2. **`/credits` is a 1.34 MB server-rendered document** (840 `<li>` rows). FCP 3336 under
   throttle; the LCP element is the **8.6 px-wide ☰ hamburger**, never the `<h1>` — the audit's
   "LCP is text" reading holds but the cost is parse/style of the document, not a swap.
3. `optional` also carries a real downside on this platform: the `Inter Fallback`
   metric-override face is `src: local(Arial)` and reports **status `error`** on this Linux
   box (no Arial), so a fallback visit renders in the generic `sans-serif` — measured
   **264 px vs 253 px** for the same probe string (+4.4 % width, i.e. reflowed body copy).

**Recommendation: keep `display: "swap"` for Inter.** If the lead wants the LCP, the lever is
the `LoadingScreen` (cap it, or run it only when a route is genuinely slow) and the size of
the `/credits` document (paginate it), not the font strategy.

### 7.3 P1-8 · touch targets (WCAG 2.5.8)

Measured: every `a[href], button, input, select, textarea, summary, [role=button|option]`
with a non-zero box on each route. "Before" = the lead's build; "after" = the same page with
the compiled CSS of my edits injected. Inline links inside a sentence are WCAG-exempt and are
counted separately.

| Route | sub-24 px before | after | horizontal overflow before → after |
|---|---|---|---|
| `/` (390 px) | 12 | **0** | +63 → **0** |
| `/911/992-1/gt3-rs` (390 px) | 33 | **1** (inline link inside the footer sentence — exempt) | 0 → 0 |
| `/variants` (390 px) | 45 | **0** | +35 → **0** |
| `/compare` (390 px) | 16 | **0** | 0 → 0 |
| `/credits` (390 px) | 767 (the 840 filename links) | **0** | +574 → **0** |
| `/` (1440 px) | 16 | **0** | **+230 → 0** |
| `/911/992-1/gt3-rs` (1440 px) | 39 | **5** (4 exempt inline + 1 footer inline) | 0 → 0 |
| `/variants` (1440 px) | 58 | **0** | 0 → 0 |
| `/compare` (1440 px) | 20 | **0** | 0 → 0 |
| `/credits` (1440 px) | 770 | **0** | 0 → 0 |

Fixed by giving each control a *valid* (non-token) size, never by removing the label or the
focus ring: header search button `min-w-11 justify-center` (it was **8.6 × 44 px** — the lead
fixed the height only), top-bar links/buttons `py-2`, mega-sheet close `min-h-11`,
`Specifications ↓` / `▶ Load the 3D viewer` / `Compare generations →` / `Back to the timeline`
/ `Open the full comparison` `min-h-11`, `Compare →` / `⌘K — search` / `Filters` / pagination
/ facet chips / `Compare four` / `Swap A ⇄ B` / `Surprise me` / `Copy shareable link` /
`Change` / footer generation links / breadcrumb / source links `min-h-6` (+ `min-w-6` on the
21.8 px-wide generation facet buttons), inputs and selects `px-3 py-2`, range inputs
`min-h-6`, `<summary>` `min-h-11`, skip link `py-2` (22 → 32.5 px when focused).

Most of these were only 16–22 px tall because `py-[--space-2]` **compiles to nothing** — see
§7.7.

### 7.4 Horizontal overflow at 390 px — root causes found

| Route | before | culprit (measured, not guessed) | fix |
|---|---|---|---|
| `/credits` | **+574 px** | `li.grid.min-w-0` → `span.md:col-span-3` → `a` with an unbreakable Wikimedia filename (clone-measured min-content 962 px). The lead's `min-w-0` on the `<li>` cannot help: the *children* have `min-width: auto` | `min-w-0` + `break-words` on all five children, `[overflow-wrap:anywhere]` on the link (`app/credits/page.tsx`) |
| `/variants` | **+35 px** | the card spec rows: `dl > div.flex.gap-2 > dd.truncate` — `white-space: nowrap` (`truncate`) makes the row's **min-content 477–492 px**, and `min-w-0` was only on the `<dd>`, not on the flex row / `<dl>` / `<li>` / `<article>` | `min-w-0` on `li`, `article`, `dl` and each spec row (`components/nav/variant-grid.tsx`) |
| `/` (390 px) | **+63 px** | `[data-ts-era]` — the giant outlined era stamp is `absolute inset-x-0` and GSAP tweens it to `scale: 1.16` (`components/timeline/index.tsx:234-240`); its box is 452.4 px wide in a 390 px viewport. Not the timeline drift plate the audit guessed. `YearNumeral`'s `inset-x-[-3vw]` wrapper also hangs 11.7 px off both edges | `overflow-x-clip` on the chapter `<article>` (`components/timeline/chapter.tsx:50`) — a clip container, so it costs no scroll container and no vertical layout change |
| `/` (1440 px) | **+230 px** | same era stamp, wider at `11vw` | same fix |

No `overflow-x: hidden` was added to `body`/`html`; `body { overflow-x: clip }` in
`globals.css:25` was already there and left alone.

### 7.5 P2-5 · framer-motion off the critical path

- Chunk `3d261__cgt1gq.js` = **136.8 kB raw / 45.2 kB gzip / 39.6 kB brotli**, present in the
  initial `<script>` list of **every** prerendered route (8/8 checked) because
  `app/layout.tsx → site-nav → nav-chrome` statically imported `command-palette.tsx` and
  `cursor.tsx`, both of which import `framer-motion`. It is ~15 % of the ~300 kB of
  transferred initial JS I measured per route.
- Shipped: `components/nav/cursor.tsx` is now `next/dynamic({ssr:false})` behind
  `useCursorEligible()` (fine pointer + no reduced motion → phones and motion-sensitive users
  never download it); `components/nav/command-palette.tsx` keeps only the context, the ⌘K /
  `/` shortcut and the launcher, and loads the new `components/nav/command-palette-panel.tsx`
  (the dialog, verbatim) through `next/dynamic({ssr:false})`, warmed in
  `requestIdleCallback` so the first ⌘K press still opens instantly. `nav-chrome`'s two
  `AnimatePresence` blocks became conditional rendering + the existing `page-in` keyframe —
  the same trade the lead already made for `PageTransition` (the exit half never ran in the
  App Router anyway).
- Verified statically: walking static imports from `app/layout.tsx` now reaches 13 modules
  and the packages `next`, `react`, `lenis` (already `import()`-ed in `lenis-provider`),
  `gsap` (same) — **`framer-motion` is no longer statically reachable**.
- Not verifiable without a build: the byte saving itself (45.2 kB gzip) and the mega-panel /
  sheet feel. `scripts/smoke.mjs` (177 routes) + a ⌘K / mega-menu click-through is needed.
- Next lever, for whoever owns the catalogue scripts: `/`'s initial payload contains
  `chunks/1myzuwx5ozir0.js` = the whole 164 kB (32.7 kB gzip) `data/client-catalog.json`
  inlined as a JS module, while the timeline only needs the nine generation summaries. A
  generation-only catalogue for `/` would be the largest single remaining win on that route.

### 7.6 P2-3 · render-blocking CSS — measured, not shipped

One stylesheet, `2vcreo4_99rdn.css`, **63.3 kB raw / 12.1 kB gzip**, linked render-blocking in
`<head>`, and it contains the Tailwind output *and* `styles/tokens.css` *and* 28
`@font-face` blocks, so it cannot be dropped from the critical path. Arm B inlined those
bytes into `<head>` and removed the `<link>` (exactly what critters emits), 3 paired runs:

| Route | linked FCP → LCP | inlined FCP → LCP |
|---|---|---|
| `/compare` | 2044 → 5684 | **1036** → 1308 |
| `/911/992-1/gt3-rs` | 2356 → 2672 | **1032** → 3160 |

≈ **1 s of FCP**, because the sheet otherwise queues behind ~14 blocking scripts over 6
connections at 1.6 Mbps. LCP is noisier (the `/compare` LCP is dominated by the
`LoadingScreen`, and the variant LCP is an image that arrives whenever it arrives), so the
honest claim is "≈1 s off FCP, LCP unproven". `next@16.3.8` still exposes
`experimental.optimizeCss`, but it needs `critters` installed — I did not add a dependency or
flip a flag that could break the lead's build. To ship it: `npm i -D critters` +
`experimental: { optimizeCss: true }` in `next.config.ts`, then re-measure; if the FOUC risk
matters, the same win can be had by preloading the sheet (`<link rel="preload" as="style">`).

### 7.7 Cross-cutting finding that outranks several items above

**907 `-[--token]` arbitrary utilities in `app/` + `components/` compile to invalid CSS.**
Tailwind v4 does not resolve the v3 syntax `py-[--space-2]` to `var(--space-2)`; the emitted
rule is literally

```css
.py-\[--space-4\]{padding-block:--space-4}      /* invalid → dropped by the parser */
.gap-\[--space-6\]{gap:--space-6}
.px-\[--gutter\]{padding-inline:--gutter}
.max-w-\[--maxw-prose\]{max-width:--maxw-prose}
.top-\[--space-8\]{top:--space-8}
```

Evidence: `var(--gutter)` and `var(--maxw-prose)` occur **0 times** in the built stylesheet;
in the browser `getComputedStyle(document.querySelector("main > div")).paddingTop === "0px"`
on `/credits` (it should be 128 px) and `max-width: none` on every prose block. Only the
*namespaced* tokens work (`text-display-2`, `min-h-dvh`, `inset-x-0`, `text-[clamp(…)]`).

Consequences that the rest of this document measures: no page gutters, no `max-w`, no
`gap`/`padding` rhythm from the `--space-*` scale, and **most of the sub-24 px touch targets
in P1-8** (a `<button class="py-[--space-2]">` is 18.5 px tall, not 32.5 px). v4 wants
`py-(--space-2)` or `py-[var(--space-2)]`. I deliberately did **not** migrate 907 call sites:
it changes the layout of every page and cannot be visually verified without a build. This is
the lead's call and should be a scripted migration + a visual pass, and it will move several
numbers in §7.3 again.

### 7.8 Remaining measurable gaps (lead)

1. `/compare` and `/variants` LCP on a **first visit** is gated by the 2.5 s `LoadingScreen`
   (§7.2). Cheapest fix with the biggest measured effect.
2. `/credits` ships a **1.34 MB** HTML document for 840 rows; FCP 3336 ms under throttle.
3. `/` ships the **164 kB raw / 32.7 kB gzip** client catalogue in its initial JS (§7.5).
4. `experimental.optimizeCss` would buy ≈1 s FCP but needs `critters` + a build (§7.6).
5. 907 dead `-[--token]` utilities (§7.7) — the single change that invalidates part of §7.3
   and most of the visual design.
6. `THREE.Clock` is upstream and only appears when a real GPU context is created; on this
   machine the hero refuses to build one (software GL), so 0 canvases and 0 warnings on
   `/` and `/911/930-turbo-1975` — the warning is no longer observable in this environment.
7. Everything in §7.3/§7.4 needs one `npm run build` to confirm in the shipped bundle.

### 7.9 Reproduce

```bash
# the lead's build (fresh as of this audit)
cd /home/abdulhadi/Work/porsches && npx next start -p 3111     # BUILD_ID wv6Wrue1M9L6xoQ43KUDS

# harnesses used for §7 (all in /tmp/opencode/perffix)
node vitals.mjs                 # FCP/LCP/CLS/TBT/JS per route, CDP 1.6 Mbps + CPU 4x
node overflow3.mjs /,/variants,/credits   # hide-and-re-measure bisect → the true culprit
node minc2.mjs /variants         # clone-based min-content width per element
node targets.mjs phone|desktop …  # every interactive element with its box
node verify-all.mjs              # before/after with my CSS injected (overflow + touch targets)
PORT=3122 MODE=passthrough     node proxy.mjs &   # control
PORT=3123 MODE=optional-inter  node proxy.mjs &   # P1-3 arm: Inter @font-face → optional
PORT=3124 MODE=optional-all     node proxy.mjs &   # P1-3 control arm: all three families
PORT=3125 MODE=inline-css       node proxy-css.mjs &   # P2-3 arm: stylesheet inlined
node fontab.mjs "/credits,/compare,/variants,/search" 4     # interleaved swap/optional A/B
node intro.mjs                  # first-visit vs warm-visit LCP (LoadingScreen)
node csstab.mjs                 # linked vs inlined CSS
node graph.mjs                  # static import graph from app/layout.tsx
node chunks.mjs                 # per-route initial JS + what is inside each chunk
node console-check.mjs          # console / failed requests / page errors per route
```


## 8. Lead verification after the CSS fix, credits pagination and `inlineCss` (2026-10-03)

The final integration pass changed three things the audit had flagged, so the numbers below are
the ones that count. All LCP figures are **measured**, not simulated: Playwright with CDP
`Network.emulateNetworkConditions` (1.6 Mbps / 150 ms RTT) + `Emulation.setCPUThrottlingRate(4)`.

### 8.1 The site-wide CSS bug the audit surfaced (P0, lead-fixed)

Tailwind v3's `[--token]` shorthand compiles under Tailwind v4 to the literal declaration
`padding-inline:--gutter`, which is invalid CSS. Every affected rule was silently dropped, so
**497 spacing / radius / tracking / max-width / duration utilities across the site were dead**
(`var(--gutter)` appeared 0 times in the built stylesheet). Migrated 838 occurrences in 42 files to
v4's `(--token)` form; the built CSS now contains `var(--gutter)` and zero `padding-inline:--*`
declarations. Guard: `node scripts/fix-tailwind-var-utilities.mjs --check`.

### 8.2 Measured LCP after every fix (slow 4G + 4× CPU)

| Route | LCP | Element |
|---|---|---|
| `/` | **1.01 s** | `<h1>` hero headline |
| `/credits` | **0.76 s** (median of 3: 756 / 772 / 832 ms; was 2.51 s) | disclaimer paragraph |
| `/variants` | **0.79 s** | intro paragraph |
| `/compare` | **0.76 s** | intro paragraph |
| `/911/901/911-2.0` | **1.36 s** | variant standfirst |
| `/911/992-1/gt3-rs` | **1.26 s** | variant standfirst |
| `/911/993/gt1` | **1.47 s** | hero image |

All inside the 2.5 s budget. `/credits` improved because pagination took the document from
**2.21 MB / 1 067 rows to 338 kB / 60 rows**, which removed most of its main-thread cost.

### 8.3 Lighthouse caveat — this box is not a benchmarking machine

Identical builds produced perf scores of **46 and 73** on `/credits` in consecutive runs, with TBT
of 3 660 ms vs 550 ms. Load average sits at 2.7–3.5 on 8 shared cores while the agent harness
itself runs. Treat Lighthouse numbers here as a smoke signal, not a benchmark; the CDP
measurements in §8.2 are the reliable ones. What Lighthouse *did* verify reliably:

- accessibility **100** on `/` and `/credits` (up from 87 after the contrast, focus-ring,
  touch-target and labelling fixes) and **96–97** elsewhere,
- best-practices **100** on every route (the favicon 404 is gone; it was the sole cause of the
  earlier `/variants` 93),
- SEO **100**, CLS **0.000–0.001** everywhere.

### 8.4 Proposal ledger

| Proposal | Outcome |
|---|---|
| P0-A `/` 500 at SSR | already guarded (`placeholder` only when a `blurDataURL` exists); clean rebuild confirmed |
| P0-B `q=82` 400s | fixed — `images.qualities: [70, 75, 82, 90]` |
| P0-C stale `.next` | fixed — every number above is from `rm -rf .next && next build` |
| P0-D LCP gated on a JS fade | fixed — `<h1>` paints immediately, position-only entrance |
| P0-E WebGL context on phones | fixed — `canRender` now excludes low-power/mobile; canvas waits for `load` + `requestIdleCallback` |
| P1-1 hydration #418 | fixed — `useFxCapability` via `useSyncExternalStore`, never probes during render |
| P1-2 1.14 MB of AVIF on `/` | fixed — timeline images through `next/image` with `sizes` + `quality={70}` |
| P1-3 webfont swap re-stamps LCP | **rejected with evidence** — A/B over 4 paired runs showed Δ within ±52 ms (noise); real cause was the first-visit loading screen and the oversized credits document |
| P1-4/5/6/7/8 a11y | fixed — named controls, AA contrast tokens, underlined footer link, ≥24 px targets, logo label |
| P1-9 lightbox focus | fixed — focus restored to the trigger, `#main` inert while open |
| P1-10 input focus rings | fixed — global `input/select/textarea:focus-visible` rule |
| P1-11 horizontal scroll | fixed — `/credits` +574 → 0, `/variants` +35 → 0, `/` +63 → 0 (desktop `/` +230 → 0) |
| P2-1 favicon | fixed — `app/icon.svg` |
| P2-2 `THREE.Clock` deprecation | **rejected as upstream** — constructed inside `@react-three/fiber@9.8.1`; both packages already latest, only a `three` downgrade would silence it |
| P2-3 render-blocking CSS | shipped as `experimental.inlineCss` rather than `critters` |
| P2-4 `/variants` bp 93 | resolved — it was the favicon 404; now 100 |
| P2-5 universal 236 kB chunk | partial — `framer-motion` moved behind `next/dynamic` in the nav; initial JS 2.03 MB → 1.01 MB overall |
| new: site-wide invalid CSS | fixed (see §8.1) |
| new: `/credits` 2.21 MB document | fixed (see §8.2) |

### 8.5 Remaining measurable debt

- Initial JS is still ~1.0 MB (React + Next runtime + the 160 kB client catalogue + GSAP/Lenis on
  scroll). Cutting further means dropping framer-motion from the remaining UI islands or moving the
  palette index to a worker-backed search.
- TBT on `/` (hero) is dominated by three.js parse/execute after the idle callback. It no longer
  blocks LCP, but it is visible on a 4× CPU throttle.
- Real-device WebGL cost is unmeasured: every 3D measurement on this machine runs on software GL,
  where the hero deliberately refuses to mount a canvas at all.
