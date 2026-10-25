import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Lava Hound fires native coal and releases six flying Pups on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("lava-hound");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-lava-hound"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const step = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.09);
  };
  await expect.poll(async () => (await data()).alive).toBe(true);
  for (let i = 0; i < 18 && (await data()).coals.length === 0; i++) await step();
  expect((await data()).coals).toContainEqual({ style: "lava-hound", damage: 54, air: true });
  expect((await data()).height).toBeGreaterThan(4.8);
  expect((await data()).ground.shadowHeight).toBeCloseTo(0.22);
  expect((await data()).ground.ringHeight).toBeCloseTo(0.23);
  await page.screenshot({ path: info.outputPath("lava-hound-coal.png"), fullPage: true });
  await page.locator("#kill-lava-hound").click();
  for (let i = 0; i < 30 && (await data()).alive; i++) await step();
  expect((await data()).alive).toBe(false);
  expect((await data()).pups).toHaveLength(6);
  expect((await data()).pups.every((pup: { air: boolean; hp: number }) => pup.air && pup.hp > 0)).toBe(true);
  expect((await data()).pups.every((pup: { height: number }) => pup.height > 3.3 && pup.height < 3.7)).toBe(true);
  expect((await data()).pups.every((pup: { shadowHeight: number; ringHeight: number }) =>
    Math.abs(pup.shadowHeight - 0.22) < 0.001 && Math.abs(pup.ringHeight - 0.23) < 0.001)).toBe(true);
  expect((await data()).pupCues).toBe(6);
  expect((await data()).deaths).toBe(1);
  expect((await data()).particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("lava-hound-six-pups.png"), fullPage: true });
  expect(errors).toEqual([]);
});
