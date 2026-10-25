import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Battle Ram charges a building then releases two Barbarians on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("battle-ram");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-battle-ram"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await data()).rams.length).toBe(1);
  for (let i = 0; i < 65 && (await data()).chargeCues === 0; i++) await advance();
  expect((await data()).chargeCues).toBeGreaterThan(0);
  expect((await data()).rams[0].chargeDistance).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: info.outputPath("battle-ram-charge.png"), fullPage: true });
  for (let i = 0; i < 65 && (await data()).barbarians.length < 2; i++) await advance();
  expect((await data()).rams).toHaveLength(0);
  expect((await data()).barbarians).toHaveLength(2);
  expect((await data()).hits).toBe(1);
  expect((await data()).deaths).toBe(1);
  expect((await data()).cannon).toBe(9390);
  expect((await data()).knight).toBe(10000);
  await page.screenshot({ path: info.outputPath("battle-ram-barbarians.png"), fullPage: true });
  expect(errors).toEqual([]);
});
