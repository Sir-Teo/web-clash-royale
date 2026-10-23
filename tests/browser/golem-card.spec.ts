import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Golem uses native art and explodes into two Golemites on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("golem");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-golem"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const step = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.09);
  };
  await expect.poll(async () => (await data()).alive).toBe(true);
  await page.locator("#second").click();
  await expect.poll(time).toBeGreaterThan(0.99);
  await expect.poll(async () => (await data()).fireflies.reduce(
    (sum: number, [, count]: [string, number]) => sum + count, 0,
  )).toBeGreaterThan(0);
  expect((await data()).fireflies.every(([clip]: [string, number]) =>
    clip.startsWith("Golem_firefly_blue_"))).toBe(true);
  await page.screenshot({ path: info.outputPath("golem-original-model.png"), fullPage: true });
  await page.locator("#kill-golem").click();
  for (let i = 0; i < 30 && (await data()).alive; i++) await step();
  expect((await data()).alive).toBe(false);
  expect((await data()).children).toHaveLength(2);
  expect((await data()).childCues).toBe(2);
  expect((await data()).deaths).toBe(1);
  expect((await data()).targets.every((target: { hp: number }) => target.hp < 10000)).toBe(true);
  for (let i = 0; i < 10 && (await data()).particles === 0; i++) await step();
  expect((await data()).particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("golem-explosion-golemites.png"), fullPage: true });
  expect(errors).toEqual([]);
});
