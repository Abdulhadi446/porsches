import { chromium } from "playwright";
const routes = process.argv.slice(2);
const b = await chromium.launch({ args: ["--no-sandbox"] });
for (const route of routes) {
  const c = await b.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.addInitScript(() => {
    window.__lcp = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), tag: e.element?.tagName, cls: (e.element?.className?.toString?.()||"").slice(0,50), txt: (e.element?.textContent||"").slice(0,30) }); }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await p.goto("http://localhost:3111" + route, { waitUntil: "load", timeout: 90000 });
  await p.waitForTimeout(9000);
  const lcp = await p.evaluate(() => window.__lcp);
  const last = lcp[lcp.length - 1];
  console.log(route.padEnd(22), "LCP=" + (last?.t ?? "?") + "ms", last?.tag, "|", last?.txt?.replace(/\s+/g," ").slice(0,28));
  await c.close();
}
await b.close();
