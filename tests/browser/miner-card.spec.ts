import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Miner crosses enemy territory underground and emerges with native effects on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("miner");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const miner = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-miner"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  await expect.poll(async () => miner()).toMatchObject({ traveling: 1, units: 0, arrivals: 0 });
  await page.locator("#second").click();
  await expect.poll(time).toBeGreaterThan(0.9);
  await expect.poll(async () => (await miner()).trails).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("miner-underground.png"), fullPage: true });
  for (let i = 0; i < 20 && (await miner()).arrivals === 0; i++) {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.099);
  }
  await expect.poll(async () => miner()).toMatchObject({ traveling: 0, units: 1, arrivals: 1, trails: [] });
  await page.screenshot({ path: info.outputPath("miner-emerged.png"), fullPage: true });
  expect(errors).toEqual([]);
});
