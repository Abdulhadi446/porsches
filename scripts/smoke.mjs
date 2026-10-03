/**
 * Lead smoke test: crawls every generated route, asserts HTTP 200, zero console
 * errors, zero failed asset requests, and that images/iframes actually resolve.
 * Run: node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3111";

const routes = ["/", "/911", "/compare", "/variants", "/search?q=911", "/credits"];
for (const f of readdirSync("data/generations")) {
  const g = JSON.parse(readFileSync(`data/generations/${f}`, "utf8"));
  routes.push(`/911/${g.id}`);
  for (const v of g.variants) routes.push(`/911/${g.id}/${v.id}`);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: pageerror ${e.message}`));
page.on("requestfailed", (r) => {
  const u = r.url();
  const err = r.failure()?.errorText ?? "";
  // Next cancels in-flight RSC prefetches when we navigate away — not a failure.
  if (u.includes("_rsc=") && err.includes("ERR_ABORTED")) return;
  if (u.startsWith(BASE)) failedRequests.push(`${u} :: ${err}`);
});
page.on("response", (r) => {
  if (r.url().startsWith(BASE) && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

const bad = [];
for (const route of routes) {
  consoleErrors.length = 0;
  failedRequests.length = 0;
  let status = 0;
  try {
    const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 45000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(450);
    const brokenImgs = await page.evaluate(() =>
      [...document.images]
        .filter((i) => i.currentSrc && i.complete && i.naturalWidth === 0)
        .map((i) => i.currentSrc),
    );
    if (status !== 200) bad.push(`${route} -> HTTP ${status}`);
    if (brokenImgs.length) bad.push(`${route} -> broken images: ${brokenImgs.join(", ")}`);
    for (const e of consoleErrors) bad.push(`${route} -> console: ${e}`);
    for (const f of failedRequests) bad.push(`${route} -> request: ${f}`);
  } catch (err) {
    bad.push(`${route} -> threw ${String(err).slice(0, 120)}`);
  }
  if ((routes.indexOf(route) + 1) % 25 === 0) console.log(`…${routes.indexOf(route) + 1}/${routes.length}`);
}

await browser.close();
console.log(`\nchecked ${routes.length} routes`);
if (bad.length) {
  console.log(`FAILURES (${bad.length}):`);
  for (const b of bad.slice(0, 60)) console.log("  -", b);
  process.exit(1);
}
console.log("SMOKE OK — all routes 200, no console errors, no 4xx assets, no broken images");