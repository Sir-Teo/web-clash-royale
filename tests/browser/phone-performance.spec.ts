import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { expectedAnimations } from "./native-assets";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arenaProfile?.state);
async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect
    .poll(async () => (await state(page))?.loadedAnimations, {
      timeout: 120000,
    })
    .toBe(expectedAnimations);
  await expect
    .poll(async () => (await state(page))?.ready, { timeout: 120000 })
    .toBe(true);
}
async function difference(a: Buffer, b: Buffer) {
  const { data: first, info } = await sharp(a)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const second = await sharp(b).ensureAlpha().raw().toBuffer();
  expect(second.length).toBe(first.length);
  let maximum = 0,
    changed = 0;
  for (let i = 0; i < first.length; i += 4) {
    const delta = Math.max(
      ...[0, 1, 2, 3].map((c) => Math.abs(first[i + c] - second[i + c])),
    );
    maximum = Math.max(maximum, delta);
    if (delta > 2) changed++;
  }
  return { maximum, fraction: changed / (info.width * info.height) };
}

test("bounds high-density phone texture memory and avoids duplicate sprite passes", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page, "/tests/fixtures/performance.html?swarms=8&fixedTime=3");
  const first = await state(page);
  expect(first.entities).toBe(126);
  expect(first.renderPixelRatio).toBe(1);
  expect(first.targetFps).toBe(30);
  expect(first.antialias).toBe(true);
  expect(first.shadows).toBe(false);
  expect(first.largestAtlas).toBeLessThanOrEqual(1024);
  expect(first.atlasBytes).toBeLessThan(140 * 1024 * 1024);
  expect(first.atlasBytes).toBeLessThan(first.originalAtlasBytes * 0.4);
  expect(first.drawCalls).toBeLessThan(120);
  const single = await page.screenshot({ scale: "css" });
  await page.evaluate(() =>
    (window as any).__arenaProfile.setSinglePass(false),
  );
  await expect
    .poll(async () => (await state(page)).drawCalls)
    .toBeGreaterThan(first.drawCalls);
  const double = await page.screenshot({ scale: "css" });
  const pixels = await difference(single, double);
  expect(pixels.maximum).toBeLessThanOrEqual(2);
  expect(pixels.fraction).toBe(0);
  await info.attach("phone-single-pass", {
    body: single,
    contentType: "image/png",
  });
  await info.attach("phone-render-budget", {
    body: JSON.stringify({ first, double: await state(page), pixels }),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath("phone-swarm.png"),
    scale: "css",
  });
  expect(errors).toEqual([]);
});

test("batches the phone diorama without moving or recoloring its surfaces", async ({
  page,
}, info) => {
  await ready(
    page,
    "/tests/fixtures/performance.html?swarms=0&fixedTime=3&scenery=off",
  );
  const original = await state(page),
    reference = await page.screenshot({ scale: "css" });
  await ready(page, "/tests/fixtures/performance.html?swarms=0&fixedTime=3");
  const batched = await state(page),
    image = await page.screenshot({ scale: "css" });
  expect(batched.drawCalls).toBeLessThan(original.drawCalls - 20);
  const pixels = await difference(reference, image);
  expect(pixels.fraction).toBeLessThan(0.001);
  await info.attach("scenery-comparison", {
    body: JSON.stringify({ original, batched, pixels }),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath("phone-scenery.png"),
    scale: "css",
  });
});

test("keeps a real phone battle, input, pause and result responsive at its presentation budget", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        sound: false,
        music: false,
        seenTutorial: true,
      }),
    ),
  );
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as any).__arena?.state.loadedAnimations),
      { timeout: 120000 },
    )
    .toBe(expectedAnimations);
  await page.locator("#battle-button").click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.intro.blocking),
      { timeout: 30000 },
    )
    .toBe(false);
  const start = await page.evaluate(() => (window as any).__arena.state);
  expect(start.renderTargetFps).toBe(30);
  expect(start.renderPixelRatio).toBeLessThanOrEqual(1);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions), {
      timeout: 30000,
    })
    .toBeGreaterThan(start.actions);
  const before = await page.evaluate(() => (window as any).__arena.state);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => (window as any).__arena.state);
  expect(after.renderedFrames - before.renderedFrames).toBeLessThanOrEqual(40);
  expect(after.time).toBeGreaterThan(before.time + 0.5);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const paused = await page.evaluate(() => (window as any).__arena.state.time);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__arena.state.time)).toBe(
    paused,
  );
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(page.locator("#return-home")).toBeVisible({ timeout: 20000 });
  await page.locator("#return-home").click();
  await expect(page.locator("#battle-button")).toBeVisible();
});
