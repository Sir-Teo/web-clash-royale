// Start Vite/preview on 5188. This read-only probe also works on a prior build.
import { chromium } from "playwright";
const seconds = Number(process.env.ARENA_PROFILE_SECONDS ?? 3);
if (!Number.isFinite(seconds) || seconds <= 0)
  throw new Error("Expected positive profile duration");
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
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    ),
  );
  const url = process.env.ARENA_PROFILE_URL ?? "http://127.0.0.1:5188/";
  await page.goto(url);
  await page.waitForFunction(
    () => window.__arena && window.__arena.state.renderPending === false,
    null,
    { timeout: 90000 },
  );
  await page.locator("#deck-preview [data-card-info]").first().click();
  await page
    .locator(".detail-art.native-card-ready")
    .waitFor({ timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const state = () => page.evaluate(() => window.__arena.state);
  const game = (s) => ({
    screen: s.screen,
    time: s.time,
    units: s.units,
    hand: s.hand,
    elixir: s.elixir,
    actions: s.actions,
  });
  const canvas = page.locator("#arena-canvas canvas");
  const pixels = () =>
    canvas.screenshot({
      style: "#modal-root, #toast { visibility: hidden !important; }",
      animations: "disabled",
    });
  const image = await pixels();
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await session.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const before = await metrics(),
    initial = await state(),
    started = performance.now();
  await page.waitForTimeout(seconds * 1000);
  const after = await metrics(),
    held = await state(),
    elapsedMs = performance.now() - started;
  const retained = await pixels();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForFunction(
    (frames) => window.__arena.state.renderedFrames > frames,
    held.renderedFrames,
  );
  const repainted = await pixels();
  const beforeClose = await state();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.waitForFunction(
    (frames) => window.__arena.state.renderedFrames > frames,
    beforeClose.renderedFrames,
  );
  const resumed = await state();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        url,
        elapsedMs,
        renders: held.renderedFrames - initial.renderedFrames,
        drawCallsPerFrame: held.drawCalls,
        gameUnchanged:
          JSON.stringify(game(initial)) === JSON.stringify(game(held)),
        pixelsRetained: image.equals(retained),
        repaintMatches: retained.equals(repainted),
        animationDelta: held.animationTime - initial.animationTime,
        effectDelta: held.destruction.time - initial.destruction.time,
        closeEffectDelta:
          resumed.destruction.time - beforeClose.destruction.time,
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
