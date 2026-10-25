// Start the development server on port 5188, then run this from the repo root.
// ARENA_PROFILE_URL and ARENA_PROFILE_SECONDS override the target and duration.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const seconds = Number(process.env.ARENA_PROFILE_SECONDS ?? 3);
if (!Number.isFinite(seconds) || seconds <= 0)
  throw new Error("ARENA_PROFILE_SECONDS must be positive");
const animations = JSON.parse(
  await readFile("public/assets/animations/manifest.json", "utf8"),
).files.length;
const browser = await chromium.launch({
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const deck = [
      "prince",
      "knight",
      "archers",
      "giant",
      "musketeer",
      "arrows",
      "zap",
      "fireball",
    ];
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        history: [
          {
            id: 1,
            date: "2026-10-25T00:00:00Z",
            mode: "classic",
            winner: "blue",
            crowns: [1, 0],
            replay: {
              rulesFamily: "origin",
              version: 17,
              seed: 1,
              mode: "classic",
              deck,
              enemyDeck: deck,
              actions: [
                { tick: 0, team: "blue", card: "prince", x: 14, y: 23 },
              ],
              duration: 900,
            },
          },
        ],
      }),
    );
  });
  const url = process.env.ARENA_PROFILE_URL ?? "http://127.0.0.1:5188/";
  await page.goto(url);
  await page.waitForFunction(
    (count) => window.__arena?.state.loadedAnimations === count,
    animations,
    { timeout: 90000 },
  );
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("slider", { name: "Replay timeline" }).fill("10");
  await page.waitForTimeout(1000);
  // Older builds have no renderPending field, permitting an independent baseline.
  await page.waitForFunction(
    () => window.__arena.state.renderPending !== true,
    null,
    { timeout: 60000 },
  );
  const state = () => page.evaluate(() => window.__arena.state);
  const game = (s) => ({
    time: s.time,
    units: s.units,
    hand: s.hand,
    elixir: s.elixir,
    actions: s.actions,
  });
  const canvas = page.locator("#arena-canvas canvas");
  const image = await canvas.screenshot();
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await session.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const initial = await state(),
    before = await metrics();
  const start = performance.now();
  await page.waitForTimeout(seconds * 1000);
  const after = await metrics(),
    held = await state();
  const elapsedMs = performance.now() - start;
  const retained = await canvas.screenshot();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForFunction(
    (frames) => window.__arena.state.renderedFrames > frames,
    held.renderedFrames,
  );
  const repainted = await canvas.screenshot();
  await page
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  await page.waitForFunction(
    (time) => window.__arena.state.time > time,
    held.time,
  );
  const resumed = await state();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        url,
        viewport: { width: 900, height: 700 },
        elapsedMs,
        renders: held.renderedFrames - initial.renderedFrames,
        drawCallsPerFrame: held.drawCalls,
        gameUnchanged:
          JSON.stringify(game(initial)) === JSON.stringify(game(held)),
        pixelsRetained: image.equals(retained),
        repaintMatches: retained.equals(repainted),
        effectTimeWhilePaused: held.destruction.time - initial.destruction.time,
        resumeEffectDelta: resumed.destruction.time - held.destruction.time,
        resumeMatchDelta: resumed.time - held.time,
        mainThreadMs: (after.TaskDuration - before.TaskDuration) * 1000,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
