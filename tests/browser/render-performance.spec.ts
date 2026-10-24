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
