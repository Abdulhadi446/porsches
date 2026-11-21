/**
 * Record a ~40 s demo of the Porsche 911 showcase.
 *
 *   node scripts/record-demo.mjs [baseUrl] [outDir]
 *
 * Flow:
 *   0–10 s  home (3D hero + scroll orbit + timeline)
 *  10–20 s  /911/992-2 generation page
 *  20–40 s  /911/992-2/carrera-gts (or first variant) — specs, gallery, videos
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "recording";
const VID_DIR = `${OUT}/video`;
mkdirSync(VID_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-driver-bug-workarounds"],
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: VID_DIR, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} :: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`${page.url()} :: pageerror ${e.message}`));
page.on("requestfailed", (r) => {
  const e = r.failure()?.errorText ?? "";
  if (r.url().startsWith(BASE) && !e.includes("ERR_ABORTED")) errors.push(`req ${r.url()} :: ${e}`);
});

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);
const log = (...a) => console.log(`[${elapsed()}s]`, ...a);

// ---- 1. HOME ----
log("home →", BASE + "/");
await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#main", { state: "attached", timeout: 30000 }).catch(() => log("no #main, continuing"));
await page.waitForTimeout(3500); // let the 3D hero settle
log("home loaded, screenshot");
await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false });

// smooth scroll through the hero / timeline
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy({ top: 180, behavior: "smooth" }));
  await page.waitForTimeout(650);
}
log("home scrolled");
await page.screenshot({ path: `${OUT}/02-home-scrolled.png` });

// ---- 2. GENERATION PAGE ----
log("→ /911/992-2");
await page.goto(BASE + "/911/992-2", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/03-generation.png` });

for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollBy({ top: 260, behavior: "smooth" }));
  await page.waitForTimeout(550);
}
await page.screenshot({ path: `${OUT}/04-generation-scrolled.png` });

// ---- 3. FLAGSHIP VARIANT PAGE ----
const variant = "/911/992-2/carrera-gts";
log("→", variant);
await page.goto(BASE + variant, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/05-variant.png` });

for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy({ top: 220, behavior: "smooth" }));
  await page.waitForTimeout(480);
}
await page.screenshot({ path: `${OUT}/06-variant-scrolled.png` });

log("closing context…");
await ctx.close();
await browser.close();

log("errors:", errors.length ? errors.slice(0, 10) : "none");
console.log("RECORD DONE");
