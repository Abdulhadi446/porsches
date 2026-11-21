import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "recording";
const VID_DIR = `${OUT}/video`;
mkdirSync(VID_DIR, { recursive: true });

let browser, ctx, page;

try {
  console.log("launch chromium");
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-driver-bug-workarounds"],
  });

  console.log("newContext with video");
  ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VID_DIR, size: { width: 1280, height: 720 } },
  });
  page = await ctx.newPage();

  const log = (msg) => console.log(`[${Date.now() / 1000 | 0}s] ${msg}`);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // navigate home, wait a bit
  log(`goto ${BASE}/`);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  log("home loaded");
  await wait(3500);

  // scroll via evaluate
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy({ top: 150, behavior: "smooth" }));
    await wait(800);
  }
  log("scroll done");

  // navigate to generation
  log("goto /911/992-2");
  await page.goto(BASE + "/911/992-2", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);

  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy({ top: 240, behavior: "smooth" }));
    await wait(600);
  }
  log("gen scrolled");

  // variant page
  log("goto /911/992-2/carrera-gts");
  await page.goto(BASE + "/911/992-2/carrera-gts", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3000);

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy({ top: 220, behavior: "smooth" }));
    await wait(450);
  }
  log("variant scrolled");

  log("saving screenshots");
  await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/02-gen.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/03-variant.png`, fullPage: false });

  log("closing");
} catch (e) {
  console.error("Error:", e);
} finally {
  if (ctx) await ctx.close();
  if (browser) await browser.close();
}

log("DONE");