import { chromium, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

const phone = process.argv.includes("--phone");
const stress = process.argv.includes("--stress");
const swarms = Number(process.argv.find((arg) => arg.startsWith("--swarms="))?.split("=")[1] ?? 8);
const noBatch = process.argv.includes("--no-batch");
const ratio = Number(process.argv.find((arg) => arg.startsWith("--ratio="))?.split("=")[1] ?? 0);
const fixedTime = process.argv.find((arg) => arg.startsWith("--fixed-time="))?.split("=")[1];
const duration = Number(process.env.ARENA_PROFILE_SECONDS ?? 12) * 1000;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext(
  phone
    ? { ...devices["iPhone 13"], serviceWorkers: "block" }
    : { viewport: { width: 1440, height: 900 }, serviceWorkers: "block" },
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.addInitScript(() => {
  localStorage.setItem(
    "browser-royale.profile.v1",
    JSON.stringify({
      version: 1,
      sound: false,
      music: false,
      seenTutorial: true,
    }),
  );
  const request = requestAnimationFrame.bind(window);
  window.__frameCosts = [];
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      const start = performance.now();
      callback(time);
      if (window.__frameCosts.length < 2000)
        window.__frameCosts.push(performance.now() - start);
    });
});
const started = performance.now();
await page.goto(process.env.ARENA_PROFILE_URL ??
  (stress ? `http://127.0.0.1:5188/tests/fixtures/performance.html?swarms=${swarms}&batch=${noBatch ? "off" : "on"}${fixedTime ? `&fixedTime=${fixedTime}` : ""}` : "http://127.0.0.1:5188/"));
if (!stress) {
  await page.locator("#battle-button").waitFor({ timeout: 60000 });
  await page.locator("#battle-button").click();
  await page.waitForFunction(() => !window.__arena.state.intro.blocking, null, {
    timeout: 60000,
  });
}
const boot = performance.now() - started;
const expectedAnimations = JSON.parse(
  readFileSync("public/assets/animations/manifest.json", "utf8"),
).files.length;
await page.waitForFunction(
  ({ count, stress }) => (stress ? window.__arenaProfile : window.__arena).state.loadedAnimations === count,
  { count: expectedAnimations, stress },
  { timeout: 120000 },
);
if (stress && ratio) await page.evaluate((value) => window.__arenaProfile.setRatio(value), ratio);
await page.waitForTimeout(3000);
const session = await context.newCDPSession(page);
await session.send("Profiler.enable");
await session.send("Profiler.setSamplingInterval", { interval: 1000 });
await session.send("Performance.enable");
const beforeMetrics = (await session.send("Performance.getMetrics")).metrics;
const before = await page.evaluate(() => ({
  state: (window.__arenaProfile ?? window.__arena).state,
  samples: window.__frameCosts.length,
}));
await session.send("Profiler.start");
await page.waitForTimeout(duration);
const { profile } = await session.send("Profiler.stop");
const afterMetrics = (await session.send("Performance.getMetrics")).metrics;
const after = await page.evaluate((sampleCount) => ({
  state: (window.__arenaProfile ?? window.__arena).state,
  costs: window.__frameCosts.slice(sampleCount),
}), before.samples);
if (process.argv.includes("--screenshot"))
  await page.screenshot({ path: process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "/tmp/web-clash-performance.png" });
const byMetric = (metrics, name) => metrics.find((entry) => entry.name === name)?.value ?? 0;
const costs = after.costs.sort((a, b) => a - b);
const percentile = (p) => costs[Math.floor((costs.length - 1) * p)] ?? 0;
const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
const self = new Map();
profile.samples?.forEach((id, index) => {
  const frame = nodes.get(id);
  if (!frame) return;
  const key = `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\/src\//, "src/")}:${frame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 1000));
});
console.log(JSON.stringify({
  phone,
  stress,
  swarms: stress ? swarms : undefined,
  noBatch: stress ? noBatch : undefined,
  bootMs: Math.round(boot),
  durationMs: duration,
  frames: after.state.renderedFrames - before.state.renderedFrames,
  fps: after.state.fps ?? (after.state.renderedFrames - before.state.renderedFrames) / (duration / 1000),
  drawCalls: after.state.drawCalls,
  renderPixelRatio: after.state.renderPixelRatio,
  entities: after.state.units?.length ?? after.state.entities,
  geometries: after.state.geometries,
  textures: after.state.textures,
  mainThreadMs: Math.round((byMetric(afterMetrics, "TaskDuration") - byMetric(beforeMetrics, "TaskDuration")) * 1000),
  scriptMs: Math.round((byMetric(afterMetrics, "ScriptDuration") - byMetric(beforeMetrics, "ScriptDuration")) * 1000),
  frameCostsMs: { median: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: costs.at(-1) ?? 0 },
  selfTimeMs: [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, us]) => [name, Math.round(us / 1000)]),
  errors,
}, null, 2));
await browser.close();
