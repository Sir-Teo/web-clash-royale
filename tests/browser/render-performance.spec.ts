import { test, expect } from "@playwright/test";
import { expectedAnimations, expectedBuildings, expectedEffects } from "./native-assets";

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
  expect(state.renderPixelRatio).toBeGreaterThanOrEqual(0.75);
  expect(state.renderPixelRatio).toBeLessThanOrEqual(2);
});

test("swarm sprites batch without changing the rendered frame", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/performance.html?swarms=8&fixedTime=3");
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile?.state.loadedAnimations),
    { timeout: 120000 }).toBe(expectedAnimations);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.entities).toBe(126);
  expect(state.drawCalls).toBeLessThan(520);
  const batched = await page.screenshot();
  await page.evaluate(() => (window as any).__arenaProfile.setBatch(false));
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.drawCalls))
    .toBeGreaterThan(650);
  const unbatched = await page.screenshot();
  expect(batched.equals(unbatched)).toBe(true);
  expect(errors).toEqual([]);
});

test("simultaneous crown sparks use one GPU draw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/performance.html?swarms=0&crowns=3&fixedTime=3");
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile?.state.loadedAnimations),
    { timeout: 120000 }).toBe(expectedAnimations);
  await page.evaluate(() => (window as any).__arenaProfile.burstCrowns());
  await expect.poll(async () => page.evaluate(() => (window as any).__arenaProfile.state.particles))
    .toBe(72);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.drawCalls).toBeLessThan(110);
  expect(state.geometries).toBeLessThan(70);
  expect(errors).toEqual([]);
});
