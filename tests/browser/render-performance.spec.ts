import { test, expect } from "@playwright/test";
import { expectedAnimations, expectedBuildings, expectedEffects } from "./native-assets";
import sharp from "sharp";

test("battle scenery stays batched after native assets load", async ({ page }) => {
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
  });
  await page.goto("/");
  await expect(page.locator("#battle-button")).toBeVisible({ timeout: 60000 });
  await expect.poll(async () => {
    const state = await page.evaluate(() => (window as any).__arena.state);
    return [state.loadedAnimations, state.loadedBuildings, state.loadedEffects];
  }, { timeout: 120000 }).toEqual([
    expectedAnimations,
    expectedBuildings,
    expectedEffects,
  ]);
  await page.locator("#battle-button").click();
  await expect.poll(
    () => page.evaluate(() => (window as any).__arena.state.intro.blocking),
    { timeout: 30000 },
  ).toBe(false);
  await expect.poll(
    () => page.evaluate(() => (window as any).__arena.state.drawCalls),
    { timeout: 10000 },
  ).toBeLessThan(160);
  const state = await page.evaluate(() => (window as any).__arena.state);
  expect(state.renderPixelRatio).toBeGreaterThanOrEqual(0.65);
  expect(state.renderPixelRatio).toBeLessThanOrEqual(2);
});

test("swarm sprites batch within one color level of the original frame", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/performance.html?swarms=8&fixedTime=3");
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile?.state.loadedAnimations),
    { timeout: 120000 }).toBe(expectedAnimations);
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.ready),
    { timeout: 120000 }).toBe(true);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.entities).toBe(126);
  expect(state.drawCalls).toBeLessThan(520);
  const batched = await page.screenshot();
  await info.attach("batched", { body: batched, contentType: "image/png" });
  await page.evaluate(() => (window as any).__arenaProfile.setBatch(false));
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.drawCalls))
    .toBeGreaterThan(state.drawCalls + 60);
  const unbatched = await page.screenshot();
  await info.attach("unbatched", { body: unbatched, contentType: "image/png" });
  if (info.project.name === "desktop") expect(batched.equals(unbatched)).toBe(true);
  const { data: a, info: image } = await sharp(batched).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(unbatched).ensureAlpha().raw().toBuffer();
  expect(b.length).toBe(a.length);
  let changed = 0, maximum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a[i + channel] - b[i + channel])));
    if (delta) changed++;
    maximum = Math.max(maximum, delta);
  }
  // WebKit's instanced vertex path can round isolated edge pixels by one
  // channel level. The measured phone frame differs at 13 of 258,960 pixels.
  expect(maximum).toBeLessThanOrEqual(1);
  expect(changed / (image.width * image.height)).toBeLessThan(0.0001);
  expect(errors).toEqual([]);
});

test("swarm shadows and rings batch with confined overlap differences", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/performance.html?swarms=8&fixedTime=3");
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile?.state.loadedAnimations),
    { timeout: 120000 }).toBe(expectedAnimations);
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.ready),
    { timeout: 120000 }).toBe(true);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.entities).toBe(126);
  expect(state.drawCalls).toBeLessThan(130);
  expect(state.geometries).toBeLessThan(90);
  const batched = await page.screenshot();
  await page.evaluate(() => (window as any).__arenaProfile.setGroundBatch(false));
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.drawCalls))
    .toBeGreaterThan(state.drawCalls + 180);
  const unbatched = await page.screenshot();
  const { data: a, info } = await sharp(batched).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(unbatched).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i += 3)
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2])) > 1) changed++;
  // Transparent overlapping markers can blend in a different order inside a
  // shared draw. The change should remain confined to their footprint.
  expect(changed / (info.width * info.height)).toBeLessThan(0.03);
  expect(errors).toEqual([]);
});

test("simultaneous crown sparks use one GPU draw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/performance.html?swarms=0&crowns=3&fixedTime=3");
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile?.state.loadedAnimations),
    { timeout: 120000 }).toBe(expectedAnimations);
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.ready),
    { timeout: 120000 }).toBe(true);
  await page.evaluate(() => (window as any).__arenaProfile.burstCrowns());
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.particles))
    .toBe(72);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.drawCalls).toBeLessThan(110);
  expect(state.geometries).toBeLessThan(70);
  expect(errors).toEqual([]);
});
