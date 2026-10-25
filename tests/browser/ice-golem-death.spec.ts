import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Ice Golem death damages and slows ground and air with native snow effects", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("ice-golem");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const golem = async () => JSON.parse((await diagnostic.getAttribute("data-ice-golem"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await golem()).alive).toBe(true);
  await page.screenshot({ path: info.outputPath("ice-golem-before-death.png"), fullPage: true });
  await page.locator("#kill-ice-golem").click();
  await step();
  const impact = await golem();
  expect(impact.alive).toBe(false);
  expect(impact.deaths).toBe(1);
  expect(impact.area).toBeGreaterThan(1.8);
  expect(impact.targets.find((target: any) => !target.air)?.hp).toBeLessThan(10000);
  expect(impact.targets.some((target: any) => target.air && target.hp < 10000))
    .toBe(true);
  expect(impact.targets.every((target: any) => target.slow > 1.8)).toBe(true);
  expect(impact.cold.length).toBeGreaterThanOrEqual(2);
  expect(impact.particles).toBeGreaterThan(0);
  expect(Object.keys(impact.clips)).toContain("snowflake_anim");
  expect(Object.keys(impact.clips)).toContain("freeze_effect_ground");
  for (let i = 0; i < 3; i++) await step();
  await page.screenshot({ path: info.outputPath("ice-golem-death-slow.png"), fullPage: true });
  for (let i = 0; i < 18; i++) await step();
  expect((await golem()).area).toBe(0);
  expect(errors).toEqual([]);
});
